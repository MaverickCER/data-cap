/**
 * The field-ownership boundary: determines which parts of a processor's
 * output an operation is actually allowed to write, then shape-checks and
 * sanitizes what passes that boundary. This is the single most
 * security/correctness-load-bearing algorithm in the package -- it is what
 * prevents an operation from smuggling fields it doesn't own into state (see
 * specs/architecture.md's negative-guarantee checklist, item 1).
 *
 * Internal -- not re-exported from the public `.` barrel. Consumed by the
 * (future) standalone runtime and any integration that executes operations
 * against a capability.
 */

import { isFieldMarker } from "./fields.js"
import { checkValueAgainstSchema, resolveFieldDefaults } from "./schema.js"
import type { DataError, DeepPartial, FieldOwnership, FieldsShape, InferFields } from "./types.js"

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

export interface ResolveOperationPatchOptions<TFields extends FieldsShape> {
  /**
   * The operation's declared field ownership. `undefined` means "no `fields`
   * declaration" (a mutator) -- treated as full-tree ownership, bounded to
   * whatever the capability's schema actually declares (never "anything
   * goes").
   */
  readonly declaredOwnership: FieldOwnership<InferFields<TFields>> | undefined
  /** The RAW capability schema (with nullable/optional markers), passed directly by the caller (e.g. `createData`'s own closure over `schema.fields`). */
  readonly fieldsSchema: TFields
  /** The operation's processor return value. Assumed not to have thrown -- a thrown processor is a separate, earlier failure path. */
  readonly processedOutput: unknown
  /** The operation key (getter/mutator/subscription name), used as `DataError.operator` and in warning paths. */
  readonly operator: string
}

export interface ResolveOperationPatchResult<TFields extends FieldsShape> {
  /** `undefined` when nothing was accepted at all (e.g. an empty/non-object processor output). */
  readonly acceptedPatch: DeepPartial<InferFields<TFields>> | undefined
  /** Keyed by dotted field path -- one entry per dropped/sanitized field, for dev-mode warnings and future `info` population. */
  readonly fieldErrors: ReadonlyMap<string, DataError>
}

type OwnershipNode = true | Record<string, unknown> | undefined

function isPlainObjectSchemaNode(node: unknown): node is Record<string, unknown> {
  return (
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    !(node instanceof Date) &&
    !(node instanceof URL) &&
    !(node instanceof RegExp) &&
    // A nullable/optional marker is a plain object shape-wise, but it must
    // never be treated as a partial-ownership-partitionable node -- it's a
    // leaf as far as ownership descent is concerned.
    !isFieldMarker(node)
  )
}

function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function fieldError(operator: string, path: readonly string[], reason: string): DataError {
  return {
    operator,
    error: new Error(`${reason} at "${path.join(".")}" (operator: "${operator}")`),
  }
}

/**
 * Resolves a processor's output into a safe, ownership-checked patch.
 *
 * Presence is checked with `Object.hasOwn`, never truthiness -- `0`,
 * `false`, `""`, `null`, and an explicit `undefined` are all real,
 * intentional values a processor may legitimately return.
 */
export function resolveOperationPatch<TFields extends FieldsShape>(
  options: ResolveOperationPatchOptions<TFields>,
): ResolveOperationPatchResult<TFields> {
  const { declaredOwnership, fieldsSchema, processedOutput, operator } = options
  const fieldErrors = new Map<string, DataError>()

  if (
    processedOutput === null ||
    typeof processedOutput !== "object" ||
    Array.isArray(processedOutput)
  ) {
    return { acceptedPatch: undefined, fieldErrors }
  }

  // No `fields` declaration (a mutator) means full-tree ownership, bounded
  // to the declared schema -- never "anything goes" (see round-1 decision 1).
  const effectiveOwnership: OwnershipNode = declaredOwnership ?? true

  function walk(
    schemaLevel: Record<string, unknown>,
    ownershipLevel: OwnershipNode,
    valueLevel: Record<string, unknown>,
    path: readonly string[],
  ): { accepted: Record<string, unknown>; hasAny: boolean } {
    const result: Record<string, unknown> = {}
    let hasAny = false

    for (const key of Object.keys(valueLevel)) {
      const keyPath = [...path, key]

      if (UNSAFE_KEYS.has(key)) {
        fieldErrors.set(keyPath.join("."), fieldError(operator, keyPath, "Rejected unsafe key"))
        continue
      }

      if (!Object.hasOwn(schemaLevel, key)) {
        fieldErrors.set(
          keyPath.join("."),
          fieldError(operator, keyPath, "Field is not declared in the capability schema"),
        )
        continue
      }

      const keyOwnership: OwnershipNode =
        ownershipLevel === true ? true : (ownershipLevel?.[key] as OwnershipNode)

      if (keyOwnership === undefined) {
        fieldErrors.set(
          keyPath.join("."),
          fieldError(operator, keyPath, "Field is not owned by this operation"),
        )
        continue
      }

      const schemaChild = schemaLevel[key]

      if (isPlainObjectSchemaNode(schemaChild)) {
        // Always keep walking ourselves for a plain-object schema child --
        // whether fully owned (`true`, descend with full ownership) or
        // partially owned (a nested ownership object, descend bounded to
        // it) -- rather than handing off to checkValueAgainstSchema. This is
        // what lets a deeply nested invalid leaf get its own precise
        // fieldErrors path (round-1 decision 2's "descend to the smallest
        // invalid leaf/subtree"), instead of only the top-level key.
        if (isPlainObjectValue(valueLevel[key])) {
          const nested = walk(schemaChild, keyOwnership, valueLevel[key], keyPath)
          if (nested.hasAny) {
            result[key] = nested.accepted
            hasAny = true
          }
        } else {
          // Schema expects a nested object here; the processor returned
          // something else entirely -- the whole subtree resets to its
          // schema default rather than being silently dropped.
          result[key] = resolveFieldDefaults(schemaChild, keyPath, new Set())
          hasAny = true
          fieldErrors.set(keyPath.join("."), fieldError(operator, keyPath, "Invalid shape"))
        }
        continue
      }

      // Leaf-like schema child (primitive/array/Date/URL/RegExp/marker) --
      // can only ever be owned wholesale; a nested partial-ownership object
      // here would be a misconfiguration (FieldOwnership's own type
      // prevents declaring one for a non-object field), so only `true`
      // grants access.
      if (keyOwnership !== true) {
        fieldErrors.set(
          keyPath.join("."),
          fieldError(operator, keyPath, "Field is not owned by this operation"),
        )
        continue
      }

      const checked = checkValueAgainstSchema(schemaChild, valueLevel[key])
      hasAny = true
      if (checked.valid) {
        result[key] = checked.accepted
      } else {
        result[key] = resolveFieldDefaults(schemaChild, keyPath, new Set())
        fieldErrors.set(keyPath.join("."), fieldError(operator, keyPath, "Invalid shape"))
      }
    }

    return { accepted: result, hasAny }
  }

  const { accepted, hasAny } = walk(
    fieldsSchema,
    effectiveOwnership,
    processedOutput as Record<string, unknown>,
    [],
  )

  return {
    acceptedPatch: hasAny ? (accepted as DeepPartial<InferFields<TFields>>) : undefined,
    fieldErrors,
  }
}
