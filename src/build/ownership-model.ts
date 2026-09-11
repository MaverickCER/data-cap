/**
 * `data-cap`'s Ownership Model (ADR 0050) -- the owner ->
 * {capabilities, fields} matrix, plus the versioned envelope that publishes
 * it as JSON. Field-level `owner` is already resolved with capability-level
 * inheritance by `inventory.ts`, so this module only ever groups, never
 * re-derives ownership itself; and unlike env-cap's own Ownership Model
 * there was no unowned-count bug to fix -- `buildOwnershipMatrix` already
 * itemizes unowned capabilities/fields as real entries.
 *
 * One file, not a `ownership.ts`(raw)/`ownership-model.ts`(versioned) split:
 * `data-cap`'s five other canonical models (Capability, Dependency, Finding,
 * Change, Runtime Contract) each live in a single module that owns both its
 * shape and its schema version, and env-cap's own `ownership-model.ts`
 * follows the same convention. The former two-file split was the odd one
 * out and bought nothing -- `buildOwnershipMatrix` has no consumer that
 * wants the matrix *without* this module.
 */

import type { CapabilityInventory } from "./inventory.js"

/** Bump only when a reader could misinterpret the shape -- same discipline every other model's schema-version constant already documents. Bumped 1 -> 2 by OUT-01: `OwnershipCapabilityRef.file` is now root-relative, not absolute. */
export const OWNERSHIP_MODEL_SCHEMA_VERSION = 2

/**
 * Sentinel bucket for a capability/field with no documented owner at any level --
 * surfaced explicitly rather than silently omitted, so "nobody owns this" is as
 * visible as any real owner.
 */
// A shared public sentinel evaluated at module load: `""` fails the tests that
// assert the rendered `"(unowned)"` label, but Stryker perTest reports a false
// Survived for this covered static mutant (see project-mutation-100-drive memory).
// Stryker disable next-line StringLiteral
export const UNOWNED = "(unowned)"

/** Identifies one capability by where it's declared. */
export interface OwnershipCapabilityRef {
  /** Root-relative POSIX path of the file declaring this capability -- carried through verbatim from `CapabilityNode.file` (see `display-path.ts`). */
  readonly file: string
  /** The binding name the capability is exported as. */
  readonly exportName: string
}

/** Identifies one field, owned by a specific capability. */
export interface OwnershipFieldRef {
  /** The capability that owns this field. */
  readonly capability: OwnershipCapabilityRef
  /** The field's path within its capability. */
  readonly field: readonly string[]
}

/** One owner's row in the ownership matrix -- every capability and field they're accountable for. */
export interface OwnershipMatrixEntry {
  /** The owner's name, or `UNOWNED`. */
  readonly owner: string
  /** Capabilities this owner is accountable for at the capability level. */
  readonly capabilities: readonly OwnershipCapabilityRef[]
  /** Individual fields (on capabilities not wholly owned by this owner) they're accountable for. */
  readonly fields: readonly OwnershipFieldRef[]
}

/** `data-cap`'s Ownership Model: the owner -> {capabilities, fields} matrix, versioned for JSON publication. */
export interface OwnershipModel {
  /** Always `OWNERSHIP_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof OWNERSHIP_MODEL_SCHEMA_VERSION
  /** Every owner's row -- see `buildOwnershipMatrix`. */
  readonly entries: readonly OwnershipMatrixEntry[]
}

interface MutableBucket {
  readonly capabilities: Map<string, OwnershipCapabilityRef>
  readonly fields: OwnershipFieldRef[]
}

function capabilityKey(ref: OwnershipCapabilityRef): string {
  return `${ref.file}#${ref.exportName}`
}

function sortCapabilityRefs(refs: readonly OwnershipCapabilityRef[]): OwnershipCapabilityRef[] {
  return refs
    .slice()
    .sort((a, b) => a.file.localeCompare(b.file) || a.exportName.localeCompare(b.exportName))
}

function sortFieldRefs(refs: readonly OwnershipFieldRef[]): OwnershipFieldRef[] {
  const fieldKey = (ref: OwnershipFieldRef): string => ref.field.join(".")
  return refs
    .slice()
    .sort(
      (a, b) =>
        a.capability.file.localeCompare(b.capability.file) ||
        a.capability.exportName.localeCompare(b.capability.exportName) ||
        fieldKey(a).localeCompare(fieldKey(b)),
    )
}

/** Builds the owner -> {capabilities, fields} matrix. Every owner bucket is sorted deterministically; the `UNOWNED` bucket, if present, always sorts last. */
export function buildOwnershipMatrix(
  inventory: CapabilityInventory,
): readonly OwnershipMatrixEntry[] {
  const byOwner = new Map<string, MutableBucket>()

  function bucketFor(owner: string): MutableBucket {
    const existing = byOwner.get(owner)
    if (existing !== undefined) return existing
    const created: MutableBucket = { capabilities: new Map(), fields: [] }
    byOwner.set(owner, created)
    return created
  }

  for (const capability of inventory.capabilities) {
    const ref: OwnershipCapabilityRef = { file: capability.file, exportName: capability.exportName }
    bucketFor(capability.docs?.owner ?? UNOWNED).capabilities.set(capabilityKey(ref), ref)

    for (const field of capability.fields) {
      bucketFor(field.owner.value ?? UNOWNED).fields.push({ capability: ref, field: field.path })
    }
  }

  return [...byOwner.entries()]
    .map(([owner, bucket]) => ({
      owner,
      capabilities: sortCapabilityRefs([...bucket.capabilities.values()]),
      fields: sortFieldRefs(bucket.fields),
    }))
    .sort((a, b) => {
      // The UNOWNED bucket always sorts last (rank 1); named owners (rank 0)
      // sort alphabetically among themselves.
      const rank = (owner: string): number => (owner === UNOWNED ? 1 : 0)
      return rank(a.owner) - rank(b.owner) || a.owner.localeCompare(b.owner)
    })
}

/** Projects `inventory` into `data-cap`'s Ownership Model. */
export function buildOwnershipModel(inventory: CapabilityInventory): OwnershipModel {
  return { schemaVersion: OWNERSHIP_MODEL_SCHEMA_VERSION, entries: buildOwnershipMatrix(inventory) }
}
