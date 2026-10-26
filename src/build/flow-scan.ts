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
import { displayPath } from "./display-path.js"
import { buildScanTargets } from "./generate-usage.js"
import type {
  FlowBoundaryKind,
  FlowEdgeInput,
  FlowHandling,
  FlowModelInput,
  FlowNodeInput,
  FlowStatus,
  FlowUnknownInput,
  FlowUnknownReason,
} from "../flow/flow-model.js"
import { flowNodeId } from "../flow/flow-model.js"
import {
  accessDynamic,
  accessKey,
  approximate,
  atomVal,
  ELEMENT_KEY,
  EMPTY_VAL,
  flattenAtoms,
  mergeVals,
  objectVal,
  signatureOf,
  withEntry,
} from "./flow-values.js"
import type { Atom, Val } from "./flow-values.js"
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
}

/** What `scanFlow` found. */
export interface ScanFlowResult {
  /** The facts, ready for `buildFlowModel`. */
  readonly input: FlowModelInput
  /** Resolution warnings, never blocking. */
  readonly warnings: readonly ParseWarning[]
}

const MAX_CALL_DEPTH = 40
const MAX_STEPS = 3_000_000
const MAX_EXPORT_HOPS = 9

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
  ].includes(name)
}

function isBuiltinExact(name: string): boolean {
  return [
    "Object.assign",
    "Object.freeze",
    "Object.seal",
    "Promise.resolve",
    "Promise.all",
    "Promise.allSettled",
    "Promise.race",
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
  TS.ArrowFunction | TS.FunctionExpression | TS.FunctionDeclaration | TS.MethodDeclaration

class Env {
  private readonly vars = new Map<string, Val>()
  constructor(readonly parent?: Env) {}
  get(name: string): Val | undefined {
    return this.vars.get(name) ?? this.parent?.get(name)
  }
  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false)
  }
  set(name: string, val: Val): void {
    this.vars.set(name, val)
  }
  /** Replaces the nearest existing binding of `name`, or defines it here. */
  assign(name: string, val: Val): void {
    if (this.vars.has(name) || !this.parent?.has(name)) {
      const existing = this.vars.get(name)
      this.vars.set(name, existing === undefined ? val : mergeVals(existing, val))
      return
    }
    this.parent.assign(name, val)
  }
}

interface ExportRef {
  /** The file the export list is in -- where a name declared there is looked up. */
  readonly owner: FileInfo
  /** The file the name is re-exported from; `undefined` when it is declared in the exporting file. */
  readonly file: string | undefined
  readonly name: string
}

/** Where a search for an exported function stands: still following re-exports, or arrived. */
type ExportStep =
  { readonly file: string; readonly name: string } | { readonly fn: FunctionInfo | undefined }

interface FileInfo {
  readonly file: string
  readonly scope: string
  readonly sourceFile: TS.SourceFile
  readonly capabilityBindings: Map<string, string>
  readonly resolvedImports: Map<string, { readonly file: string; readonly name: string }>
  readonly namespaces: Map<string, string>
  readonly topFunctions: Map<string, FunctionInfo>
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
  closureEnv: Env | undefined
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
}

/** Where a call is made from: the frame making it and the node it is made at. */
interface CallSite {
  readonly caller: Frame
  readonly site: TS.Node
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
  | { readonly kind: "boundary"; readonly id: string; readonly handling?: FlowHandling | undefined }
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
    ts.isSatisfiesExpression(expression)
  )
    return unwrap(expression.expression)
  return expression
}

/** The key an element access reads or writes: its string literal, else any element. */
function elementKey(access: TS.ElementAccessExpression): string {
  const index = unwrap(access.argumentExpression)
  return ts.isStringLiteralLike(index) ? index.text : ELEMENT_KEY
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
  private readonly caps = new Map<string, CapInfo>()
  private readonly shapeByOrigin = new Map<string, unknown>()
  private readonly files = new Map<string, FileInfo>()
  private readonly memo = new Map<string, { returnVal: Val }>()
  private readonly entered = new Map<string, EntryRecord>()
  private readonly sinks: readonly FlowSinkPattern[]
  private readonly queue: FunctionInfo[] = []
  private readonly declaredBoundaries = new Map<string, string>()
  private steps = 0
  private exhausted = false

  constructor(
    private readonly root: string,
    sinks: readonly FlowSinkPattern[],
  ) {
    this.sinks = sinks
  }

  // ----- setup ---------------------------------------------------------------------------------

  registerCapabilities(inventory: CapabilityInventory, targets: readonly ScanTarget[]): void {
    for (const node of inventory.capabilities) {
      const file =
        targets.find((candidate) => displayPath(this.root, candidate.file) === node.file)?.file ??
        node.file
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

  private addEdge(edge: FlowEdgeInput): void {
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
      topFunctions: new Map(),
      exports: new Map(),
      moduleStatements: [],
      moduleEnv: new Env(),
      moduleStarted: false,
    }
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
      if (binding.importedName === "default") continue
      const resolved = await resolveImportSpecifier(file, binding.moduleSpecifier, context)
      // Stryker disable next-line ConditionalExpression: equivalent -- an unresolved import recorded with no file finds no exports later, the same as not recording it.
      if (resolved === undefined) continue
      if (binding.importedName === "*") info.namespaces.set(binding.localName, resolved)
      else
        info.resolvedImports.set(binding.localName, { file: resolved, name: binding.importedName })
    }
    for (const statement of sourceFile.statements)
      await this.indexStatement(info, statement, context, schemas)
    for (const [local, key] of info.capabilityBindings) {
      info.moduleEnv.set(local, { ...EMPTY_VAL, capability: key })
    }
    this.files.set(file, info)
  }

  private async indexStatement(
    info: FileInfo,
    statement: TS.Statement,
    context: ImportResolutionContext,
    schemas: ReadonlySet<string>,
  ): Promise<void> {
    const isExported =
      ts.canHaveModifiers(statement) &&
      (ts
        .getModifiers(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.body !== undefined
    ) {
      this.registerTop(info, statement.name.text, statement)
      if (isExported)
        info.exports.set(statement.name.text, {
          owner: info,
          file: undefined,
          name: statement.name.text,
        })
      return
    }
    if (ts.isVariableStatement(statement)) {
      const declared = statement.declarationList.declarations
      if (
        declared.every(
          (declaration) => ts.isIdentifier(declaration.name) && schemas.has(declaration.name.text),
        )
      )
        return
      let allFunctions = true
      for (const declaration of statement.declarationList.declarations) {
        const initializer =
          declaration.initializer === undefined ? undefined : unwrap(declaration.initializer)
        if (
          ts.isIdentifier(declaration.name) &&
          initializer !== undefined &&
          isFunctionLikeNode(initializer)
        ) {
          this.registerTop(info, declaration.name.text, initializer)
          if (isExported)
            info.exports.set(declaration.name.text, {
              owner: info,
              file: undefined,
              name: declaration.name.text,
            })
        } else {
          allFunctions = false
        }
      }
      if (!allFunctions) info.moduleStatements.push(statement)
      return
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const from =
        statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier)
          ? await resolveImportSpecifier(info.file, statement.moduleSpecifier.text, context)
          : undefined
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text
        info.exports.set(element.name.text, { owner: info, file: from, name: local })
      }
      return
    }
    // Imports, type declarations, classes and the like are kept as module statements too: `statement` ignores them.
    info.moduleStatements.push(statement)
  }

  private registerTop(info: FileInfo, name: string, node: FunctionLike): void {
    const position = positionOf(info.sourceFile, node)
    const finalName = info.topFunctions.has(name)
      ? `${name}@${position.line}:${position.column}`
      : name
    const fn = this.makeFunction(info, finalName, node)
    info.topFunctions.set(name, fn)
  }

  private makeFunction(info: FileInfo, name: string, node: FunctionLike | undefined): FunctionInfo {
    const fn: FunctionInfo = {
      key: `${info.file}#${name}`,
      file: info,
      name,
      node,
      // Stryker disable next-line ArrayDeclaration: equivalent -- only the module function has no node, and it is never called with arguments, so its parameter list is never read.
      params: node?.parameters ?? [],
      closureEnv: undefined,
    }
    this.functions.set(fn.key, fn)
    return fn
  }

  // ----- node helpers --------------------------------------------------------------------------

  /** The id of `fn`'s node, creating it first so no edge ever points at a missing one. */
  private fnNode(fn: FunctionInfo): string {
    return this.addNode(this.functionNode(fn, "static"))
  }

  private paramName(fn: FunctionInfo, index: number): string {
    const param = fn.params[index]
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
    const data = atoms.map((atom) => ({ origin: atom.origin, path: atom.path }))
    const existing = this.unknowns.get(key)
    if (existing !== undefined) {
      this.unknowns.set(key, { ...existing, data: [...existing.data, ...data] })
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
    return atom.approx ? "inferred" : "static"
  }

  private emitEntry(fn: FunctionInfo, atom: Atom, node: TS.Node): void {
    const to = this.fnNode(fn)
    const source = this.location(fn, node)
    const base = { to, status: this.statusOf(atom), path: atom.path, origin: atom.origin, source }
    const { entry } = atom
    switch (entry.kind) {
      case "read":
        this.addEdge({ kind: "reads", from: atom.origin, ...base })
        break
      case "param": {
        const owner = this.functions.get(entry.fn)
        // Stryker disable next-line ConditionalExpression: equivalent -- an atom's function key was registered when the atom was made, so the owner is always found.
        if (owner !== undefined)
          this.addEdge({ kind: "reads", from: this.paramNode(owner, entry.index), ...base })
        break
      }
      case "return": {
        const owner = this.functions.get(entry.from)
        // Stryker disable next-line ConditionalExpression: equivalent -- an atom's function key was registered when the atom was made, so the owner is always found.
        if (owner !== undefined)
          this.addEdge({ kind: "passes", from: this.returnNode(owner), ...base })
        break
      }
    }
  }

  private sink(frame: Frame, val: Val, spec: SinkSpec, node: TS.Node): void {
    const fn = frame.fn
    for (const atom of flattenAtoms(val)) {
      this.emitEntry(fn, atom, node)
      this.entered.get(this.entryKey(fn.key, atom.origin, atom.entryPath))?.touched.push(atom.path)
      const edgeBase = {
        from: this.fnNode(fn),
        status: this.statusOf(atom),
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
    if (this.steps > MAX_STEPS) this.exhausted = true
    return !this.exhausted
  }

  private frame(fn: FunctionInfo, env: Env, depth: number): Frame {
    return { fn, env, returns: [], depth }
  }

  private ensureModule(file: FileInfo): void {
    if (file.moduleStarted) return
    file.moduleStarted = true
    const frame = this.frame(this.makeFunction(file, "<module>", undefined), file.moduleEnv, 0)
    for (const statement of file.moduleStatements) this.statement(frame, statement)
    // The capability's own `const userData = createData(...)` rebinds its name to an empty value; restore it so functions in the same file trace through it.
    for (const [local, key] of file.capabilityBindings)
      file.moduleEnv.set(local, { ...EMPTY_VAL, capability: key })
  }

  run(): void {
    for (const file of this.files.values()) this.ensureModule(file)
    for (const file of this.files.values()) {
      for (const fn of file.topFunctions.values()) this.runRoot(fn)
    }
    for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift())
      this.runRoot(next)
  }

  private runRoot(fn: FunctionInfo): void {
    this.analyze(undefined, fn, [])
  }

  // ----- function calls ------------------------------------------------------------------------

  private analyze(call: CallSite | undefined, fn: FunctionInfo, args: readonly Val[]): Val {
    if (call !== undefined) {
      this.addEdge({
        kind: "calls",
        from: this.fnNode(call.caller.fn),
        to: this.fnNode(fn),
        status: "static",
        source: this.location(call.caller.fn, call.site),
      })
      args.forEach((arg, index) => {
        this.sink(call.caller, arg, { kind: "arg", callee: fn, index }, call.site)
      })
    }
    if (this.exhausted || (call !== undefined && call.caller.depth + 1 > MAX_CALL_DEPTH)) {
      this.nodes.set(this.fnNode(fn), this.functionNode(fn, "unknown"))
      if (call !== undefined)
        this.unknown(
          call.caller.fn,
          "unanalyzed-function",
          call.site,
          `call depth or analysis budget exceeded at ${fn.name}`,
          args.flatMap((arg) => flattenAtoms(arg)),
        )
      return approximate(mergeVals(...args))
    }
    const key = JSON.stringify([fn.key, ...args.map(signatureOf)])
    const cached = this.memo.get(key)
    const bound = args.map((arg, index) => withEntry(arg, { kind: "param", fn: fn.key, index }))
    if (cached !== undefined) return this.returnToCaller(call, fn, cached.returnVal)
    const record = { returnVal: EMPTY_VAL }
    this.memo.set(key, record)
    this.ensureModule(fn.file)

    const env = new Env(fn.closureEnv ?? fn.file.moduleEnv)
    const frame = this.frame(fn, env, (call?.caller.depth ?? 0) + 1)
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
    // Stryker disable next-line OptionalChaining: equivalent -- only the module function has no node, and it is never analyzed as a call.
    const body = fn.node?.body
    // Stryker disable next-line ConditionalExpression: equivalent -- a function declaration without a body is never registered, so the body is always present when a node is.
    if (body !== undefined) {
      if (ts.isBlock(body)) this.statements(frame, body.statements)
      else this.returnValue(frame, this.expr(frame, body), body)
    }
    record.returnVal = mergeVals(...frame.returns)
    return this.returnToCaller(call, fn, record.returnVal)
  }

  private returnToCaller(call: CallSite | undefined, fn: FunctionInfo, returned: Val): Val {
    const result = withEntry(returned, { kind: "return", from: fn.key })
    if (call !== undefined) this.noteEntry(call.caller.fn, result)
    return result
  }

  private returnValue(frame: Frame, val: Val, node: TS.Node): void {
    frame.returns.push(val)
    this.sink(frame, val, { kind: "return" }, node)
  }

  // ----- statements ----------------------------------------------------------------------------

  private statements(frame: Frame, list: readonly TS.Statement[]): void {
    for (const statement of list) this.statement(frame, statement)
  }

  private statement(frame: Frame, node: TS.Statement): void {
    if (!this.step()) return
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        this.bind(frame, declaration.name, this.expr(frame, declaration.initializer))
      }
    } else if (ts.isExpressionStatement(node)) {
      this.expr(frame, node.expression)
    } else if (ts.isReturnStatement(node)) {
      this.returnValue(frame, this.expr(frame, node.expression), node)
    } else if (ts.isIfStatement(node)) {
      this.expr(frame, node.expression)
      this.statement(frame, node.thenStatement)
      if (node.elseStatement !== undefined) this.statement(frame, node.elseStatement)
    } else if (ts.isBlock(node)) {
      this.statements(frame, node.statements)
    } else if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const iterable = this.expr(frame, node.expression)
      const element = ts.isForOfStatement(node)
        ? this.accessMember(frame, iterable, ELEMENT_KEY, node)
        : EMPTY_VAL
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations)
          this.bind(frame, declaration.name, element)
      } else {
        this.assign(frame, node.initializer, element)
      }
      this.statement(frame, node.statement)
    } else if (ts.isForStatement(node)) {
      if (node.initializer !== undefined) {
        if (ts.isVariableDeclarationList(node.initializer)) {
          for (const declaration of node.initializer.declarations)
            this.bind(frame, declaration.name, this.expr(frame, declaration.initializer))
        } else {
          this.expr(frame, node.initializer)
        }
      }
      this.expr(frame, node.condition)
      this.expr(frame, node.incrementor)
      this.statement(frame, node.statement)
    } else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      this.expr(frame, node.expression)
      this.statement(frame, node.statement)
    } else if (ts.isSwitchStatement(node)) {
      this.expr(frame, node.expression)
      for (const clause of node.caseBlock.clauses) {
        this.expr(frame, ts.isCaseClause(clause) ? clause.expression : undefined)
        this.statements(frame, clause.statements)
      }
    } else if (ts.isTryStatement(node)) {
      this.statements(frame, node.tryBlock.statements)
      if (node.catchClause !== undefined) {
        if (node.catchClause.variableDeclaration !== undefined)
          this.bind(frame, node.catchClause.variableDeclaration.name, EMPTY_VAL)
        this.statements(frame, node.catchClause.block.statements)
      }
      if (node.finallyBlock !== undefined) this.statements(frame, node.finallyBlock.statements)
    } else if (ts.isThrowStatement(node)) {
      this.expr(frame, node.expression)
    } else if (ts.isLabeledStatement(node)) {
      this.statement(frame, node.statement)
    } else if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      node.body !== undefined
    ) {
      const fn = this.nestedFunction(frame, node, node.name.text)
      frame.env.set(node.name.text, { ...EMPTY_VAL, callable: fn.key })
    }
  }

  // ----- binding -------------------------------------------------------------------------------

  private bind(frame: Frame, name: TS.BindingName, value: Val): void {
    if (ts.isIdentifier(name)) {
      frame.env.set(name.text, value)
    } else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.dotDotDotToken !== undefined) {
          this.bind(frame, element.name, approximate(value))
          continue
        }
        const key =
          element.propertyName === undefined ? keyOf(element.name) : keyOf(element.propertyName)
        const part =
          key === undefined ? accessDynamic(value) : this.accessMember(frame, value, key, element)
        this.bind(frame, element.name, mergeVals(part, this.expr(frame, element.initializer)))
      }
    } else {
      name.elements.forEach((element) => {
        if (ts.isOmittedExpression(element)) return
        const part =
          element.dotDotDotToken !== undefined
            ? value
            : this.accessMember(frame, value, ELEMENT_KEY, element)
        this.bind(frame, element.name, part)
      })
    }
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
    if (receiver.capability !== undefined) {
      return key === "fields" ? { ...EMPTY_VAL, fieldsOf: receiver.capability } : EMPTY_VAL
    }
    const result = accessKey(receiver, key)
    this.touch(frame.fn, result, site)
    return result
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
    this.queue.push(fn)
    return fn
  }

  private functionValue(frame: Frame, node: FunctionLike, hint?: string): Val {
    const fn = this.nestedFunction(frame, node, hint)
    return { ...EMPTY_VAL, callable: fn.key }
  }

  private resolveCallable(frame: Frame, expression: TS.Expression): FunctionInfo | undefined {
    const target = unwrap(expression)
    if (isFunctionLikeNode(target)) return this.nestedFunction(frame, target, undefined)
    if (ts.isIdentifier(target)) {
      const local = frame.env.get(target.text)
      if (local?.callable !== undefined) return this.functions.get(local.callable)
      if (frame.env.has(target.text)) return undefined
      return this.resolveByName(frame.fn.file, target.text)
    }
    if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
      const namespace = frame.fn.file.namespaces.get(target.expression.text)
      // Stryker disable next-line ConditionalExpression: equivalent -- `findExport` of a missing file finds no exports, so skipping it and calling it with `undefined` give the same result.
      if (namespace !== undefined) return this.findExport(namespace, target.name.text)
    }
    return undefined
  }

  private resolveByName(file: FileInfo, name: string): FunctionInfo | undefined {
    const local = file.topFunctions.get(name)
    if (local !== undefined) return local
    const imported = file.resolvedImports.get(name)
    return imported === undefined ? undefined : this.findExport(imported.file, imported.name)
  }

  /**
   * Follows `export { name } from` hops from `file` to the function that is finally declared (at most `MAX_EXPORT_HOPS`
   * of them, so a cycle of re-exports ends the search rather than the process).
   */
  private findExport(file: string, name: string): FunctionInfo | undefined {
    const end = Array.from({ length: MAX_EXPORT_HOPS }).reduce<ExportStep | undefined>(
      (step) => this.exportHop(step),
      { file, name },
    )
    return end !== undefined && "fn" in end ? end.fn : undefined
  }

  private exportHop(step: ExportStep | undefined): ExportStep | undefined {
    if (step === undefined || "fn" in step) return step
    const ref = this.files.get(step.file)?.exports.get(step.name)
    if (ref === undefined) return undefined
    if (ref.file === undefined) return { fn: ref.owner.topFunctions.get(ref.name) }
    return { file: ref.file, name: ref.name }
  }

  // ----- expressions ---------------------------------------------------------------------------

  private expr(frame: Frame, node: TS.Node | undefined): Val {
    if (node === undefined || !this.step()) return EMPTY_VAL
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isAwaitExpression(node)
    ) {
      return this.expr(frame, node.expression)
    }
    if (ts.isIdentifier(node)) return frame.env.get(node.text) ?? EMPTY_VAL
    if (ts.isPropertyAccessExpression(node))
      return this.accessMember(frame, this.expr(frame, node.expression), node.name.text, node)
    if (ts.isElementAccessExpression(node)) return this.elementAccess(frame, node)
    if (ts.isObjectLiteralExpression(node)) return this.objectLiteral(frame, node)
    if (ts.isArrayLiteralExpression(node)) return this.arrayLiteral(frame, node)
    if (ts.isCallExpression(node)) return this.call(frame, node)
    if (ts.isNewExpression(node))
      return this.unresolved(
        frame,
        node,
        undefined,
        node.arguments === undefined
          ? []
          : node.arguments.map((argument) => this.expr(frame, argument)),
      )
    if (ts.isConditionalExpression(node)) {
      this.expr(frame, node.condition)
      return mergeVals(this.expr(frame, node.whenTrue), this.expr(frame, node.whenFalse))
    }
    if (ts.isBinaryExpression(node)) return this.binary(frame, node)
    if (ts.isTemplateExpression(node))
      return approximate(
        mergeVals(...node.templateSpans.map((span) => this.expr(frame, span.expression))),
      )
    if (ts.isTaggedTemplateExpression(node))
      return approximate(
        this.expr(frame, ts.isTemplateExpression(node.template) ? node.template : undefined),
      )
    if (isFunctionLikeNode(node)) return this.functionValue(frame, node)
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      this.expr(frame, node.operand)
      return EMPTY_VAL
    }
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node) || ts.isDeleteExpression(node)) {
      this.expr(frame, node.expression)
      return EMPTY_VAL
    }
    if (ts.isSpreadElement(node)) return this.expr(frame, node.expression)
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return this.jsx(frame, node)
    if (ts.isJsxFragment(node)) {
      this.jsxChildren(frame, node.children)
      return EMPTY_VAL
    }
    return EMPTY_VAL
  }

  private elementAccess(frame: Frame, node: TS.ElementAccessExpression): Val {
    const receiver = this.expr(frame, node.expression)
    const argument = unwrap(node.argumentExpression)
    if (ts.isStringLiteralLike(argument))
      return this.accessMember(frame, receiver, argument.text, node)
    if (ts.isNumericLiteral(argument)) return this.accessMember(frame, receiver, ELEMENT_KEY, node)
    this.expr(frame, argument)
    if (flattenAtoms(receiver).length > 0) {
      this.unknown(
        frame.fn,
        "dynamic-access",
        node,
        "computed property key on tracked data",
        flattenAtoms(receiver),
      )
      const result = accessDynamic(receiver)
      this.touch(frame.fn, result, node)
      return result
    }
    return EMPTY_VAL
  }

  private objectLiteral(frame: Frame, node: TS.ObjectLiteralExpression): Val {
    const props: Record<string, Val> = {}
    const spreads: Val[] = []
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const key = keyOf(property.name)
        const value = this.expr(frame, property.initializer)
        if (key === undefined) spreads.push(approximate(value))
        else props[key] = props[key] === undefined ? value : mergeVals(props[key], value)
      } else if (ts.isShorthandPropertyAssignment(property)) {
        props[property.name.text] = frame.env.get(property.name.text) ?? EMPTY_VAL
      } else if (ts.isSpreadAssignment(property)) {
        spreads.push(this.expr(frame, property.expression))
      } else if (ts.isMethodDeclaration(property) && property.body !== undefined) {
        const key = keyOf(property.name)
        const value = this.functionValue(frame, property, key)
        if (key !== undefined) props[key] = value
      }
    }
    return objectVal(props, spreads)
  }

  private arrayLiteral(frame: Frame, node: TS.ArrayLiteralExpression): Val {
    const elements = node.elements.map((element) =>
      this.expr(frame, ts.isSpreadElement(element) ? element.expression : element),
    )
    const merged = mergeVals(...elements)
    return { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, merged]]) }
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
    if (
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return mergeVals(left, right)
    }
    if (
      operator === SyntaxKind.PlusEqualsToken ||
      operator === SyntaxKind.BarBarEqualsToken ||
      operator === SyntaxKind.QuestionQuestionEqualsToken ||
      operator === SyntaxKind.AmpersandAmpersandEqualsToken
    ) {
      const value =
        operator === SyntaxKind.PlusEqualsToken
          ? approximate(mergeVals(left, right))
          : mergeVals(left, right)
      this.assign(frame, node.left, value)
      return value
    }
    if (
      operator === SyntaxKind.PlusToken ||
      operator === SyntaxKind.MinusToken ||
      operator === SyntaxKind.AsteriskToken ||
      operator === SyntaxKind.SlashToken ||
      operator === SyntaxKind.PercentToken ||
      operator === SyntaxKind.AsteriskAsteriskToken
    ) {
      return approximate(mergeVals(left, right))
    }
    return EMPTY_VAL
  }

  private assign(frame: Frame, target: TS.Expression, value: Val): void {
    const left = unwrap(target)
    if (ts.isIdentifier(left)) {
      frame.env.assign(left.text, value)
    } else if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
      const key = ts.isPropertyAccessExpression(left) ? left.name.text : elementKey(left)
      const base = unwrap(left.expression)
      // Stryker disable next-line ConditionalExpression: equivalent -- a non-identifier base has no `text`, so assigning to it binds a name no read can reach.
      if (ts.isIdentifier(base)) {
        frame.env.assign(base.text, { ...EMPTY_VAL, props: new Map([[key, value]]) })
      }
    } else if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) {
      this.expr(frame, left)
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

  private callbackArgs(frame: Frame, node: TS.CallExpression): (FunctionInfo | undefined)[] {
    return node.arguments.map((argument) => this.resolveCallable(frame, argument))
  }

  private evalArgs(frame: Frame, node: TS.CallExpression): Val[] {
    return node.arguments.map((argument) => this.expr(frame, argument))
  }

  /** The identifier a callee chain starts from (`res` in `res.status(200).json`), looking through calls, members and wrappers. */
  private rootIdentifier(expression: TS.Expression): TS.Identifier | undefined {
    const root = unwrap(expression)
    if (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root))
      return this.rootIdentifier(root.expression)
    return ts.isIdentifier(root) ? root : undefined
  }

  private matchSink(callee: TS.Expression): FlowSinkPattern | undefined {
    const target = unwrap(callee)
    if (!ts.isPropertyAccessExpression(target)) return undefined
    const root = this.rootIdentifier(target.expression)
    if (root === undefined) return undefined
    const wanted = `${root.text}.${target.name.text}`
    return this.sinks.find((pattern) => pattern.callee === wanted)
  }

  private call(frame: Frame, node: TS.CallExpression): Val {
    const callee = unwrap(node.expression)
    if (ts.isIdentifier(callee) && isOpaqueCallee(callee.text)) return EMPTY_VAL

    const sink = this.matchSink(callee)
    if (sink !== undefined) {
      const args = this.evalArgs(frame, node)
      const sent = mergeVals(...args)
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

    if (ts.isPropertyAccessExpression(callee)) return this.methodCall(frame, node, callee)

    const target = this.resolveCallable(frame, callee)
    const args = this.evalArgs(frame, node)
    if (target !== undefined) return this.analyze({ caller: frame, site: node }, target, args)
    if (ts.isIdentifier(callee) && isBuiltinGlobal(callee.text))
      return approximate(mergeVals(...args))
    if (ts.isIdentifier(callee) && callee.text === "structuredClone") return mergeVals(...args)
    const computed = this.expr(frame, callee)
    const fn = this.functions.get(computed.callable)
    if (fn !== undefined) return this.analyze({ caller: frame, site: node }, fn, args)
    return this.unresolved(frame, node, undefined, args)
  }

  private methodCall(
    frame: Frame,
    node: TS.CallExpression,
    callee: TS.PropertyAccessExpression,
  ): Val {
    const name = callee.name.text
    const base = unwrap(callee.expression)
    const rootName = ts.isIdentifier(base) ? base.text : String(base.kind)

    const namespaceFile = frame.fn.file.namespaces.get(rootName)
    if (namespaceFile !== undefined) {
      const exported = this.findExport(namespaceFile, name)
      const args = this.evalArgs(frame, node)
      if (exported !== undefined) return this.analyze({ caller: frame, site: node }, exported, args)
      return this.unresolved(frame, node, undefined, args)
    }

    if (!frame.env.has(rootName) && isBuiltinRoot(rootName)) {
      const args = this.evalArgs(frame, node)
      const qualified = `${rootName}.${name}`
      if (isBuiltinEmpty(qualified)) return EMPTY_VAL
      const merged = mergeVals(...args)
      return isBuiltinExact(qualified) ? merged : approximate(merged)
    }

    const receiver = this.expr(frame, callee.expression)

    if (receiver.capability !== undefined)
      return this.capabilityCall(frame, node, receiver.capability, name)

    if (isThenMethod(name)) {
      const callbacks = this.callbackArgs(frame, node)
      this.evalArgs(frame, node)
      let result = name === "then" ? EMPTY_VAL : receiver
      callbacks.forEach((fn, index) => {
        if (fn === undefined) return
        const returned = this.analyze({ caller: frame, site: node }, fn, [
          name === "then" && index === 0 ? receiver : EMPTY_VAL,
        ])
        if (name === "then") result = mergeVals(result, returned)
      })
      return callbacks.every((fn) => fn === undefined) ? receiver : result
    }

    if (isElementCallbackMethod(name) || isReduceMethod(name)) {
      const callbacks = this.callbackArgs(frame, node)
      const args = this.evalArgs(frame, node)
      const [callback] = callbacks
      if (callback !== undefined) {
        const element = this.accessMember(frame, receiver, ELEMENT_KEY, node)
        let returned: Val
        if (isReduceMethod(name)) {
          const initial = args[1] ?? EMPTY_VAL
          returned = this.analyze({ caller: frame, site: node }, callback, [
            mergeVals(initial, receiver),
            element,
          ])
          return approximate(mergeVals(initial, returned))
        }
        returned = this.analyze({ caller: frame, site: node }, callback, [element])
        if (name === "map" || name === "flatMap")
          return { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, returned]]) }
        if (name === "forEach" || isPredicateMethod(name)) return EMPTY_VAL
        return receiver
      }
      if (isPredicateMethod(name) || name === "forEach") return EMPTY_VAL
    }

    const args = this.evalArgs(frame, node)

    if ((name === "push" || name === "unshift") && ts.isIdentifier(base)) {
      frame.env.assign(base.text, {
        ...EMPTY_VAL,
        props: new Map([[ELEMENT_KEY, mergeVals(...args)]]),
      })
      return EMPTY_VAL
    }
    if (isPredicateMethod(name)) return EMPTY_VAL
    if (isShapePreservingMethod(name)) return mergeVals(receiver, ...args)
    if (isTransformingMethod(name)) return approximate(mergeVals(receiver, ...args))
    return this.unresolved(frame, node, receiver, args)
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
    const all = mergeVals(...(receiver === undefined ? [] : [receiver]), ...args)
    const atoms = flattenAtoms(all)
    if (atoms.length === 0) return EMPTY_VAL
    this.unknown(frame.fn, "unresolved-call", node, "call target is not a project function", atoms)
    for (const atom of atoms)
      this.entered
        .get(this.entryKey(frame.fn.key, atom.origin, atom.entryPath))
        ?.touched.push(atom.path)
    return approximate(all)
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
    }
  }
}

/** Runs the flow pass over `options.files` for every capability in `options.inventory`. */
export async function scanFlow(options: ScanFlowOptions): Promise<ScanFlowResult> {
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

  const scan = new FlowScan(options.root, options.sinks ?? defaultFlowSinks())
  scan.registerCapabilities(options.inventory, targets)
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
