/**
 * The flow pass (ADR 0070, ADR 0071): a syntactic, import-resolved,
 * context-sensitive data-flow analysis that follows capability field data
 * through local variables, destructuring, spreads, object and array
 * literals, function parameters and return values, closures, callbacks and
 * known sinks, and produces the input for `buildFlowModel`.
 *
 * It evaluates expressions to abstract values (`flow-values.ts`): bags of
 * (origin field, path) atoms with known properties. Each function is
 * evaluated once per distinct argument shape (memoized), starting from every
 * function with empty arguments (so direct reads are found) and from each
 * call with the arguments' real values (so interprocedural flow is found).
 * Edges carry the origin field, so a helper shared by two fields never makes
 * one appear to reach the other's destinations.
 *
 * Never imports or evaluates the code it reads (ADR 0002); the compiler API
 * parses text only. Anything it cannot follow -- a call it cannot resolve
 * that receives tracked data, a computed key on tracked data, a call chain
 * deeper than its limit -- becomes an explicit `FlowUnknown` with a
 * `file:line:column` citation, and the data is assumed to pass through
 * approximately (an `inferred` edge). It never guesses silently (ADR 0071).
 *
 * Operation bodies (`createData`/`buildData`/`documentData` arguments) stay
 * opaque (AGENTS.md invariant 6).
 */

import type TS from "typescript"
import type { DataFlowEndpoint } from "../core/document.js"
import { assertCompilerApi } from "./compiler-api.js"
import type { ScanTarget } from "./dependency-graph.js"
import { absolutePathFrom, displayPath } from "./display-path.js"
import { identifierCounts, isPureDerivation } from "./flow-derivation.js"
import { HeapCells } from "./flow-heap.js"
import { buildScanTargets } from "./generate-usage.js"
import type {
  FlowBoundaryKind,
  FlowEdgeInput,
  FlowEdgeTagInput,
  FlowHandling,
  FlowModelInput,
  FlowNodeInput,
  FlowStatus,
  FlowUnknownInput,
  FlowUnknownReason,
} from "../flow/flow-model.js"
import { flowEdgeId, flowNodeId } from "../flow/flow-model.js"
import {
  accessDynamic,
  accessKey,
  allocsOf,
  ANY_KEY,
  approximate,
  atomVal,
  declaredVal,
  dropHandles,
  ELEMENT_KEY,
  EMPTY_VAL,
  flattenAtoms,
  GENERATOR_HANDLE,
  handlesOf,
  handleVal,
  MAP_KEYS,
  MAP_VALUES,
  mapVal,
  mergeVals,
  objectVal,
  OPAQUE_ALLOC,
  PROMISE_HANDLE,
  recordVal,
  REJECT_HANDLE,
  remapAllocs,
  RESOLVE_HANDLE,
  setVal,
  signatureOf,
  withAlloc,
  withEntry,
  withoutAlloc,
  withoutExternal,
} from "./flow-values.js"
import type { Allocated, Atom, Val } from "./flow-values.js"
import { isGeneratedFile } from "./generated-banner.js"
import type { CapabilityInventory, CapabilityNode } from "./inventory.js"
import type { ImportBinding, ParseWarning } from "./parse.js"
import {
  createAliasResolutionCache,
  loadTsconfigPaths,
} from "./resolution/resolve-tsconfig-paths.js"
import { resolveImportSpecifier } from "./resolution/resolve-import.js"
import type { ImportResolutionContext } from "./resolution/resolve-import.js"
import { collectFileImports, matchFileImports } from "./scan-dependencies.js"
import { positionOf } from "./source-position.js"
import type { SourceLocation } from "./source-position.js"
import { ts } from "./typescript.js"
import type { BuildFileSystem } from "./types.js"

/** A call whose arguments leave the program through a boundary. Matched by the root identifier and final member name of the callee (`res.status(200).json` matches `res.json`). */
export interface FlowSinkPattern {
  /** `root.method`, for example `res.json`. */
  readonly callee: string
  readonly boundary: { readonly kind: FlowBoundaryKind; readonly name: string }
  /** Declared data-safety state of what is sent here, when it is always the same. */
  readonly handling?: FlowHandling
}

function defaultFlowSinks(): readonly FlowSinkPattern[] {
  return [
    ...["json", "send", "end", "write", "render", "redirect"].map((method) => ({
      callee: `res.${method}`,
      boundary: { kind: "client-response" as const, name: "http-response" },
    })),
    { callee: "reply.send", boundary: { kind: "client-response", name: "http-response" } },
    { callee: "Response.json", boundary: { kind: "client-response", name: "http-response" } },
    { callee: "NextResponse.json", boundary: { kind: "client-response", name: "http-response" } },
    ...["log", "info", "warn", "error", "debug", "trace"].map((method) => ({
      callee: `console.${method}`,
      boundary: { kind: "log" as const, name: "console" },
    })),
    ...["info", "warn", "error", "debug", "trace", "log"].map((method) => ({
      callee: `logger.${method}`,
      boundary: { kind: "log" as const, name: "logger" },
    })),
  ]
}

/** Sinks recognised without configuration. */
export const DEFAULT_FLOW_SINKS: readonly FlowSinkPattern[] = defaultFlowSinks()

/**
 * What a call to a function of a package does, as the project's author states it. A package's code is never read
 * (ADR 0002), so this is the only sound way past it: without a summary, a call that receives tracked data is an
 * explicit unknown. Whatever a summary lets the scan follow is `declared` evidence (ADR 0071), never `static`: it
 * is the author's word, not the scan's proof.
 *
 * `module` is the specifier as the code writes it (`lodash`, `lodash/fp`, `@acme/sdk`). `export` is the name it is
 * imported by (`pick`), `default` for a default import, or a dotted path to a member (`z.object`,
 * `default.get`). A member of a default import also matches the bare member name (`_.pick` matches `pick`), for
 * packages whose default export is the object of their named exports. The first summary that matches wins.
 */
export type FlowSummary = {
  readonly module: string
  readonly export: string
} & (
  | {
      /** The result holds everything the arguments hold. */
      readonly effect: "pass-through"
      /** Set when the result is a transformed or partial copy (`pick`, `omit`): its data is then inferred, not exact. */
      readonly approximate?: true
    }
  | {
      /** The result holds what the argument at `arg` holds, and nothing the others hold. */
      readonly effect: "returns-arg"
      readonly arg: number
      readonly approximate?: true
    }
  | {
      /** The arguments leave the program through `boundary`; the result holds nothing. */
      readonly effect: "sink"
      readonly boundary: FlowSinkPattern["boundary"]
      readonly handling?: FlowHandling
    }
  | {
      /** The result holds none of what the arguments hold (a hash, a redaction, a count): the call is not an unknown. */
      readonly effect: "sanitizes"
    }
  | {
      /** The call neither carries data nor sends it anywhere (a metric name, a validator that only throws). */
      readonly effect: "ignores"
    }
)

/** Options for `scanFlow`. */
export interface ScanFlowOptions {
  /** The capabilities whose field data is tracked. */
  readonly inventory: CapabilityInventory
  /** Absolute paths of every project file to analyze. */
  readonly files: readonly string[]
  /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
  readonly fs: BuildFileSystem
  /** Directory import specifiers resolve against and paths are published relative to. */
  readonly root: string
  /** Explicit `tsconfig.json` path override, or `false` to disable alias resolution. */
  readonly tsconfig?: string | false | undefined
  /** Explicit cross-package allowlist, as for `scanDependencies`. */
  readonly packages?: readonly string[] | undefined
  /** Sinks to recognise instead of `DEFAULT_FLOW_SINKS`. */
  readonly sinks?: readonly FlowSinkPattern[] | undefined
  /** What calls into packages do, declared by the project. Each makes a call that would be an unknown a `declared` fact instead. */
  readonly summaries?: readonly FlowSummary[] | undefined
}

/** What `scanFlow` found. */
export interface ScanFlowResult {
  /** The facts, ready for `buildFlowModel`. */
  readonly input: FlowModelInput
  /** Resolution warnings, never blocking. */
  readonly warnings: readonly ParseWarning[]
}

/** The bounds the flow pass works within; `scanFlowWithin` takes smaller ones, so a test can reach each in moments. */
export interface ScanLimits {
  /** How deep calls are followed before the rest is reported as unknown. */
  readonly maxCallDepth: number
  /** How many evaluation steps the whole analysis may take before every later function is left unanalyzed. */
  readonly maxSteps: number
  /** How many files a re-export may be followed through, so a cycle of re-exports ends the search. */
  readonly maxExportHops: number
}

/** The bounds `scanFlow` works within. */
export function defaultScanLimits(): ScanLimits {
  return { maxCallDepth: 40, maxSteps: 3_000_000, maxExportHops: 9 }
}

// Name tables are functions, not module constants: a constant is evaluated at import and belongs to no test.
function isOpaqueCallee(name: string): boolean {
  return ["createData", "buildData", "documentData"].includes(name)
}

function isThenMethod(name: string): boolean {
  return ["then", "catch", "finally"].includes(name)
}

function isElementCallbackMethod(name: string): boolean {
  return [
    "map",
    "flatMap",
    "forEach",
    "filter",
    "find",
    "findLast",
    "some",
    "every",
    "findIndex",
    "findLastIndex",
    "sort",
    "toSorted",
  ].includes(name)
}

function isReduceMethod(name: string): boolean {
  return ["reduce", "reduceRight"].includes(name)
}

function isShapePreservingMethod(name: string): boolean {
  return [
    "slice",
    "concat",
    "reverse",
    "flat",
    "at",
    "filter",
    "find",
    "findLast",
    "sort",
    "toSorted",
    "toReversed",
    "splice",
    "valueOf",
  ].includes(name)
}

function isTransformingMethod(name: string): boolean {
  return [
    "toString",
    "toLowerCase",
    "toUpperCase",
    "trim",
    "trimStart",
    "trimEnd",
    "substring",
    "substr",
    "split",
    "join",
    "replace",
    "replaceAll",
    "padStart",
    "padEnd",
    "repeat",
    "normalize",
    "charAt",
    "toFixed",
    "toISOString",
    "toLocaleString",
    "toJSON",
    "toLocaleLowerCase",
    "toLocaleUpperCase",
  ].includes(name)
}

function isPredicateMethod(name: string): boolean {
  return [
    "includes",
    "indexOf",
    "lastIndexOf",
    "some",
    "every",
    "startsWith",
    "endsWith",
    "has",
    "hasOwnProperty",
    "test",
    "localeCompare",
    "isArray",
    "keys",
    "isNaN",
    "isFinite",
    "isInteger",
    "findIndex",
    "findLastIndex",
  ].includes(name)
}

function isBuiltinRoot(name: string): boolean {
  return [
    "JSON",
    "Math",
    "Number",
    "String",
    "Boolean",
    "Array",
    "Object",
    "Promise",
    "Date",
    "BigInt",
    "Intl",
    "Buffer",
    "Reflect",
    "Map",
  ].includes(name)
}

/** @internal Exported for direct unit coverage. */
export function isBuiltinExact(name: string): boolean {
  return [
    "Object.assign",
    "Object.freeze",
    "Object.seal",
    "Object.setPrototypeOf",
    "Promise.resolve",
  ].includes(name)
}

function isBuiltinEmpty(name: string): boolean {
  return [
    "Object.keys",
    "Object.getOwnPropertyNames",
    "Array.isArray",
    "Number.isNaN",
    "Number.isFinite",
    "Number.isInteger",
    "Object.hasOwn",
    "Object.is",
  ].includes(name)
}

function isBuiltinGlobal(name: string): boolean {
  return [
    "String",
    "Number",
    "Boolean",
    "parseInt",
    "parseFloat",
    "encodeURIComponent",
    "decodeURIComponent",
    "encodeURI",
    "decodeURI",
    "btoa",
    "atob",
    "BigInt",
  ].includes(name)
}

type FunctionLike =
  | TS.ArrowFunction
  | TS.FunctionExpression
  | TS.FunctionDeclaration
  | TS.MethodDeclaration
  | TS.ConstructorDeclaration
  | TS.GetAccessorDeclaration
  | TS.SetAccessorDeclaration

type ClassLike = TS.ClassDeclaration | TS.ClassExpression

/** What a function is for: a plain function, a class method (instance or static), or a class constructor. */
type FunctionRole = "plain" | "method" | "static" | "constructor"

/** @internal Exported for direct unit coverage. */
export class Env {
  private readonly vars = new Map<string, Val>()
  /** The text of a `const` bound to a string literal: the key `o[k]` stands for. */
  private readonly texts = new Map<string, string>()
  /**
   * `boundary` marks the scope of a function or a module: what lies beyond it is shared with other functions.
   * `persistent` marks a scope that outlives one round of the analysis (a module's, the globals): only a write into one
   * can show a function analyzed earlier something new, since every function's own scopes are made afresh each round.
   */
  constructor(
    readonly parent?: Env,
    private readonly boundary = false,
    private readonly persistent = false,
  ) {}
  get(name: string): Val | undefined {
    return this.vars.get(name) ?? this.parent?.get(name)
  }
  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false)
  }
  set(name: string, val: Val): void {
    this.vars.set(name, val)
    this.texts.delete(name)
  }
  /** Records that the `const` just bound to `name` here holds this string, whatever it is used as later. */
  setText(name: string, text: string): void {
    this.texts.set(name, text)
  }
  /** The string `name` is a constant for -- looked up in the scope that declares it, so a shadowing variable hides it. */
  textOf(name: string): string | undefined {
    if (this.vars.has(name)) return this.texts.get(name)
    return this.parent?.textOf(name)
  }
  /** The value of `name`, or the empty value when it is not bound anywhere. */
  lookup(name: string): Val {
    return this.get(name) ?? EMPTY_VAL
  }
  /**
   * Merges `val` into the nearest existing binding of `name`, or defines it here. Returns true when that changed a
   * binding beyond the running function's own scope (module state, a captured variable): other functions see it too.
   */
  assign(name: string, val: Val): boolean {
    return this.assignFrom(name, val, false)
  }
  private assignFrom(name: string, val: Val, shared: boolean): boolean {
    const { parent } = this
    if (parent === undefined || this.vars.has(name) || !parent.has(name)) {
      const existing = this.vars.get(name)
      const merged = existing === undefined ? val : mergeVals(existing, val)
      this.vars.set(name, merged)
      this.texts.delete(name)
      if (!shared || !this.persistent) return false
      // Stryker disable next-line ConditionalExpression: equivalent -- a write reaches this scope as `shared` only because it has the name, so `existing` is never undefined then; the check only satisfies the type checker.
      return existing !== undefined && signatureOf(existing) !== signatureOf(merged)
    }
    return parent.assignFrom(name, val, shared || this.boundary)
  }
}

interface ExportRef {
  /** The file the export list is in -- where a name declared there is looked up. */
  readonly owner: FileInfo
  /** The file the name is re-exported from; `undefined` when it is declared in the exporting file. */
  readonly file: string | undefined
  readonly name: string
}

/** What an export name finally stands for. */
type ExportTarget =
  | { readonly kind: "function"; readonly fn: FunctionInfo }
  | { readonly kind: "class"; readonly cls: ClassInfo }
  | { readonly kind: "value"; readonly file: FileInfo; readonly name: string }
  | { readonly kind: "namespace"; readonly file: string }

interface FileInfo {
  readonly file: string
  readonly scope: string
  readonly sourceFile: TS.SourceFile
  readonly capabilityBindings: Map<string, string>
  readonly resolvedImports: Map<string, { readonly file: string; readonly name: string }>
  readonly namespaces: Map<string, string>
  /** Every imported name that is not (or not yet) a project module's: `module` as written and the name imported (`*` for a namespace). */
  readonly packageImports: Map<string, { readonly module: string; readonly name: string }>
  readonly topFunctions: Map<string, FunctionInfo>
  readonly topClasses: Map<string, ClassInfo>
  /** Names declared by module-level variables (and a default-exported expression): exports that stand for a value. */
  readonly valueNames: Set<string>
  /** Files this one re-exports wholesale (`export * from`), resolved. */
  readonly stars: string[]
  /** Literal specifiers of `import("...")` and `require("...")` calls in this file, resolved to the file they load. */
  readonly dynamicImports: Map<string, string>
  readonly exports: Map<string, ExportRef>
  readonly moduleStatements: TS.Statement[]
  moduleEnv: Env
  moduleStarted: boolean
}

interface FunctionInfo {
  readonly key: string
  readonly file: FileInfo
  readonly name: string
  readonly node: FunctionLike | undefined
  readonly params: readonly TS.ParameterDeclaration[]
  /** The class a method, accessor or constructor belongs to. */
  cls: ClassInfo | undefined
  role: FunctionRole
  closureEnv: Env | undefined
  /** Set on a closure created by one particular evaluation of the code that makes it: it keeps the scope of that evaluation. */
  readonly instance: string | undefined
  /** Set on a function made by `bind`: what it fixes. */
  readonly bound: BoundArguments | undefined
}

/** What `fn.bind(thisArg, ...args)` fixed: the receiver (when given) and the leading arguments. */
interface BoundArguments {
  readonly thisVal: Val | undefined
  readonly args: readonly Val[]
}

interface ClassInfo {
  readonly key: string
  readonly name: string
  readonly file: FileInfo
  readonly node: ClassLike
  /** The scope the class was declared in -- where its members and `extends` clause are resolved. */
  readonly env: Env
  /** Methods and accessors by `<kind>:<static|instance>:<name>` (see `memberKey`). */
  readonly members: Map<string, FunctionInfo>
  readonly fields: TS.PropertyDeclaration[]
  readonly statics: (TS.PropertyDeclaration | TS.ClassStaticBlockDeclaration)[]
  /** The declared constructor, or an implicit one that only initializes fields and hands its arguments to the superclass. */
  ctor: FunctionInfo
  /** Stands for the class's static initializers and blocks. */
  staticFn: FunctionInfo | undefined
  staticVals: Map<string, Val> | undefined
  /** The superclass once looked up: a project class, "opaque" when it is not one, "none" when there is no `extends`. */
  parent: ClassInfo | "opaque" | "none" | undefined
  /** Set on a class made by one evaluation of a class expression or declaration inside a function: its members share that evaluation's scope. */
  readonly evaluation: string | undefined
  /** Whether the decorators written on the class and its members have run. */
  decorated: boolean
  /** Members (by `memberKey`) a decorator the scan cannot follow may have replaced. */
  readonly opaque: Set<string>
  /** Set when a class decorator the scan cannot follow may have replaced the whole class. */
  opaqueClass: boolean
  /** What a class decorator that the scan follows returned in place of the class. */
  replacement: Val | undefined
}

interface OperationInfo {
  readonly kind: "getter" | "mutator" | "subscription"
  readonly endpoints: readonly DataFlowEndpoint[]
}

interface CapInfo {
  readonly key: string
  readonly node: CapabilityNode
  readonly fieldIds: Map<string, string>
  readonly operations: Map<string, OperationInfo>
}

interface Frame {
  readonly fn: FunctionInfo
  readonly env: Env
  readonly returns: Val[]
  readonly depth: number
  /** What `throw` statements (and the calls made here that throw) raised. */
  readonly thrown: Val[]
  /** What a generator yielded. */
  readonly yields: Val[]
  /** Names that had a property stored into them here: an object the caller may share. */
  readonly mutated: Set<string>
  /** Names bound to something that may be shared with another name (`const b = a`, a destructured part, a loop element). */
  readonly aliased: Set<string>
  /** True when nothing called this function: it is analyzed on its own, with empty arguments. */
  readonly root: boolean
  /** The scope of the function itself: `var` declarations land here even when written inside a block. */
  readonly fnEnv: Env
  /** Identifies this evaluation of the function by what it was called with: stable from one round of the analysis to the next. */
  readonly callKey: string
}

/** Where a call is made from: the frame making it and the node it is made at. */
interface CallSite {
  readonly caller: Frame
  readonly site: TS.Node
  /** The argument expressions, so an object the callee filled in can be written back to the caller's variable. */
  readonly argExprs?: readonly TS.Expression[]
  /** The receiver expression of a method call, for the same reason. */
  readonly receiver?: TS.Expression
}

/** What a call to a function produced, remembered per distinct argument shape. */
interface CallRecord {
  returnVal: Val
  /** Values of the arguments (by index; -1 is `this`) the callee stored properties into. */
  readonly outs: Map<number, Val>
  /** What the callee threw. */
  thrown: Val
}

/** How a function is entered beyond its arguments. */
interface AnalyzeOptions {
  /** The receiver (`this`) of a method call. */
  readonly thisVal?: Val
  /** Set when the function is a constructor being run for an instance of this class. */
  readonly construct?: ClassInfo
  /** Set when a plain function is run as a constructor (`new Foo()` with a function `Foo`): `this` is the instance it returns. */
  readonly constructs?: true
}

/** A value some function resolved or rejected a promise with. */
interface Settlement {
  readonly from: string
  readonly val: Val
}

/** Everything a promise was settled with so far. `read` is set once anything awaited it: a later settlement then asks for another round. */
interface PromiseSlot {
  readonly resolved: Map<string, Settlement>
  readonly rejected: Map<string, Settlement>
  read: boolean
}

/** What `next(x)` handed one evaluation of a generator. */
interface SentSlot {
  readonly values: Map<string, Val>
}

interface EntryRecord {
  readonly fn: FunctionInfo
  readonly origin: string
  readonly entryPath: readonly string[]
  readonly touched: (readonly string[])[]
}

type SinkSpec =
  | { readonly kind: "return" }
  | { readonly kind: "arg"; readonly callee: FunctionInfo; readonly index: number }
  | {
      readonly kind: "boundary"
      readonly id: string
      readonly handling?: FlowHandling | undefined
      /** Set when the boundary was declared by a summary: the crossing is the author's word. */
      readonly declared?: true
    }
  | {
      readonly kind: "operation"
      readonly cap: CapInfo
      readonly operation: string
      readonly info: OperationInfo
    }

function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => path[index] === segment)
}

function isFunctionLikeNode(node: TS.Node): node is TS.ArrowFunction | TS.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function unwrap(expression: TS.Expression): TS.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  )
    return unwrap(expression.expression)
  return expression
}

function keyOf(name: TS.PropertyName | TS.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
    return name.text
  return undefined
}

/** An object-shaped sample value -- not null, not an array, not a scalar. */
function isShapeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The sample shape one path segment below `shape`, or `undefined` when there is none. */
function childShape(shape: unknown, segment: string): unknown {
  if (Array.isArray(shape)) return segment === ELEMENT_KEY ? shape[0] : undefined
  return isShapeObject(shape) && Object.hasOwn(shape, segment) ? shape[segment] : undefined
}

function shapeAt(shape: unknown, path: readonly string[]): unknown {
  const [segment, ...rest] = path
  return segment === undefined ? shape : shapeAt(childShape(shape, segment), rest)
}

/** Every variable name a binding introduces (`a`, or `a` and `b` for `{ a, c: [b] }`). */
function bindingNames(name: TS.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  const elements: readonly (TS.BindingElement | TS.OmittedExpression)[] = name.elements
  return elements.filter(ts.isBindingElement).flatMap((element) => bindingNames(element.name))
}

function hasModifier(node: TS.Node, kind: TS.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  )
}

/** The name a class member or object method answers to; `[Symbol.iterator]` for that computed key, `undefined` for any other computed one. */
function memberName(name: TS.PropertyName): string | undefined {
  if (ts.isPrivateIdentifier(name)) return name.text
  if (ts.isComputedPropertyName(name)) {
    const inner = unwrap(name.expression)
    return ts.isPropertyAccessExpression(inner) &&
      ts.isIdentifier(inner.expression) &&
      inner.expression.text === "Symbol"
      ? `[Symbol.${inner.name.text}]`
      : undefined
  }
  return keyOf(name)
}

/** The key an object literal stores a getter or setter under -- one no property of that object can have. */
function accessorKey(kind: "get" | "set", key: string): string {
  return `\u0000${kind}:${key}`
}

/** Whether `val`, or anything below it, is a capability or its `fields` object: something whose data is only read when asked for. */
function holdsFields(val: Val): boolean {
  return (
    val.fieldsOf !== undefined ||
    val.capability !== undefined ||
    [...val.props.values()].some(holdsFields)
  )
}

/** Whether `val`, or anything below it, is a promise made by `new Promise`. */
function holdsPromise(val: Val): boolean {
  return handlesOf(val, PROMISE_HANDLE).length > 0 || [...val.props.values()].some(holdsPromise)
}

/** The property a promise value keeps what it was rejected with under -- a name no property of any object can have. */
function rejectedKey(): string {
  return "\u0000rejected"
}

/** The value with the rejection taken off: what an `await` returns when it does not throw. */
function settled(val: Val): Val {
  const props = new Map(val.props)
  props.delete(rejectedKey())
  return { ...val, props }
}

function memberKey(kind: "method" | "get" | "set", isStatic: boolean, name: string): string {
  return `${kind}:${isStatic ? "static" : "instance"}:${name}`
}

/** Reads the string an expression is for sure: a literal, or a `const` bound to one. */
type LiteralReader = (expression: TS.Expression) => string | undefined

/** The key one link of a member chain reads or writes. `dynamic` when it is a computed key that is not a literal. */
function linkKey(
  link: TS.PropertyAccessExpression | TS.ElementAccessExpression,
  literal: LiteralReader,
): {
  readonly key: string
  readonly dynamic: boolean
} {
  if (ts.isPropertyAccessExpression(link)) return { key: link.name.text, dynamic: false }
  const index = unwrap(link.argumentExpression)
  const text = literal(index)
  if (text !== undefined) return { key: text, dynamic: false }
  return { key: ELEMENT_KEY, dynamic: !ts.isNumericLiteral(index) }
}

/** The name an assignment through `target` ends up changing, and the keys walked to get there (root first). `root` is `undefined` when it is not a plain variable or `this`. */
function memberChain(
  target: TS.Expression,
  literal: LiteralReader = () => undefined,
): {
  readonly root: string | undefined
  readonly keys: readonly string[]
  readonly dynamic: boolean
} {
  const keys: string[] = []
  let dynamic = false
  let current = unwrap(target)
  // The step to the next link is in the header, so a body that does nothing still walks the chain to its end.
  for (
    ;
    ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current);
    current = unwrap(current.expression)
  ) {
    const link = linkKey(current, literal)
    keys.unshift(link.key)
    dynamic = dynamic || link.dynamic
  }
  if (ts.isIdentifier(current)) return { root: current.text, keys, dynamic }
  if (current.kind === ts.SyntaxKind.ThisKeyword) return { root: "this", keys, dynamic }
  return { root: undefined, keys, dynamic }
}

/** A name bound to one of these may share its object with another name. */
function isReferenceExpression(expression: TS.Expression | undefined): boolean {
  if (expression === undefined) return false
  const target = unwrap(expression)
  return (
    ts.isIdentifier(target) ||
    ts.isPropertyAccessExpression(target) ||
    ts.isElementAccessExpression(target) ||
    target.kind === ts.SyntaxKind.ThisKeyword
  )
}

/** What a method call is made through: a receiver expression and the name of the method (`a.b`, or `a["b"]` with a literal key). */
interface MemberCallee {
  readonly expression: TS.Expression
  readonly name: { readonly text: string }
}

/** The receiver and method name of a callee written `a.b` or `a["b"]`. */
function memberCallee(callee: TS.Expression, literal: LiteralReader): MemberCallee | undefined {
  if (ts.isPropertyAccessExpression(callee)) return callee
  if (!ts.isElementAccessExpression(callee)) return undefined
  const text = literal(unwrap(callee.argumentExpression))
  return text === undefined ? undefined : { expression: callee.expression, name: { text } }
}

function isLogicalOperator(kind: TS.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ].includes(kind)
}

/** The assignment operators whose result is one of the values around them (`+=` alters it; `||=`, `??=`, `&&=` pick one). */
function isCompoundAssignment(kind: TS.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ].includes(kind)
}

/** The operators that compute a new value out of both operands. */
function isArithmeticOperator(kind: TS.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.MinusToken,
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.PercentToken,
    ts.SyntaxKind.AsteriskAsteriskToken,
    ts.SyntaxKind.AmpersandToken,
    ts.SyntaxKind.BarToken,
    ts.SyntaxKind.CaretToken,
    ts.SyntaxKind.LessThanLessThanToken,
    ts.SyntaxKind.GreaterThanGreaterThanToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ].includes(kind)
}

/** An expression that only wraps another one (`(x)`, `x as T`, `x!`, `x satisfies T`, `<T>x`): it evaluates to what it wraps. */
function isTransparentWrapper(
  node: TS.Node,
): node is
  | TS.ParenthesizedExpression
  | TS.AsExpression
  | TS.NonNullExpression
  | TS.SatisfiesExpression
  | TS.TypeAssertion {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
}

/** `a.union(b)` and the other set methods of ES2025: the set they make holds items of `a`, of `b`, or of both; the ones that only ask hold nothing. `undefined` for any other method. */
function setAlgebra(name: string, items: Val, other: Val): Val | undefined {
  if (["isSubsetOf", "isSupersetOf", "isDisjointFrom"].includes(name)) return EMPTY_VAL
  if (["union", "symmetricDifference"].includes(name)) return setVal(mergeVals(items, other))
  return ["intersection", "difference"].includes(name) ? setVal(items) : undefined
}

/** An array value whose every element is `element`. */
function arrayOf(element: Val): Val {
  return { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, element]]) }
}

/** The `[key, value]` literals of `[[k1, v1], [k2, v2]]`; `undefined` when the argument is anything else. */
function literalPairs(expression: TS.Expression): readonly TS.ArrayLiteralExpression[] | undefined {
  const list = unwrap(expression)
  if (!ts.isArrayLiteralExpression(list) || list.elements.length === 0) return undefined
  const pairs = list.elements.map((element) => unwrap(element))
  const literals = pairs.filter(ts.isArrayLiteralExpression)
  const fits = (pair: TS.ArrayLiteralExpression): boolean =>
    pair.elements.length <= 2 && !pair.elements.some(ts.isSpreadElement)
  return literals.length === pairs.length && literals.every(fits) ? literals : undefined
}

/** What `m.set(a, b).set(c, d)` stores into: the expression at the start of the chain of `set` / `add` calls. */
function collectionBase(expression: TS.Expression): TS.Expression {
  const current = unwrap(expression)
  if (!ts.isCallExpression(current)) return current
  const callee = unwrap(current.expression)
  if (!ts.isPropertyAccessExpression(callee) || !["set", "add"].includes(callee.name.text))
    return current
  return collectionBase(callee.expression)
}

/** Whether `expression` is `Array.prototype.m` / `Object.prototype.m` / `[].m` and the like: the method name, otherwise `undefined`. */
function prototypeMethod(
  expression: TS.Expression,
  shadowed: (name: string) => boolean,
): string | undefined {
  const target = unwrap(expression)
  if (!ts.isPropertyAccessExpression(target)) return undefined
  const holder = unwrap(target.expression)
  if (ts.isArrayLiteralExpression(holder) && holder.elements.length === 0) return target.name.text
  if (!ts.isPropertyAccessExpression(holder) || holder.name.text !== "prototype") return undefined
  const owner = unwrap(holder.expression)
  const builtin =
    ts.isIdentifier(owner) &&
    ["Array", "Object", "String", "Number", "Boolean"].includes(owner.text) &&
    !shadowed(owner.text)
  return builtin ? target.name.text : undefined
}

/** The literal specifier a node loads at run time: `import("x")`, `require("x")` or `import a = require("x")`. */
function loadedSpecifier(node: TS.Node): string | undefined {
  let argument: TS.Expression | undefined
  if (ts.isCallExpression(node)) {
    const isLoad =
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require")
    argument = isLoad ? node.arguments[0] : undefined
  } else if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    argument = node.moduleReference.expression
  }
  const literal = argument === undefined ? undefined : unwrap(argument)
  return literal !== undefined && ts.isStringLiteralLike(literal) ? literal.text : undefined
}

/** The decorators written on a class, a member or a parameter, in source order. */
function decoratorsOf(node: TS.Node): TS.Decorator[] {
  return ts.canHaveDecorators(node) ? [...(ts.getDecorators(node) ?? [])] : []
}

/** A function made by `bind` runs with what was bound ahead of what the call gives, and with the receiver that was bound. */
function withBound(
  fn: FunctionInfo,
  given: readonly Val[],
  own: AnalyzeOptions,
): { readonly args: readonly Val[]; readonly options: AnalyzeOptions } {
  if (fn.bound === undefined) return { args: given, options: own }
  const options = fn.bound.thisVal === undefined ? own : { ...own, thisVal: fn.bound.thisVal }
  return { args: [...fn.bound.args, ...given], options }
}

/** What a package exports: only a declared summary can say what a call to it does. */
function externalVal(module: string, path: string): Val {
  return { ...EMPTY_VAL, external: `${module}\u0000${path}`, alloc: [OPAQUE_ALLOC] }
}

/** The package export a member of `external` is: `_.pick` on the default import of `lodash`, `z.object` on the named import `z`. */
function externalMember(external: string, key: string): readonly [string, string] {
  // `split` always gives at least the module.
  const [module, path = ""] = external.split("\u0000") as [string, string?]
  return [module, path === "*" ? key : `${path}.${key}`]
}

/** The identity of an export of a package, as `summaryFor` looks it up. */
function externalKey([module, path]: readonly [string, string]): string {
  return `${module}\u0000${path}`
}

function isAsyncFunction(node: FunctionLike | undefined): boolean {
  return node !== undefined && hasModifier(node, ts.SyntaxKind.AsyncKeyword)
}

function isGeneratorFunction(node: FunctionLike | undefined): boolean {
  return node !== undefined && "asteriskToken" in node && node.asteriskToken !== undefined
}

class FlowScan {
  readonly nodes = new Map<string, FlowNodeInput>()
  readonly edges = new Map<string, FlowEdgeInput>()
  readonly unknowns = new Map<
    string,
    FlowUnknownInput & { readonly data: readonly { origin: string; path: readonly string[] }[] }
  >()
  readonly warnings: ParseWarning[] = []
  private readonly functions = new Map<string | undefined, FunctionInfo>()
  private readonly nestedByNode = new Map<TS.Node, FunctionInfo>()
  /** Closures by the token a value carries: one per evaluation of the expression that makes them, each with its own scope. */
  private readonly instances = new Map<string, FunctionInfo>()
  private readonly instanceTokens = new WeakMap<Env, Map<string, string>>()
  /** The round of the analysis (0 before the first) that made each closure or method of a class a call made, when no function analyzed on its own made it. */
  private readonly madeByCalls = new Map<string, number>()
  private round = 0
  /** What `globalThis`, `window` and undeclared names refer to: shared by every file. */
  private readonly globalEnv = new Env(undefined, undefined, true)
  private readonly classes = new Map<string | undefined, ClassInfo>()
  private readonly classByNode = new Map<TS.Node, ClassInfo>()
  /** Keys of the functions that were created as closures (arrows, function expressions, object methods). */
  private readonly closureKeys = new Set<string>()
  /** Keys of the functions some analyzed code called. */
  private readonly calledKeys = new Set<string>()
  /** What each closure returns when run on its own, for closures nothing calls. */
  private readonly closureReturns = new Map<string, readonly Atom[]>()
  /** Unresolved calls through a parameter, met while a function was analyzed on its own: reported only if nothing analyzed ever calls it with real arguments. */
  private readonly provisional = new Map<
    string,
    {
      readonly fn: FunctionInfo
      readonly node: TS.Node
      readonly atoms: readonly Atom[]
      readonly reason: FlowUnknownReason
      readonly detail: string
    }[]
  >()
  /** Set when a write changed a scope other than the one running, so earlier-analyzed functions may see more. */
  // Stryker disable next-line BooleanLiteral: equivalent -- `run` clears the flag at the start of every round, before any function is analyzed.
  private dirty = false
  private readonly caps = new Map<string, CapInfo>()
  private readonly shapeByOrigin = new Map<string, unknown>()
  private readonly files = new Map<string | undefined, FileInfo>()
  private readonly memo = new Map<string, CallRecord>()
  private readonly entered = new Map<string, EntryRecord>()
  private readonly sinks: readonly FlowSinkPattern[]
  private readonly queue: FunctionInfo[] = []
  private readonly declaredBoundaries = new Map<string, string>()
  /** What the code that settles a promise handed it, by the promise's id: read back wherever the promise is awaited. */
  private readonly promiseSlots = new Map<string, PromiseSlot>()
  /** The generators the analysis has run, by evaluation, and what was sent into them with `next(x)`. */
  private readonly generators = new Map<string, FunctionInfo>()
  private readonly sent = new Map<string, SentSlot>()
  /** The shared contents of the objects made so far (`flow-heap.ts`): a store through one name is seen through every alias. */
  private readonly heap = new HeapCells()
  /** What the scan saw happen to the data of some edges at some places: copies and unused derivations (ADR 0075). */
  private readonly edgeTags: FlowEdgeTagInput[] = []
  /** The allocation sites of the values a recognised copy made: copying one of them again changes nothing. */
  private readonly copySites = new Set<string>()
  private steps = 0
  private exhausted = false

  constructor(
    private readonly root: string,
    sinks: readonly FlowSinkPattern[],
    private readonly summaries: readonly FlowSummary[],
    private readonly limits: ScanLimits,
  ) {
    this.sinks = sinks
  }

  // ----- setup ---------------------------------------------------------------------------------

  registerCapabilities(inventory: CapabilityInventory): void {
    for (const declared of inventory.capabilities) {
      // An inventory may spell a path `./features/x.ts` or with backslashes; every id and scope uses the one normal form.
      const file = absolutePathFrom(this.root, declared.file)
      const node: CapabilityNode = { ...declared, file: displayPath(this.root, file) }
      const key = `${file}#${node.exportName}`
      const cap: CapInfo = {
        key,
        node,
        fieldIds: new Map(),
        operations: new Map(),
      }
      for (const field of node.fields) {
        const fieldName = field.path.join(".")
        const id = flowNodeId("field", node.file, `${node.exportName}.${fieldName}`)
        cap.fieldIds.set(field.path[0] ?? fieldName, id)
        this.shapeByOrigin.set(id, field.shape)
        this.addNode({
          kind: "field",
          scope: node.file,
          name: `${node.exportName}.${fieldName}`,
          status: "static",
          ...(field.sensitivity.value === undefined
            ? {}
            : { classification: field.sensitivity.value }),
          ...(field.declarationPosition === undefined ? {} : { source: field.declarationPosition }),
        })
      }
      for (const [list, kind] of [
        [node.getters, "getter"],
        [node.mutators, "mutator"],
        [node.subscriptions, "subscription"],
      ] as const) {
        for (const operation of list)
          cap.operations.set(operation.name, { kind, endpoints: operation.endpoints })
      }
      this.caps.set(key, cap)
      this.addDeclaredEdges(cap)
    }
  }

  private addNode(node: FlowNodeInput): string {
    const id = flowNodeId(node.kind, node.scope, node.name)
    this.nodes.set(id, this.nodes.get(id) ?? node)
    return id
  }

  /** Adds the edge unless it is there, and returns the id the Flow Model gives it. */
  private addEdge(edge: FlowEdgeInput): string {
    const key = JSON.stringify([
      edge.kind,
      edge.from,
      edge.to,
      edge.path,
      edge.status,
      edge.origin,
      edge.handling,
    ])
    if (!this.edges.has(key)) this.edges.set(key, edge)
    return flowEdgeId(edge.kind, edge.from, edge.to, edge.path, edge.status, edge.origin)
  }

  private declaredBoundary(endpoint: DataFlowEndpoint): string {
    const mapKey = `${endpoint.kind}|${endpoint.name}`
    const known = this.declaredBoundaries.get(mapKey)
    if (known !== undefined) return known
    const taken = [...this.declaredBoundaries.values()].some(
      (id) => id === flowNodeId("boundary", "boundary", endpoint.name),
    )
    const name = taken ? `${endpoint.name}#${endpoint.kind}` : endpoint.name
    const id = this.addNode({
      kind: "boundary",
      scope: "boundary",
      name,
      status: "declared",
      boundaryKind: endpoint.kind,
    })
    this.declaredBoundaries.set(mapKey, id)
    return id
  }

  private addDeclaredEdges(cap: CapInfo): void {
    for (const node of [...cap.node.getters, ...cap.node.mutators, ...cap.node.subscriptions]) {
      for (const written of node.writes) {
        const fieldId = cap.fieldIds.get(written[0] ?? "")
        if (fieldId === undefined) continue
        for (const endpoint of node.endpoints) {
          const boundary = this.declaredBoundary(endpoint)
          if (endpoint.direction === "input") {
            this.addEdge({
              kind: "crosses-boundary",
              from: boundary,
              to: fieldId,
              status: "declared",
              origin: fieldId,
              ...(endpoint.handling === undefined ? {} : { handling: endpoint.handling }),
            })
          } else {
            this.addEdge({
              kind: "crosses-boundary",
              from: fieldId,
              to: boundary,
              status: "declared",
              origin: fieldId,
              ...(endpoint.handling === undefined ? {} : { handling: endpoint.handling }),
            })
          }
        }
      }
    }
  }

  /**
   * Names of the schema constants this file hands to `createData`/`buildData`/`documentData` (`createData(schema)`).
   * Their declarations hold the operation bodies (`execute`, `processor`, ...), which stay opaque however the schema
   * is spelled -- inline in the call or declared first and passed by name (AGENTS.md invariant 6).
   */
  private schemaConstants(sourceFile: TS.SourceFile): ReadonlySet<string> {
    const names = new Set<string>()
    const visit = (node: TS.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        isOpaqueCallee(node.expression.text)
      ) {
        const first = node.arguments[0]
        if (first !== undefined && ts.isIdentifier(first)) names.add(first.text)
      }
      ts.forEachChild(node, visit)
    }
    for (const statement of sourceFile.statements) visit(statement)
    return names
  }

  async indexFile(
    file: string,
    text: string,
    context: ImportResolutionContext,
    targets: readonly ScanTarget[],
    targetsByName: ReadonlyMap<string, readonly ScanTarget[]>,
  ): Promise<void> {
    assertCompilerApi(ts)
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      undefined,
      ts.ScriptKind.TSX,
    )
    const schemas = this.schemaConstants(sourceFile)
    const info: FileInfo = {
      file,
      scope: displayPath(this.root, file),
      sourceFile,
      capabilityBindings: new Map(),
      resolvedImports: new Map(),
      namespaces: new Map(),
      packageImports: new Map(),
      topFunctions: new Map(),
      topClasses: new Map(),
      // Stryker disable next-line ArrayDeclaration: equivalent -- a stand-in file names no module, so looking a name up in it finds nothing.
      stars: [],
      dynamicImports: new Map(),
      valueNames: new Set(),
      exports: new Map(),
      moduleStatements: [],
      moduleEnv: new Env(this.globalEnv, true, true),
      moduleStarted: false,
    }
    // What a CommonJS module writes its exports to: `exports.a = ...`, `module.exports = ...`.
    info.moduleEnv.set("exports", EMPTY_VAL)
    info.moduleEnv.set("module", { ...EMPTY_VAL, props: new Map([["exports", EMPTY_VAL]]) })
    const imports: readonly ImportBinding[] = collectFileImports(sourceFile)
    const matches = await matchFileImports(file, imports, targets, targetsByName, context)
    const matched = new Set(matches.map((match) => match.localName))
    for (const match of matches)
      info.capabilityBindings.set(
        match.localName,
        `${match.target.file}#${match.target.exportName}`,
      )
    for (const target of targets) {
      if (target.file === file && !matched.has(target.exportName))
        info.capabilityBindings.set(target.exportName, `${target.file}#${target.exportName}`)
    }
    for (const binding of imports) {
      info.packageImports.set(binding.localName, {
        module: binding.moduleSpecifier,
        name: binding.importedName,
      })
      const resolved = await resolveImportSpecifier(file, binding.moduleSpecifier, context)
      // Stryker disable next-line ConditionalExpression: equivalent -- an unresolved import recorded with no file finds no exports later, the same as not recording it.
      if (resolved === undefined) continue
      if (binding.importedName === "*") info.namespaces.set(binding.localName, resolved)
      else
        info.resolvedImports.set(binding.localName, { file: resolved, name: binding.importedName })
    }
    await this.indexDynamicImports(info, context)
    for (const statement of sourceFile.statements)
      await this.indexStatement(info, statement, context, schemas)
    for (const [local, key] of info.capabilityBindings) {
      info.moduleEnv.set(local, { ...EMPTY_VAL, capability: key })
    }
    this.files.set(file, info)
  }

  /** Resolves every `import("literal")` and `require("literal")` in the file now, since resolution is asynchronous and the analysis is not. */
  private async indexDynamicImports(
    info: FileInfo,
    context: ImportResolutionContext,
  ): Promise<void> {
    const specifiers = new Set<string>()
    const visit = (node: TS.Node): void => {
      const loaded = loadedSpecifier(node)
      if (loaded !== undefined) specifiers.add(loaded)
      ts.forEachChild(node, visit)
    }
    visit(info.sourceFile)
    for (const specifier of specifiers) {
      const resolved = await resolveImportSpecifier(info.file, specifier, context)
      // Stryker disable next-line ConditionalExpression: equivalent -- a specifier stored with no file is looked up as no file.
      if (resolved !== undefined) info.dynamicImports.set(specifier, resolved)
    }
  }

  private async indexStatement(
    info: FileInfo,
    statement: TS.Statement,
    context: ImportResolutionContext,
    schemas: ReadonlySet<string>,
  ): Promise<void> {
    if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
      this.indexFunctionDeclaration(info, statement)
    } else if (ts.isClassDeclaration(statement)) {
      this.indexClassDeclaration(info, statement)
    } else if (ts.isVariableStatement(statement)) {
      this.indexVariableStatement(info, statement, schemas)
    } else if (ts.isExportDeclaration(statement)) {
      await this.indexExportDeclaration(info, statement, context)
    } else if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
      this.indexExportAssignment(info, statement)
    } else if (
      ts.isModuleDeclaration(statement) &&
      statement.body !== undefined &&
      ts.isModuleBlock(statement.body)
    ) {
      // A namespace's functions and statements are the file's: its exports are not the file's exports.
      const before = new Map(info.exports)
      for (const inner of statement.body.statements)
        await this.indexStatement(info, inner, context, schemas)
      info.exports.clear()
      for (const [name, ref] of before) info.exports.set(name, ref)
    } else {
      // Imports, type declarations and the like are kept as module statements too: `statement` ignores them.
      info.moduleStatements.push(statement)
    }
  }

  private exportLocal(info: FileInfo, exported: string, local: string): void {
    info.exports.set(exported, { owner: info, file: undefined, name: local })
  }

  private indexFunctionDeclaration(info: FileInfo, statement: TS.FunctionDeclaration): void {
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    const name = statement.name?.text ?? "default"
    this.registerTop(info, name, statement)
    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword))
      this.exportLocal(info, isDefault ? "default" : name, name)
  }

  private indexClassDeclaration(info: FileInfo, statement: TS.ClassDeclaration): void {
    // An ambient class (`declare class`) has no body here: whatever implements it is code the analysis cannot see.
    if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
      info.moduleStatements.push(statement)
      return
    }
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    const name = statement.name?.text ?? "default"
    this.registerClass(info, name, statement)
    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword))
      this.exportLocal(info, isDefault ? "default" : name, name)
  }

  private indexVariableStatement(
    info: FileInfo,
    statement: TS.VariableStatement,
    schemas: ReadonlySet<string>,
  ): void {
    const declared = statement.declarationList.declarations
    if (
      declared.every(
        (declaration) => ts.isIdentifier(declaration.name) && schemas.has(declaration.name.text),
      )
    )
      return
    const isExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    let allFunctions = true
    for (const declaration of declared) {
      const initializer =
        declaration.initializer === undefined ? undefined : unwrap(declaration.initializer)
      if (
        ts.isIdentifier(declaration.name) &&
        initializer !== undefined &&
        isFunctionLikeNode(initializer)
      ) {
        this.registerTop(info, declaration.name.text, initializer)
        if (isExported) this.exportLocal(info, declaration.name.text, declaration.name.text)
      } else {
        allFunctions = false
        for (const name of bindingNames(declaration.name)) {
          info.valueNames.add(name)
          if (isExported) this.exportLocal(info, name, name)
        }
      }
    }
    if (!allFunctions) info.moduleStatements.push(statement)
  }

  private async indexExportDeclaration(
    info: FileInfo,
    statement: TS.ExportDeclaration,
    context: ImportResolutionContext,
  ): Promise<void> {
    const specifier = statement.moduleSpecifier
    const hasSource = specifier !== undefined
    const from =
      specifier !== undefined && ts.isStringLiteralLike(specifier)
        ? await resolveImportSpecifier(info.file, specifier.text, context)
        : undefined
    const clause = statement.exportClause
    if (clause === undefined) {
      if (from !== undefined) info.stars.push(from)
    } else if (ts.isNamespaceExport(clause)) {
      if (from !== undefined)
        info.exports.set(clause.name.text, { owner: info, file: from, name: "*" })
    } else {
      for (const element of clause.elements) {
        const local = (element.propertyName ?? element.name).text
        // A name re-exported from a module that cannot be resolved points at no file at all, never at a local of the same name.
        info.exports.set(element.name.text, {
          owner: info,
          // Stryker disable next-line StringLiteral: equivalent -- any text that is no file path points at no file, as the empty one does.
          file: hasSource ? (from ?? "") : undefined,
          name: local,
        })
      }
    }
  }

  private indexExportAssignment(info: FileInfo, statement: TS.ExportAssignment): void {
    const expression = unwrap(statement.expression)
    if (isFunctionLikeNode(expression)) {
      this.registerTop(info, "default", expression)
    } else if (ts.isClassExpression(expression)) {
      this.registerClass(info, "default", expression)
    } else if (ts.isIdentifier(expression)) {
      this.exportLocal(info, "default", expression.text)
      return
    } else {
      info.valueNames.add("default")
      info.moduleStatements.push(statement)
    }
    this.exportLocal(info, "default", "default")
  }

  private registerTop(info: FileInfo, name: string, node: FunctionLike): void {
    const position = positionOf(info.sourceFile, node)
    const finalName = info.topFunctions.has(name)
      ? `${name}@${position.line}:${position.column}`
      : name
    const fn = this.makeFunction(info, finalName, node)
    info.topFunctions.set(name, fn)
    // A function is a value of its module: properties stored on it (`Foo.prototype.m = ...`) live there.
    info.moduleEnv.set(name, { ...EMPTY_VAL, callable: fn.key })
  }

  private makeFunction(
    info: FileInfo,
    name: string,
    node: FunctionLike | undefined,
    owner?: {
      readonly cls: ClassInfo
      readonly role: FunctionRole
      /** Set on the members of a class made by one particular evaluation: each answers to a token of its own. */
      readonly instance?: string
    },
  ): FunctionInfo {
    const fn: FunctionInfo = {
      key: `${info.file}#${name}`,
      file: info,
      name,
      node,
      // A TypeScript `this` parameter only types the receiver: it takes no argument.
      // Stryker disable next-line ArrayDeclaration: equivalent -- only the module function has no node, and it is never called with arguments, so its parameter list is never read.
      params: (node?.parameters ?? []).filter(
        (param) => !(ts.isIdentifier(param.name) && param.name.text === "this"),
      ),
      cls: owner?.cls,
      // Stryker disable next-line StringLiteral: equivalent -- the code only asks whether a role is `static` or `constructor`, never whether it is `plain`.
      role: owner?.role ?? "plain",
      closureEnv: undefined,
      instance: owner?.instance,
      bound: undefined,
    }
    this.functions.set(fn.key, fn)
    // Stryker disable next-line ConditionalExpression: equivalent -- a closure is looked up by its token, which is never `undefined`.
    if (fn.instance !== undefined) this.instances.set(fn.instance, fn)
    return fn
  }

  // ----- classes -------------------------------------------------------------------------------

  private registerClass(info: FileInfo, name: string, node: ClassLike): ClassInfo {
    const cls = this.makeClass(info, name, node, info.moduleEnv)
    info.topClasses.set(name, cls)
    info.moduleEnv.set(name, { ...EMPTY_VAL, classRef: cls.key })
    return cls
  }

  /**
   * The class declared by `node` -- one per node, created the first time it is met. Its members are analyzed as roots
   * too. With `evaluation` set it is instead the class one particular evaluation of the code made (a class written inside
   * a function, which captures that call's variables): a new one each time.
   */
  private makeClass(
    info: FileInfo,
    name: string,
    node: ClassLike,
    env: Env,
    evaluation?: string,
  ): ClassInfo {
    const known = evaluation === undefined ? this.classByNode.get(node) : undefined
    if (known !== undefined) return known
    const position = positionOf(info.sourceFile, node)
    const label = this.classes.has(`${info.file}#${name}`)
      ? `${name}@${position.line}:${position.column}`
      : name
    const cls: ClassInfo = {
      key:
        evaluation === undefined
          ? `${info.file}#${label}`
          : `${info.file}#${label}\u0000${evaluation}`,
      name: label,
      file: info,
      node,
      env,
      members: new Map(),
      fields: [],
      statics: [],
      ctor: this.makeFunction(info, `${label}.constructor`, undefined),
      staticFn: undefined,
      staticVals: undefined,
      parent: undefined,
      evaluation,
      decorated: false,
      opaque: new Set(),
      opaqueClass: false,
      replacement: undefined,
    }
    this.classes.set(cls.key, cls)
    if (evaluation === undefined) this.classByNode.set(node, cls)
    this.registerMembers(cls)
    return cls
  }

  private classFunction(
    cls: ClassInfo,
    name: string,
    node: FunctionLike,
    role: FunctionRole,
  ): FunctionInfo {
    const fn = this.makeFunction(cls.file, `${cls.name}.${name}`, node, {
      cls,
      role,
      ...(cls.evaluation === undefined ? {} : { instance: `${cls.key}.${name}` }),
    })
    fn.closureEnv = cls.env
    // A method of a class one call made is a closure of that call: if nothing calls it, what it returns is handed to code the scan cannot see.
    // Stryker disable next-line ConditionalExpression: equivalent -- a key of `undefined` that is added is one no function is looked up by.
    if (fn.instance !== undefined) this.closureKeys.add(fn.instance)
    this.queue.push(fn)
    return fn
  }

  private registerMembers(cls: ClassInfo): void {
    const explicit = cls.node.members.find(
      (member): member is TS.ConstructorDeclaration =>
        ts.isConstructorDeclaration(member) && member.body !== undefined,
    )
    if (explicit !== undefined) {
      cls.ctor = this.classFunction(cls, "constructor", explicit, "constructor")
    } else {
      cls.ctor.cls = cls
      cls.ctor.role = "constructor"
      cls.ctor.closureEnv = cls.env
      this.queue.push(cls.ctor)
    }
    for (const member of cls.node.members) this.registerMember(cls, member)
    // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent -- the root made for a class with no statics has nothing to run, so it adds no node and no edge.
    if (cls.statics.length > 0) {
      cls.staticFn = this.makeFunction(cls.file, `${cls.name}.static`, undefined, {
        cls,
        role: "static",
      })
      this.queue.push(cls.staticFn)
    }
  }

  private registerMember(cls: ClassInfo, member: TS.ClassElement): void {
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword)
    if (
      (ts.isMethodDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)) &&
      member.body !== undefined
    ) {
      const kind = ts.isMethodDeclaration(member)
        ? "method"
        : ts.isGetAccessorDeclaration(member)
          ? "get"
          : "set"
      const name = memberName(member.name)
      const fn = this.classFunction(
        cls,
        `${kind === "method" ? "" : `${kind} `}${name ?? "<computed>"}`,
        member,
        // Stryker disable next-line StringLiteral: equivalent -- the code only asks whether a role is `static` or `constructor`, never whether it is `method`.
        isStatic ? "static" : "method",
      )
      // Stryker disable next-line ConditionalExpression: equivalent -- a member whose name is not known is stored under a key nothing looks up.
      if (name !== undefined) cls.members.set(memberKey(kind, isStatic, name), fn)
    } else if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
      if (isStatic) cls.statics.push(member)
      else cls.fields.push(member)
    } else if (ts.isClassStaticBlockDeclaration(member)) {
      cls.statics.push(member)
    }
  }

  // ----- node helpers --------------------------------------------------------------------------

  /** The id of `fn`'s node, creating it first so no edge ever points at a missing one. */
  private fnNode(fn: FunctionInfo): string {
    return this.addNode(this.functionNode(fn, "static"))
  }

  private paramName(fn: FunctionInfo, index: number): string {
    const param = fn.params[index]
    if (index < 0) return `${fn.name}.this`
    const base =
      param !== undefined && ts.isIdentifier(param.name) ? param.name.text : `arg${index}`
    return `${fn.name}.${base}`
  }

  /** The node of the `index`th argument position -- created on demand, since a call may pass more arguments than the callee declares parameters. */
  private paramNode(fn: FunctionInfo, index: number): string {
    return this.addNode(this.parameterNode(fn, index))
  }

  private parameterNode(fn: FunctionInfo, index: number): FlowNodeInput {
    return {
      kind: "parameter",
      scope: fn.file.scope,
      name: this.paramName(fn, index),
      status: "static",
    }
  }

  private returnNode(fn: FunctionInfo): string {
    return this.addNode({
      kind: "return",
      scope: fn.file.scope,
      name: `${fn.name}#return`,
      status: "static",
    })
  }

  private functionNode(fn: FunctionInfo, status: FlowStatus): FlowNodeInput {
    return {
      kind: "function",
      scope: fn.file.scope,
      name: fn.name,
      status,
      ...(fn.node === undefined ? {} : { source: positionOf(fn.file.sourceFile, fn.node) }),
    }
  }

  /** Every node a function owns: itself, each declared parameter and its return. */
  private ensureFunctionNodes(fn: FunctionInfo): void {
    this.fnNode(fn)
    fn.params.forEach((_, index) => this.paramNode(fn, index))
    this.returnNode(fn)
  }

  private location(fn: FunctionInfo, node: TS.Node): SourceLocation {
    return { file: fn.file.scope, ...positionOf(fn.file.sourceFile, node) }
  }

  /** Records what could not be followed, and which tracked data was inside it (merged when the same site is reached again). */
  private unknown(
    fn: FunctionInfo,
    reason: FlowUnknownReason,
    node: TS.Node,
    detail: string,
    atoms: readonly Atom[],
  ): void {
    const source = this.location(fn, node)
    const key = `${reason}|${source.file}|${source.line}|${source.column}`
    // The same data can arrive under several entries (as a parameter and as a returned value): it is one piece of data.
    const data = [
      ...new Map(
        atoms.map((atom) => [
          JSON.stringify([atom.origin, atom.path]),
          { origin: atom.origin, path: atom.path },
        ]),
      ).values(),
    ]
    const existing = this.unknowns.get(key)
    if (existing !== undefined) {
      const known = new Set(existing.data.map((item) => JSON.stringify([item.origin, item.path])))
      const added = data.filter((item) => !known.has(JSON.stringify([item.origin, item.path])))
      this.unknowns.set(key, { ...existing, data: [...existing.data, ...added] })
      return
    }
    this.unknowns.set(key, {
      reason,
      source,
      subject: this.fnNode(fn),
      detail,
      data,
    })
  }

  // ----- entries, uses, sinks ------------------------------------------------------------------

  private entryKey(fnKey: string, origin: string, entryPath: readonly string[]): string {
    return JSON.stringify([fnKey, origin, entryPath])
  }

  private noteEntry(fn: FunctionInfo, val: Val): void {
    for (const atom of flattenAtoms(val)) {
      const key = this.entryKey(fn.key, atom.origin, atom.entryPath)
      if (!this.entered.has(key))
        this.entered.set(key, {
          fn,
          origin: atom.origin,
          entryPath: atom.entryPath,
          touched: [],
        })
    }
  }

  /** Records that `fn` accessed this data (so it is not "discarded"), and that it reads it -- even if it never goes anywhere. */
  private touch(fn: FunctionInfo, val: Val, site: TS.Node): void {
    for (const atom of flattenAtoms(val)) {
      this.entered.get(this.entryKey(fn.key, atom.origin, atom.entryPath))?.touched.push(atom.path)
      this.emitEntry(fn, atom, site)
    }
  }

  private statusOf(atom: Atom): FlowStatus {
    if (atom.declared === true) return "declared"
    return atom.approx ? "inferred" : "static"
  }

  /** Records that `fn` received this data, and returns the id of the edge that says so. */
  private emitEntry(fn: FunctionInfo, atom: Atom, node: TS.Node): string | undefined {
    const to = this.fnNode(fn)
    const source = this.location(fn, node)
    const base = { to, status: this.statusOf(atom), path: atom.path, origin: atom.origin, source }
    const { entry } = atom
    switch (entry.kind) {
      case "read":
        // The read itself is a fact the scan saw, whatever a summary later says about where the data went.
        return this.addEdge({
          kind: "reads",
          from: atom.origin,
          ...base,
          status: atom.approx ? "inferred" : "static",
        })
      case "param": {
        const owner = this.functions.get(entry.fn)
        // Stryker disable next-line ConditionalExpression: equivalent -- an atom's function key was registered when the atom was made, so the owner is always found.
        return owner === undefined
          ? undefined
          : this.addEdge({ kind: "reads", from: this.paramNode(owner, entry.index), ...base })
      }
      case "return": {
        const owner = this.functions.get(entry.from)
        // Stryker disable next-line ConditionalExpression: equivalent -- an atom's function key was registered when the atom was made, so the owner is always found.
        return owner === undefined
          ? undefined
          : this.addEdge({ kind: "passes", from: this.returnNode(owner), ...base })
      }
    }
  }

  private sink(frame: Frame, val: Val, spec: SinkSpec, node: TS.Node): void {
    const fn = frame.fn
    // Data handed to a boundary or an operation leaves the program: a whole `fields` object takes every field with it.
    const sent =
      spec.kind === "boundary" || spec.kind === "operation"
        ? this.materialize(frame, val, node)
        : val
    for (const atom of flattenAtoms(sent)) {
      this.emitEntry(fn, atom, node)
      this.entered.get(this.entryKey(fn.key, atom.origin, atom.entryPath))?.touched.push(atom.path)
      const edgeBase = {
        from: this.fnNode(fn),
        status:
          spec.kind === "boundary" && spec.declared === true ? "declared" : this.statusOf(atom),
        path: atom.path,
        origin: atom.origin,
        source: this.location(fn, node),
      }
      switch (spec.kind) {
        case "return":
          this.addEdge({ kind: "returns", ...edgeBase, to: this.returnNode(fn) })
          break
        case "arg":
          this.addEdge({ kind: "passes", ...edgeBase, to: this.paramNode(spec.callee, spec.index) })
          break
        case "boundary":
          this.addEdge({
            kind: "side-effect",
            ...edgeBase,
            to: spec.id,
            ...(spec.handling === undefined ? {} : { handling: spec.handling }),
          })
          break
        case "operation": {
          const operationId = this.operationNode(spec.cap, spec.operation)
          this.addEdge({ kind: "passes", ...edgeBase, to: operationId })
          if (spec.info.kind === "mutator") {
            for (const endpoint of spec.info.endpoints.filter(
              (candidate) => candidate.direction === "output",
            )) {
              this.addEdge({
                kind: "crosses-boundary",
                from: operationId,
                to: this.declaredBoundary(endpoint),
                status: "declared",
                path: atom.path,
                origin: atom.origin,
                ...(endpoint.handling === undefined ? {} : { handling: endpoint.handling }),
              })
            }
          }
          break
        }
      }
    }
  }

  private operationNode(cap: CapInfo, operation: string): string {
    return this.addNode({
      kind: "function",
      scope: cap.node.file,
      name: `${cap.node.exportName}.${operation}`,
      status: "static",
    })
  }

  private codeBoundary(pattern: FlowSinkPattern["boundary"]): string {
    return this.addNode({
      kind: "boundary",
      scope: "boundary:code",
      name: pattern.name,
      status: "static",
      boundaryKind: pattern.kind,
    })
  }

  // ----- evaluation driver ---------------------------------------------------------------------

  private step(): boolean {
    this.steps += 1
    if (this.steps > this.limits.maxSteps) this.exhausted = true
    return !this.exhausted
  }

  private frame(fn: FunctionInfo, env: Env, depth: number, root = false, callKey = fn.key): Frame {
    return {
      fn,
      env,
      returns: [],
      depth,
      thrown: [],
      yields: [],
      mutated: new Set(),
      aliased: new Set(),
      root,
      fnEnv: env,
      callKey,
    }
  }

  /** The same function frame, one block deeper: names declared in the block go away with it. */
  private scoped(frame: Frame): Frame {
    return { ...frame, env: new Env(frame.env) }
  }

  private ensureModule(file: FileInfo): void {
    if (file.moduleStarted) return
    file.moduleStarted = true
    const frame = this.frame(this.makeFunction(file, "<module>", undefined), file.moduleEnv, 0)
    for (const statement of file.moduleStatements) this.statement(frame, statement)
    for (const cls of file.topClasses.values()) this.applyDecorators(cls)
    // The capability's own `const userData = createData(...)` rebinds its name to an empty value; restore it so functions in the same file trace through it.
    for (const [local, key] of file.capabilityBindings)
      file.moduleEnv.set(local, { ...EMPTY_VAL, capability: key })
  }

  /**
   * Runs every function as a root, then repeats while a function wrote into a scope it does not own (module state, a
   * captured variable): a reader analyzed before the writer must see what the writer stored. Merging only ever adds, so
   * the repetition ends; it is also capped, and a project that is still changing at the cap is reported, not trusted.
   */
  run(): void {
    for (const file of this.files.values()) this.ensureModule(file)
    const roots: FunctionInfo[] = []
    for (const file of this.files.values()) roots.push(...file.topFunctions.values())
    const rounds = 6
    let settled = false
    for (let round = 0; round < rounds && !settled; round += 1) {
      this.round = round + 1
      if (round > 0) this.heap.nextRound()
      this.dirty = false
      this.memo.clear()
      settled = !this.runRoots(roots)
    }
    const first = roots[0]
    // Data kept moving between functions after every round: a function analyzed early may have missed what a later one stored.
    if (!settled && first?.node !== undefined)
      this.unknown(
        first,
        "unanalyzed-function",
        first.node,
        `the analysis did not settle after ${rounds} rounds: data written by one function was still reaching others`,
        [],
      )
    this.runUncalledInstances()
    this.flagUncalledClosures()
    this.flushDeferred()
  }

  /** Runs every root and everything queued meanwhile; true when a write reached beyond the scope that made it. */
  private runRoots(roots: FunctionInfo[]): boolean {
    for (const fn of roots) this.runRoot(fn)
    for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
      roots.push(next)
      this.runRoot(next)
    }
    return this.dirty
  }

  private runRoot(fn: FunctionInfo): void {
    if (fn.role === "static" && fn.node === undefined) {
      if (fn.cls !== undefined) this.classStatics(fn.cls)
      return
    }
    const options = this.rootOptions(fn)
    const returned = this.analyze(undefined, fn, [], options)
    const id = fn.instance ?? fn.key
    if (this.closureKeys.has(id)) this.closureReturns.set(id, flattenAtoms(returned))
  }

  /**
   * Closures, and the methods of classes, that one call made and nothing called. Whatever received them can call them
   * -- with the variables of the call that made them, which are not the variables of the first call -- so each is run on
   * its own, and what it sends or returns counts.
   */
  private runUncalledInstances(): void {
    const done = new Set<string>()
    const pending = (): FunctionInfo[] => {
      const found: FunctionInfo[] = []
      for (const [token, round] of this.madeByCalls) {
        const fn = this.instances.get(token)
        // The last round has the module's state as it ended up; earlier ones are superseded.
        const live = round === 0 || round === this.round
        if (fn?.node !== undefined && live && !done.has(token) && !this.calledKeys.has(token))
          found.push(fn)
      }
      return found
    }
    // Each round is a call of its own, so a body that does nothing ends the run instead of repeating it.
    const runRound = (): void => {
      const next = pending()
      if (next.length === 0) return
      const before = done.size
      for (const fn of next) {
        done.add(fn.instance ?? fn.key)
        this.runRoot(fn)
      }
      // Stryker disable all: unreachable -- `pending` never offers a function twice, so each round marks one more as done; the check only turns a round that makes no progress into a failure instead of a hang.
      /* v8 ignore next 3 */
      if (done.size === before) {
        throw new Error("running the uncalled instances made no progress")
      }
      // Stryker restore all
      runRound()
    }
    runRound()
  }

  /**
   * How a function runs when nothing calls it: a method on an instance of its class, a constructor on a fresh instance.
   * The constructor and the methods run on the same stand-in instance (one allocation site for the class), so what the
   * constructor and the field initializers store on `this` is what a method finds there.
   */
  private rootOptions(fn: FunctionInfo): AnalyzeOptions {
    const { cls } = fn
    if (cls === undefined) return {}
    const instance = withAlloc(
      { ...EMPTY_VAL, instance: cls.key },
      // Stryker disable next-line StringLiteral: equivalent -- the site is told apart by the class key; the text after it only has to differ from the positions other sites use.
      this.heap.allocId(cls.key, "instance"),
    )
    if (fn.role === "constructor") return { thisVal: instance, construct: cls }
    return { thisVal: fn.role === "static" ? { ...EMPTY_VAL, classRef: cls.key } : instance }
  }

  /** A closure that returns tracked data and that nothing calls hands it to code the analysis cannot see. */
  private flagUncalledClosures(): void {
    for (const [key, atoms] of this.closureReturns) {
      const fn = this.functionOf(key)
      if (fn?.node === undefined || atoms.length === 0) continue
      if (this.calledKeys.has(key)) continue
      this.unknown(
        fn,
        "unanalyzed-function",
        fn.node,
        "closure returns tracked data but nothing in the project calls it",
        atoms,
      )
    }
  }

  // ----- function calls ------------------------------------------------------------------------

  private analyze(
    call: CallSite | undefined,
    fn: FunctionInfo,
    given: readonly Val[],
    own: AnalyzeOptions = {},
  ): Val {
    const { args, options } = withBound(fn, given, own)
    if (call !== undefined) this.enterCall(call, fn, args, options)
    if (this.exhausted || (call !== undefined && call.caller.depth + 1 > this.limits.maxCallDepth))
      return this.overBudget(call, fn, args, options)
    const shape = [
      options.construct?.key,
      options.constructs === true,
      // Stryker disable next-line StringLiteral: equivalent -- the stand-in for "no receiver" only has to differ from the signature of a receiver.
      options.thisVal === undefined ? "" : signatureOf(options.thisVal),
      ...args.map(signatureOf),
    ]
    const key = JSON.stringify([fn.instance ?? fn.key, ...shape])
    const cached = this.memo.get(key)
    if (cached !== undefined) return this.finishCall(call, fn, cached)
    const record: CallRecord = { returnVal: EMPTY_VAL, outs: new Map(), thrown: EMPTY_VAL }
    this.memo.set(key, record)
    this.ensureModule(fn.file)

    const frame = this.frame(
      fn,
      new Env(fn.closureEnv ?? fn.file.moduleEnv, true),
      (call?.caller.depth ?? 0) + 1,
      call === undefined,
      // The same function called with the same data is the same evaluation, whichever copy of a closure it is.
      JSON.stringify([fn.key, ...shape]),
    )
    this.heap.enter(frame.callKey)
    this.enterFrame(frame, args, options)
    this.runBody(frame, fn)
    this.collect(frame, record, options)
    this.heap.leave(frame.callKey)
    return this.finishCall(call, fn, record)
  }

  /** A call the analysis does not make because it is too deep or the budget is spent: the callee becomes unknown, and the data handed to it comes out approximately. */
  private overBudget(
    call: CallSite | undefined,
    fn: FunctionInfo,
    args: readonly Val[],
    options: AnalyzeOptions,
  ): Val {
    this.nodes.set(this.fnNode(fn), this.functionNode(fn, "unknown"))
    const all = options.thisVal === undefined ? args : [options.thisVal, ...args]
    if (call !== undefined)
      this.unknown(
        call.caller.fn,
        "unanalyzed-function",
        call.site,
        `call depth or analysis budget exceeded at ${fn.name}`,
        all.flatMap((arg) => flattenAtoms(arg)),
      )
    return approximate(mergeVals(...all))
  }

  /** The edges a call adds before anything is known about the callee: the call itself and the data handed over. */
  private enterCall(
    call: CallSite,
    fn: FunctionInfo,
    args: readonly Val[],
    options: AnalyzeOptions,
  ): void {
    this.addEdge({
      kind: "calls",
      from: this.fnNode(call.caller.fn),
      to: this.fnNode(fn),
      status: "static",
      source: this.location(call.caller.fn, call.site),
    })
    if (options.thisVal !== undefined)
      this.sink(call.caller, options.thisVal, { kind: "arg", callee: fn, index: -1 }, call.site)
    args.forEach((arg, index) => {
      this.sink(call.caller, arg, { kind: "arg", callee: fn, index }, call.site)
    })
  }

  /** Binds `this`, `arguments` and the parameters, and starts a constructor's instance. */
  private enterFrame(frame: Frame, args: readonly Val[], options: AnalyzeOptions): void {
    const { fn } = frame
    const bound = args.map((arg, index) => withEntry(arg, { kind: "param", fn: fn.key, index }))
    if (fn.node === undefined || !ts.isArrowFunction(fn.node)) {
      const self = withEntry(options.thisVal ?? EMPTY_VAL, { kind: "param", fn: fn.key, index: -1 })
      this.noteEntry(fn, self)
      frame.env.set("this", self)
      frame.env.set("arguments", {
        ...EMPTY_VAL,
        props: new Map([[ELEMENT_KEY, mergeVals(...bound)]]),
      })
    }
    if (fn.node !== undefined && ts.isFunctionExpression(fn.node) && fn.node.name !== undefined)
      frame.env.set(fn.node.name.text, { ...EMPTY_VAL, callable: fn.instance ?? fn.key })
    fn.params.forEach((param, index) => {
      const value = mergeVals(
        param.dotDotDotToken === undefined
          ? (bound[index] ?? EMPTY_VAL)
          : { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, mergeVals(...bound.slice(index))]]) },
        this.expr(frame, param.initializer),
      )
      this.noteEntry(fn, value)
      this.bind(frame, param.name, value)
    })
    if (options.construct !== undefined) this.beginConstruct(frame, options.construct, bound)
  }

  private runBody(frame: Frame, fn: FunctionInfo): void {
    // Stryker disable next-line OptionalChaining: equivalent -- only the module function has no node, and it is never analyzed as a call.
    const body = fn.node?.body
    // Stryker disable next-line ConditionalExpression: equivalent -- a function declaration without a body is never registered, so the body is always present when a node is.
    if (body === undefined) return
    if (ts.isBlock(body)) this.statements(frame, body.statements)
    else this.returnValue(frame, this.expr(frame, body), body)
  }

  /** Turns what a finished frame holds into the call's record: its result, what it threw, and the objects it filled in. */
  private collect(frame: Frame, record: CallRecord, options: AnalyzeOptions): void {
    const { fn } = frame
    const anchor = fn.node ?? fn.cls?.node ?? fn.file.sourceFile
    const returned = mergeVals(...frame.returns)
    const constructs = options.construct !== undefined || options.constructs === true
    if (constructs) {
      record.returnVal = mergeVals(frame.env.lookup("this"), returned)
      this.sink(frame, record.returnVal, { kind: "return" }, anchor)
    } else if (isGeneratorFunction(fn.node)) {
      const items = mergeVals(...frame.yields, returned)
      this.generators.set(frame.callKey, fn)
      record.returnVal = mergeVals(arrayOf(items), handleVal(GENERATOR_HANDLE, frame.callKey))
    } else {
      record.returnVal = returned
    }
    record.thrown = mergeVals(...frame.thrown)
    if (isAsyncFunction(fn.node) && flattenAtoms(record.thrown).length > 0)
      record.returnVal = mergeVals(record.returnVal, {
        ...EMPTY_VAL,
        props: new Map([[rejectedKey(), record.thrown]]),
      })
    fn.params.forEach((param, index) => {
      if (ts.isIdentifier(param.name) && frame.mutated.has(param.name.text))
        record.outs.set(index, frame.env.lookup(param.name.text))
    })
    if (!constructs && frame.mutated.has("this")) record.outs.set(-1, frame.env.lookup("this"))
    for (const out of record.outs.values()) this.sink(frame, out, { kind: "return" }, anchor)
  }

  private finishCall(call: CallSite | undefined, fn: FunctionInfo, record: CallRecord): Val {
    const result = withEntry(record.returnVal, { kind: "return", from: fn.key })
    if (call === undefined) return result
    this.calledKeys.add(fn.key)
    if (fn.instance !== undefined) this.calledKeys.add(fn.instance)
    this.noteEntry(call.caller.fn, result)
    const thrown = withEntry(record.thrown, { kind: "return", from: fn.key })
    call.caller.thrown.push(thrown)
    this.noteEntry(call.caller.fn, thrown)
    for (const [index, val] of record.outs) this.writeBack(call, fn, index, val)
    return result
  }

  /** An object the callee stored properties into is the caller's object: what was stored is visible to the caller from here on. */
  private writeBack(call: CallSite, fn: FunctionInfo, index: number, val: Val): void {
    const target = index === -1 ? call.receiver : call.argExprs?.[index]
    const root = target === undefined ? undefined : memberChain(target).root
    if (target === undefined || root === undefined) return
    const relabeled = withEntry(val, { kind: "return", from: fn.key })
    this.noteEntry(call.caller.fn, relabeled)
    if (call.caller.aliased.has(root))
      this.flagStore(
        call.caller,
        call.site,
        this.atomsOf(call.caller, relabeled, call.site),
        "an object another name may share was filled in by a call",
      )
    this.assign(call.caller, target, relabeled)
    call.caller.mutated.add(root)
  }

  private returnValue(frame: Frame, val: Val, node: TS.Node): void {
    frame.returns.push(val)
    this.sink(frame, val, { kind: "return" }, node)
  }

  // ----- statements ----------------------------------------------------------------------------

  /** Function declarations are hoisted: they can be called before the line that declares them. */
  private statements(frame: Frame, list: readonly TS.Statement[]): void {
    const declaresFunction = (statement: TS.Statement): boolean =>
      ts.isFunctionDeclaration(statement) && statement.body !== undefined
    for (const statement of list) if (declaresFunction(statement)) this.statement(frame, statement)
    for (const statement of list) if (!declaresFunction(statement)) this.statement(frame, statement)
  }

  private statement(frame: Frame, node: TS.Statement): void {
    if (!this.step()) return
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations)
        this.declare(frame, declaration, node.declarationList)
    } else if (ts.isExpressionStatement(node)) {
      this.expr(frame, node.expression)
    } else if (ts.isReturnStatement(node)) {
      this.returnValue(frame, this.expr(frame, node.expression), node)
    } else if (ts.isIfStatement(node)) {
      this.expr(frame, node.expression)
      this.statement(frame, node.thenStatement)
      if (node.elseStatement !== undefined) this.statement(frame, node.elseStatement)
    } else if (ts.isBlock(node)) {
      this.statements(this.scoped(frame), node.statements)
    } else if (ts.isLabeledStatement(node)) {
      this.statement(frame, node.statement)
    } else if (ts.isThrowStatement(node)) {
      const thrown = this.expr(frame, node.expression)
      frame.thrown.push(thrown)
      this.sink(frame, thrown, { kind: "return" }, node)
    } else if (ts.isTryStatement(node)) {
      this.tryStatement(frame, node)
    } else if (ts.isSwitchStatement(node)) {
      this.expr(frame, node.expression)
      const inner = this.scoped(frame)
      for (const clause of node.caseBlock.clauses) {
        this.expr(inner, ts.isCaseClause(clause) ? clause.expression : undefined)
        this.statements(inner, clause.statements)
      }
    } else {
      this.loopOrDeclaration(frame, node)
    }
  }

  private loopOrDeclaration(frame: Frame, node: TS.Statement): void {
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      this.forInOf(frame, node)
    } else if (ts.isForStatement(node)) {
      this.forLoop(frame, node)
    } else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      this.expr(frame, node.expression)
      this.statement(frame, node.statement)
    } else {
      this.declarationStatement(frame, node)
    }
  }

  private forInOf(frame: Frame, node: TS.ForOfStatement | TS.ForInStatement): void {
    const inner = this.scoped(frame)
    const iterable = this.expr(frame, node.expression)
    const element = ts.isForOfStatement(node) ? this.iterated(frame, iterable, node) : EMPTY_VAL
    if (ts.isVariableDeclarationList(node.initializer)) {
      for (const declaration of node.initializer.declarations) {
        for (const name of bindingNames(declaration.name)) inner.aliased.add(name)
        this.bind(inner, declaration.name, element, this.scopeFor(inner, node.initializer))
      }
    } else {
      this.assign(inner, node.initializer, element)
    }
    this.statement(inner, node.statement)
  }

  /** What `for...of` binds: each element, and, in `for await`, the value an element that is a promise settles with. */
  private iterated(frame: Frame, iterable: Val, node: TS.ForOfStatement): Val {
    const element = this.iterate(frame, iterable, node)
    return node.awaitModifier === undefined ? element : this.unwrapPromise(frame, element, node)
  }

  private forLoop(frame: Frame, node: TS.ForStatement): void {
    const inner = this.scoped(frame)
    if (node.initializer !== undefined) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations)
          this.declare(inner, declaration, node.initializer)
      } else {
        this.expr(inner, node.initializer)
      }
    }
    this.expr(inner, node.condition)
    this.expr(inner, node.incrementor)
    this.statement(inner, node.statement)
  }

  private declarationStatement(frame: Frame, node: TS.Statement): void {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
      frame.env.set(node.name.text, this.functionValue(frame, node, node.name.text))
    } else if (
      ts.isClassDeclaration(node) &&
      node.name !== undefined &&
      !hasModifier(node, ts.SyntaxKind.DeclareKeyword)
    ) {
      frame.env.set(node.name.text, this.classValue(frame, node))
    } else if (ts.isImportEqualsDeclaration(node)) {
      const specifier = loadedSpecifier(node)
      const file = specifier === undefined ? undefined : frame.fn.file.dynamicImports.get(specifier)
      frame.env.set(
        node.name.text,
        specifier === undefined ? EMPTY_VAL : this.loaded(specifier, file),
      )
    } else if (ts.isExportAssignment(node)) {
      frame.env.set("default", this.expr(frame, node.expression))
    } else if (ts.isWithStatement(node)) {
      this.withStatement(frame, node)
    } else if (ts.isEnumDeclaration(node)) {
      for (const member of node.members) this.expr(frame, member.initializer)
    }
  }

  /** `with (object) { ... }` makes every name in the block a possible property of `object`: nothing in it can be resolved when `object` holds tracked data. */
  private withStatement(frame: Frame, node: TS.WithStatement): void {
    const scope = this.expr(frame, node.expression)
    this.flagStore(
      frame,
      node,
      this.atomsOf(frame, scope, node),
      "names inside a with statement may be properties of tracked data",
    )
    this.statement(frame, node.statement)
  }

  /** `var` lands in the function's own scope, `let` and `const` in the scope they are written in. */
  private scopeFor(frame: Frame, list: TS.VariableDeclarationList): Env {
    return (list.flags & ts.NodeFlags.BlockScoped) === 0 ? frame.fnEnv : frame.env
  }

  /** `try` / `catch` / `finally`: the catch variable holds whatever the try block threw, directly or through a call. */
  private tryStatement(frame: Frame, node: TS.TryStatement): void {
    const before = frame.thrown.length
    this.statements(this.scoped(frame), node.tryBlock.statements)
    if (node.catchClause !== undefined) {
      // What the try block threw is caught here; only what the handler throws goes on.
      const caught = mergeVals(...frame.thrown.splice(before))
      const handler = this.scoped(frame)
      if (node.catchClause.variableDeclaration !== undefined)
        this.bind(handler, node.catchClause.variableDeclaration.name, caught)
      this.statements(handler, node.catchClause.block.statements)
    }
    if (node.finallyBlock !== undefined)
      this.statements(this.scoped(frame), node.finallyBlock.statements)
  }

  private declare(
    frame: Frame,
    declaration: TS.VariableDeclaration,
    list: TS.VariableDeclarationList,
  ): void {
    if (ts.isIdentifier(declaration.name)) {
      if (isReferenceExpression(declaration.initializer)) frame.aliased.add(declaration.name.text)
    } else {
      for (const name of bindingNames(declaration.name)) frame.aliased.add(name)
    }
    const env = this.scopeFor(frame, list)
    const value = this.expr(frame, declaration.initializer)
    this.bind(frame, declaration.name, value, env)
    this.rememberText(frame, declaration, list, env)
    this.noteUnusedDerivation(frame, declaration, value)
  }

  /** `const k = "name"`: remembers the string, so `o[k]` reads the property `name`. */
  private rememberText(
    frame: Frame,
    declaration: TS.VariableDeclaration,
    list: TS.VariableDeclarationList,
    env: Env,
  ): void {
    if ((list.flags & ts.NodeFlags.Const) === 0 || !ts.isIdentifier(declaration.name)) return
    const text =
      declaration.initializer === undefined
        ? undefined
        : this.literalReader(frame)(declaration.initializer)
    if (text !== undefined) env.setText(declaration.name.text, text)
  }

  // ----- binding -------------------------------------------------------------------------------

  private bind(frame: Frame, name: TS.BindingName, value: Val, env: Env = frame.env): void {
    if (ts.isIdentifier(name)) {
      env.set(name.text, value)
    } else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.dotDotDotToken !== undefined) {
          // The rest of an object is a new object holding what is left of it.
          this.bind(
            frame,
            element.name,
            this.fresh(frame, element, withoutAlloc(approximate(value))),
            env,
          )
          continue
        }
        const key =
          element.propertyName === undefined ? keyOf(element.name) : keyOf(element.propertyName)
        const part =
          key === undefined
            ? accessDynamic(this.materialize(frame, value, element))
            : this.accessMember(frame, value, key, element)
        this.bind(frame, element.name, mergeVals(part, this.expr(frame, element.initializer)), env)
      }
    } else {
      name.elements.forEach((element) => {
        if (ts.isOmittedExpression(element)) return
        const part =
          element.dotDotDotToken !== undefined ? value : this.iterate(frame, value, element)
        this.bind(frame, element.name, part, env)
      })
    }
  }

  /** What iterating `val` yields: an instance that defines `[Symbol.iterator]` answers with its generator, anything else with its elements. */
  private iterate(frame: Frame, val: Val, site: TS.Node): Val {
    const cls = this.classes.get(val.instance ?? "")
    const method =
      cls === undefined
        ? this.functionOf(
            (val.props.get("[Symbol.iterator]") ?? val.props.get("[Symbol.asyncIterator]"))
              ?.callable,
          )
        : this.iteratorMethod(cls)
    if (method === undefined) return this.accessMember(frame, val, ELEMENT_KEY, site)
    const generator = this.analyze({ caller: frame, site }, method, [], { thisVal: val })
    return this.accessMember(frame, generator, ELEMENT_KEY, site)
  }

  private iteratorMethod(cls: ClassInfo): FunctionInfo | undefined {
    for (const name of ["[Symbol.iterator]", "[Symbol.asyncIterator]"]) {
      const found = this.findMember(cls, "method", false, name)
      if (found !== undefined && found !== "opaque") return found
    }
    return undefined
  }

  /**
   * Replaces every capability, and every capability `fields` object, inside `val` by the data of all its fields: they are
   * lazy (a field is only read when asked for), so anything that takes the whole object -- a sink, an unresolved call
   * (which can call `getSnapshot()` on a capability it is handed), a computed key -- gets every field, each read here.
   */
  private materialize(frame: Frame, given: Val, site: TS.Node): Val {
    // What a promise settles with is data that goes wherever the promise goes.
    const val = this.unwrapPromise(frame, given, site)
    if (!holdsFields(val) && !holdsPromise(val)) return val
    const props = new Map<string, Val>()
    for (const [key, child] of val.props) props.set(key, this.materialize(frame, child, site))
    const base: Val = { ...val, props }
    const cap = this.caps.get(val.fieldsOf ?? val.capability ?? "")
    if (cap === undefined) return base
    const lazy: Val = { ...EMPTY_VAL, fieldsOf: cap.key }
    const fields = [...cap.fieldIds.keys()].map((key) => this.accessMember(frame, lazy, key, site))
    // A transformation that touched the lazy value (a JSON round trip, a template) made what it holds approximate.
    return mergeVals(base, ...(val.inexact === true ? fields.map(approximate) : fields))
  }

  /** Every atom `val` holds, counting the fields of a whole capability `fields` object. */
  private atomsOf(frame: Frame, val: Val, site: TS.Node): Atom[] {
    return flattenAtoms(this.materialize(frame, val, site))
  }

  private accessMember(frame: Frame, receiver: Val, key: string, site: TS.Node): Val {
    if (receiver.fieldsOf !== undefined) {
      const cap = this.caps.get(receiver.fieldsOf)
      const origin = cap?.fieldIds.get(key)
      if (origin === undefined) return EMPTY_VAL
      const atom: Atom = { origin, path: [], approx: false, entry: { kind: "read" }, entryPath: [] }
      const val = atomVal(atom)
      this.noteEntry(frame.fn, val)
      // The function reads this field, whatever it later does with it. Without the edge, a field handed straight
      // to code the analysis cannot follow would leave the function out of every trace, and the unknown with it.
      this.emitEntry(frame.fn, atom, site)
      return val
    }
    if (receiver.capability !== undefined) return this.capabilityMember(receiver.capability, key)
    const special = this.accessSpecial(frame, receiver, key, site)
    if (special !== undefined) return special
    const result = accessKey(receiver, key)
    this.touch(frame.fn, result, site)
    // What a package exports has members of its own, besides any data the same value holds.
    return receiver.external === undefined
      ? result
      : mergeVals(result, externalVal(...externalMember(receiver.external, key)))
  }

  /** `data.fields` is the capability's fields; a method read without being called stays attached to its capability so a later call still counts. */
  private capabilityMember(capKey: string, key: string): Val {
    if (key === "fields") return { ...EMPTY_VAL, fieldsOf: capKey }
    const known = key === "getSnapshot" || this.caps.get(capKey)?.operations.has(key) === true
    return known ? { ...EMPTY_VAL, capability: capKey, boundMethod: key } : EMPTY_VAL
  }

  /** A property that is not stored data: a module's export, an accessor, a method, a static of a class. */
  private accessSpecial(frame: Frame, receiver: Val, key: string, site: TS.Node): Val | undefined {
    // The keys of a record are chosen when the program runs: any key may read any entry.
    if (receiver.native === "record")
      return mergeVals(
        receiver.props.get(key) ?? EMPTY_VAL,
        receiver.props.get(ANY_KEY) ?? EMPTY_VAL,
      )
    if (receiver.namespace !== undefined) {
      const target = this.lookupExport(receiver.namespace, key)
      return target === undefined ? undefined : this.targetVal(target)
    }
    const getter = receiver.props.get(accessorKey("get", key))
    if (getter?.callable !== undefined) {
      const fn = this.functionOf(getter.callable)
      if (fn !== undefined)
        return this.analyze({ caller: frame, site }, fn, [], { thisVal: receiver })
    }
    if (receiver.instance !== undefined) return this.instanceMember(frame, receiver, key, site)
    if (receiver.classRef !== undefined) return this.staticMember(frame, receiver, key, site)
    return undefined
  }

  private instanceMember(frame: Frame, receiver: Val, key: string, site: TS.Node): Val | undefined {
    const cls = this.classes.get(receiver.instance ?? "")
    if (cls === undefined) return undefined
    const getter = this.findMember(cls, "get", false, key)
    if (getter !== undefined && getter !== "opaque")
      return this.analyze({ caller: frame, site }, getter, [], { thisVal: receiver })
    // An accessor a decorator the scan cannot follow may have replaced: what it answers is not known.
    if (getter === "opaque" && this.isDecorated(cls, "get", false, key))
      return this.unresolved(frame, site, receiver, [])
    if (receiver.props.has(key)) return undefined
    const method = this.findMember(cls, "method", false, key)
    if (method !== undefined && method !== "opaque")
      return { ...EMPTY_VAL, callable: method.instance ?? method.key }
    return this.mixedIn(cls, key)
  }

  private staticMember(frame: Frame, receiver: Val, key: string, site: TS.Node): Val | undefined {
    const cls = this.classes.get(receiver.classRef ?? "")
    if (cls === undefined) return undefined
    for (const owner of this.chain(cls)) {
      const stored = this.classStatics(owner).get(key)
      if (stored !== undefined) return stored
    }
    const getter = this.findMember(cls, "get", true, key)
    if (getter !== undefined && getter !== "opaque")
      return this.analyze({ caller: frame, site }, getter, [], { thisVal: receiver })
    const method = this.findMember(cls, "method", true, key)
    return method === undefined || method === "opaque"
      ? undefined
      : { ...EMPTY_VAL, callable: method.instance ?? method.key }
  }

  // ----- classes at run time -------------------------------------------------------------------

  /** The class a class expression or a class declared inside a function evaluates to: a new one each time, as it captures the variables of that very evaluation. */
  private classValue(frame: Frame, node: ClassLike): Val {
    const name = node.name?.text ?? `anonymous@${positionOf(frame.fn.file.sourceFile, node).line}`
    const cls = this.makeClass(
      frame.fn.file,
      `${frame.fn.name}>${name}`,
      node,
      frame.env,
      String(this.classes.size),
    )
    if (!frame.root)
      for (const member of cls.members.values())
        if (member.instance !== undefined) this.madeByCalls.set(member.instance, this.round)
    this.applyDecorators(cls)
    return cls.replacement ?? { ...EMPTY_VAL, classRef: cls.key }
  }

  /** The class `extends` names: a project class, "opaque" for anything else (a package, a call), "none" when there is no `extends`. */
  private parentOf(cls: ClassInfo): ClassInfo | "opaque" | "none" {
    if (cls.parent !== undefined) return cls.parent
    const clause = cls.node.heritageClauses?.find(
      (candidate) => candidate.token === ts.SyntaxKind.ExtendsKeyword,
    )
    const base = clause?.types[0]?.expression
    cls.parent = base === undefined ? "none" : this.classNamed(cls, unwrap(base))
    return cls.parent
  }

  private classNamed(cls: ClassInfo, base: TS.Expression): ClassInfo | "opaque" {
    let found: Val = EMPTY_VAL
    if (ts.isIdentifier(base)) {
      found = cls.env.get(base.text) ?? this.importedVal(cls.file, base.text)
    } else if (ts.isPropertyAccessExpression(base) && ts.isIdentifier(base.expression)) {
      const namespace = this.namespaceFile(cls.file, base.expression.text)
      const target =
        namespace === undefined ? undefined : this.lookupExport(namespace, base.name.text)
      found = target === undefined ? EMPTY_VAL : this.targetVal(target)
    }
    return this.classes.get(found.classRef ?? "") ?? "opaque"
  }

  /** The class and its project superclasses, nearest first. A cycle or an overlong chain ends it. */
  private chain(cls: ClassInfo): ClassInfo[] {
    const out: ClassInfo[] = []
    for (
      let current: ClassInfo | "opaque" | "none" = cls;
      current !== "opaque" &&
      current !== "none" &&
      out.length < this.limits.maxExportHops * 4 &&
      !out.includes(current);
      current = this.parentOf(current)
    )
      out.push(current)
    return out
  }

  /** The method or accessor `cls` or a superclass declares; "opaque" when the chain ends at a class the analysis cannot read before one is found. */
  private findMember(
    cls: ClassInfo,
    kind: "method" | "get" | "set",
    isStatic: boolean,
    name: string,
  ): FunctionInfo | "opaque" | undefined {
    const owners = this.chain(cls)
    for (const owner of owners) {
      // A decorator the scan cannot follow may have replaced the member, or the class.
      if (owner.opaqueClass || owner.opaque.has(memberKey(kind, isStatic, name))) return "opaque"
      const fn = owner.members.get(memberKey(kind, isStatic, name))
      if (fn !== undefined) return fn
    }
    const last = owners[owners.length - 1]
    return last !== undefined && this.parentOf(last) === "opaque" ? "opaque" : undefined
  }

  /** Whether a decorator the scan cannot follow may have replaced this member (or the class that has it). */
  private isDecorated(
    cls: ClassInfo,
    kind: "method" | "get" | "set",
    isStatic: boolean,
    name: string,
  ): boolean {
    return this.chain(cls).some(
      (owner) => owner.opaqueClass || owner.opaque.has(memberKey(kind, isStatic, name)),
    )
  }

  /** The static fields of a class, computed once (running its static initializers and blocks). */
  private classStatics(cls: ClassInfo): ReadonlyMap<string, Val> {
    if (cls.staticVals !== undefined) return cls.staticVals
    const vals = new Map<string, Val>()
    cls.staticVals = vals
    if (cls.staticFn === undefined) return vals
    this.ensureModule(cls.file)
    const frame = this.frame(cls.staticFn, new Env(cls.env, true), 1)
    frame.env.set("this", { ...EMPTY_VAL, classRef: cls.key })
    for (const member of cls.statics) {
      if (ts.isClassStaticBlockDeclaration(member)) {
        this.statements(frame, member.body.statements)
      } else {
        const name = memberName(member.name)
        const value = this.expr(frame, member.initializer)
        if (name !== undefined) vals.set(name, value)
      }
    }
    return vals
  }

  /** A constructor run for a fresh instance starts its class: a base class initializes its fields now, a derived one when it calls `super`. */
  private beginConstruct(frame: Frame, cls: ClassInfo, bound: readonly Val[]): void {
    const parent = this.parentOf(cls)
    if (parent === "none") {
      this.initInstance(frame, cls)
    } else if (frame.fn.node === undefined) {
      // An implicit constructor hands every argument to its superclass.
      this.callSuper(frame, cls.node, bound, [])
    }
  }

  /** The parameter properties and field initializers of `cls`, stored on `this`. */
  private initInstance(frame: Frame, cls: ClassInfo): void {
    for (const param of cls.ctor.params) {
      if (
        ts.isIdentifier(param.name) &&
        (hasModifier(param, ts.SyntaxKind.PublicKeyword) ||
          hasModifier(param, ts.SyntaxKind.PrivateKeyword) ||
          hasModifier(param, ts.SyntaxKind.ProtectedKeyword) ||
          hasModifier(param, ts.SyntaxKind.ReadonlyKeyword))
      )
        this.initMember(frame, param, param.name.text, frame.env.lookup(param.name.text))
    }
    for (const field of cls.fields) {
      const name = memberName(field.name)
      const value = this.expr(frame, field.initializer)
      if (name !== undefined) this.initMember(frame, field, name, value)
    }
  }

  /**
   * Stores one member on `this`. Data it holds is also stored in the shared contents of the object `this` is, as
   * `this.name = value` does, so a method that nothing in the project calls on an instance still finds it; a function
   * is not, since it would lose its callable when read back from there.
   */
  private initMember(frame: Frame, site: TS.Node, name: string, value: Val): void {
    this.storeMember(frame, "this", [name], value)
    if (flattenAtoms(value).length > 0)
      this.storeShared(frame, site, frame.env.lookup("this"), {
        ...EMPTY_VAL,
        props: new Map([[name, value]]),
      })
  }

  /** `super(...)`: the superclass constructor runs on this very instance, then this class's own fields are initialized. */
  private callSuper(
    frame: Frame,
    site: TS.Node,
    args: readonly Val[],
    argExprs: readonly TS.Expression[],
  ): void {
    const cls = frame.fn.cls
    if (cls === undefined) return
    const parent = this.parentOf(cls)
    if (parent === "opaque") {
      this.assignName(frame, "this", this.unresolved(frame, site, undefined, args))
    } else if (parent !== "none") {
      const result = this.analyze({ caller: frame, site, argExprs }, parent.ctor, args, {
        thisVal: frame.env.lookup("this"),
        construct: parent,
      })
      this.assignName(frame, "this", result)
    }
    this.initInstance(frame, cls)
  }

  // ----- functions as values -------------------------------------------------------------------

  private nestedFunction(frame: Frame, node: FunctionLike, hint: string | undefined): FunctionInfo {
    const known = this.nestedByNode.get(node)
    if (known !== undefined) return known
    const position = positionOf(frame.fn.file.sourceFile, node)
    const name = `${frame.fn.name}>${hint ?? "anonymous"}@${position.line}:${position.column}`
    const fn = this.makeFunction(frame.fn.file, name, node)
    fn.closureEnv = frame.env
    this.nestedByNode.set(node, fn)
    this.closureKeys.add(fn.key)
    this.queue.push(fn)
    return fn
  }

  /**
   * A closure value. The same code evaluated in two different scopes makes two different closures -- `mk(a)` and
   * `mk(b)` do not share what they captured -- so each gets its own token, and the token its own scope.
   */
  private closureToken(frame: Frame, node: FunctionLike, hint: string | undefined): string {
    const canonical = this.nestedFunction(frame, node, hint)
    const known = this.instanceTokens.get(frame.env) ?? new Map<string, string>()
    this.instanceTokens.set(frame.env, known)
    const existing = known.get(canonical.key)
    if (existing !== undefined) return existing
    const token = `${canonical.key}\u0000${this.instances.size}`
    this.instances.set(token, { ...canonical, closureEnv: frame.env, instance: token })
    this.closureKeys.add(token)
    // A function analyzed on its own has no arguments: what it makes is covered by the closure run with it, not by this one.
    if (!frame.root) this.madeByCalls.set(token, this.round)
    known.set(canonical.key, token)
    return token
  }

  private functionValue(frame: Frame, node: FunctionLike, hint?: string): Val {
    return { ...EMPTY_VAL, callable: this.closureToken(frame, node, hint) }
  }

  /** The function a value's `callable` token stands for. */
  private functionOf(token: string | undefined): FunctionInfo | undefined {
    if (token === undefined) return undefined
    return this.instances.get(token) ?? this.functions.get(token)
  }

  private resolveCallable(frame: Frame, expression: TS.Expression): FunctionInfo | undefined {
    const target = unwrap(expression)
    if (isFunctionLikeNode(target))
      return this.functionOf(this.closureToken(frame, target, undefined))
    if (ts.isIdentifier(target)) {
      const local = frame.env.get(target.text)
      if (local?.callable !== undefined) return this.functionOf(local.callable)
      if (frame.env.has(target.text)) return undefined
      return this.resolveByName(frame.fn.file, target.text)
    }
    if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
      const namespace = this.namespaceFile(frame.fn.file, target.expression.text)
      // Stryker disable next-line ConditionalExpression: equivalent -- `findExport` of a missing file finds no exports, so skipping it and calling it with `undefined` give the same result.
      if (namespace !== undefined) return this.findExport(namespace, target.name.text)
    }
    if (ts.isPropertyAccessExpression(target)) {
      // A method read off an object or an instance (`handler.send`), passed along as a callback.
      return this.functionOf(this.expr(frame, target).callable)
    }
    // A function made by `bind`, passed along as a callback.
    if (
      ts.isCallExpression(target) &&
      memberCallee(unwrap(target.expression), this.literalReader(frame))?.name.text === "bind"
    )
      return this.functionOf(this.expr(frame, target).callable)
    return undefined
  }

  private resolveByName(file: FileInfo, name: string): FunctionInfo | undefined {
    const target = this.resolveName(file, name)
    return target?.kind === "function" ? target.fn : undefined
  }

  /** What a name that is not a local variable stands for in `file`: a function or class it declares, or something it imports. */
  private resolveName(file: FileInfo, name: string): ExportTarget | undefined {
    const fn = file.topFunctions.get(name)
    if (fn !== undefined) return { kind: "function", fn }
    const cls = file.topClasses.get(name)
    if (cls !== undefined) return { kind: "class", cls }
    const imported = file.resolvedImports.get(name)
    if (imported !== undefined) return this.lookupExport(imported.file, imported.name)
    const namespace = file.namespaces.get(name)
    return namespace === undefined ? undefined : { kind: "namespace", file: namespace }
  }

  /** The module a name refers to when it is `import * as name` or an `export * as name` import. */
  private namespaceFile(file: FileInfo, name: string): string | undefined {
    const direct = file.namespaces.get(name)
    if (direct !== undefined) return direct
    const imported = file.resolvedImports.get(name)
    const target =
      imported === undefined ? undefined : this.lookupExport(imported.file, imported.name)
    return target?.kind === "namespace" ? target.file : undefined
  }

  private importedVal(file: FileInfo, name: string): Val {
    const target = this.resolveName(file, name)
    if (target !== undefined) return this.targetVal(target)
    const imported = file.packageImports.get(name)
    return imported === undefined ? EMPTY_VAL : externalVal(imported.module, imported.name)
  }

  private targetVal(target: ExportTarget): Val {
    switch (target.kind) {
      case "function":
        return this.homeVal(target) ?? { ...EMPTY_VAL, callable: target.fn.key }
      case "class":
        return (
          target.cls.replacement ??
          this.homeVal(target) ?? { ...EMPTY_VAL, classRef: target.cls.key }
        )
      case "namespace":
        return { ...EMPTY_VAL, namespace: target.file }
      case "value":
        this.ensureModule(target.file)
        return target.file.moduleEnv.lookup(target.name)
    }
  }

  private findExport(file: string, name: string): FunctionInfo | undefined {
    const target = this.lookupExport(file, name)
    return target?.kind === "function" ? target.fn : undefined
  }

  /**
   * Follows `export { name } from`, `export * from` and `export * as ns from` hops from `file` to what is finally
   * declared. At most `limits.maxExportHops` files are visited on a route, so a cycle of re-exports ends the search rather
   * than the process.
   */
  private lookupExport(
    file: string | undefined,
    name: string,
    depth = 1,
    seen = new Map<string, number>(),
  ): ExportTarget | undefined {
    const info = this.files.get(file)
    const mark = `${file}\u0000${name}`
    const earlier = seen.get(mark)
    if (
      depth > this.limits.maxExportHops ||
      info === undefined ||
      (earlier !== undefined && earlier <= depth)
    )
      return undefined
    seen.set(mark, depth)
    const ref = info.exports.get(name)
    if (ref !== undefined) {
      if (ref.file === undefined) return this.localTarget(ref.owner, ref.name)
      if (ref.name === "*")
        return this.files.has(ref.file) ? { kind: "namespace", file: ref.file } : undefined
      return this.lookupExport(ref.file, ref.name, depth + 1, seen)
    }
    // `export *` carries every name but `default`.
    if (name === "default") return undefined
    for (const star of info.stars) {
      const found = this.lookupExport(star, name, depth + 1, seen)
      if (found !== undefined) return found
    }
    return undefined
  }

  private localTarget(owner: FileInfo, name: string): ExportTarget | undefined {
    const fn = owner.topFunctions.get(name)
    if (fn !== undefined) return { kind: "function", fn }
    const cls = owner.topClasses.get(name)
    if (cls !== undefined) return { kind: "class", cls }
    return owner.valueNames.has(name) ? { kind: "value", file: owner, name } : undefined
  }

  // ----- expressions ---------------------------------------------------------------------------

  /** The value of an expression, with whatever was stored into the objects it may be through any other name. */
  private expr(frame: Frame, node: TS.Node | undefined): Val {
    return this.heap.expand(this.evaluate(frame, node))
  }

  private evaluate(frame: Frame, node: TS.Node | undefined): Val {
    if (node === undefined || !this.step()) return EMPTY_VAL
    if (isTransparentWrapper(node)) return this.evaluate(frame, node.expression)
    if (ts.isAwaitExpression(node)) return this.awaited(frame, node)
    if (ts.isCallExpression(node)) return this.call(frame, node)
    if (ts.isNewExpression(node)) return this.newExpression(frame, node)
    if (ts.isBinaryExpression(node)) return this.binary(frame, node)
    if (ts.isConditionalExpression(node)) {
      this.expr(frame, node.condition)
      return mergeVals(this.expr(frame, node.whenTrue), this.expr(frame, node.whenFalse))
    }
    return this.referenceOrLiteral(frame, node)
  }

  /** A name, `this`, a member read, or an object / array literal. */
  private referenceOrLiteral(frame: Frame, node: TS.Node): Val {
    if (ts.isIdentifier(node))
      return frame.env.get(node.text) ?? this.importedVal(frame.fn.file, node.text)
    if (node.kind === ts.SyntaxKind.ThisKeyword) return frame.env.get("this") ?? EMPTY_VAL
    if (ts.isPropertyAccessExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.SuperKeyword) return this.superMember(frame, node)
      return this.accessMember(frame, this.expr(frame, node.expression), node.name.text, node)
    }
    if (ts.isElementAccessExpression(node)) return this.elementAccess(frame, node)
    if (ts.isObjectLiteralExpression(node)) return this.objectLiteral(frame, node)
    if (ts.isArrayLiteralExpression(node)) return this.arrayLiteral(frame, node)
    return this.otherExpression(frame, node)
  }

  private otherExpression(frame: Frame, node: TS.Node): Val {
    if (ts.isTemplateExpression(node))
      return approximate(
        mergeVals(...node.templateSpans.map((span) => this.expr(frame, span.expression))),
      )
    if (ts.isTaggedTemplateExpression(node)) return this.taggedTemplate(frame, node)
    if (isFunctionLikeNode(node)) return this.functionValue(frame, node)
    if (ts.isClassExpression(node)) return this.classValue(frame, node)
    if (ts.isYieldExpression(node)) return this.yielded(frame, node)
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      return this.unary(frame, node)
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node) || ts.isDeleteExpression(node)) {
      this.expr(frame, node.expression)
      return EMPTY_VAL
    }
    if (ts.isSpreadElement(node)) return this.expr(frame, node.expression)
    return this.jsxExpression(frame, node)
  }

  private unary(frame: Frame, node: TS.PrefixUnaryExpression | TS.PostfixUnaryExpression): Val {
    const operand = this.expr(frame, node.operand)
    // `-x`, `+x` and `~x` are numeric transformations of `x`, like `x * 1`; `!x`, `++x` and `x--` are not.
    return ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.MinusToken ||
        node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.TildeToken)
      ? approximate(operand)
      : EMPTY_VAL
  }

  private jsxExpression(frame: Frame, node: TS.Node): Val {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return this.jsx(frame, node)
    if (ts.isJsxFragment(node)) this.jsxChildren(frame, node.children)
    return EMPTY_VAL
  }

  /** `super.name` read off the superclass: an accessor runs on this instance, a method is the method. */
  private superMember(frame: Frame, node: TS.PropertyAccessExpression): Val {
    const cls = frame.fn.cls
    const parent = cls === undefined ? "none" : this.parentOf(cls)
    if (parent === "none" || parent === "opaque") return EMPTY_VAL
    const isStatic = frame.fn.role === "static"
    const accessor = this.findMember(parent, "get", isStatic, node.name.text)
    if (accessor !== undefined && accessor !== "opaque")
      return this.analyze({ caller: frame, site: node }, accessor, [], {
        thisVal: frame.env.lookup("this"),
      })
    const method = this.findMember(parent, "method", isStatic, node.name.text)
    return method === undefined || method === "opaque"
      ? EMPTY_VAL
      : { ...EMPTY_VAL, callable: method.instance ?? method.key }
  }

  /** `await x` is `x`; awaiting a rejected promise throws what it was rejected with. */
  private awaited(frame: Frame, node: TS.AwaitExpression): Val {
    const value = this.unwrapPromise(frame, this.expr(frame, node.expression), node)
    const rejected = value.props.get(rejectedKey())
    if (rejected === undefined) return value
    frame.thrown.push(rejected)
    return settled(value)
  }

  /** `yield x` hands `x` to the consumer and evaluates to what `next(y)` sends in; `yield* x` hands over everything `x` yields. */
  private yielded(frame: Frame, node: TS.YieldExpression): Val {
    const value = this.expr(frame, node.expression)
    const item = node.asteriskToken === undefined ? value : this.iterate(frame, value, node)
    frame.yields.push(item)
    this.sink(frame, item, { kind: "return" }, node)
    if (node.asteriskToken === undefined) return this.sentInto(frame)
    // `yield* inner` hands the generator inner everything that is sent to this one.
    const forwarded = this.sentInto(frame)
    for (const [id, generator] of this.generatorsOf(value))
      this.send(frame, node, id, generator, forwarded)
    return EMPTY_VAL
  }

  private sentSlot(id: string): SentSlot {
    const known = this.sent.get(id)
    if (known !== undefined) return known
    const slot: SentSlot = { values: new Map() }
    this.sent.set(id, slot)
    return slot
  }

  /** What was sent into this evaluation of the generator, as a parameter the generator receives after its declared ones. */
  private sentInto(frame: Frame): Val {
    const slot = this.sentSlot(frame.callKey)
    const received = withEntry(mergeVals(...slot.values.values()), {
      kind: "param",
      fn: frame.fn.key,
      index: frame.fn.params.length,
    })
    this.noteEntry(frame.fn, received)
    return received
  }

  /** The generators `value` holds handles to, each with the evaluation it runs in. */
  private generatorsOf(value: Val): [string, FunctionInfo][] {
    const ids = handlesOf(value, GENERATOR_HANDLE)
    return [...this.generators].filter(([id]) => ids.includes(id))
  }

  /** `generator.next(x)` hands `x` to the `yield` the generator is stopped at -- any of them, as the scan does not count the calls. */
  private send(frame: Frame, node: TS.Node, id: string, generator: FunctionInfo, value: Val): void {
    const slot = this.sentSlot(id)
    const key = signatureOf(value)
    if (!slot.values.has(key)) {
      slot.values.set(key, value)
      // A `yield` analyzed before this call took less than the generator is now sent.
      this.dirty = true
    }
    this.sink(
      frame,
      value,
      { kind: "arg", callee: generator, index: generator.params.length },
      node,
    )
  }

  /** A tagged template calls its tag with the strings and the substituted values. */
  private taggedTemplate(frame: Frame, node: TS.TaggedTemplateExpression): Val {
    const spans = ts.isTemplateExpression(node.template)
      ? node.template.templateSpans.map((span) => this.expr(frame, span.expression))
      : []
    const tag = unwrap(node.tag)
    if (
      ts.isPropertyAccessExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      tag.expression.text === "String" &&
      tag.name.text === "raw"
    )
      return approximate(mergeVals(...spans))
    const target = this.resolveCallable(frame, tag)
    if (target !== undefined)
      return this.analyze({ caller: frame, site: node }, target, [EMPTY_VAL, ...spans])
    return this.unresolved(frame, node, undefined, spans)
  }

  /** The string an expression is for sure -- a literal, or a `const` initialized with one -- for `o[k]`. */
  private literalReader(frame: Frame): LiteralReader {
    return (expression) => {
      const target = unwrap(expression)
      if (ts.isStringLiteralLike(target)) return target.text
      return ts.isIdentifier(target) ? frame.env.textOf(target.text) : undefined
    }
  }

  private elementAccess(frame: Frame, node: TS.ElementAccessExpression): Val {
    return this.readKey(frame, node, this.expr(frame, node.expression), node.argumentExpression)
  }

  /** `receiver[key]`: a literal or constant key reads that property, a number an element, anything else every property (an explicit unknown when the receiver holds tracked data). */
  private readKey(frame: Frame, node: TS.Node, receiver: Val, key: TS.Expression): Val {
    const argument = unwrap(key)
    const text = this.literalReader(frame)(argument)
    if (text !== undefined) return this.accessMember(frame, receiver, text, node)
    if (ts.isNumericLiteral(argument)) return this.accessMember(frame, receiver, ELEMENT_KEY, node)
    this.expr(frame, argument)
    const held = this.materialize(frame, receiver, node)
    if (flattenAtoms(held).length > 0) {
      this.unknown(
        frame.fn,
        "dynamic-access",
        node,
        "computed property key on tracked data",
        flattenAtoms(held),
      )
      const result = accessDynamic(held)
      this.touch(frame.fn, result, node)
      return result
    }
    return EMPTY_VAL
  }

  private objectLiteral(frame: Frame, node: TS.ObjectLiteralExpression): Val {
    const props: Record<string, Val> = {}
    const spreads: Val[] = []
    let lone: Val | undefined
    const inherited: Val[] = []
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const key = keyOf(property.name)
        const value = this.expr(frame, property.initializer)
        if (key === undefined) spreads.push(approximate(value))
        else if (key === "__proto__") inherited.push(value)
        else props[key] = props[key] === undefined ? value : mergeVals(props[key], value)
      } else if (ts.isShorthandPropertyAssignment(property)) {
        props[property.name.text] = this.expr(frame, property.name)
      } else if (ts.isSpreadAssignment(property)) {
        const operand = this.expr(frame, property.expression)
        spreads.push(operand)
        if (node.properties.length === 1) lone = operand
      } else {
        this.objectMethod(frame, property, props)
      }
    }
    // `{ ...x }` and nothing else is a copy of `x`.
    if (lone !== undefined) return this.copied(frame, node, lone, "copy", false)
    // A spread copies the properties of an object into a new one: the new object is not the old.
    return this.fresh(
      frame,
      node,
      objectVal(props, [...spreads.map((spread) => withoutAlloc(spread)), ...inherited]),
    )
  }

  /** A method, getter or setter written in an object literal: a closure stored under its name. */
  private objectMethod(
    frame: Frame,
    property: TS.MethodDeclaration | TS.AccessorDeclaration,
    props: Record<string, Val>,
  ): void {
    if (property.body === undefined) return
    const key = memberName(property.name)
    const value = this.functionValue(frame, property, key)
    if (key === undefined) return
    if (ts.isMethodDeclaration(property)) props[key] = value
    else props[accessorKey(ts.isGetAccessorDeclaration(property) ? "get" : "set", key)] = value
  }

  private arrayLiteral(frame: Frame, node: TS.ArrayLiteralExpression): Val {
    let lone: Val | undefined
    const elements = node.elements.map((element) => {
      if (!ts.isSpreadElement(element)) return this.expr(frame, element)
      const operand = this.expr(frame, element.expression)
      if (node.elements.length === 1) lone = operand
      return this.iterate(frame, operand, element)
    })
    const merged = mergeVals(...elements)
    const made = this.fresh(frame, node, { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, merged]]) })
    // `[...x]` and nothing else is a copy of `x`.
    return lone === undefined ? made : this.copiedElements(frame, node, lone, made)
  }

  private binary(frame: Frame, node: TS.BinaryExpression): Val {
    const operator = node.operatorToken.kind
    const { SyntaxKind } = ts
    if (operator === SyntaxKind.EqualsToken) {
      const value = this.expr(frame, node.right)
      this.assign(frame, node.left, value)
      return value
    }
    const left = this.expr(frame, node.left)
    const right = this.expr(frame, node.right)
    if (operator === SyntaxKind.CommaToken) return right
    if (isLogicalOperator(operator)) return mergeVals(left, right)
    if (isCompoundAssignment(operator)) {
      const value =
        operator === SyntaxKind.PlusEqualsToken
          ? approximate(mergeVals(left, right))
          : mergeVals(left, right)
      this.assign(frame, node.left, value)
      return value
    }
    return isArithmeticOperator(operator) ? approximate(mergeVals(left, right)) : EMPTY_VAL
  }

  // ----- assignment ----------------------------------------------------------------------------

  /** Binds `value` to `name` in the nearest scope that has it, noting when that scope is not the running one. */
  private assignName(frame: Frame, name: string, value: Val): void {
    if (frame.env.has(name)) {
      if (frame.env.assign(name, value)) this.dirty = true
      return
    }
    // Not a variable of this function or its scopes: an imported object lives in the module that exports it, anything else is a global.
    const imported = this.resolveName(frame.fn.file, name)
    const home = imported === undefined ? undefined : this.homeOf(imported)
    if (home !== undefined) {
      this.assignShared(home.file.moduleEnv, home.name, value)
    } else {
      this.assignShared(this.globalEnv, name, value)
    }
  }

  /** A function or class as its module holds it: with the properties stored on it since (`Foo.prototype.m = ...`, `Foo.helper = ...`), from any module. */
  private homeVal(target: Extract<ExportTarget, { kind: "function" | "class" }>): Val | undefined {
    const home = this.homeOf(target)
    if (home === undefined) return undefined
    const held = home.file.moduleEnv.lookup(home.name)
    const [bound, own] =
      target.kind === "function" ? [held.callable, target.fn.key] : [held.classRef, target.cls.key]
    return bound === own ? held : undefined
  }

  /** The module scope and the name a function, class or exported variable lives under, so a store through an import reaches the original. */
  private homeOf(
    target: ExportTarget,
  ): { readonly file: FileInfo; readonly name: string } | undefined {
    if (target.kind === "value") return target
    if (target.kind === "function") {
      return [...target.fn.file.topFunctions]
        .filter(([, fn]) => fn === target.fn)
        .map(([name]) => ({ file: target.fn.file, name }))[0]
    }
    if (target.kind === "class") {
      const name = target.cls.node.name?.text
      return name === undefined ? undefined : { file: target.cls.file, name }
    }
    return undefined
  }

  /** Writes where every function can read it; the functions analyzed before this write must see it, so a new or changed binding asks for another round. */
  private assignShared(env: Env, name: string, value: Val): void {
    const before = env.get(name)
    env.assign(name, value)
    if (before === undefined || signatureOf(before) !== signatureOf(env.lookup(name)))
      this.dirty = true
  }

  /** Stores `value` at `keys` below the variable `root`, merging with what it already holds. */
  private storeMember(frame: Frame, root: string, keys: readonly string[], value: Val): void {
    const nested = keys.reduceRight<Val>(
      (inner, key) => ({ ...EMPTY_VAL, props: new Map([[key, inner]]) }),
      value,
    )
    this.assignName(frame, root, nested)
    if (keys.length > 0) frame.mutated.add(root)
  }

  private assign(frame: Frame, target: TS.Expression, value: Val): void {
    const left = unwrap(target)
    if (ts.isIdentifier(left)) {
      this.assignName(frame, left.text, value)
    } else if (left.kind === ts.SyntaxKind.ThisKeyword) {
      // The object a callee filled in through `Base.call(this, ...)`.
      this.assignName(frame, "this", value)
    } else if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
      this.assignMember(frame, left, value)
    } else if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) {
      this.assignPattern(frame, left, value)
    }
  }

  /** `a.b.c = value`: stored under the variable `a` -- or reported, when the store reaches somewhere the analysis cannot follow. */
  private assignMember(
    frame: Frame,
    left: TS.PropertyAccessExpression | TS.ElementAccessExpression,
    value: Val,
  ): void {
    const chain = memberChain(left, this.literalReader(frame))
    const atoms = this.atomsOf(frame, value, left)
    if (this.callSetter(frame, left, value)) return
    // `o.__proto__ = p` makes `o` answer to what `p` holds; it is not a property of `o`.
    const proto = chain.keys.at(-1) === "__proto__"
    const keys = proto ? chain.keys.slice(0, -1) : chain.keys
    this.storeAt(
      frame,
      left,
      { root: chain.root, keys, dynamic: chain.dynamic },
      value,
      atoms,
      // The object the property is stored into, read again only when the store is to a plain chain of names.
      proto ? undefined : () => this.expr(frame, left.expression),
    )
  }

  /** Stores `value` below the variable a member chain starts from. */
  private storeAt(
    frame: Frame,
    site: TS.Node,
    chain: {
      readonly root: string | undefined
      readonly keys: readonly string[]
      readonly dynamic: boolean
    },
    value: Val,
    atoms: readonly Atom[],
    container?: () => Val | undefined,
  ): void {
    const { root, keys, dynamic } = chain
    if (root === undefined) {
      this.flagStore(frame, site, atoms, "assignment target is not a variable")
      return
    }
    if (this.storeThroughNamespace(frame, root, keys, value)) return
    if (dynamic)
      this.flagStore(
        frame,
        site,
        atoms,
        "computed property key on a store of tracked data",
        "dynamic-access",
      )
    else if (frame.aliased.has(root))
      this.flagStore(frame, site, atoms, "property stored into an object another name may share")
    // Read before the store below, which changes what the object holds.
    const shared = keys
      .slice(dynamic ? keys.length : -1)
      .map((last) => ({ into: container?.(), last }))
    this.storeMember(frame, root, keys, value)
    for (const { into, last } of shared)
      this.storeShared(frame, site, into, { ...EMPTY_VAL, props: new Map([[last, value]]) })
    this.noteParameterStore(frame, site, root, value)
  }

  /** `ns.shared.x = value` where `ns` is an imported module: the object `shared` lives in that module. */
  private storeThroughNamespace(
    frame: Frame,
    root: string,
    keys: readonly string[],
    value: Val,
  ): boolean {
    if (frame.env.has(root)) return false
    const module = this.namespaceFile(frame.fn.file, root)
    return keys
      .slice(0, 1)
      .map((first) => {
        const target = this.lookupExport(module, first)
        if (target?.kind !== "value") return false
        const nested = keys
          .slice(1)
          .reduceRight<Val>(
            (inner, key) => ({ ...EMPTY_VAL, props: new Map([[key, inner]]) }),
            value,
          )
        this.assignShared(target.file.moduleEnv, target.name, nested)
        return true
      })
      .includes(true)
  }

  // ----- copies and derivations (ADR 0075) -----------------------------------------------------

  /** Whether the value is a copy a recognised copy made: copying it again changes nothing. */
  private isFreshCopy(val: Val): boolean {
    return val.alloc?.every((id) => this.copySites.has(id)) === true
  }

  /** Notes what happened to the tracked data in `val` at `node`: one tag for each piece of it, on the edge that carries it into this function. */
  private tagData(
    frame: Frame,
    node: TS.Node,
    val: Val,
    via: FlowEdgeTagInput["via"],
    flags: Pick<FlowEdgeTagInput, "fresh" | "unused"> = {},
  ): void {
    for (const atom of flattenAtoms(val)) {
      const edge = this.emitEntry(frame.fn, atom, node)
      // Stryker disable next-line ConditionalExpression: equivalent -- `emitEntry` finds no edge only for an atom whose function key was never registered, and every atom's was when it was made.
      if (edge !== undefined)
        this.edgeTags.push({ via, edge, source: this.location(frame.fn, node), ...flags })
    }
  }

  /** A copy of `operand` that changes nothing, made at `node` with its own object (its own nested objects too, when the copy is deep). */
  private copied(
    frame: Frame,
    node: TS.Node,
    operand: Val,
    via: "copy" | "serialize-roundtrip",
    deep: boolean,
  ): Val {
    this.tagData(frame, node, operand, via, this.isFreshCopy(operand) ? { fresh: true } : {})
    const where = `${node.pos}:${node.end}`
    const renamed = deep
      ? remapAllocs(operand, (id) =>
          id === OPAQUE_ALLOC ? id : this.heap.allocId(frame.callKey, `${where}:${id}`),
        )
      : operand
    const result = this.fresh(frame, node, withoutAlloc(renamed))
    for (const id of deep ? allocsOf(result) : result.alloc) this.copySites.add(id)
    return result
  }

  /** `[...x]` made `made` out of `operand`: a copy, noted as one. */
  private copiedElements(frame: Frame, node: TS.Node, operand: Val, made: Allocated): Val {
    this.tagData(frame, node, operand, "copy", this.isFreshCopy(operand) ? { fresh: true } : {})
    for (const id of made.alloc) this.copySites.add(id)
    return made
  }

  /** A name nothing reads, bound to a value derived from tracked data and nothing else, is a derivation nobody uses. */
  private noteUnusedDerivation(
    frame: Frame,
    declaration: TS.VariableDeclaration,
    value: Val,
  ): void {
    const { initializer } = declaration
    const root = frame.fn.node
    if (root === undefined || initializer === undefined || !isPureDerivation(initializer)) return
    const counts = identifierCounts(root)
    const names = bindingNames(declaration.name)
    // A name that is written once is written where it is declared; `_name` says it is meant to be unused.
    const unused = names.every((name) => counts.get(name) === 1 && !name.startsWith("_"))
    if (names.length > 0 && unused)
      this.tagData(frame, declaration, value, "derive", { unused: true })
  }

  /** A value for the object an expression at `node` makes: it has its own allocation site, so what is stored into it is shared by every alias. */
  private fresh(frame: Frame, node: TS.Node, val: Val): Allocated {
    return withAlloc(val, this.heap.allocId(frame.callKey, `${node.pos}:${node.end}`))
  }

  /** Writes `content` into the shared contents of the objects `container` may be, so every other name for them sees it. */
  private storeShared(frame: Frame, site: TS.Node, container: Val | undefined, content: Val): void {
    if (container?.alloc === undefined) return
    if (container.alloc.includes(OPAQUE_ALLOC))
      this.flagStore(
        frame,
        site,
        this.atomsOf(frame, content, site),
        "tracked data stored into an object whose origin the analysis cannot see",
      )
    const sites = container.alloc.filter((id) => id !== OPAQUE_ALLOC)
    if (this.heap.store(sites, content, frame.callKey)) this.dirty = true
  }

  private flagStore(
    frame: Frame,
    node: TS.Node,
    atoms: readonly Atom[],
    detail: string,
    reason: FlowUnknownReason = "unsupported-construct",
  ): void {
    if (atoms.length > 0) this.unknown(frame.fn, reason, node, detail, atoms)
  }

  /** `obj.prop = value` where `prop` has a setter runs the setter instead of storing. */
  private callSetter(
    frame: Frame,
    left: TS.PropertyAccessExpression | TS.ElementAccessExpression,
    value: Val,
  ): boolean {
    const link = linkKey(left, this.literalReader(frame))
    const receiver = this.expr(frame, left.expression)
    const own = receiver.props.get(accessorKey("set", link.key))
    const cls = this.classes.get(receiver.instance)
    const inherited = cls === undefined ? undefined : this.findMember(cls, "set", false, link.key)
    const setter = own?.callable === undefined ? inherited : this.functionOf(own.callable)
    if (setter === undefined || setter === "opaque") return false
    this.analyze({ caller: frame, site: left, receiver: left.expression }, setter, [value], {
      thisVal: receiver,
    })
    return true
  }

  /** `({ a, b: [c] } = value)` and `[a, b] = value`: binds each target to its part of `value`. */
  private assignPattern(
    frame: Frame,
    pattern: TS.ObjectLiteralExpression | TS.ArrayLiteralExpression,
    value: Val,
  ): void {
    if (ts.isArrayLiteralExpression(pattern)) {
      const items = this.iterate(frame, value, pattern)
      for (const element of pattern.elements) {
        this.assignTarget(
          frame,
          ts.isSpreadElement(element) ? element.expression : element,
          ts.isSpreadElement(element) ? value : items,
        )
      }
      return
    }
    for (const property of pattern.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        const part = this.accessMember(frame, value, property.name.text, property)
        const fallback = this.expr(frame, property.objectAssignmentInitializer)
        this.assignName(frame, property.name.text, mergeVals(part, fallback))
      } else if (ts.isPropertyAssignment(property)) {
        const key = keyOf(property.name)
        const part =
          key === undefined
            ? accessDynamic(this.materialize(frame, value, property))
            : this.accessMember(frame, value, key, property)
        this.assignTarget(frame, property.initializer, part)
      } else if (ts.isSpreadAssignment(property)) {
        this.assignTarget(frame, property.expression, approximate(value))
      }
    }
  }

  /** One target of a destructuring assignment: it may carry a default (`a = 1`) or be a nested pattern. */
  private assignTarget(frame: Frame, target: TS.Expression, part: Val): void {
    const inner = unwrap(target)
    if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      this.assign(frame, inner.left, mergeVals(part, this.expr(frame, inner.right)))
    } else {
      this.assign(frame, inner, part)
    }
  }

  private jsxChildren(frame: Frame, children: TS.NodeArray<TS.JsxChild>): void {
    for (const child of children)
      this.expr(frame, ts.isJsxExpression(child) ? child.expression : child)
  }

  private jsx(frame: Frame, node: TS.JsxElement | TS.JsxSelfClosingElement): Val {
    const opening = ts.isJsxElement(node) ? node.openingElement : node
    const props: Record<string, Val> = {}
    const spreads: Val[] = []
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxAttribute(attribute)) {
        const key = ts.isIdentifier(attribute.name) ? attribute.name.text : undefined
        const value =
          attribute.initializer !== undefined && ts.isJsxExpression(attribute.initializer)
            ? this.expr(frame, attribute.initializer.expression)
            : EMPTY_VAL
        if (key !== undefined) props[key] = value
      } else {
        spreads.push(this.expr(frame, attribute.expression))
      }
    }
    const propsVal = objectVal(props, spreads)
    if (ts.isJsxElement(node)) this.jsxChildren(frame, node.children)
    const tag = opening.tagName
    const target = ts.isIdentifier(tag) ? this.resolveCallable(frame, tag) : undefined
    if (target !== undefined)
      return this.analyze({ caller: frame, site: opening }, target, [propsVal])
    return this.unresolved(frame, opening, undefined, [propsVal])
  }

  // ----- calls ---------------------------------------------------------------------------------

  private callbackArgs(frame: Frame, list: readonly TS.Expression[]): (FunctionInfo | undefined)[] {
    return list.map((argument) => this.resolveCallable(frame, argument))
  }

  /**
   * The values of a call's arguments. A spread argument stands for each of the parameters from its position on (at
   * least `arity` positions), so `f(...items)` hands every parameter an element.
   */
  private evalArgs(
    frame: Frame,
    node: { readonly arguments?: readonly TS.Expression[] },
    arity = 1,
  ): Val[] {
    return (node.arguments ?? []).flatMap((argument, index) => {
      if (!ts.isSpreadElement(argument)) return [this.expr(frame, argument)]
      const element = this.iterate(frame, this.expr(frame, argument.expression), argument)
      return Array.from({ length: Math.max(arity - index, 1) }, () => element)
    })
  }

  /** The identifier a callee chain starts from (`res` in `res.status(200).json`), looking through calls, members and wrappers. */
  private rootIdentifier(expression: TS.Expression): TS.Identifier | undefined {
    const root = unwrap(expression)
    if (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root))
      return this.rootIdentifier(root.expression)
    return ts.isIdentifier(root) ? root : undefined
  }

  /** A sink is named by the root of the callee chain and its last member (`res.status(200).json` is `res.json`), or by the member just before the method (`this.logger.info` is `logger.info`). */
  private matchSink(callee: TS.Expression): FlowSinkPattern | undefined {
    const target = unwrap(callee)
    if (!ts.isPropertyAccessExpression(target)) return undefined
    const receiver = unwrap(target.expression)
    const root = this.rootIdentifier(target.expression)
    const wanted = [
      root === undefined ? undefined : `${root.text}.${target.name.text}`,
      ts.isPropertyAccessExpression(receiver)
        ? `${receiver.name.text}.${target.name.text}`
        : undefined,
    ]
    return this.sinks.find((pattern) => wanted.includes(pattern.callee))
  }

  private call(frame: Frame, node: TS.CallExpression): Val {
    const callee = unwrap(node.expression)
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return this.dynamicImport(frame, node)
    if (callee.kind === ts.SyntaxKind.SuperKeyword) {
      this.callSuper(frame, node, this.evalArgs(frame, node), node.arguments)
      return EMPTY_VAL
    }
    if (ts.isIdentifier(callee)) {
      const reserved = this.reservedCall(frame, node, callee)
      if (reserved !== undefined) return reserved
    }

    const sink = this.matchSink(callee)
    if (sink !== undefined) return this.sinkCall(frame, node, sink)

    const member = memberCallee(callee, this.literalReader(frame))
    if (member !== undefined) return this.methodCall(frame, node, member)

    const target = this.resolveCallable(frame, callee)
    const args = this.evalArgs(frame, node, target?.params.length)
    const site: CallSite = { caller: frame, site: node, argExprs: node.arguments }
    if (target !== undefined) return this.analyze(site, target, args)
    return this.valueCall(frame, node, callee, args, site)
  }

  /** A call whose callee is not a declared project function: a global builtin, a capability method, a function held in a value, or something unresolved. */
  private valueCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: TS.Expression,
    args: readonly Val[],
    site: CallSite,
  ): Val {
    if (ts.isIdentifier(callee) && isBuiltinGlobal(callee.text))
      return approximate(mergeVals(...args))
    if (ts.isIdentifier(callee) && callee.text === "structuredClone")
      return this.copied(frame, node, mergeVals(...args), "copy", true)
    const computed = this.expr(frame, callee)
    if (computed.capability !== undefined && computed.boundMethod !== undefined)
      return this.capabilityCall(frame, node, computed.capability, computed.boundMethod)
    const fn = this.functionOf(computed.callable)
    if (fn !== undefined) return this.analyze(site, fn, args)
    if (this.isSettler(computed)) return this.settleCall(frame, node, computed, args)
    const declared = this.declaredCall(frame, node, computed.external, args)
    if (declared !== undefined) return declared
    return this.unresolved(frame, node, undefined, args)
  }

  /** `createData(...)` and friends stay opaque; `require(...)` loads a module. `undefined` for any other name. */
  private reservedCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: TS.Identifier,
  ): Val | undefined {
    if (isOpaqueCallee(callee.text)) return EMPTY_VAL
    return callee.text === "require" && !frame.env.has("require")
      ? this.requireCall(frame, node)
      : undefined
  }

  /** `require("./x")` is what the module `./x` exports; any other specifier is only reported when tracked data decides it. */
  private requireCall(frame: Frame, node: TS.CallExpression): Val {
    const specifier = loadedSpecifier(node)
    if (specifier === undefined) return this.dynamicImport(frame, node)
    const file = frame.fn.file.dynamicImports.get(specifier)
    return this.loaded(specifier, file)
  }

  /** What loading `specifier` gives: a project file's exports, or, for any other module, what its package exports. */
  private loaded(specifier: string, file: string | undefined): Val {
    return file !== undefined && this.files.has(file)
      ? this.moduleExports(file)
      : externalVal(specifier, "*")
  }

  /** What `require` hands back for a project file: its `export`s, and whatever it stored on `exports` and `module.exports`. */
  private moduleExports(file: string): Val {
    const info = this.files.get(file)
    if (info === undefined) return EMPTY_VAL
    this.ensureModule(info)
    const written = mergeVals(
      info.moduleEnv.lookup("exports"),
      info.moduleEnv.lookup("module").props.get("exports") ?? EMPTY_VAL,
    )
    return mergeVals({ ...EMPTY_VAL, namespace: file }, written)
  }

  /** A call that sends its arguments through a boundary. */
  private sinkCall(frame: Frame, node: TS.CallExpression, sink: FlowSinkPattern): Val {
    const args = this.evalArgs(frame, node)
    const sent = this.materialize(frame, mergeVals(...args), node)
    // The boundary only exists in the model when tracked data actually reaches it.
    if (flattenAtoms(sent).length > 0) {
      this.sink(
        frame,
        sent,
        { kind: "boundary", id: this.codeBoundary(sink.boundary), handling: sink.handling },
        node,
      )
    }
    return EMPTY_VAL
  }

  /** `new C(...)`: the constructor of a project class runs on a fresh instance; a builtin the scan models is built; anything else is a call the analysis cannot follow. */
  private newExpression(frame: Frame, node: TS.NewExpression): Val {
    const builtin = this.builtinNew(frame, node)
    if (builtin !== undefined) return builtin
    const target = this.expr(frame, node.expression)
    const constructor = this.constructorOf(target)
    const args = this.evalArgs(frame, node, constructor?.params.length)
    return this.construct(frame, node, target, args, node.arguments ?? [])
  }

  /** The function that runs when `target` is constructed: a project class's constructor, or a plain function. */
  private constructorOf(target: Val): FunctionInfo | undefined {
    const cls = this.classes.get(target.classRef ?? "")
    if (cls !== undefined) return cls.ctor
    const fn = this.functionOf(target.callable)
    return fn?.node === undefined || ts.isArrowFunction(fn.node) ? undefined : fn
  }

  /** `new target(...args)`, for a class or for a function written as a constructor. */
  private construct(
    frame: Frame,
    node: TS.Node,
    target: Val,
    args: readonly Val[],
    argExprs: readonly TS.Expression[],
  ): Val {
    const cls = this.classes.get(target.classRef ?? "")
    if (cls !== undefined)
      return this.analyze({ caller: frame, site: node, argExprs }, cls.ctor, args, {
        thisVal: this.fresh(frame, node, { ...EMPTY_VAL, instance: cls.key }),
        construct: cls,
      })
    const fn = this.constructorOf(target)
    if (fn === undefined) return this.unresolved(frame, node, undefined, args)
    // Its instances answer to whatever was stored on its `prototype`.
    const instance: Val = this.fresh(frame, node, {
      ...EMPTY_VAL,
      props: new Map(target.props.get("prototype")?.props),
    })
    return this.analyze({ caller: frame, site: node, argExprs }, fn, args, {
      thisVal: instance,
      constructs: true,
    })
  }

  /** `import("./x.js")` loads a project module; any other specifier is only reported when tracked data decides it. */
  private dynamicImport(frame: Frame, node: TS.CallExpression): Val {
    const args = this.evalArgs(frame, node)
    const specifier = node.arguments[0] === undefined ? undefined : unwrap(node.arguments[0])
    if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
      const file = frame.fn.file.dynamicImports.get(specifier.text)
      return file === undefined ? EMPTY_VAL : { ...EMPTY_VAL, namespace: file }
    }
    const atoms = this.atomsOf(frame, mergeVals(...args), node)
    if (atoms.length > 0)
      this.unknown(
        frame.fn,
        "unresolved-import",
        node,
        "module specifier is computed from tracked data",
        atoms,
      )
    return EMPTY_VAL
  }

  private methodCall(frame: Frame, node: TS.CallExpression, callee: MemberCallee): Val {
    const name = callee.name.text
    const base = unwrap(callee.expression)
    if (base.kind === ts.SyntaxKind.SuperKeyword) return this.superMethodCall(frame, node, name)
    const rootName = ts.isIdentifier(base) ? base.text : String(base.kind)

    const method =
      name === "call"
        ? prototypeMethod(callee.expression, (shadow) => frame.env.has(shadow))
        : undefined
    if (method !== undefined) return this.prototypeCall(frame, node, method)

    const namespaceFile = this.namespaceFile(frame.fn.file, rootName)
    if (namespaceFile !== undefined)
      return this.namespaceCall(frame, node, namespaceFile, rootName, name)

    if (!frame.env.has(rootName) && isBuiltinRoot(rootName))
      return this.builtinCall(frame, node, rootName, name)

    const receiver = this.expr(frame, callee.expression)

    if (receiver.capability !== undefined && receiver.boundMethod === undefined)
      return this.capabilityCall(frame, node, receiver.capability, name)

    const member = this.resolveMember(receiver, name)
    if (member === "opaque")
      return this.unresolved(frame, node, receiver, this.evalArgs(frame, node))
    if (member !== undefined) {
      const args = this.evalArgs(frame, node, member.params.length)
      const site: CallSite = {
        caller: frame,
        site: node,
        argExprs: node.arguments,
        receiver: callee.expression,
      }
      return this.analyze(site, member, args, { thisVal: receiver })
    }
    return this.valueMethodCall(frame, node, callee, receiver, name)
  }

  /** `ns.name(...)` on an imported module: an export of a project module, or, for a package, whatever its declared summary says. */
  private namespaceCall(
    frame: Frame,
    node: TS.CallExpression,
    namespaceFile: string,
    rootName: string,
    name: string,
  ): Val {
    const exported = this.findExport(namespaceFile, name)
    const args = this.evalArgs(frame, node, exported?.params.length)
    if (exported !== undefined)
      return this.analyze({ caller: frame, site: node, argExprs: node.arguments }, exported, args)
    const imported = frame.fn.file.packageImports.get(rootName)
    const external =
      imported === undefined
        ? undefined
        : externalKey(externalMember(`${imported.module}\u0000${imported.name}`, name))
    return (
      this.declaredCall(frame, node, external, args) ??
      this.unresolved(frame, node, undefined, args)
    )
  }

  /** The project function a method call on `receiver` runs: a module's export, a class's method, a function stored under that name. */
  private resolveMember(receiver: Val, name: string): FunctionInfo | "opaque" | undefined {
    const exported =
      receiver.namespace === undefined ? undefined : this.findExport(receiver.namespace, name)
    if (exported !== undefined) return exported
    const own = this.functionOf(receiver.props.get(name)?.callable)
    if (own !== undefined) return own
    const cls = this.classes.get(receiver.instance ?? receiver.classRef ?? "")
    if (cls === undefined) return undefined
    return this.methodOf(cls, receiver.instance === undefined, name)
  }

  /** The method a class answers to under `name`: one it declares, or one stored on its `prototype` from outside its body. */
  private methodOf(
    cls: ClassInfo,
    isStatic: boolean,
    name: string,
  ): FunctionInfo | "opaque" | undefined {
    const declared = this.findMember(cls, "method", isStatic, name)
    if (isStatic || (declared !== undefined && declared !== "opaque")) return declared
    return this.functionOf(this.mixedIn(cls, name)?.callable) ?? declared
  }

  /** What `Class.prototype.name = ...` and `Object.assign(Class.prototype, ...)` stored for `cls` or a superclass. */
  private mixedIn(cls: ClassInfo, name: string): Val | undefined {
    for (const owner of this.chain(cls)) {
      const className = owner.node.name?.text
      const bound = className === undefined ? undefined : owner.env.get(className)
      const stored =
        bound?.classRef === owner.key ? bound.props.get("prototype")?.props.get(name) : undefined
      if (stored !== undefined) return stored
    }
    return undefined
  }

  /** `super.method(...)`: the superclass's method, run on this instance. */
  private superMethodCall(frame: Frame, node: TS.CallExpression, name: string): Val {
    const cls = frame.fn.cls
    const parent = cls === undefined ? "none" : this.parentOf(cls)
    const isStatic = frame.fn.role === "static"
    const found =
      parent === "none" || parent === "opaque"
        ? parent
        : this.findMember(parent, "method", isStatic, name)
    const args = this.evalArgs(frame, node)
    if (found === undefined || found === "none" || found === "opaque")
      return this.unresolved(frame, node, frame.env.get("this"), args)
    return this.analyze({ caller: frame, site: node, argExprs: node.arguments }, found, args, {
      thisVal: frame.env.lookup("this"),
    })
  }

  private builtinCall(frame: Frame, node: TS.CallExpression, rootName: string, name: string): Val {
    const qualified = `${rootName}.${name}`
    // A JSON round trip changes nothing a data-flow analysis can see.
    const stringified = qualified === "JSON.parse" ? this.stringifiedArgument(node) : undefined
    if (stringified !== undefined) return this.roundTrip(frame, node, stringified)
    const args = this.evalArgs(frame, node)
    if (isBuiltinEmpty(qualified)) return EMPTY_VAL
    const special = this.specialBuiltin(frame, node, qualified, args)
    if (special !== undefined) return special
    const merged = mergeVals(...args)
    if (qualified === "Object.values" || qualified === "Object.entries") {
      // An array of the object's values (or of key/value pairs): every value is one element.
      const element = accessDynamic(this.materialize(frame, merged, node))
      const pair: Val = { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, element]]) }
      return {
        ...EMPTY_VAL,
        props: new Map([[ELEMENT_KEY, qualified === "Object.values" ? element : pair]]),
      }
    }
    if (qualified === "Object.fromEntries") {
      // `Object.fromEntries(Object.entries(x))` takes the object apart and puts it back as it was.
      if (this.isEntriesOf(node)) this.tagData(frame, node, merged, "serialize-roundtrip")
      return accessDynamic(this.materialize(frame, merged, node))
    }
    if (qualified === "Array.from" && node.arguments.length === 1)
      return this.copiedElements(
        frame,
        node,
        merged,
        this.fresh(frame, node, withoutAlloc(approximate(merged))),
      )
    this.storeIntoTarget(frame, node, qualified, args)
    if (qualified === "Promise.reject")
      return { ...EMPTY_VAL, props: new Map([[rejectedKey(), merged]]) }
    return isBuiltinExact(qualified) ? merged : approximate(merged)
  }

  /** `JSON.parse(JSON.stringify(x))`: the data of `x` in new objects. With a replacer, a reviver or a second argument it can change the data, so only the plain pair is a copy. */
  private roundTrip(frame: Frame, node: TS.CallExpression, stringified: TS.CallExpression): Val {
    const operand = this.expr(frame, stringified.arguments[0])
    return node.arguments.length === 1 && stringified.arguments.length === 1
      ? this.copied(frame, node, operand, "serialize-roundtrip", true)
      : operand
  }

  /** Whether the call's only argument is `Object.entries(x)` with nothing else. */
  private isEntriesOf(node: TS.CallExpression): boolean {
    const [first] = node.arguments
    const inner = first === undefined ? undefined : unwrap(first)
    if (node.arguments.length !== 1 || inner === undefined || !ts.isCallExpression(inner))
      return false
    const callee = unwrap(inner.expression)
    return (
      inner.arguments.length === 1 &&
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "Object" &&
      callee.name.text === "entries"
    )
  }

  /** `JSON.stringify(x)` written as the argument of `JSON.parse`: that call. */
  private stringifiedArgument(node: TS.CallExpression): TS.CallExpression | undefined {
    const [first] = node.arguments
    const inner = first === undefined ? undefined : unwrap(first)
    if (inner === undefined || !ts.isCallExpression(inner)) return undefined
    const callee = unwrap(inner.expression)
    return ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "JSON" &&
      callee.name.text === "stringify"
      ? inner
      : undefined
  }

  /** The builtins whose result the scan models rather than approximates; `undefined` for the rest. */
  private specialBuiltin(
    frame: Frame,
    node: TS.CallExpression,
    qualified: string,
    args: readonly Val[],
  ): Val | undefined {
    if (qualified.startsWith("Reflect."))
      return this.reflectCall(frame, node, qualified.slice(8), args)
    if (qualified === "Object.groupBy" || qualified === "Map.groupBy")
      return this.groupBy(frame, node, qualified, args)
    if (qualified === "Object.create") return this.objectCreate(frame, node, args)
    if (qualified.startsWith("Promise."))
      return this.promiseStatic(frame, node, qualified.slice(8), args)
    return undefined
  }

  /** `Object.assign(target, ...sources)` and `Object.defineProperty(target, ...)` change `target` itself. */
  private storeIntoTarget(
    frame: Frame,
    node: TS.CallExpression,
    qualified: string,
    args: readonly Val[],
  ): void {
    const target = node.arguments[0]
    const stored = qualified === "Object.assign" || qualified === "Object.setPrototypeOf"
    if (!stored && !qualified.startsWith("Object.define")) return
    if (target === undefined) return
    const given = mergeVals(...args.slice(1))
    // A property defined through a descriptor holds the descriptor's value under a name chosen at run time.
    const value = stored ? given : accessDynamic(this.materialize(frame, given, node))
    const fresh =
      ts.isObjectLiteralExpression(unwrap(target)) || ts.isArrayLiteralExpression(unwrap(target))
    if (stored) this.storeShared(frame, node, args[0], value)
    if (memberChain(target).root !== undefined) this.assign(frame, target, value)
    else if (!fresh)
      this.flagStore(frame, node, flattenAtoms(value), "assignment target is not a variable")
  }

  /** The calls made on a value rather than on a module, a class or a capability: promises, array methods, strings, and the rest. */
  private valueMethodCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: MemberCallee,
    receiver: Val,
    name: string,
    list: readonly TS.Expression[] = node.arguments,
  ): Val {
    if (isThenMethod(name)) return this.promiseCall(frame, node, receiver, name, list)
    if (name === "call" || name === "apply") {
      const handled = this.functionCall(frame, node, callee, name)
      if (handled !== undefined) return handled
    }
    const args = this.evalArgs(frame, { arguments: list })
    const modelled = this.modelledCall(frame, node, callee, receiver, name, args, list)
    if (modelled !== undefined) return modelled
    if (isElementCallbackMethod(name) || isReduceMethod(name)) {
      const handled = this.callbackCall(frame, node, receiver, name, args, list)
      if (handled !== undefined) return handled
    }
    return this.plainMethodCall(frame, node, callee, receiver, name, args)
  }

  /** Calls on values the scan models itself: bound functions, maps, sets and generators. `undefined` when `receiver` is none of them. */
  private modelledCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: MemberCallee,
    receiver: Val,
    name: string,
    args: readonly Val[],
    list: readonly TS.Expression[],
  ): Val | undefined {
    if (name === "bind") return this.bindCall(frame, node, receiver, args)
    if (receiver.external !== undefined)
      return this.declaredCall(
        frame,
        node,
        externalKey(externalMember(receiver.external, name)),
        args,
      )
    if (receiver.native === "map")
      return this.mapCall(frame, node, callee, receiver, name, args, list)
    if (receiver.native === "set")
      return this.setCall(frame, node, callee, receiver, name, args, list)
    if (name === "next" && receiver.props.has(ELEMENT_KEY))
      return this.generatorNext(frame, node, receiver, args)
    return undefined
  }

  /** `fn.bind(thisArg, ...args)` on a project function; a capability's method bound to its capability is still that method. */
  private bindCall(
    frame: Frame,
    node: TS.CallExpression,
    receiver: Val,
    args: readonly Val[],
  ): Val | undefined {
    if (receiver.boundMethod !== undefined) return receiver
    const target = this.functionOf(receiver.callable)
    if (target === undefined) return undefined
    const [self, ...rest] = args
    const token = `${target.instance ?? target.key}\u0000bind${this.instances.size}`
    this.instances.set(token, {
      ...target,
      instance: token,
      bound: {
        thisVal: target.bound?.thisVal ?? self,
        args: [...(target.bound?.args ?? []), ...rest],
      },
    })
    // The data fixed into the function travels with it: a bound function handed to code the scan cannot read hands that over too.
    const fixed = this.materialize(
      frame,
      mergeVals(...(self === undefined ? [] : [self]), ...rest),
      node,
    )
    return { ...EMPTY_VAL, atoms: flattenAtoms(approximate(fixed)), callable: token }
  }

  private plainMethodCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: MemberCallee,
    receiver: Val,
    name: string,
    args: readonly Val[],
  ): Val {
    if (name === "push" || name === "unshift" || name === "splice" || name === "fill") {
      // Elements stored where no later read can find them are data that went somewhere unseen.
      if (!this.storeElements(frame, callee.expression, receiver, args))
        this.unresolved(frame, node, undefined, args)
      if (name === "push" || name === "unshift") return EMPTY_VAL
    }
    if (isPredicateMethod(name)) return EMPTY_VAL
    if (isShapePreservingMethod(name) || name === "fill")
      return mergeVals(this.elementIfArray(frame, receiver, name, node), ...args)
    if (isTransformingMethod(name)) return approximate(mergeVals(receiver, ...args))
    return this.unresolved(frame, node, receiver, args)
  }

  /** Stores `args` as elements of the array `target` names; false when `target` is not something a later read can find again. */
  private storeElements(
    frame: Frame,
    target: TS.Expression,
    receiver: Val,
    args: readonly Val[],
  ): boolean {
    return this.fillContainer(frame, target, receiver, arrayOf(mergeVals(...args)))
  }

  /** Merges `added` into the variable or member `target` names, as a call that fills a container does; false when `target` is not something a later read can find again. */
  private fillContainer(frame: Frame, target: TS.Expression, container: Val, added: Val): boolean {
    this.storeShared(frame, target, container, added)
    const { root } = memberChain(target)
    if (root === undefined) return false
    // Another name may hold this very object: what is stored here is stored there too, and the scan does not follow that.
    if (frame.aliased.has(root))
      this.flagStore(
        frame,
        target,
        this.atomsOf(frame, added, target),
        "property stored into an object another name may share",
      )
    this.assign(frame, target, added)
    frame.mutated.add(root)
    this.noteParameterStore(frame, target, root, added)
    return true
  }

  /** `generator.next(x)` hands out what the generator yielded, and sends `x` to a generator the project defines; into any other it is an unknown. */
  private generatorNext(
    frame: Frame,
    node: TS.CallExpression,
    receiver: Val,
    args: readonly Val[],
  ): Val {
    if (handlesOf(receiver, GENERATOR_HANDLE).length === 0) this.unresolvedSent(frame, node, args)
    for (const [id, generator] of this.generatorsOf(receiver))
      this.send(frame, node, id, generator, mergeVals(...args))
    return objectVal(
      { value: this.accessMember(frame, receiver, ELEMENT_KEY, node), done: EMPTY_VAL },
      [],
    )
  }

  /** Tracked data handed to a generator through `next(x)` flows into code this analysis does not follow. */
  private unresolvedSent(frame: Frame, node: TS.Node, args: readonly Val[]): void {
    const atoms = this.atomsOf(frame, mergeVals(...args), node)
    if (atoms.length > 0)
      this.unknown(
        frame.fn,
        "unresolved-call",
        node,
        "value sent into a generator is not followed",
        atoms,
      )
  }

  /** `promise.then(a, b)`, `.catch(b)`, `.finally(c)`: the callbacks run with the settled value, or with what the promise was rejected with. */
  private promiseCall(
    frame: Frame,
    node: TS.CallExpression,
    promise: Val,
    name: string,
    list: readonly TS.Expression[],
  ): Val {
    const callbacks = this.callbackArgs(frame, list)
    this.evalArgs(frame, { arguments: list })
    const receiver = this.unwrapPromise(frame, promise, node)
    const rejected = receiver.props.get(rejectedKey()) ?? EMPTY_VAL
    const value = settled(receiver)
    let result = name === "catch" ? value : name === "then" ? EMPTY_VAL : receiver
    callbacks.forEach((fn, index) => {
      if (fn === undefined) return
      const received =
        name === "then" && index === 0 ? value : name === "finally" ? EMPTY_VAL : rejected
      const returned = this.analyze({ caller: frame, site: node }, fn, [received])
      if (name !== "finally") result = mergeVals(result, returned)
    })
    if (callbacks.every((fn) => fn === undefined)) return promise
    // What the callbacks do not handle stays rejected.
    if (name !== "then" || flattenAtoms(rejected).length === 0) return result
    return mergeVals(result, { ...EMPTY_VAL, props: new Map([[rejectedKey(), rejected]]) })
  }

  /** `array.map(cb)`, `forEach`, `reduce`, ...: the callback runs once with an element (and the accumulator). */
  private callbackCall(
    frame: Frame,
    node: TS.CallExpression,
    receiver: Val,
    name: string,
    args: readonly Val[],
    list: readonly TS.Expression[],
  ): Val | undefined {
    const [callback] = this.callbackArgs(frame, list)
    if (callback === undefined) {
      if (this.unresolvedCallback(list)) this.unresolved(frame, node, receiver, args)
      if (isPredicateMethod(name) || name === "forEach") return EMPTY_VAL
      return undefined
    }
    const site: CallSite = { caller: frame, site: node, argExprs: list }
    const element = this.accessMember(frame, receiver, ELEMENT_KEY, node)
    if (isReduceMethod(name)) {
      const initial = args[1] ?? EMPTY_VAL
      const returned = this.analyze(site, callback, [mergeVals(initial, receiver), element])
      return approximate(mergeVals(initial, returned))
    }
    const returned = this.analyze(site, callback, [element])
    if (name === "map" || name === "flatMap")
      return { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, returned]]) }
    if (name === "forEach" || isPredicateMethod(name)) return EMPTY_VAL
    if (name === "find" || name === "findLast")
      return this.elementIfArray(frame, receiver, name, node)
    return receiver
  }

  /** `at`, `find` and `findLast` give one element of an array whose elements are known, and otherwise the value itself. */
  private elementIfArray(frame: Frame, receiver: Val, name: string, node: TS.Node): Val {
    const single = name === "at" || name === "find" || name === "findLast"
    return single && receiver.props.has(ELEMENT_KEY)
      ? this.accessMember(frame, receiver, ELEMENT_KEY, node)
      : receiver
  }

  /** Whether the first argument names something that could be a callback (not a literal, not a builtin like `Boolean`) -- and, being here, was not resolved. */
  private unresolvedCallback(list: readonly TS.Expression[]): boolean {
    const [first] = list
    if (first === undefined) return false
    const target = unwrap(first)
    if (ts.isIdentifier(target)) return !isBuiltinGlobal(target.text)
    return (
      ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target) ||
      ts.isCallExpression(target) ||
      ts.isConditionalExpression(target) ||
      ts.isBinaryExpression(target)
    )
  }

  /** `fn.call(thisArg, ...args)` and `fn.apply(thisArg, array)` call a project function. */
  private functionCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: MemberCallee,
    name: string,
  ): Val | undefined {
    const method = this.expr(frame, callee.expression)
    if (method.capability !== undefined && method.boundMethod !== undefined)
      return this.capabilityCall(frame, node, method.capability, method.boundMethod)
    const target = this.resolveCallable(frame, callee.expression)
    if (target === undefined) return undefined
    const [self, ...rest] = this.evalArgs(frame, node)
    const args =
      name === "call"
        ? rest
        : Array.from({ length: Math.max(target.params.length, 1) }, () =>
            this.accessMember(frame, rest[0] ?? EMPTY_VAL, ELEMENT_KEY, node),
          )
    // What the callee stores on `this` is stored on the object `thisArg` names (`Base.call(this, x)`), and on the arguments it fills in.
    const site: CallSite = {
      caller: frame,
      site: node,
      argExprs: name === "call" ? node.arguments.slice(1) : [],
      ...(node.arguments[0] === undefined ? {} : { receiver: node.arguments[0] }),
    }
    return this.analyze(site, target, args, self === undefined ? {} : { thisVal: self })
  }

  private capabilityCall(frame: Frame, node: TS.CallExpression, capKey: string, name: string): Val {
    const cap = this.caps.get(capKey)
    const args = this.evalArgs(frame, node)
    if (cap === undefined) return EMPTY_VAL
    if (name === "getSnapshot") {
      return { ...EMPTY_VAL, props: new Map([["fields", { ...EMPTY_VAL, fieldsOf: capKey }]]) }
    }
    const operation = cap.operations.get(name)
    if (operation === undefined) return EMPTY_VAL
    this.addEdge({
      kind: "calls",
      from: this.fnNode(frame.fn),
      to: this.operationNode(cap, name),
      status: "static",
      source: this.location(frame.fn, node),
    })
    this.sink(
      frame,
      mergeVals(...args),
      { kind: "operation", cap, operation: name, info: operation },
      node,
    )
    return EMPTY_VAL
  }

  /** A call whose target cannot be followed: tracked data going in is an explicit unknown, and is assumed to come out approximately. */
  private unresolved(
    frame: Frame,
    node: TS.Node,
    receiver: Val | undefined,
    args: readonly Val[],
  ): Val {
    // Nothing a call returns is a package's export, whatever was handed to it.
    const all = this.materialize(
      frame,
      withoutExternal(mergeVals(...(receiver === undefined ? [] : [receiver]), ...args)),
      node,
    )
    const atoms = flattenAtoms(all)
    if (atoms.length === 0) return withAlloc(EMPTY_VAL, OPAQUE_ALLOC)
    if (this.callsThroughParameter(frame, node))
      this.deferUnknown(
        frame.fn,
        node,
        atoms,
        "unresolved-call",
        "call target is not a project function",
      )
    else
      this.unknown(
        frame.fn,
        "unresolved-call",
        node,
        "call target is not a project function",
        atoms,
      )
    for (const atom of atoms)
      this.entered
        .get(this.entryKey(frame.fn.key, atom.origin, atom.entryPath))
        ?.touched.push(atom.path)
    return withAlloc(approximate(all), OPAQUE_ALLOC)
  }

  /** Whether `node` calls something reached through one of the parameters of a function that is being analyzed on its own, where the parameter is empty. */
  private callsThroughParameter(frame: Frame, node: TS.Node): boolean {
    if (!frame.root || !ts.isCallExpression(node)) return false
    const root = this.rootIdentifier(node.expression)
    return (
      root !== undefined &&
      frame.fn.params.some((param) => bindingNames(param.name).includes(root.text))
    )
  }

  private deferUnknown(
    fn: FunctionInfo,
    node: TS.Node,
    atoms: readonly Atom[],
    reason: FlowUnknownReason,
    detail: string,
  ): void {
    const kept = this.provisional.get(fn.key) ?? []
    kept.push({ fn, node, atoms, reason, detail })
    this.provisional.set(fn.key, kept)
  }

  /** Data stored on an object that arrived as a parameter is in the caller's hands: reported unless every caller is analyzed (the object is then written back). */
  private noteParameterStore(frame: Frame, node: TS.Node, root: string, value: Val): void {
    if (!frame.root || !frame.fn.params.some((param) => bindingNames(param.name).includes(root)))
      return
    const atoms = this.atomsOf(frame, value, node)
    if (atoms.length > 0)
      this.deferUnknown(
        frame.fn,
        node,
        atoms,
        "unsupported-construct",
        "tracked data stored on an object the caller owns",
      )
  }

  /** Whether code outside the analyzed project may call `fn`: it is exported, or belongs to an exported class. */
  private exposed(fn: FunctionInfo): boolean {
    const names = new Set([fn.name, fn.cls?.name])
    return [...fn.file.exports.values()].some(
      (ref) => ref.file === undefined && names.has(ref.name),
    )
  }

  /** What was met only while analyzing a function with empty arguments is dropped when analyzed code does call it, unless callers outside the project could too. */
  private flushDeferred(): void {
    for (const [key, items] of this.provisional) {
      const fn = this.functions.get(key)
      if (fn === undefined || (this.calledKeys.has(key) && !this.exposed(fn))) continue
      for (const item of items)
        this.unknown(item.fn, item.reason, item.node, item.detail, item.atoms)
    }
  }

  // ----- decorators ----------------------------------------------------------------------------

  /** Calls the decorators written on a class and on its members, as the language does when the class is defined. */
  private applyDecorators(cls: ClassInfo): void {
    if (cls.decorated) return
    cls.decorated = true
    const fn = this.makeFunction(cls.file, `${cls.name}.decorators`, undefined)
    const frame = this.frame(fn, new Env(cls.env, true), 1)
    for (const member of cls.node.members) this.decorateMember(frame, cls, member)
    for (const decorator of decoratorsOf(cls.node).reverse()) {
      const result = this.runDecorator(frame, decorator, [{ ...EMPTY_VAL, classRef: cls.key }])
      if (result === undefined) cls.opaqueClass = true
      else if (result.classRef !== undefined && result.classRef !== cls.key)
        this.replaceClass(cls, result)
    }
  }

  /** A class decorator returned another class: that is what the class's name stands for from now on. */
  private replaceClass(cls: ClassInfo, replacement: Val): void {
    cls.replacement = replacement
    const name = cls.node.name?.text
    if (name !== undefined) cls.env.set(name, replacement)
  }

  /** Runs one decorator with the arguments it receives; `undefined` when it is not a function the project defines. */
  private runDecorator(
    frame: Frame,
    decorator: TS.Decorator,
    args: readonly Val[],
  ): Val | undefined {
    const fn = this.functionOf(this.expr(frame, decorator.expression).callable)
    return fn === undefined ? undefined : this.analyze({ caller: frame, site: decorator }, fn, args)
  }

  private decorateMember(frame: Frame, cls: ClassInfo, member: TS.ClassElement): void {
    if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member))
      for (const param of member.parameters)
        for (const decorator of decoratorsOf(param))
          this.runDecorator(frame, decorator, [EMPTY_VAL, EMPTY_VAL, EMPTY_VAL])
    if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    )
      this.decorateMethod(frame, cls, member)
    else if (ts.isPropertyDeclaration(member))
      for (const decorator of decoratorsOf(member).reverse())
        this.runDecorator(frame, decorator, [EMPTY_VAL, EMPTY_VAL])
  }

  /** A method decorator may return a function, or a descriptor holding one, that takes the method's place. */
  private decorateMethod(
    frame: Frame,
    cls: ClassInfo,
    member: TS.MethodDeclaration | TS.GetAccessorDeclaration | TS.SetAccessorDeclaration,
  ): void {
    const name = memberName(member.name)
    if (name === undefined) return
    const kind = ts.isMethodDeclaration(member)
      ? "method"
      : ts.isGetAccessorDeclaration(member)
        ? "get"
        : "set"
    const key = memberKey(kind, hasModifier(member, ts.SyntaxKind.StaticKeyword), name)
    for (const decorator of decoratorsOf(member).reverse()) {
      const current = cls.members.get(key)
      if (current === undefined) return
      const original = { ...EMPTY_VAL, callable: current.instance ?? current.key }
      // The descriptor holds a method as `value`, an accessor as `get` or `set`.
      const slot = kind === "method" ? "value" : kind
      const result = this.runDecorator(frame, decorator, [
        original,
        EMPTY_VAL,
        objectVal({ [slot]: original }, []),
      ])
      if (result === undefined) {
        cls.opaque.add(key)
        continue
      }
      const replacement = this.replacementOf(result, original, slot)
      if (replacement === "opaque") cls.opaque.add(key)
      else if (replacement !== undefined) cls.members.set(key, replacement)
    }
  }

  /** The function a method decorator put in place of the method: what it returned, or the `value` of the descriptor it returned. `"opaque"` when it replaced the method with something the scan cannot tell apart. */
  private replacementOf(
    result: Val,
    original: Val,
    slot: string,
  ): FunctionInfo | "opaque" | undefined {
    const returned = this.functionOf(result.callable)
    if (returned !== undefined) return returned
    const value = result.props.get(slot)
    if (value === undefined || value.callable === original.callable) return undefined
    return this.functionOf(value.callable) ?? "opaque"
  }

  // ----- declared summaries --------------------------------------------------------------------

  /** The summary the project declared for a package export, if any. */
  private summaryFor(external: string): FlowSummary | undefined {
    // `split` always gives at least the module.
    const [module, path = ""] = external.split("\u0000") as [string, string?]
    const bare = path.startsWith("default.") ? path.slice(8) : undefined
    return this.summaries.find(
      (summary) =>
        summary.module === module && (summary.export === path || summary.export === bare),
    )
  }

  /** A call to a package export: what its declared summary says, or `undefined` when none was declared (then it is an unknown). */
  private declaredCall(
    frame: Frame,
    node: TS.CallExpression,
    external: string | undefined,
    args: readonly Val[],
  ): Val | undefined {
    const summary = external === undefined ? undefined : this.summaryFor(external)
    if (summary === undefined) return undefined
    const given = this.materialize(frame, mergeVals(...args), node)
    // Whatever the summary says, the function reads what it is handed.
    this.touch(frame.fn, given, node)
    switch (summary.effect) {
      case "pass-through":
        return this.declaredResult(given, summary.approximate)
      case "returns-arg":
        return this.declaredResult(
          this.materialize(frame, args[summary.arg] ?? EMPTY_VAL, node),
          summary.approximate,
        )
      case "sink":
        this.sinkToDeclared(frame, node, given, summary)
        return EMPTY_VAL
      default:
        return EMPTY_VAL
    }
  }

  /** The result of a summarized call: the data it carries, as the author's word. */
  private declaredResult(val: Val, approximated: true | undefined): Val {
    return declaredVal(approximated === true ? approximate(val) : val)
  }

  /** A summary that says the arguments are sent through a boundary. */
  private sinkToDeclared(
    frame: Frame,
    node: TS.CallExpression,
    sent: Val,
    summary: FlowSummary & { readonly effect: "sink" },
  ): void {
    if (flattenAtoms(sent).length === 0) return
    const id = this.addNode({
      kind: "boundary",
      scope: "boundary:declared",
      name: summary.boundary.name,
      status: "declared",
      boundaryKind: summary.boundary.kind,
    })
    this.sink(
      frame,
      sent,
      { kind: "boundary", id, handling: summary.handling, declared: true },
      node,
    )
  }

  // ----- builtins with known semantics ---------------------------------------------------------

  /** `new Map(...)`, `new Set(...)`, `new Promise(...)`; `undefined` for any other constructor, or one the project shadows. */
  private builtinNew(frame: Frame, node: TS.NewExpression): Val | undefined {
    const callee = unwrap(node.expression)
    if (!ts.isIdentifier(callee) || frame.env.has(callee.text)) return undefined
    if (this.resolveName(frame.fn.file, callee.text) !== undefined) return undefined
    if (callee.text === "Map" || callee.text === "WeakMap")
      return this.fresh(frame, node, this.newMap(frame, node))
    if (callee.text === "Set" || callee.text === "WeakSet")
      return this.fresh(frame, node, this.newSet(frame, node))
    return callee.text === "Promise" ? this.newPromise(frame, node) : undefined
  }

  /** A map made of `[key, value]` literals keeps keys and values apart; one made of anything else cannot tell them apart. */
  private newMap(frame: Frame, node: TS.NewExpression): Val {
    const [source] = node.arguments ?? []
    if (source === undefined) return mapVal(EMPTY_VAL, EMPTY_VAL)
    const pairs = literalPairs(source)
    if (pairs !== undefined) {
      const keys = pairs.map((pair) => this.expr(frame, pair.elements[0]))
      const values = pairs.map((pair) => this.expr(frame, pair.elements[1]))
      return mapVal(mergeVals(...keys), mergeVals(...values))
    }
    const given = this.expr(frame, source)
    if (given.native === "map")
      return mapVal(
        given.props.get(MAP_KEYS) ?? EMPTY_VAL,
        given.props.get(MAP_VALUES) ?? EMPTY_VAL,
      )
    const element = this.iterate(frame, this.iterate(frame, given, node), node)
    return mapVal(element, element)
  }

  private newSet(frame: Frame, node: TS.NewExpression): Val {
    const [source] = node.arguments ?? []
    return setVal(
      source === undefined ? EMPTY_VAL : this.iterate(frame, this.expr(frame, source), node),
    )
  }

  /** `new Promise(executor)`: the executor runs with `resolve` and `reject` that settle this very promise, wherever they are called from. */
  private newPromise(frame: Frame, node: TS.NewExpression): Val {
    const position = positionOf(frame.fn.file.sourceFile, node)
    const id = `${frame.callKey}@${position.line}:${position.column}`
    const handle = handleVal(PROMISE_HANDLE, id)
    const [executor] = node.arguments ?? []
    const target = executor === undefined ? undefined : this.resolveCallable(frame, executor)
    const args = this.evalArgs(frame, node)
    if (target === undefined)
      return mergeVals(handle, this.unresolved(frame, node, undefined, args))
    const raised = frame.thrown.length
    this.analyze({ caller: frame, site: node }, target, [
      handleVal(RESOLVE_HANDLE, id),
      handleVal(REJECT_HANDLE, id),
    ])
    // What the executor throws rejects the promise.
    const thrown = frame.thrown.splice(raised)
    if (thrown.length > 0) this.settle(frame, node, id, "rejected", mergeVals(...thrown))
    return handle
  }

  private promiseSlot(id: string): PromiseSlot {
    const known = this.promiseSlots.get(id)
    if (known !== undefined) return known
    const slot: PromiseSlot = { resolved: new Map(), rejected: new Map(), read: false }
    this.promiseSlots.set(id, slot)
    return slot
  }

  /** Records what a promise was resolved or rejected with, and hands it to the function that settled it as a return. */
  private settle(
    frame: Frame,
    node: TS.Node,
    id: string,
    outcome: "resolved" | "rejected",
    value: Val,
  ): void {
    const slot = this.promiseSlot(id)
    const list = slot[outcome]
    const key = JSON.stringify([frame.fn.key, signatureOf(value)])
    if (!list.has(key)) {
      list.set(key, { from: frame.fn.key, val: value })
      // Whoever awaited it before saw less than it holds now.
      if (slot.read) this.dirty = true
    }
    this.sink(frame, value, { kind: "return" }, node)
  }

  /** The value a promise made by `new Promise` settles with, what it was rejected with, kept apart as an awaited or `.then`-ed value is. */
  private unwrapPromise(frame: Frame, promise: Val, site: TS.Node): Val {
    const ids = handlesOf(promise, PROMISE_HANDLE)
    if (ids.length === 0) return promise
    const parts: Val[] = [dropHandles(promise)]
    for (const id of ids) {
      const slot = this.promiseSlot(id)
      slot.read = true
      const back = (settlement: Settlement): Val =>
        withEntry(settlement.val, { kind: "return", from: settlement.from })
      parts.push(...[...slot.resolved.values()].map(back))
      const rejected = [...slot.rejected.values()].map(back)
      if (rejected.length > 0)
        parts.push({ ...EMPTY_VAL, props: new Map([[rejectedKey(), mergeVals(...rejected)]]) })
    }
    const result = mergeVals(...parts)
    // The data comes to this function from whichever function settled the promise, as a value it was returned.
    this.noteEntry(frame.fn, result)
    this.touch(frame.fn, result, site)
    return result
  }

  private isSettler(callee: Val): boolean {
    return handlesOf(callee, RESOLVE_HANDLE).length + handlesOf(callee, REJECT_HANDLE).length > 0
  }

  /** `resolve(x)` / `reject(e)`: settles every promise the callee stands for. */
  private settleCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: Val,
    args: readonly Val[],
  ): Val {
    const value = args[0] ?? EMPTY_VAL
    for (const id of handlesOf(callee, RESOLVE_HANDLE))
      this.settle(frame, node, id, "resolved", this.unwrapPromise(frame, value, node))
    for (const id of handlesOf(callee, REJECT_HANDLE))
      this.settle(frame, node, id, "rejected", value)
    return EMPTY_VAL
  }

  /** `Promise.all`, `allSettled`, `race`, `any`: the settled values of the promises given, and the first rejection. */
  private promiseStatic(
    frame: Frame,
    node: TS.CallExpression,
    name: string,
    args: readonly Val[],
  ): Val | undefined {
    if (!["all", "allSettled", "race", "any"].includes(name)) return undefined
    const items = this.unwrapPromise(frame, this.iterate(frame, args[0] ?? EMPTY_VAL, node), node)
    const rejected = items.props.get(rejectedKey())
    const value = settled(items)
    if (name === "allSettled")
      return arrayOf(objectVal({ value, reason: rejected ?? EMPTY_VAL }, []))
    const failure: Val =
      rejected === undefined
        ? EMPTY_VAL
        : { ...EMPTY_VAL, props: new Map([[rejectedKey(), rejected]]) }
    return mergeVals(name === "all" ? arrayOf(value) : value, failure)
  }

  /** `Reflect.*`: each is the operation it names, written as a call. */
  private reflectCall(
    frame: Frame,
    node: TS.CallExpression,
    name: string,
    args: readonly Val[],
  ): Val {
    const access = this.reflectAccess(frame, node, name, args)
    if (access !== undefined) return access
    // Names and booleans only: what they answer holds no data.
    if (["has", "deleteProperty", "ownKeys", "isExtensible"].includes(name)) return EMPTY_VAL
    if (name === "defineProperty" || name === "setPrototypeOf") {
      this.storeIntoTarget(frame, node, `Object.${name}`, args)
      return EMPTY_VAL
    }
    if (name === "getPrototypeOf") return approximate(mergeVals(...args))
    if (name === "apply") return this.reflectApply(frame, node, args)
    if (name === "construct") return this.reflectConstruct(frame, node, args)
    return this.unresolved(frame, node, undefined, args)
  }

  /** `Reflect.get`, `Reflect.set` and `Reflect.getOwnPropertyDescriptor` are a property read, a property store, and a read wrapped in a descriptor. */
  private reflectAccess(
    frame: Frame,
    node: TS.CallExpression,
    name: string,
    args: readonly Val[],
  ): Val | undefined {
    const [target, key] = node.arguments
    if (target === undefined || key === undefined) return undefined
    if (name === "get") return this.readKey(frame, node, args[0] ?? EMPTY_VAL, key)
    if (name === "getOwnPropertyDescriptor")
      return objectVal({ value: this.readKey(frame, node, args[0] ?? EMPTY_VAL, key) }, [])
    if (name !== "set") return undefined
    const literal = this.literalReader(frame)
    const chain = memberChain(target, literal)
    const text = literal(unwrap(key))
    const dynamic = text === undefined && !ts.isNumericLiteral(unwrap(key))
    const value = args[2] ?? EMPTY_VAL
    this.storeAt(
      frame,
      node,
      {
        root: chain.root,
        keys: [...chain.keys, text ?? ELEMENT_KEY],
        dynamic: chain.dynamic || dynamic,
      },
      value,
      this.atomsOf(frame, value, node),
      () => args[0],
    )
    return EMPTY_VAL
  }

  /** `Reflect.construct(Class, argumentsList)` is `new Class(...argumentsList)`. */
  private reflectConstruct(frame: Frame, node: TS.CallExpression, args: readonly Val[]): Val {
    const target = args[0] ?? EMPTY_VAL
    const list = args[1] ?? EMPTY_VAL
    const arity = Math.max(this.constructorOf(target)?.params.length ?? 1, 1)
    const given = Array.from({ length: arity }, () =>
      this.accessMember(frame, list, ELEMENT_KEY, node),
    )
    return this.construct(frame, node, target, given, [])
  }

  /** `Reflect.apply(fn, thisArg, argumentsList)` is `fn.apply(thisArg, argumentsList)`. */
  private reflectApply(frame: Frame, node: TS.CallExpression, args: readonly Val[]): Val {
    const target = this.functionOf(args[0]?.callable)
    if (target === undefined) return this.unresolved(frame, node, undefined, args)
    const list = args[2] ?? EMPTY_VAL
    const spread = Array.from({ length: Math.max(target.params.length, 1) }, () =>
      this.accessMember(frame, list, ELEMENT_KEY, node),
    )
    return this.analyze(
      { caller: frame, site: node },
      target,
      spread,
      args[1] === undefined ? {} : { thisVal: args[1] },
    )
  }

  /** `Object.create(proto, descriptors)`: an object that answers to everything `proto` holds -- its methods, its data, its class. */
  private objectCreate(frame: Frame, node: TS.CallExpression, args: readonly Val[]): Val {
    const [proto, descriptors] = args
    // A property defined through a descriptor holds the descriptor's value under a name chosen at run time.
    const defined =
      descriptors === undefined
        ? EMPTY_VAL
        : accessDynamic(this.materialize(frame, descriptors, node))
    return this.fresh(frame, node, mergeVals(proto ?? EMPTY_VAL, defined))
  }

  /** `Object.groupBy(items, f)` and `Map.groupBy(items, f)`: arrays of the items, under the keys `f` chooses. */
  private groupBy(
    frame: Frame,
    node: TS.CallExpression,
    qualified: string,
    args: readonly Val[],
  ): Val {
    const callbackExpression = node.arguments[1]
    const callback =
      callbackExpression === undefined ? undefined : this.resolveCallable(frame, callbackExpression)
    if (callback === undefined) return this.unresolved(frame, node, undefined, args)
    const element = this.iterate(frame, args[0] ?? EMPTY_VAL, node)
    const chosen = this.analyze({ caller: frame, site: node, argExprs: node.arguments }, callback, [
      element,
      EMPTY_VAL,
    ])
    const group = arrayOf(element)
    return qualified === "Map.groupBy" ? mapVal(chosen, group) : recordVal(group)
  }

  /** The calls on a `Map` / `WeakMap`; `undefined` for a method it does not have. */
  private mapCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: MemberCallee,
    receiver: Val,
    name: string,
    args: readonly Val[],
    list: readonly TS.Expression[],
  ): Val | undefined {
    const keys = receiver.props.get(MAP_KEYS) ?? EMPTY_VAL
    const values = receiver.props.get(MAP_VALUES) ?? EMPTY_VAL
    switch (name) {
      case "get":
        return values
      case "set":
        return this.addToCollection(
          frame,
          node,
          callee,
          receiver,
          mapVal(args[0] ?? EMPTY_VAL, args[1] ?? EMPTY_VAL),
          args,
        )
      case "has":
      case "delete":
      case "clear":
        return EMPTY_VAL
      case "forEach":
        return this.collectionEach(frame, node, receiver, [values, keys, receiver], args, list)
      case "values":
        return arrayOf(values)
      case "keys":
        return arrayOf(keys)
      case "entries":
        return arrayOf(receiver.props.get(ELEMENT_KEY) ?? EMPTY_VAL)
      default:
        return undefined
    }
  }

  /** The calls on a `Set` / `WeakSet`; `undefined` for a method it does not have. */
  private setCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: MemberCallee,
    receiver: Val,
    name: string,
    args: readonly Val[],
    list: readonly TS.Expression[],
  ): Val | undefined {
    const items = receiver.props.get(ELEMENT_KEY) ?? EMPTY_VAL
    switch (name) {
      case "add":
        return this.addToCollection(
          frame,
          node,
          callee,
          receiver,
          setVal(args[0] ?? EMPTY_VAL),
          args,
        )
      case "has":
      case "delete":
      case "clear":
        return EMPTY_VAL
      case "forEach":
        return this.collectionEach(frame, node, receiver, [items, items, receiver], args, list)
      case "values":
      case "keys":
        return arrayOf(items)
      case "entries":
        return arrayOf(arrayOf(items))
      default:
        return setAlgebra(name, items, args[0]?.props.get(ELEMENT_KEY) ?? EMPTY_VAL)
    }
  }

  /** `m.set(k, v)` / `s.add(x)`: stored into the variable the chain of calls starts from, and the collection returned for chaining. */
  private addToCollection(
    frame: Frame,
    node: TS.CallExpression,
    callee: MemberCallee,
    receiver: Val,
    added: Val,
    args: readonly Val[],
  ): Val {
    const base = collectionBase(callee.expression)
    if (!this.fillContainer(frame, base, receiver, added) && !ts.isNewExpression(base)) {
      // Stored into something no later read can find: data that went somewhere unseen.
      this.unresolved(frame, node, undefined, args)
    }
    return mergeVals(receiver, added)
  }

  /** `forEach(callback)` on a collection: the callback runs once with what the collection holds. */
  private collectionEach(
    frame: Frame,
    node: TS.CallExpression,
    receiver: Val,
    params: readonly Val[],
    args: readonly Val[],
    list: readonly TS.Expression[],
  ): Val {
    const [callback] = this.callbackArgs(frame, list)
    if (callback !== undefined)
      this.analyze({ caller: frame, site: node, argExprs: list }, callback, params)
    else if (this.unresolvedCallback(list)) this.unresolved(frame, node, receiver, args)
    return EMPTY_VAL
  }

  /** `Array.prototype.m.call(self, ...)`: the call `self.m(...)`. */
  private prototypeCall(frame: Frame, node: TS.CallExpression, method: string): Val {
    const [self, ...rest] = node.arguments
    const receiver = self === undefined ? EMPTY_VAL : this.expr(frame, self)
    const callee: MemberCallee = { expression: self ?? node.expression, name: { text: method } }
    return this.valueMethodCall(frame, node, callee, receiver, method, rest)
  }

  // ----- discards ------------------------------------------------------------------------------

  emitDiscards(): void {
    for (const record of this.entered.values()) {
      const fn = record.fn
      const shape = shapeAt(this.shapeByOrigin.get(record.origin), record.entryPath)
      if (!isShapeObject(shape)) continue
      for (const key of Object.keys(shape)) {
        const path = [...record.entryPath, key]
        const used = record.touched.some(
          (touched) => pathStartsWith(touched, path) || pathStartsWith(path, touched),
        )
        if (used) continue
        this.addEdge({
          kind: "discards",
          from: this.fnNode(fn),
          to: record.origin,
          status: "static",
          path,
          origin: record.origin,
        })
      }
    }
  }

  finish(): FlowModelInput {
    for (const fn of this.functions.values())
      if (fn.node !== undefined) this.ensureFunctionNodes(fn)
    this.emitDiscards()
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      unknowns: [...this.unknowns.values()],
      ...(this.edgeTags.length === 0 ? {} : { edgeTags: this.edgeTags }),
    }
  }
}

/** Runs the flow pass over `options.files` for every capability in `options.inventory`. */
export async function scanFlow(options: ScanFlowOptions): Promise<ScanFlowResult> {
  return scanFlowWithin(options, defaultScanLimits())
}

/** `scanFlow` within the given bounds. @internal Exported so a test can reach each bound with a small project. */
export async function scanFlowWithin(
  options: ScanFlowOptions,
  limits: ScanLimits,
): Promise<ScanFlowResult> {
  const { resolution: tsconfigPaths, warning: tsconfigWarning } = await loadTsconfigPaths(
    options.root,
    options.tsconfig,
    options.fs,
  )
  const context: ImportResolutionContext = {
    fs: options.fs,
    root: options.root,
    packages: options.packages ?? [],
    cache: new Map(),
    tsconfigPaths,
    aliasCache: createAliasResolutionCache(),
  }
  const targets = buildScanTargets(options.inventory, options.root)
  const targetsByName = new Map<string, ScanTarget[]>()
  for (const target of targets)
    targetsByName.set(target.exportName, [...(targetsByName.get(target.exportName) ?? []), target])

  const scan = new FlowScan(
    options.root,
    options.sinks ?? defaultFlowSinks(),
    options.summaries ?? [],
    limits,
  )
  scan.registerCapabilities(options.inventory)
  if (tsconfigWarning !== undefined) scan.warnings.push(tsconfigWarning)

  for (const file of [...options.files].sort()) {
    let text: string
    try {
      text = await options.fs.readFile(file, "utf8")
    } catch {
      continue
    }
    if (isGeneratedFile(text)) continue
    await scan.indexFile(file, text, context, targets, targetsByName)
  }

  scan.run()
  return { input: scan.finish(), warnings: scan.warnings }
}

/** The small rules of the scan, exported so a test can reach each one without writing a project around it. @internal */
export const scanHelpers = {
  arrayOf,
  collectionBase,
  decoratorsOf,
  externalKey,
  externalMember,
  externalVal,
  holdsFields,
  holdsPromise,
  isArithmeticOperator,
  isAsyncFunction,
  isCompoundAssignment,
  isGeneratorFunction,
  isLogicalOperator,
  isReferenceExpression,
  isTransparentWrapper,
  keyOf,
  linkKey,
  literalPairs,
  loadedSpecifier,
  memberCallee,
  memberChain,
  memberKey,
  memberName,
  prototypeMethod,
  rejectedKey,
  setAlgebra,
  settled,
  unwrap,
  withBound,
}
