/**
 * Statically proves `DependencyEdge`s from one already-parsed consumer
 * file's AST -- given which local identifiers are already known (by
 * `scan-dependencies.ts`) to be import bindings for a target capability.
 * Never traces variable aliasing, destructuring, or re-assignment: a
 * capability reference passed to another function, stored under a new
 * name, or destructured apart is a real usage this module cannot follow
 * without genuine scope analysis. Per ADR 0060, that boundary is never
 * silence: `x.field(...)` calls and `x.fields.*`/`x.getSnapshot().fields.*`
 * reads are proven `reads-field`/`calls-*` edges; `x[computed]` and
 * `x.fields[computed]` dynamic access are `indeterminate` (never guessed
 * at); and every other bare mention of a tracked binding -- passed as an
 * argument, spread, assigned to a new name, returned, or handed to JSX as
 * a prop -- is an *escape*: also `indeterminate`, widening every
 * not-otherwise-proven field on that capability (see `usage-report.ts`'s
 * `collectIndeterminateSites`), never silently downgraded to `unconsumed`.
 * The binding's own import/export/declaration position is the one bare
 * mention that is never a usage at all (see `isDeclarationOrExportPosition`),
 * and a bare mention used only as another expression's element-access
 * *key* (`registry[x]`, `registry[x.fields]`) is inert with respect to this
 * capability's own data and produces no edge either (see
 * `isElementAccessIndex`).
 */

import { ts } from "./typescript.js"
import type TS from "typescript"
import type { DependencyEdge, DependencyRelationship } from "./dependency-types.js"
import type { SourcePosition } from "./source-position.js"
import { positionOf } from "./source-position.js"

/** One capability to scan a file's AST for usage of. */
export interface ScanTarget {
  /** Absolute path of the file declaring this capability. */
  readonly file: string
  /** The binding name the capability is exported as. */
  readonly exportName: string
  /** Getter names declared on the capability. */
  readonly getterNames: readonly string[]
  /** Mutator names declared on the capability. */
  readonly mutatorNames: readonly string[]
  /** Subscription names declared on the capability. */
  readonly subscriptionNames: readonly string[]
}

/** One consuming file's import resolved against a `ScanTarget`. */
export interface ImportBindingMatch {
  /** The name this binding is referenced by within the consuming file. */
  readonly localName: string
  /** Which capability this import resolved to. */
  readonly target: ScanTarget
  /** `"unresolved-consumer"` when the match came from a same-name heuristic (the import specifier didn't resolve directly to the target's own file -- e.g. a barrel re-export) rather than a directly-resolved import. */
  readonly resolution: "resolved" | "unresolved-consumer"
}

function makeEdge(
  relationship: DependencyRelationship,
  fromFile: string,
  target: ScanTarget,
  resolution: DependencyEdge["resolution"],
  position: SourcePosition | undefined,
  field?: readonly string[],
  operation?: string,
): DependencyEdge {
  return {
    relationship,
    from: fromFile,
    to: {
      capability: { file: target.file, exportName: target.exportName },
      ...(field !== undefined ? { field } : {}),
      ...(operation !== undefined ? { operation } : {}),
    },
    resolution,
    position,
  }
}

/** The top-level field name immediately following a `.fields` access, or `undefined` when `.fields` is referenced bare (spread, passed whole) rather than indexed into a specific field. */
function readFieldNameAfter(fieldsAccess: TS.PropertyAccessExpression): string | undefined {
  const next = fieldsAccess.parent
  // `fieldsAccess` (itself a `.fields` access, never an `Identifier`) can only
  // be the object-expression of a wrapping member access, never its `.name` --
  // so `next.expression === fieldsAccess` is implied whenever `next` is a
  // `PropertyAccessExpression` here, and (for an `ElementAccessExpression`) is
  // implied by `argumentExpression` being a string literal at all.
  if (ts.isPropertyAccessExpression(next)) return next.name.text
  if (ts.isElementAccessExpression(next) && ts.isStringLiteralLike(next.argumentExpression)) {
    return next.argumentExpression.text
  }
  return undefined
}

/**
 * Whether `node` sits only as another expression's element-access *key*
 * (`registry[x]`, `registry[x.fields]`) rather than as the value being
 * read. The capability's own identity is used here, never its data --
 * inert with respect to what this scan tracks, so it is neither a proven
 * access nor an escape (ADR 0060).
 */
function isElementAccessIndex(node: TS.Node): boolean {
  const parent = node.parent
  return ts.isElementAccessExpression(parent) && parent.argumentExpression === node
}

/**
 * Whether `id` sits in the tracked binding's own declaration -- an
 * `import` specifier/clause, a re-`export` specifier, or (for a capability
 * declared and read in the same file) the `const`/`let` declaration's own
 * name. None of these is ever a usage, proven or escaped (ADR 0060) --
 * matching `scanFileForUsage`'s existing guarantee that an import
 * declaration is walked but never mistaken for a usage, extended to the
 * self-declared-capability shape `scan-dependencies.ts`'s `selfMatches`
 * introduces.
 */
function isDeclarationOrExportPosition(id: TS.Identifier, parent: TS.Node): boolean {
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) {
    return true
  }
  if (ts.isExportSpecifier(parent)) return true
  return ts.isVariableDeclaration(parent) && parent.name === id
}

/**
 * Whether `id` sits in a "name" (label/key) position -- an unrelated
 * object's member access, an object literal's own property key, a
 * class/interface member's own name -- rather than being read as a value.
 * A same-named local binding (`getUser`, say) coincidentally colliding with
 * one of these labels elsewhere in the file (`other.getUser()`, `{ getUser:
 * 1 }`) is never a reference to the tracked binding itself, escaped or
 * otherwise (ADR 0060) -- this pass matches identifiers by text alone
 * (ADR 0010), so it must exclude every "name," not just member access,
 * where that text can recur without meaning the same thing.
 *
 * Deliberately excludes `ShorthandPropertyAssignment` (`{ getUser }`,
 * meaning `{ getUser: getUser }`): there, the identifier genuinely IS a
 * value reference to the outer binding, spread into the object literal --
 * a real escape, not a label collision.
 *
 * `parent.name === id` is checked for `PropertyAccessExpression` (`.name`
 * or `.expression` can each be a bare identifier: `other.getUser`) and
 * `PropertyAssignment` (`.name` or `.initializer` can each be one: `{
 * someKey: getUser }` is a real escape, not a label). It is NOT checked for
 * `PropertySignature`/`MethodDeclaration`/`MethodSignature`/accessors,
 * because those node kinds expose no OTHER direct-child identifier `id`
 * could be: every other slot (`.type`, `.parameters`, `.body`, ...) is
 * itself a further AST node, never a bare `Identifier` sitting directly at
 * `id.parent`. So whenever `parent` IS one of those kinds at all, `id`
 * being its child already proves `id` is `.name`.
 */
function isNamePosition(id: TS.Identifier, parent: TS.Node): boolean {
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return true
  if (ts.isPropertyAssignment(parent) && parent.name === id) return true
  if (ts.isPropertySignature(parent)) return true
  if (ts.isMethodDeclaration(parent)) return true
  if (ts.isMethodSignature(parent)) return true
  if (ts.isGetAccessor(parent) || ts.isSetAccessor(parent)) return true
  return false
}

/**
 * What a `.fields` (or `.getSnapshot().fields`) access proves, once it's
 * confirmed to be reading FROM `fieldsAccess` rather than merely being
 * indexed BY it elsewhere (`registry[x.fields]` -- `undefined`, not a read
 * of `x`'s data at all). A computed `.fields[computed]` index and a bare
 * reference (spread, passed, assigned, returned, handed to JSX as a prop,
 * ...) both resolve to the same `"indeterminate"` outcome -- see ADR 0060 --
 * so they are never distinguished here.
 */
type FieldsAccessOutcome =
  { readonly kind: "field"; readonly field: string } | { readonly kind: "indeterminate" }

function classifyFieldsAccess(
  fieldsAccess: TS.PropertyAccessExpression,
): FieldsAccessOutcome | undefined {
  const fieldName = readFieldNameAfter(fieldsAccess)
  if (fieldName !== undefined) return { kind: "field", field: fieldName }
  if (isElementAccessIndex(fieldsAccess)) return undefined
  return { kind: "indeterminate" }
}

function classifyUsage(
  id: TS.Identifier,
  match: ImportBindingMatch,
  fromFile: string,
  sourceFile: TS.SourceFile,
  edges: DependencyEdge[],
): void {
  const parent = id.parent
  const { target, resolution } = match
  const position = positionOf(sourceFile, id)

  if (isDeclarationOrExportPosition(id, parent)) return // the binding's own import/export/self-declaration -- never a usage
  if (isNamePosition(id, parent)) return // e.g. `other.getUser()`, `{ getUser: 1 }` -- a same-named label, never a reference to the tracked binding

  // `id` can only be a `PropertyAccessExpression`'s `.expression` or `.name`
  // (its only two identifier-bearing slots), and `isNamePosition` above
  // already excluded `.name` -- so whenever `parent` IS one, `id` is
  // provably its subject, and this check alone is enough to also rule out
  // every OTHER shape a bare mention takes (an `ElementAccessExpression`'s
  // object or key, a `CallExpression` argument, a `JsxExpression`, a
  // `ReturnStatement`, spread, assignment, ...).
  if (!ts.isPropertyAccessExpression(parent)) {
    // A bare mention: passed as an argument, spread, assigned to a new
    // name, returned, handed to JSX as a prop, ... -- unless `id` is merely
    // used as some OTHER expression's element-access key (`registry[x]`,
    // never a read of `x`'s own data), this is a real, provable reference
    // this single-file pass simply can't attribute to any specific field.
    // Escalated to `indeterminate` (ADR 0060), never silently dropped to
    // `unconsumed` -- the exact false claim of certainty ADR 0039 (env-cap)
    // already fixed for the sibling package's own equivalent scanner.
    if (!isElementAccessIndex(id)) {
      edges.push(makeEdge("imports", fromFile, target, "indeterminate", position))
    }
    return
  }
  const memberName = parent.name.text

  if (memberName === "fields") {
    const outcome = classifyFieldsAccess(parent)
    if (outcome?.kind === "field") {
      edges.push(makeEdge("reads-field", fromFile, target, resolution, position, [outcome.field]))
    } else if (outcome?.kind === "indeterminate") {
      edges.push(makeEdge("reads-field", fromFile, target, "indeterminate", position))
    }
    return
  }

  if (memberName === "getSnapshot") {
    const call = parent.parent
    if (!ts.isCallExpression(call) || call.expression !== parent) return
    const afterCall = call.parent
    // A `CallExpression` can only ever be a wrapping `PropertyAccessExpression`'s
    // `.expression` (its object), never its `.name` (always an `Identifier`) --
    // so `afterCall.expression === call` is implied whenever `afterCall` is a
    // `PropertyAccessExpression` at all, exactly as `readFieldNameAfter` already
    // relies on for `.fields` itself.
    const narrowsToFields =
      ts.isPropertyAccessExpression(afterCall) && afterCall.name.text === "fields"
    if (!narrowsToFields) {
      // Explicitly narrowed to some OTHER named property
      // (`.getSnapshot().info`) -- provably never reads `.fields` through
      // this access at all, so not an escape either. Anything else
      // (assigned, returned, spread, passed as an argument/prop, or
      // narrowed by a computed key) is ambiguous: `.fields` might still be
      // reached through it, just not in a shape this pass can follow --
      // indeterminate, unless the call result is merely used as another
      // expression's element-access key.
      const narrowsToOtherProperty = ts.isPropertyAccessExpression(afterCall)
      if (!narrowsToOtherProperty && !isElementAccessIndex(call)) {
        edges.push(makeEdge("reads-field", fromFile, target, "indeterminate", position))
      }
      return
    }
    const outcome = classifyFieldsAccess(afterCall)
    if (outcome?.kind === "field") {
      edges.push(makeEdge("reads-field", fromFile, target, resolution, position, [outcome.field]))
    } else if (outcome?.kind === "indeterminate") {
      edges.push(makeEdge("reads-field", fromFile, target, "indeterminate", position))
    }
    return
  }

  const relationship: DependencyRelationship | undefined = target.getterNames.includes(memberName)
    ? "calls-getter"
    : target.mutatorNames.includes(memberName)
      ? "calls-mutator"
      : target.subscriptionNames.includes(memberName)
        ? "calls-subscription"
        : undefined
  if (relationship === undefined) return // some other property/method -- not a recognized data-cap access pattern

  const call = parent.parent
  if (ts.isCallExpression(call) && call.expression === parent) {
    edges.push(
      makeEdge(relationship, fromFile, target, resolution, position, undefined, memberName),
    )
  }
}

/**
 * Walks `sourceFile`'s full AST (not just top-level statements, unlike
 * `parseCapabilityFile`) for every reference to a local name in `matches`,
 * producing one `DependencyEdge` per recognized access pattern found. A
 * binding's own import declaration is walked like any other node but produces
 * no edge -- an import-position identifier is never in an access expression.
 */
export function scanFileForUsage(
  sourceFile: TS.SourceFile,
  fromFile: string,
  matches: readonly ImportBindingMatch[],
): readonly DependencyEdge[] {
  const edges: DependencyEdge[] = []
  const byLocalName = new Map(matches.map((m) => [m.localName, m]))

  function visit(node: TS.Node): void {
    if (ts.isIdentifier(node)) {
      const match = byLocalName.get(node.text)
      // An identifier inside the import declaration itself sits in an
      // `ImportSpecifier`/`ImportClause`, never an access expression, so
      // `classifyUsage` produces no edge for it -- the binding's own
      // declaration is never mistaken for a usage.
      if (match !== undefined) classifyUsage(node, match, fromFile, sourceFile, edges)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return edges
}
