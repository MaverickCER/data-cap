/**
 * The small rules of the flow pass (`flow-scan.ts`): what a name means, how a node is read, and the scope a value lives in.
 */

import type TS from "typescript"
import type {
  AnalyzeOptions,
  FlowSinkPattern,
  FunctionInfo,
  FunctionLike,
  LiteralReader,
  MemberCallee,
  ScanLimits,
} from "./flow-scan-types.js"
import type { Val } from "./flow-values.js"
import {
  ELEMENT_KEY,
  EMPTY_VAL,
  handlesOf,
  mergeVals,
  OPAQUE_ALLOC,
  PROMISE_HANDLE,
  setVal,
  signatureOf,
} from "./flow-values.js"
import { ts } from "./typescript.js"

export function defaultFlowSinks(): readonly FlowSinkPattern[] {
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

/** The bounds `scanFlow` works within. */
export function defaultScanLimits(): ScanLimits {
  return { maxCallDepth: 40, maxSteps: 3_000_000, maxExportHops: 9 }
}

// Name tables are functions, not module constants: a constant is evaluated at import and belongs to no test.
export function isOpaqueCallee(name: string): boolean {
  return ["createData", "buildData", "documentData"].includes(name)
}

export function isThenMethod(name: string): boolean {
  return ["then", "catch", "finally"].includes(name)
}

export function isElementCallbackMethod(name: string): boolean {
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

export function isReduceMethod(name: string): boolean {
  return ["reduce", "reduceRight"].includes(name)
}

export function isShapePreservingMethod(name: string): boolean {
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

export function isTransformingMethod(name: string): boolean {
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

export function isPredicateMethod(name: string): boolean {
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

export function isBuiltinRoot(name: string): boolean {
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

export function isBuiltinEmpty(name: string): boolean {
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

export function isBuiltinGlobal(name: string): boolean {
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

export function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => path[index] === segment)
}

export function isFunctionLikeNode(
  node: TS.Node,
): node is TS.ArrowFunction | TS.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

export function unwrap(expression: TS.Expression): TS.Expression {
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

export function keyOf(name: TS.PropertyName | TS.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
    return name.text
  return undefined
}

/** An object-shaped sample value -- not null, not an array, not a scalar. */
export function isShapeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The sample shape one path segment below `shape`, or `undefined` when there is none. */
function childShape(shape: unknown, segment: string): unknown {
  if (Array.isArray(shape)) return segment === ELEMENT_KEY ? shape[0] : undefined
  return isShapeObject(shape) && Object.hasOwn(shape, segment) ? shape[segment] : undefined
}

export function shapeAt(shape: unknown, path: readonly string[]): unknown {
  const [segment, ...rest] = path
  return segment === undefined ? shape : shapeAt(childShape(shape, segment), rest)
}

/** Every variable name a binding introduces (`a`, or `a` and `b` for `{ a, c: [b] }`). */
export function bindingNames(name: TS.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  const elements: readonly (TS.BindingElement | TS.OmittedExpression)[] = name.elements
  return elements.filter(ts.isBindingElement).flatMap((element) => bindingNames(element.name))
}

export function hasModifier(node: TS.Node, kind: TS.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  )
}

/** The name a class member or object method answers to; `[Symbol.iterator]` for that computed key, `undefined` for any other computed one. */
export function memberName(name: TS.PropertyName): string | undefined {
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
export function accessorKey(kind: "get" | "set", key: string): string {
  return `\u0000${kind}:${key}`
}

/** Whether `val`, or anything below it, is a capability or its `fields` object: something whose data is only read when asked for. */
export function holdsFields(val: Val): boolean {
  return (
    val.fieldsOf !== undefined ||
    val.capability !== undefined ||
    [...val.props.values()].some(holdsFields)
  )
}

/** Whether `val`, or anything below it, is a promise made by `new Promise`. */
export function holdsPromise(val: Val): boolean {
  return handlesOf(val, PROMISE_HANDLE).length > 0 || [...val.props.values()].some(holdsPromise)
}

/** The property a promise value keeps what it was rejected with under -- a name no property of any object can have. */
export function rejectedKey(): string {
  return "\u0000rejected"
}

/** The value with the rejection taken off: what an `await` returns when it does not throw. */
export function settled(val: Val): Val {
  const props = new Map(val.props)
  props.delete(rejectedKey())
  return { ...val, props }
}

export function memberKey(kind: "method" | "get" | "set", isStatic: boolean, name: string): string {
  return `${kind}:${isStatic ? "static" : "instance"}:${name}`
}

/** The key one link of a member chain reads or writes. `dynamic` when it is a computed key that is not a literal. */
export function linkKey(
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
export function memberChain(
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
export function isReferenceExpression(expression: TS.Expression | undefined): boolean {
  if (expression === undefined) return false
  const target = unwrap(expression)
  return (
    ts.isIdentifier(target) ||
    ts.isPropertyAccessExpression(target) ||
    ts.isElementAccessExpression(target) ||
    target.kind === ts.SyntaxKind.ThisKeyword
  )
}

/** The receiver and method name of a callee written `a.b` or `a["b"]`. */
export function memberCallee(
  callee: TS.Expression,
  literal: LiteralReader,
): MemberCallee | undefined {
  if (ts.isPropertyAccessExpression(callee)) return callee
  if (!ts.isElementAccessExpression(callee)) return undefined
  const text = literal(unwrap(callee.argumentExpression))
  return text === undefined ? undefined : { expression: callee.expression, name: { text } }
}

export function isLogicalOperator(kind: TS.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ].includes(kind)
}

/** The assignment operators whose result is one of the values around them (`+=` alters it; `||=`, `??=`, `&&=` pick one). */
export function isCompoundAssignment(kind: TS.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ].includes(kind)
}

/** The operators that compute a new value out of both operands. */
export function isArithmeticOperator(kind: TS.SyntaxKind): boolean {
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
export function isTransparentWrapper(
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
export function setAlgebra(name: string, items: Val, other: Val): Val | undefined {
  if (["isSubsetOf", "isSupersetOf", "isDisjointFrom"].includes(name)) return EMPTY_VAL
  if (["union", "symmetricDifference"].includes(name)) return setVal(mergeVals(items, other))
  return ["intersection", "difference"].includes(name) ? setVal(items) : undefined
}

/** An array value whose every element is `element`. */
export function arrayOf(element: Val): Val {
  return { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, element]]) }
}

/** The `[key, value]` literals of `[[k1, v1], [k2, v2]]`; `undefined` when the argument is anything else. */
export function literalPairs(
  expression: TS.Expression,
): readonly TS.ArrayLiteralExpression[] | undefined {
  const list = unwrap(expression)
  if (!ts.isArrayLiteralExpression(list) || list.elements.length === 0) return undefined
  const pairs = list.elements.map((element) => unwrap(element))
  const literals = pairs.filter(ts.isArrayLiteralExpression)
  const fits = (pair: TS.ArrayLiteralExpression): boolean =>
    pair.elements.length <= 2 && !pair.elements.some(ts.isSpreadElement)
  return literals.length === pairs.length && literals.every(fits) ? literals : undefined
}

/** What `m.set(a, b).set(c, d)` stores into: the expression at the start of the chain of `set` / `add` calls. */
export function collectionBase(expression: TS.Expression): TS.Expression {
  const current = unwrap(expression)
  if (!ts.isCallExpression(current)) return current
  const callee = unwrap(current.expression)
  if (!ts.isPropertyAccessExpression(callee) || !["set", "add"].includes(callee.name.text))
    return current
  return collectionBase(callee.expression)
}

/** Whether `expression` is `Array.prototype.m` / `Object.prototype.m` / `[].m` and the like: the method name, otherwise `undefined`. */
export function prototypeMethod(
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
export function loadedSpecifier(node: TS.Node): string | undefined {
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
export function decoratorsOf(node: TS.Node): TS.Decorator[] {
  return ts.canHaveDecorators(node) ? [...(ts.getDecorators(node) ?? [])] : []
}

/** A function made by `bind` runs with what was bound ahead of what the call gives, and with the receiver that was bound. */
export function withBound(
  fn: FunctionInfo,
  given: readonly Val[],
  own: AnalyzeOptions,
): { readonly args: readonly Val[]; readonly options: AnalyzeOptions } {
  if (fn.bound === undefined) return { args: given, options: own }
  const options = fn.bound.thisVal === undefined ? own : { ...own, thisVal: fn.bound.thisVal }
  return { args: [...fn.bound.args, ...given], options }
}

/** What a package exports: only a declared summary can say what a call to it does. */
export function externalVal(module: string, path: string): Val {
  return { ...EMPTY_VAL, external: `${module}\u0000${path}`, alloc: [OPAQUE_ALLOC] }
}

/** The package export a member of `external` is: `_.pick` on the default import of `lodash`, `z.object` on the named import `z`. */
export function externalMember(external: string, key: string): readonly [string, string] {
  // `split` always gives at least the module.
  const [module, path = ""] = external.split("\u0000") as [string, string?]
  return [module, path === "*" ? key : `${path}.${key}`]
}

/** The identity of an export of a package, as `summaryFor` looks it up. */
export function externalKey([module, path]: readonly [string, string]): string {
  return `${module}\u0000${path}`
}

export function isAsyncFunction(node: FunctionLike | undefined): boolean {
  return node !== undefined && hasModifier(node, ts.SyntaxKind.AsyncKeyword)
}

export function isGeneratorFunction(node: FunctionLike | undefined): boolean {
  return node !== undefined && "asteriskToken" in node && node.asteriskToken !== undefined
}
