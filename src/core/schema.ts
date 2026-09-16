/**
 * Pure utilities over a RAW field schema -- the object literal a developer
 * passes as `buildData({ fields: ... })`, still containing
 * `fields.nullable`/`fields.optional` markers -- as opposed to a RESOLVED
 * fields value (plain data, markers already stripped to null/undefined).
 *
 * Shared by build.ts (initial defaults) and ownership.ts (per-field shape
 * validation + reset-to-default for an invalid processed value). Internal --
 * not re-exported from the public `.` barrel.
 */

import { FIELD_MARKER, isFieldMarker, type FieldMarker } from "./fields.js"
import { InvalidFieldDefaultError } from "./errors.js"

/**
 * Walks a declared `fields` schema tree, producing the resolved defaults
 * object: strips nullable/optional markers down to their runtime default
 * (`null`/`undefined`), rejects function values and cyclic references, and
 * passes Date/URL/RegExp instances through untouched as opaque leaves (never
 * decomposed into a plain object).
 */

// A hard, generous fail-safe wholly independent of the `stack.has()` cycle
// check below -- not a policy limit (a real field schema never nests
// anywhere close to this deep) but a backstop against that check itself
// being broken: a mutation neutralizing `stack.has(schemaNode)` would
// otherwise let a genuine cyclic reference recurse until a real stack
// overflow, which takes long enough to manifest that it reads as a hang
// (Stryker's own per-mutant timeout) rather than an observably wrong
// result. `path` already grows by exactly one at every recursive call
// site, independent of `stack`, so it still reaches this ceiling fast
// under that same mutation.
const MAX_FIELD_DEPTH = 200

export function resolveFieldDefaults(
  schemaNode: unknown,
  path: readonly string[],
  stack: Set<object>,
): unknown {
  if (path.length > MAX_FIELD_DEPTH) {
    throw new InvalidFieldDefaultError(path, "cyclic field defaults are not supported")
  }

  if (typeof schemaNode === "function") {
    throw new InvalidFieldDefaultError(path, "functions are not valid field values")
  }

  if (isFieldMarker(schemaNode)) {
    // `inner` is validated for shape (functions/cycles) but never appears in
    // the resolved output -- the marker's own runtime default is
    // null/undefined regardless of what `inner` is.
    resolveFieldDefaults(schemaNode.inner, [...path, "<nullable/optional inner>"], stack)
    return schemaNode[FIELD_MARKER] === "nullable" ? null : undefined
  }

  if (schemaNode === null || typeof schemaNode !== "object") {
    return schemaNode
  }

  if (schemaNode instanceof Date || schemaNode instanceof URL || schemaNode instanceof RegExp) {
    return schemaNode
  }

  if (stack.has(schemaNode)) {
    throw new InvalidFieldDefaultError(path, "cyclic field defaults are not supported")
  }

  stack.add(schemaNode)
  try {
    if (Array.isArray(schemaNode)) {
      return schemaNode.map((item: unknown, index) =>
        resolveFieldDefaults(item, [...path, String(index)], stack),
      )
    }
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(schemaNode)) {
      result[key] = resolveFieldDefaults(
        (schemaNode as Record<string, unknown>)[key],
        [...path, key],
        stack,
      )
    }
    return result
  } finally {
    // A "currently visiting" stack, not an "ever visited" set -- the same
    // object referenced twice in unrelated branches (aliasing, not a cycle)
    // must not be misreported as cyclic.
    stack.delete(schemaNode)
  }
}

export type ShapeCheckResult =
  { readonly valid: true; readonly accepted: unknown } | { readonly valid: false }

function isPlainObjectSchemaNode(node: unknown): node is Record<string, unknown> {
  return (
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    !isFieldMarker(node) &&
    !(node instanceof Date) &&
    !(node instanceof URL) &&
    !(node instanceof RegExp)
  )
}

const INVALID: ShapeCheckResult = { valid: false }

/** A nullable/optional marker widens its `inner` shape to also accept `null`/`undefined`. */
function checkFieldMarker(marker: FieldMarker, value: unknown): ShapeCheckResult {
  if (marker[FIELD_MARKER] === "nullable" && value === null) return { valid: true, accepted: null }
  if (marker[FIELD_MARKER] === "optional" && value === undefined) {
    return { valid: true, accepted: undefined }
  }
  return checkValueAgainstSchema(marker.inner, value)
}

/** Date/URL/RegExp schema nodes are atomic instance checks. `null` = `schemaNode` is not one of them. */
function checkBuiltinInstance(schemaNode: unknown, value: unknown): ShapeCheckResult | null {
  if (schemaNode instanceof Date)
    return value instanceof Date ? { valid: true, accepted: value } : INVALID
  if (schemaNode instanceof URL)
    return value instanceof URL ? { valid: true, accepted: value } : INVALID
  if (schemaNode instanceof RegExp) {
    return value instanceof RegExp ? { valid: true, accepted: value } : INVALID
  }
  return null
}

/** A nested plain-object schema node accepts a partial patch -- only keys present in `value` (own, via `Object.hasOwn`) are checked; an invalid nested subtree resets to its schema default rather than being dropped. */
function checkPlainObject(schemaNode: Record<string, unknown>, value: unknown): ShapeCheckResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return INVALID

  const result: Record<string, unknown> = {}
  const valueRecord = value as Record<string, unknown>
  for (const key of Object.keys(valueRecord)) {
    // Unknown key at a nested level -- not declared anywhere in the schema.
    // Dropped; does not invalidate sibling keys.
    if (!Object.hasOwn(schemaNode, key)) continue
    const nested = checkValueAgainstSchema(schemaNode[key], valueRecord[key])
    result[key] = nested.valid
      ? nested.accepted
      : resolveFieldDefaults(schemaNode[key], [key], new Set())
  }
  return { valid: true, accepted: result }
}

/**
 * Checks `value` against the accepted runtime shape a schema node declares.
 * Nested plain objects accept a PARTIAL patch -- only keys actually present
 * in `value` (via `Object.hasOwn`, never truthiness) are checked/kept; a key
 * declared in the schema but absent from `value` simply isn't part of the
 * result, matching a processor's ability to return a partial field tree.
 * Arrays are atomic: `value` must itself be an array, never validated
 * item-by-item here. Nullable/optional markers widen the accepted shape to
 * include `null`/`undefined` respectively, on top of whatever `inner`
 * accepts.
 */
export function checkValueAgainstSchema(schemaNode: unknown, value: unknown): ShapeCheckResult {
  if (isFieldMarker(schemaNode)) return checkFieldMarker(schemaNode, value)

  const builtin = checkBuiltinInstance(schemaNode, value)
  if (builtin !== null) return builtin

  if (Array.isArray(schemaNode)) {
    return Array.isArray(value) ? { valid: true, accepted: value } : INVALID
  }

  if (isPlainObjectSchemaNode(schemaNode)) return checkPlainObject(schemaNode, value)

  // Primitive leaf.
  return typeof value === typeof schemaNode ? { valid: true, accepted: value } : INVALID
}
