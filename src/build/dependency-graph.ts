/**
 * Statically proves `DependencyEdge`s from one already-parsed consumer
 * file's AST -- given which local identifiers are already known (by
 * `scan-dependencies.ts`) to be import bindings for a target capability.
 * Never traces variable aliasing, destructuring, or re-assignment: a
 * capability reference passed to another function, stored under a new
 * name, or destructured apart is a real usage this module cannot follow
 * without genuine scope analysis, so it contributes nothing beyond the
 * base `imports` edge -- matching AGENTS.md's "never infer from
 * insufficient evidence" invariant. Only the direct shapes real usage
 * overwhelmingly takes are recognized: `x.field(...)` calls, `x.fields.*`/
 * `x.getSnapshot().fields.*` reads, and `x[computed]` dynamic access
 * (flagged `indeterminate`, never guessed at).
 */

import ts from "typescript"
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
    to: { capability: { file: target.file, exportName: target.exportName }, field, operation },
    resolution,
    position,
  }
}

/** The top-level field name immediately following a `.fields` access, or `undefined` when `.fields` is referenced bare (spread, passed whole) rather than indexed into a specific field. */
function readFieldNameAfter(fieldsAccess: ts.PropertyAccessExpression): string | undefined {
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
 * Whether `.fields` (or `.getSnapshot().fields`) is immediately followed by
 * an element access at all -- `x.fields[computed]` -- as opposed to a bare
 * reference (`x.fields` spread, passed whole, assigned). Only called after
 * `readFieldNameAfter` already returned `undefined`, so when this is `true`
 * the element access's argument specifically wasn't a string literal: a
 * real per-field access this pass can't name, not the absence of one.
 */
function isIndexedAccess(fieldsAccess: ts.PropertyAccessExpression): boolean {
  const next = fieldsAccess.parent
  return ts.isElementAccessExpression(next) && next.expression === fieldsAccess
}

function classifyUsage(
  id: ts.Identifier,
  match: ImportBindingMatch,
  fromFile: string,
  sourceFile: ts.SourceFile,
  edges: DependencyEdge[],
): void {
  const parent = id.parent
  const { target, resolution } = match
  const position = positionOf(sourceFile, id)

  if (ts.isElementAccessExpression(parent) && parent.expression === id) {
    edges.push(makeEdge("imports", fromFile, target, "indeterminate", position))
    return
  }

  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== id) return // bare reference (passed as an argument, assigned, spread, ...) -- not further classified
  const memberName = parent.name.text

  if (memberName === "fields") {
    const fieldName = readFieldNameAfter(parent)
    if (fieldName !== undefined) {
      edges.push(makeEdge("reads-field", fromFile, target, resolution, position, [fieldName]))
    } else if (isIndexedAccess(parent)) {
      // `.fields[computed]` where `computed` isn't a string literal -- a
      // real access this pass can't name, never silently dropped (see this
      // module's own header comment on "never infer from insufficient
      // evidence" -- disclosed as indeterminate, not treated as absent).
      edges.push(makeEdge("reads-field", fromFile, target, "indeterminate", position))
    }
    return
  }

  if (memberName === "getSnapshot") {
    const call = parent.parent
    if (!ts.isCallExpression(call) || call.expression !== parent) return
    // `afterCall` is a member access whose object-expression is the call, so
    // (like `readFieldNameAfter`) `afterCall.expression === call` is implied
    // once `afterCall` is a `PropertyAccessExpression`.
    const afterCall = call.parent
    if (!ts.isPropertyAccessExpression(afterCall) || afterCall.name.text !== "fields") return
    const fieldName = readFieldNameAfter(afterCall)
    if (fieldName !== undefined) {
      edges.push(makeEdge("reads-field", fromFile, target, resolution, position, [fieldName]))
    } else if (isIndexedAccess(afterCall)) {
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
  sourceFile: ts.SourceFile,
  fromFile: string,
  matches: readonly ImportBindingMatch[],
): readonly DependencyEdge[] {
  const edges: DependencyEdge[] = []
  const byLocalName = new Map(matches.map((m) => [m.localName, m]))

  function visit(node: ts.Node): void {
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
