/**
 * Statically parses one TypeScript source file's AST to find `buildData()`,
 * `createData()`, and `documentData()` calls -- using the TypeScript
 * compiler API to build an AST, never `import()`ing, `require()`ing, or
 * `eval()`ing the file itself. A spread, factory call, or re-export
 * resolves as "unknown" and surfaces as a warning, never a guess.
 *
 * Matches calls by property/identifier name alone (`buildData(...)`/
 * `createData(...)`, or `dataCap.buildData(...)`), not by tracing import
 * provenance -- the same pragmatic, documented convention env-cap's own
 * `parse.ts` uses. `buildData` (the low-level, fields-only primitive) and
 * `createData` (the batteries-included runtime, which also accepts
 * `getters`/`mutators`/`subscriptions`) are treated identically for
 * `fields`-extraction purposes -- both produce a `RawCreateDataCall` --
 * `createData` calls additionally get their operation names extracted (see
 * `extractOperationNames`), never their `execute`/`processor`/`subscribe`/
 * `optimistic` function bodies (ADR 0002's never-eval rule).
 */

import ts from "typescript"
import type {
  CapabilityDocs,
  DataFlowDirection,
  DataFlowEndpoint,
  DataFlowEndpointKind,
  EvidenceFieldDocs,
  FieldDocs,
  OperationDocs,
} from "../core/document.js"
import type { DataSchema } from "../core/index.js"
import { evaluateLiteral, getStaticPropertyName } from "./literal-eval.js"
import { positionOf } from "./source-position.js"
import type { SourcePosition } from "./source-position.js"

/**
 * `CapabilityDocs` is parameterized by the real `documentData()` schema type
 * so authored calls get `keyof`-checked field/getter/mutator/subscription
 * names -- but this module (and `inventory.ts`/`link.ts`, which reuse this
 * exact type) deals only in already-parsed AST facts, with no compile-time
 * schema of its own to check against. `LooseCapabilityDocs` is the build-
 * tool-internal equivalent of "structurally shaped like docs, unconstrained"
 * the old bare `Record<string, unknown>` parameter gave: every OTHER
 * property comes from `CapabilityDocs` itself (via `Omit`), but
 * `fields`/`getters`/`mutators`/`subscriptions` are redeclared as plain
 * `Record<string, X>` maps rather than routed through `CapabilityDocs`'
 * own `keyof`-checked generics -- `DataSchema`'s `getters`/etc. are
 * themselves optional properties, which resolve to "no keys allowed" (not
 * "any key allowed") once `CapabilityDocs` requires a concrete schema type,
 * exactly backwards from what an unconstrained AST-parsed fact needs here.
 */
/**
 * Every property here is always assigned (never conditionally omitted --
 * see extractCapabilityDocs()/extractOperationDocsMap()/
 * extractEvidenceFieldsMap() below), just sometimes with an `undefined`
 * value when the AST literal didn't declare it. exactOptionalPropertyTypes
 * distinguishes "key absent" from "key present holding undefined";
 * widening every property to explicitly include `| undefined` (rather than
 * routing every assignment through a conditional-spread "omit if absent"
 * instead) matches what this type actually represents: a raw,
 * unconstrained parse result, not a validated CapabilityDocs.
 */
export type Loosen<T> = { readonly [K in keyof T]?: T[K] | undefined }

/**
 * Converts a `Loosen<T>` value back into a real `T`, omitting every key
 * whose value is `undefined` -- the exactOptionalPropertyTypes-correct way
 * to cross the boundary from "raw parse result" (this module's own
 * internal representation, every key always assigned) to a validated
 * public model type (`FieldDocs`/`OperationDocs`, key absence is
 * meaningful). Shallow only: a nested loose value inside `loose` is not
 * itself compacted, since none of this module's `Loosen<T>` usages nest.
 */
export function compactLoose<T extends Record<string, unknown>>(
  loose: Loosen<T> | undefined,
): T | undefined {
  if (loose === undefined) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(loose)) {
    if (value !== undefined) result[key] = value
  }
  return result as T
}

export type LooseCapabilityDocs = Loosen<
  Omit<
    CapabilityDocs<DataSchema<Record<string, unknown>>>,
    "fields" | "getters" | "mutators" | "subscriptions" | "evidence"
  >
> & {
  readonly fields?: Readonly<Partial<Record<string, Loosen<FieldDocs>>>> | undefined
  readonly getters?: Readonly<Partial<Record<string, Loosen<OperationDocs>>>> | undefined
  readonly mutators?: Readonly<Partial<Record<string, Loosen<OperationDocs>>>> | undefined
  readonly subscriptions?: Readonly<Partial<Record<string, Loosen<OperationDocs>>>> | undefined
  // Loosen<> only widens top-level properties -- CapabilityDocs.evidence's
  // own nested `fields` needs the same treatment explicitly, same reasoning
  // as the four sibling overrides above.
  readonly evidence?:
    | { readonly fields?: Readonly<Record<string, Loosen<EvidenceFieldDocs>>> | undefined }
    | undefined
}

/** A recoverable issue found while statically parsing or linking one capability file -- never fatal, always surfaced to the caller as data. */
export interface ParseWarning {
  /** Absolute path (or synthetic label, e.g. `"(package) name"`) the warning applies to. */
  readonly file: string
  /** Human-readable explanation of what was skipped and why. */
  readonly message: string
}

/**
 * How a `buildData`/`createData`/`documentData` call's `fields` reference
 * resolves, before any cross-file linking is attempted (that's `link.ts`'s
 * job -- this module only ever looks at one file's own AST).
 */
export type SchemaRef =
  /** `fields` is an inline object literal in this same call. */
  | {
      /** Always `"literal"` for this variant. */
      readonly kind: "literal"
      /** The object literal AST node itself. */
      readonly node: ts.ObjectLiteralExpression
    }
  /** `fields` is a bare identifier -- resolved against `ParseResult.localConsts`/cross-file imports by `link.ts`. */
  | {
      /** Always `"identifier"` for this variant. */
      readonly kind: "identifier"
      /** The identifier's text. */
      readonly name: string
    }
  /** `fields` could not be statically resolved to either of the above. */
  | {
      /** Always `"unresolvable"` for this variant. */
      readonly kind: "unresolvable"
      /** Human-readable explanation of why resolution failed. */
      readonly reason: string
    }

/** Static operation names discovered on a `createData(...)` call's config object literal -- names (AST object keys) only, never the operations' own function bodies. `undefined` for a `buildData(...)` call, which never has these sections. */
export interface OperationNames {
  /** Getter names. */
  readonly getters: readonly string[]
  /** Mutator names. */
  readonly mutators: readonly string[]
  /** Subscription names. */
  readonly subscriptions: readonly string[]
}

/** One `buildData(...)`/`createData(...)` call found in a file's top-level statements. */
export interface RawCreateDataCall {
  /** The exported binding name (`export const X = buildData(...)`), or `undefined` if unexported -- see the accompanying warning in that case. */
  readonly exportName: string | undefined
  /** `"buildData"` or `"createData"` -- which call form this is. */
  readonly kind: "buildData" | "createData"
  /** How this call's `fields` argument resolves within this one file. */
  readonly fieldsRef: SchemaRef
  /** Static getter/mutator/subscription names, or `undefined` for a `buildData()` call. */
  readonly operationNames: OperationNames | undefined
  /** Static `writes` field-ownership shapes, keyed the same way as `operationNames`. `undefined` for a `buildData()` call, which has no operations section. */
  readonly operationWrites: OperationWritesByKind | undefined
  /** Static `processor`/`optimistic` key-presence facts, keyed the same way as `operationNames`. `undefined` for a `buildData()` call, which has no operations section. */
  readonly operationPresence: OperationPresenceByKind | undefined
  /** The full call expression AST node, for later structural inspection. */
  readonly node: ts.CallExpression
  /** Position of this call's own declaration site -- always available, since `node` always resolves to a real AST location regardless of how `fields` itself resolves. */
  readonly declarationPosition: SourcePosition
  /** Position of each top-level field's own key, keyed by field name -- only when `fieldsRef.kind === "literal"` (an identifier-resolved `fields` crosses a file boundary this pass doesn't retain AST access to; `undefined` there, never guessed at). */
  readonly fieldPositions: Readonly<Record<string, SourcePosition>> | undefined
}

/** One `documentData(...)` call found in a file's top-level statements. */
export interface RawDocumentDataCall {
  /** How this call's first (`fields` reference) argument resolves within this one file. */
  readonly fieldsRef: SchemaRef
  /** The second (`docs`) argument, for later structural inspection -- not evaluated here. */
  readonly docsNode: ts.Expression | undefined
  /** The full call expression AST node, for later structural inspection. */
  readonly node: ts.CallExpression
}

/** One `import { X as Y } from "..."` (or namespace/default) binding found in a file's top-level statements. */
export interface ImportBinding {
  /** The name this binding is referenced by within the file (`Y` above). */
  readonly localName: string
  /** The imported name, or the sentinel `"*"` (namespace import) / `"default"` (default import). */
  readonly importedName: string
  /** The specifier exactly as written (`"..."` above) -- unresolved, relative or bare. */
  readonly moduleSpecifier: string
}

/** Everything statically extracted from one source file's AST, before any cross-file linking. */
export interface ParseResult {
  /** Absolute path of the parsed file. */
  readonly file: string
  /** Every `buildData(...)`/`createData(...)` call found in this file. */
  readonly createDataCalls: readonly RawCreateDataCall[]
  /** Every `documentData(...)` call found in this file. */
  readonly documentDataCalls: readonly RawDocumentDataCall[]
  /** Top-level `const X = <expr>` bindings, keyed by name -- for resolving an `identifier`-kind `SchemaRef` within the same file. */
  readonly localConsts: ReadonlyMap<string, ts.Expression>
  /** Every top-level import binding found in this file. */
  readonly imports: readonly ImportBinding[]
  /** Extraction problems encountered while parsing this file -- never thrown, always collected. */
  readonly warnings: readonly ParseWarning[]
}

/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function isCallToName(call: ts.CallExpression, name: string): boolean {
  const expr = call.expression
  if (ts.isIdentifier(expr)) return expr.text === name
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === name
  return false
}

/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function hasExportModifier(statement: ts.VariableStatement): boolean {
  return statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

/**
 * Resolves a `buildData`/`createData`/`documentData` call's own first
 * argument to an inline object literal -- either because it already is one
 * (`createData({fields: ..., getters: ...})`), or because it's a local
 * identifier this same file declares as one (`const schema = {fields:
 * ..., getters: ...}; createData(schema)`, the pattern `documentData`'s own
 * `keyof`-checked getter/mutator/subscription docs are designed around --
 * see `core/document.ts`'s own header comment: passing the SAME schema
 * object to both `createData` and `documentData` is what makes that
 * checking real). One level of indirection only, matching every other
 * identifier-resolution this module does -- a factory call, a spread, or a
 * chain of re-assignments is not this module's concern, and is never
 * guessed at; it resolves to `undefined` instead.
 */
function resolveConfigObjectLiteral(
  call: ts.CallExpression,
  localConsts: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const configArg = call.arguments[0]
  if (configArg === undefined) return undefined
  if (ts.isObjectLiteralExpression(configArg)) return configArg
  if (ts.isIdentifier(configArg)) {
    const resolved = localConsts.get(configArg.text)
    if (resolved !== undefined && ts.isObjectLiteralExpression(resolved)) return resolved
  }
  return undefined
}

/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function extractFieldsRef(
  call: ts.CallExpression,
  localConsts: ReadonlyMap<string, ts.Expression>,
): SchemaRef {
  if (call.arguments[0] === undefined) {
    return { kind: "unresolvable", reason: "call has no arguments" }
  }
  const configArg = resolveConfigObjectLiteral(call, localConsts)
  if (configArg === undefined) {
    return {
      kind: "unresolvable",
      reason:
        "first argument is not an inline object literal, or a local identifier resolving to one",
    }
  }
  const fieldsProp = configArg.properties.find(
    (prop) => ts.isPropertyAssignment(prop) && getStaticPropertyName(prop.name) === "fields",
  )
  if (fieldsProp === undefined || !ts.isPropertyAssignment(fieldsProp)) {
    return { kind: "unresolvable", reason: 'config object has no "fields" property' }
  }
  const value = fieldsProp.initializer
  if (ts.isObjectLiteralExpression(value)) return { kind: "literal", node: value }
  if (ts.isIdentifier(value)) return { kind: "identifier", name: value.text }
  return {
    kind: "unresolvable",
    reason: '"fields" is neither an inline object literal nor a local identifier',
  }
}

/**
 * Position of each top-level field's own key, only when `fieldsRef` is an
 * inline object literal in this same file -- an identifier-resolved
 * `fields` (or one this pass otherwise couldn't pin to a literal) has no
 * AST access retained for its individual keys, so this returns `undefined`
 * rather than guessing. Scoped honestly to top-level properties only,
 * matching `buildFieldNodes`' own one-level-deep granularity (`inventory.ts`).
 */
function extractFieldPositions(
  fieldsRef: SchemaRef,
  sourceFile: ts.SourceFile,
): Readonly<Record<string, SourcePosition>> | undefined {
  if (fieldsRef.kind !== "literal") return undefined
  const positions: Record<string, SourcePosition> = {}
  for (const prop of fieldsRef.node.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue
    const key = getStaticPropertyName(prop.name)
    if (key === undefined) continue
    positions[key] = positionOf(sourceFile, prop.name)
  }
  return positions
}

/** Property key names of an object-literal-valued section (`getters`/`mutators`/`subscriptions`) -- never the values themselves. `undefined` when the section is absent or not an inline object literal (a spread, a factory call, an identifier reference -- none of these are guessed at). */
/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function extractSectionNames(
  configArg: ts.ObjectLiteralExpression,
  sectionName: string,
): readonly string[] | undefined {
  const sectionProp = configArg.properties.find(
    (prop) => ts.isPropertyAssignment(prop) && getStaticPropertyName(prop.name) === sectionName,
  )
  if (sectionProp === undefined || !ts.isPropertyAssignment(sectionProp)) return undefined
  const value = sectionProp.initializer
  if (!ts.isObjectLiteralExpression(value)) return undefined
  const names: string[] = []
  for (const prop of value.properties) {
    const name = ts.isPropertyAssignment(prop) ? getStaticPropertyName(prop.name) : undefined
    if (name !== undefined) names.push(name)
  }
  return names
}

/** Static operation names on a `createData(...)` call's config object -- names (AST object keys) only, never `execute`/`processor`/`subscribe`/`optimistic` function bodies (ADR 0002). `undefined` when the call has no inline object-literal first argument at all. */
/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function extractOperationNames(
  call: ts.CallExpression,
  localConsts: ReadonlyMap<string, ts.Expression>,
): OperationNames | undefined {
  const configArg = resolveConfigObjectLiteral(call, localConsts)
  if (configArg === undefined) return undefined
  return {
    getters: extractSectionNames(configArg, "getters") ?? [],
    mutators: extractSectionNames(configArg, "mutators") ?? [],
    subscriptions: extractSectionNames(configArg, "subscriptions") ?? [],
  }
}

/** One operation's statically-extracted `writes` field-ownership shape -- `true` (owns the whole capability), a nested plain object mirroring `FieldOwnership<T>` (untyped, since this is extracted data), or `undefined` when it couldn't be determined (never guessed at). */
export interface RawOperationWrites {
  /** The operation's key name. */
  readonly name: string
  /** The extracted `writes` value, unvalidated against the actual `fields` shape. */
  readonly writes: unknown
}

/** `RawOperationWrites` entries grouped by operation kind, mirroring `OperationNames`' shape. */
export interface OperationWritesByKind {
  /** Getters' extracted `writes` shapes. */
  readonly getters: readonly RawOperationWrites[]
  /** Mutators' extracted `writes` shapes. */
  readonly mutators: readonly RawOperationWrites[]
  /** Subscriptions' extracted `writes` shapes. */
  readonly subscriptions: readonly RawOperationWrites[]
}

type WritesExtraction =
  | { readonly kind: "absent" }
  | { readonly kind: "resolved"; readonly value: unknown }
  | { readonly kind: "unresolvable" }

/** Extracts one operation entry's `writes` property, distinguishing "never declared" from "declared but not statically resolvable" -- callers must not conflate the two (ADR 0011's implicit-full-ownership default applies only to a genuinely absent `writes`, never to one that's merely unresolvable). */
function extractOperationWrites(
  operationEntry: ts.ObjectLiteralExpression,
  operationLabel: string,
  file: string,
  warnings: ParseWarning[],
): WritesExtraction {
  const prop = findProp(operationEntry, "writes")
  if (prop === undefined) return { kind: "absent" }
  const evaluated = evaluateLiteral(prop.initializer)
  if (!evaluated.ok) {
    warnings.push({
      file,
      message: `"writes" for "${operationLabel}" is not a statically-resolvable literal; treating it as unresolved, never guessed at.`,
    })
    // `extractSectionWrites` (below) only ever branches on `"resolved"` and
    // `"absent"` today, folding every other kind -- including this one --
    // into the same `undefined` default; the "unresolvable" discriminant
    // exists purely for API clarity/future-proofing (see this function's own
    // doc comment: "callers must not conflate the two"), with no current
    // caller that reads it. Genuinely unobservable as things stand -- there
    // is no consumer to add an assertion against without inventing one
    // purely to defeat this mutant.
    // Stryker disable next-line ObjectLiteral, StringLiteral
    return { kind: "unresolvable" }
  }
  return { kind: "resolved", value: evaluated.value }
}

function extractSectionWrites(
  configArg: ts.ObjectLiteralExpression,
  sectionName: "getters" | "mutators" | "subscriptions",
  file: string,
  warnings: ParseWarning[],
): readonly RawOperationWrites[] {
  const entries: RawOperationWrites[] = []
  for (const { name, prop } of namedSectionProps(configArg, sectionName)) {
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      // The operation's own definition isn't an inline object literal (a
      // factory call, an identifier reference) -- its writes shape is
      // simply unresolvable, same as any other non-literal value.
      warnings.push({
        file,
        message: `"${sectionName}.${name}" is not an inline object literal; its "writes" shape is unresolvable.`,
      })
      entries.push({ name, writes: undefined })
      continue
    }
    const extraction = extractOperationWrites(
      prop.initializer,
      `${sectionName}.${name}`,
      file,
      warnings,
    )
    const writes =
      extraction.kind === "resolved"
        ? extraction.value
        : extraction.kind === "absent" && sectionName === "mutators"
          ? true // ADR 0011: an absent `writes` on a mutator defaults to full-capability-tree ownership
          : undefined // unresolvable, or absent on a getter/subscription (writes is required there) -- never guessed
    entries.push({ name, writes })
  }
  return entries
}

/** Static `writes` field-ownership shapes for every getter/mutator/subscription on a `createData(...)` call's config object. `undefined` when the call has no inline object-literal first argument at all (same condition `extractOperationNames` returns `undefined` for). */
function extractOperationWritesByKind(
  call: ts.CallExpression,
  file: string,
  warnings: ParseWarning[],
  localConsts: ReadonlyMap<string, ts.Expression>,
): OperationWritesByKind | undefined {
  const configArg = resolveConfigObjectLiteral(call, localConsts)
  if (configArg === undefined) return undefined
  return {
    getters: extractSectionWrites(configArg, "getters", file, warnings),
    mutators: extractSectionWrites(configArg, "mutators", file, warnings),
    subscriptions: extractSectionWrites(configArg, "subscriptions", file, warnings),
  }
}

/**
 * One operation's statically-detected presence of a `processor`/`optimistic`
 * key on its config object literal -- a structural AST-key-presence check,
 * the same technique `extractOperationWrites` already uses for `writes`,
 * never an evaluation of what the function actually does (ADR 0002 stays
 * fully honored: this can tell a `processor` key exists without knowing
 * anything about what it computes). See ADR 0050.
 */
export interface RawOperationPresence {
  /** The operation's key name. */
  readonly name: string
  /** Whether this operation's config object literal has a `processor` key at all. */
  readonly hasProcessor: boolean
  /** Whether this operation's config object literal has an `optimistic` key at all -- structurally always `false` for a getter/subscription, since `GetterDefinition`/`SubscriptionDefinition` never declare one. */
  readonly hasOptimistic: boolean
}

/** `RawOperationPresence` entries grouped by operation kind, mirroring `OperationNames`'/`OperationWritesByKind`'s shape. */
export interface OperationPresenceByKind {
  /** Getters' extracted presence facts. */
  readonly getters: readonly RawOperationPresence[]
  /** Mutators' extracted presence facts. */
  readonly mutators: readonly RawOperationPresence[]
  /** Subscriptions' extracted presence facts. */
  readonly subscriptions: readonly RawOperationPresence[]
}

function extractSectionPresence(
  configArg: ts.ObjectLiteralExpression,
  sectionName: "getters" | "mutators" | "subscriptions",
): readonly RawOperationPresence[] {
  const entries: RawOperationPresence[] = []
  for (const { name, prop } of namedSectionProps(configArg, sectionName)) {
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      // Not an inline object literal (a factory call, an identifier
      // reference) -- there's no `processor`/`optimistic` key to find in it
      // either way. extractSectionWrites already warns about this same
      // entry for `writes`; no need to warn a second time here.
      entries.push({ name, hasProcessor: false, hasOptimistic: false })
      continue
    }
    entries.push({
      name,
      hasProcessor: findProp(prop.initializer, "processor") !== undefined,
      hasOptimistic: findProp(prop.initializer, "optimistic") !== undefined,
    })
  }
  return entries
}

/** Static `processor`/`optimistic` key-presence facts for every getter/mutator/subscription on a `createData(...)` call's config object. `undefined` when the call has no inline object-literal first argument at all (same condition `extractOperationNames`/`extractOperationWritesByKind` return `undefined` for). */
function extractOperationPresenceByKind(
  call: ts.CallExpression,
  localConsts: ReadonlyMap<string, ts.Expression>,
): OperationPresenceByKind | undefined {
  const configArg = resolveConfigObjectLiteral(call, localConsts)
  if (configArg === undefined) return undefined
  return {
    getters: extractSectionPresence(configArg, "getters"),
    mutators: extractSectionPresence(configArg, "mutators"),
    subscriptions: extractSectionPresence(configArg, "subscriptions"),
  }
}

/* -------------------------------------------------------------------------- */
/* documentData() docs extraction                                            */
/* -------------------------------------------------------------------------- */
/*
 * Statically extracts CapabilityDocs metadata from a documentData() call's
 * second argument -- mirrors env-cap's extractContractDocs/
 * extractVariableDocsMap convention. Every value here is author-declared,
 * never statically verified (AGENTS.md's declared-vs-proven invariant): a
 * non-literal value becomes a ParseWarning, never a thrown error or a
 * guessed value.
 */

/**
 * @internal One of `documentData`'s recognized data-flow direction values.
 * Accepts `unknown` (not just `string`) and doubles as the type guard that
 * narrows a raw, unvalidated property value -- so a caller never needs its
 * own separate `typeof value === "string"` check first: a non-string is
 * simply never equal to either literal, safely and without throwing.
 */
export function isDataFlowDirection(value: unknown): value is DataFlowDirection {
  return value === "input" || value === "output"
}

/** @internal One of `documentData`'s recognized data-flow endpoint kinds -- see {@link isDataFlowDirection} on why `unknown` needs no separate `typeof` guard. */
export function isDataFlowEndpointKind(value: unknown): value is DataFlowEndpointKind {
  return (
    value === "database" ||
    value === "cache" ||
    value === "storage" ||
    value === "queue" ||
    value === "api" ||
    value === "external-service" ||
    value === "user-input" ||
    value === "computed" ||
    value === "internal"
  )
}

/** @internal One of `documentData`'s recognized field-handling values -- see {@link isDataFlowDirection} on why `unknown` needs no separate `typeof` guard. */
export function isDataFlowHandlingValue(
  value: unknown,
): value is NonNullable<DataFlowEndpoint["handling"]> {
  return (
    value === "plaintext" ||
    value === "masked" ||
    value === "redacted" ||
    value === "hashed" ||
    value === "encrypted"
  )
}

function findProp(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  // A real type predicate on the `.find()` callback itself (rather than a
  // plain boolean-returning arrow) lets `.find()`'s own overload narrow the
  // result to `PropertyAssignment | undefined` directly -- no redundant
  // re-check of the same fact `.find()` already established is needed.
  return obj.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) && getStaticPropertyName(p.name) === name,
  )
}

/**
 * Yields `{ name, prop }` for every statically-named property assignment of
 * `configArg`'s `sectionName` object-literal section (`getters`/`mutators`/
 * `subscriptions`). Yields nothing if the section is absent or not an inline
 * object literal -- the caller's own list stays empty, matching the previous
 * per-caller early return.
 */
function* namedSectionProps(
  configArg: ts.ObjectLiteralExpression,
  sectionName: string,
): Generator<{ readonly name: string; readonly prop: ts.PropertyAssignment }> {
  const sectionProp = findProp(configArg, sectionName)
  if (sectionProp === undefined || !ts.isObjectLiteralExpression(sectionProp.initializer)) return
  for (const prop of sectionProp.initializer.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const name = getStaticPropertyName(prop.name)
    if (name === undefined) continue
    yield { name, prop }
  }
}

/**
 * Walks a `documentData()` docs sub-section object literal, invoking `extract`
 * for each entry whose value is an inline object literal and pushing a
 * "not an inline object literal; skipped" warning for the rest.
 * `undefined` when `sectionNode` itself isn't an object literal.
 */
function extractDocsSection<T>(
  sectionNode: ts.Expression,
  what: string,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
  extract: (initializer: ts.ObjectLiteralExpression, key: string) => T,
): Record<string, T> | undefined {
  if (!ts.isObjectLiteralExpression(sectionNode)) return undefined
  const out: Record<string, T> = {}
  for (const prop of sectionNode.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = getStaticPropertyName(prop.name)
    if (key === undefined) continue
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      warnings.push({
        file,
        message: `documentData() ${what} docs for "${key}" in "${contextLabel}" is not an inline object literal; skipped.`,
      })
      continue
    }
    out[key] = extract(prop.initializer, key)
  }
  return out
}

/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function readStringProp(
  obj: ts.ObjectLiteralExpression,
  name: string,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): string | undefined {
  const prop = findProp(obj, name)
  if (prop === undefined) return undefined
  const evaluated = evaluateLiteral(prop.initializer)
  if (evaluated.ok && typeof evaluated.value === "string") return evaluated.value
  warnings.push({
    file,
    message: `"${name}" for "${contextLabel}" is not a statically-resolvable string literal; ignoring it.`,
  })
  return undefined
}

/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function readBooleanProp(
  obj: ts.ObjectLiteralExpression,
  name: string,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): boolean | undefined {
  const prop = findProp(obj, name)
  if (prop === undefined) return undefined
  const evaluated = evaluateLiteral(prop.initializer)
  if (evaluated.ok && typeof evaluated.value === "boolean") return evaluated.value
  warnings.push({
    file,
    message: `"${name}" for "${contextLabel}" is not a statically-resolvable boolean literal; ignoring it.`,
  })
  return undefined
}

/** Widened to `unknown` values (unlike `readStringProp`'s siblings): `metadata` is data-cap's one deliberately-opaque extension bag, never validated beyond "is this an object literal at all." */
/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function readMetadataProp(
  obj: ts.ObjectLiteralExpression,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): Record<string, unknown> | undefined {
  const prop = findProp(obj, "metadata")
  if (prop === undefined) return undefined
  const evaluated = evaluateLiteral(prop.initializer)
  if (
    evaluated.ok &&
    typeof evaluated.value === "object" &&
    evaluated.value !== null &&
    !Array.isArray(evaluated.value)
  ) {
    return evaluated.value as Record<string, unknown>
  }
  warnings.push({
    file,
    message: `"metadata" for "${contextLabel}" is not a statically-resolvable object literal; ignoring it.`,
  })
  return undefined
}

/** `dataResidency` accepts either a single jurisdiction string or a list of them. */
/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function readDataResidencyProp(
  obj: ts.ObjectLiteralExpression,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): string | readonly string[] | undefined {
  const prop = findProp(obj, "dataResidency")
  if (prop === undefined) return undefined
  const evaluated = evaluateLiteral(prop.initializer)
  if (evaluated.ok && typeof evaluated.value === "string") return evaluated.value
  if (
    evaluated.ok &&
    Array.isArray(evaluated.value) &&
    evaluated.value.every((v) => typeof v === "string")
  ) {
    return evaluated.value
  }
  warnings.push({
    file,
    message: `"dataResidency" for "${contextLabel}" is not a statically-resolvable string or string-array literal; ignoring it.`,
  })
  return undefined
}

/** Extracts a single `DataFlowEndpoint` array entry -- an entry that isn't a fully literal, well-formed endpoint is dropped with a warning, never guessed at (the rest of the array is still used). */
/** @internal Exported for direct unit coverage -- in production it is only
 *  reached through `readEndpointsProp` → `extractOperationDocsMap`. */
export function readDataFlowEndpoint(
  node: ts.Expression,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): DataFlowEndpoint | undefined {
  const evaluated = evaluateLiteral(node)
  if (
    !evaluated.ok ||
    typeof evaluated.value !== "object" ||
    evaluated.value === null ||
    Array.isArray(evaluated.value)
  ) {
    warnings.push({
      file,
      message: `An "endpoints" entry for "${contextLabel}" is not a statically-resolvable object literal; dropping it.`,
    })
    return undefined
  }
  const record = evaluated.value as Record<string, unknown>
  const { direction, kind, name, url, handling } = record
  if (
    !isDataFlowDirection(direction) ||
    !isDataFlowEndpointKind(kind) ||
    typeof name !== "string"
  ) {
    warnings.push({
      file,
      message: `An "endpoints" entry for "${contextLabel}" has a missing or unrecognized "direction"/"kind"/"name"; dropping it.`,
    })
    return undefined
  }
  if (url !== undefined && typeof url !== "string") {
    warnings.push({
      file,
      message: `An "endpoints" entry for "${contextLabel}" has a non-string "url"; dropping the entry's "url", not the whole entry.`,
    })
  }
  if (handling !== undefined && !isDataFlowHandlingValue(handling)) {
    warnings.push({
      file,
      message: `An "endpoints" entry for "${contextLabel}" has an unrecognized "handling" value; dropping the entry's "handling", not the whole entry.`,
    })
  }
  return {
    direction,
    kind,
    name,
    // exactOptionalPropertyTypes: omit each key rather than set it to
    // `undefined` when the parsed source didn't declare a valid value.
    ...(typeof url === "string" ? { url } : {}),
    ...(isDataFlowHandlingValue(handling) ? { handling } : {}),
  }
}

/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function readEndpointsProp(
  obj: ts.ObjectLiteralExpression,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): readonly DataFlowEndpoint[] | undefined {
  const prop = findProp(obj, "endpoints")
  if (prop === undefined) return undefined
  if (!ts.isArrayLiteralExpression(prop.initializer)) {
    warnings.push({
      file,
      message: `"endpoints" for "${contextLabel}" is not an inline array literal; ignoring it.`,
    })
    return undefined
  }
  const endpoints: DataFlowEndpoint[] = []
  for (const element of prop.initializer.elements) {
    if (ts.isSpreadElement(element)) {
      warnings.push({
        file,
        message: `An "endpoints" entry for "${contextLabel}" is a spread element, not statically resolvable; dropping it.`,
      })
      continue
    }
    const endpoint = readDataFlowEndpoint(element, contextLabel, file, warnings)
    if (endpoint !== undefined) endpoints.push(endpoint)
  }
  return endpoints
}

function extractFieldDocsMap(
  sectionNode: ts.Expression,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): Partial<Record<string, Loosen<FieldDocs>>> | undefined {
  return extractDocsSection(sectionNode, "field", contextLabel, file, warnings, (init, key) => {
    const fieldLabel = `${contextLabel}.fields.${key}`
    return {
      description: readStringProp(init, "description", fieldLabel, file, warnings),
      owner: readStringProp(init, "owner", fieldLabel, file, warnings),
      sensitivity: readStringProp(init, "sensitivity", fieldLabel, file, warnings),
      protections: readStringProp(init, "protections", fieldLabel, file, warnings),
      retention: readStringProp(init, "retention", fieldLabel, file, warnings),
      purpose: readStringProp(init, "purpose", fieldLabel, file, warnings),
      legalBasis: readStringProp(init, "legalBasis", fieldLabel, file, warnings),
      dataResidency: readDataResidencyProp(init, fieldLabel, file, warnings),
      auditRequired: readBooleanProp(init, "auditRequired", fieldLabel, file, warnings),
      // Lifecycle vocabulary (EVD-05) -- extracted exactly like every other
      // declared fact above: a literal string/boolean or nothing. `expiresAt`/
      // `removeBy` are never parsed as dates here; `lifecycle-model.ts` is the
      // one place a date is interpreted, and an unparseable one is skipped
      // there rather than guessed at.
      expiresAt: readStringProp(init, "expiresAt", fieldLabel, file, warnings),
      deprecated: readBooleanProp(init, "deprecated", fieldLabel, file, warnings),
      deprecatedReason: readStringProp(init, "deprecatedReason", fieldLabel, file, warnings),
      removeBy: readStringProp(init, "removeBy", fieldLabel, file, warnings),
      renamedFrom: readStringProp(init, "renamedFrom", fieldLabel, file, warnings),
      metadata: readMetadataProp(init, fieldLabel, file, warnings),
    }
  })
}

function extractOperationDocsMap(
  sectionNode: ts.Expression,
  sectionLabel: string,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): Partial<Record<string, Loosen<OperationDocs>>> | undefined {
  return extractDocsSection(
    sectionNode,
    sectionLabel,
    contextLabel,
    file,
    warnings,
    (init, key) => {
      const opLabel = `${contextLabel}.${sectionLabel}.${key}`
      return {
        description: readStringProp(init, "description", opLabel, file, warnings),
        source: readStringProp(init, "source", opLabel, file, warnings),
        credentials: readStringProp(init, "credentials", opLabel, file, warnings),
        endpoints: readEndpointsProp(init, opLabel, file, warnings),
        metadata: readMetadataProp(init, opLabel, file, warnings),
      }
    },
  )
}

/**
 * @internal Whether `value` has the one citation shape `dynamicAccess`
 * entries are ever accepted in: `"<relative-path>:<line>:<column>"`, where the
 * path is at least one character and line/column are runs of digits, with
 * nothing before or after. Exported for direct boundary coverage.
 */
export function isDynamicAccessCitation(value: string): boolean {
  return /^.+:\d+:\d+$/.test(value)
}

/** Extracts and format-validates one field's `dynamicAccess` citation list -- a malformed entry is dropped individually, with its own warning, never rejecting the rest of the array (same discipline `readEndpointsProp` already established for `endpoints`). */
/** @internal Exported for direct unit coverage (reached only through the recursive parse walk in production). */
export function readDynamicAccessCitations(
  node: ts.Expression,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): readonly string[] | undefined {
  const evaluated = evaluateLiteral(node)
  if (!evaluated.ok || !Array.isArray(evaluated.value)) {
    warnings.push({
      file,
      message: `"dynamicAccess" for "${contextLabel}" is not a statically-resolvable array literal; ignoring it.`,
    })
    return undefined
  }
  const citations: string[] = []
  for (const entry of evaluated.value) {
    if (typeof entry !== "string" || !isDynamicAccessCitation(entry)) {
      warnings.push({
        file,
        message: `A "dynamicAccess" entry for "${contextLabel}" is not a "<path>:<line>:<column>"-shaped string; dropping it.`,
      })
      continue
    }
    citations.push(entry)
  }
  return citations
}

function extractEvidenceFieldsMap(
  sectionNode: ts.Expression,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): Readonly<Record<string, Loosen<EvidenceFieldDocs>>> | undefined {
  return extractDocsSection(
    sectionNode,
    "evidence.fields",
    contextLabel,
    file,
    warnings,
    (init, key) => {
      const evidenceFieldLabel = `${contextLabel}.evidence.fields.${key}`
      const dynamicAccessProp = findProp(init, "dynamicAccess")
      return {
        dynamicAccess:
          dynamicAccessProp !== undefined
            ? readDynamicAccessCitations(
                dynamicAccessProp.initializer,
                evidenceFieldLabel,
                file,
                warnings,
              )
            : undefined,
      }
    },
  )
}

/** Extracts `documentData()`'s `evidence.fields` section -- see `EvidenceFieldDocs`' own doc comment for why this lives structurally apart from the rest of `CapabilityDocs`. */
function extractEvidenceDocs(
  docsNode: ts.ObjectLiteralExpression,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): LooseCapabilityDocs["evidence"] {
  const evidenceProp = findProp(docsNode, "evidence")
  if (evidenceProp === undefined) return undefined
  if (!ts.isObjectLiteralExpression(evidenceProp.initializer)) {
    warnings.push({
      file,
      message: `"evidence" for "${contextLabel}" is not an inline object literal; ignoring it.`,
    })
    return undefined
  }
  const fieldsProp = findProp(evidenceProp.initializer, "fields")
  if (fieldsProp === undefined) return {}
  return {
    fields: extractEvidenceFieldsMap(fieldsProp.initializer, contextLabel, file, warnings),
  }
}

/**
 * Statically extracts a `documentData()` call's second argument into
 * `CapabilityDocs` -- the same literal-only, warn-not-guess extraction
 * `extractOperationNames` applies to the schema's own `getters`/`mutators`/
 * `subscriptions` section names. Returns `undefined` when `docsNode` is
 * absent or not an inline object literal at all (nothing to extract).
 */
export function extractCapabilityDocs(
  docsNode: ts.Expression | undefined,
  contextLabel: string,
  file: string,
  warnings: ParseWarning[],
): LooseCapabilityDocs | undefined {
  if (docsNode === undefined || !ts.isObjectLiteralExpression(docsNode)) return undefined

  const fieldsProp = findProp(docsNode, "fields")
  const gettersProp = findProp(docsNode, "getters")
  const mutatorsProp = findProp(docsNode, "mutators")
  const subscriptionsProp = findProp(docsNode, "subscriptions")

  return {
    name: readStringProp(docsNode, "name", contextLabel, file, warnings),
    description: readStringProp(docsNode, "description", contextLabel, file, warnings),
    owner: readStringProp(docsNode, "owner", contextLabel, file, warnings),
    category: readStringProp(docsNode, "category", contextLabel, file, warnings),
    exclusiveGroup: readStringProp(docsNode, "exclusiveGroup", contextLabel, file, warnings),
    active: readBooleanProp(docsNode, "active", contextLabel, file, warnings),
    sensitivity: readStringProp(docsNode, "sensitivity", contextLabel, file, warnings),
    protections: readStringProp(docsNode, "protections", contextLabel, file, warnings),
    retention: readStringProp(docsNode, "retention", contextLabel, file, warnings),
    purpose: readStringProp(docsNode, "purpose", contextLabel, file, warnings),
    legalBasis: readStringProp(docsNode, "legalBasis", contextLabel, file, warnings),
    dataResidency: readDataResidencyProp(docsNode, contextLabel, file, warnings),
    auditRequired: readBooleanProp(docsNode, "auditRequired", contextLabel, file, warnings),
    // Capability-level lifecycle is deliberately narrower than a field's:
    // no `removeBy`/`renamedFrom`, which only mean something per-field (see
    // `core/document.ts`).
    expiresAt: readStringProp(docsNode, "expiresAt", contextLabel, file, warnings),
    deprecated: readBooleanProp(docsNode, "deprecated", contextLabel, file, warnings),
    deprecatedReason: readStringProp(docsNode, "deprecatedReason", contextLabel, file, warnings),
    metadata: readMetadataProp(docsNode, contextLabel, file, warnings),
    evidence: extractEvidenceDocs(docsNode, contextLabel, file, warnings),
    fields:
      fieldsProp !== undefined
        ? extractFieldDocsMap(fieldsProp.initializer, contextLabel, file, warnings)
        : undefined,
    getters:
      gettersProp !== undefined
        ? extractOperationDocsMap(gettersProp.initializer, "getters", contextLabel, file, warnings)
        : undefined,
    mutators:
      mutatorsProp !== undefined
        ? extractOperationDocsMap(
            mutatorsProp.initializer,
            "mutators",
            contextLabel,
            file,
            warnings,
          )
        : undefined,
    subscriptions:
      subscriptionsProp !== undefined
        ? extractOperationDocsMap(
            subscriptionsProp.initializer,
            "subscriptions",
            contextLabel,
            file,
            warnings,
          )
        : undefined,
  }
}

/** Exported for reuse by `dependency-graph.ts` (both live in `build/`, so this is ordinary reuse, not the deliberate cross-folder duplication `glob.ts` uses between `build/` and `eslint-plugin/`). */
export function collectImportBindings(node: ts.ImportDeclaration, imports: ImportBinding[]): void {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return
  const moduleSpecifier = node.moduleSpecifier.text
  const clause = node.importClause
  if (clause === undefined) return

  if (clause.name !== undefined) {
    imports.push({ localName: clause.name.text, importedName: "default", moduleSpecifier })
  }
  if (clause.namedBindings !== undefined) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      imports.push({
        localName: clause.namedBindings.name.text,
        importedName: "*",
        moduleSpecifier,
      })
    } else {
      // `NamedImportBindings` is exactly `NamespaceImport | NamedImports` --
      // `ts.isNamespaceImport` above is a real type predicate, so TS already
      // narrows `clause.namedBindings` to `NamedImports` in this `else`
      // branch on its own; a redundant `ts.isNamedImports` check here would
      // only ever be a no-op condition (there is no third member of the
      // union for it to distinguish), so it's simply not written.
      for (const element of clause.namedBindings.elements) {
        const importedName = (element.propertyName ?? element.name).text
        imports.push({ localName: element.name.text, importedName, moduleSpecifier })
      }
    }
  }
}

/**
 * Parses one file's top-level statements only (matching `buildData`'s/
 * `createData`'s own intended usage: called once, at module scope, and
 * exported). Nested/conditional/dynamically-constructed calls are not this
 * module's concern -- they cannot be statically discovered and are simply
 * never found, never guessed at.
 */
export function parseCapabilityFile(filePath: string, sourceText: string): ParseResult {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    // `setParentNodes` -- nothing in this module reads `node.parent` (position
    // lookups pass `sourceFile` explicitly), so `true`/`false` is behaviourally
    // identical here; kept `true` only as the conventional default.
    // Stryker disable next-line BooleanLiteral
    true,
    ts.ScriptKind.TSX,
  )

  const warnings: ParseWarning[] = []
  const imports: ImportBinding[] = []
  const localConsts = new Map<string, ts.Expression>()
  const createDataCalls: RawCreateDataCall[] = []
  const documentDataCalls: RawDocumentDataCall[] = []

  function recordDocumentDataCall(call: ts.CallExpression): void {
    documentDataCalls.push({
      fieldsRef: extractFieldsRef(call, localConsts),
      docsNode: call.arguments[1],
      node: call,
    })
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      collectImportBindings(statement, imports)
      continue
    }

    if (ts.isVariableStatement(statement)) {
      const isExported = hasExportModifier(statement)
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
        const name = declaration.name.text
        const initializer = declaration.initializer
        localConsts.set(name, initializer)

        if (!ts.isCallExpression(initializer)) continue

        const callKind = isCallToName(initializer, "buildData")
          ? "buildData"
          : isCallToName(initializer, "createData")
            ? "createData"
            : undefined

        if (callKind !== undefined) {
          const fieldsRef = extractFieldsRef(initializer, localConsts)
          createDataCalls.push({
            exportName: isExported ? name : undefined,
            kind: callKind,
            fieldsRef,
            operationNames:
              callKind === "createData"
                ? extractOperationNames(initializer, localConsts)
                : undefined,
            operationWrites:
              callKind === "createData"
                ? extractOperationWritesByKind(initializer, filePath, warnings, localConsts)
                : undefined,
            operationPresence:
              callKind === "createData"
                ? extractOperationPresenceByKind(initializer, localConsts)
                : undefined,
            node: initializer,
            declarationPosition: positionOf(sourceFile, initializer),
            fieldPositions: extractFieldPositions(fieldsRef, sourceFile),
          })
          if (!isExported) {
            warnings.push({
              file: filePath,
              message: `${callKind}() assigned to "${name}" is not exported -- build tooling can only discover exported capabilities.`,
            })
          }
        } else if (isCallToName(initializer, "documentData")) {
          recordDocumentDataCall(initializer)
        }
      }
      continue
    }

    // documentData()'s result is void and typically called as a bare
    // top-level statement, not assigned to a variable.
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const call = statement.expression
      if (isCallToName(call, "documentData")) {
        recordDocumentDataCall(call)
      }
    }
  }

  return { file: filePath, createDataCalls, documentDataCalls, localConsts, imports, warnings }
}
