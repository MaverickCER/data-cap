/**
 * `data-cap`'s Change Model (ADR 0050) -- wraps `manifest-snapshot.ts`'s
 * already-versioned, already-persisted `ManifestChangeReport`, adding one
 * genuinely new thing: a blast-radius index answering "if this capability's
 * shape changed, which in-repo files are known to consume it right now."
 * Computed by combining the diff (`addedCapabilities`/`updatedCapabilities`)
 * with `dependency-projections.ts`'s `groupEdgesByCapability` (ADR 0056) --
 * never re-scanning.
 *
 * Blast radius only ever covers capabilities present in the *current*
 * inventory (`addedCapabilities` and `updatedCapabilities`): a
 * `removedCapabilities` entry has no corresponding Dependency Model row to
 * look up, since it's no longer part of what was just discovered/scanned --
 * its prior consumers were never captured in the snapshot, and inventing
 * them would misrepresent this as more than it is.
 */

import type { DependencyModel } from "./dependency-model.js"
import { groupEdgesByCapability } from "./dependency-projections.js"
import type { ManifestChangeReport } from "./manifest-snapshot.js"

/**
 * Bump only when a reader could misinterpret the shape -- same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: every capability key is now built from a root-relative `file`
 * (OUT-01), and `renamedFields` was added (EVD-05).
 */
export const CHANGE_MODEL_SCHEMA_VERSION = 2

/** One added-field/removed-field pair correlated into a single rename via the current declaration's `renamedFrom` (EVD-05). */
export interface RenamedField {
  /** The owning capability's key (`file#exportName`) -- a rename never crosses capabilities. */
  readonly capability: string
  /** The field's name before the rename -- matches a `removed` entry in that capability's own field diff. */
  readonly previousName: string
  /** The field's name after the rename -- matches an `added` entry in the same diff. */
  readonly currentName: string
}

/** One changed capability's known current consumers. */
export interface BlastRadiusEntry {
  /** The capability key (`file#exportName`) -- matches `ManifestChangeReport`'s own key convention. */
  readonly capability: string
  /** Distinct consuming files known (from Dependency Model) to depend on this capability right now, sorted. */
  readonly consumers: readonly string[]
}

/** `data-cap`'s Change Model: the manifest diff, plus an optional blast-radius index. */
export interface ChangeModel {
  /** Always `CHANGE_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof CHANGE_MODEL_SCHEMA_VERSION
  /** The underlying manifest diff -- see `diffManifestSnapshots`. */
  readonly manifest: ManifestChangeReport
  /** One entry per added/updated capability, or `undefined` when no `DependencyModel` was supplied -- an optional layer, matching `--ownership`/`--flow`'s existing opt-in cost model (the usage scan isn't free). */
  readonly blastRadius: readonly BlastRadiusEntry[] | undefined
  /**
   * Every added-field/removed-field pair this run's currently-declared
   * `renamedFrom` values correlate into a single rename, sorted by
   * capability key then current name.
   *
   * @remarks
   * Only ever populated from an *authored* `FieldDocs.renamedFrom` -- never
   * guessed from name similarity, which is the same "prove it, never infer
   * it" rule AGENTS.md invariant 11 applies to every other derived fact
   * here. An additive view, not a filter: `manifest.updatedCapabilities`'s
   * own `fields.added`/`fields.removed` still list a correlated rename's two
   * halves separately, so a consumer that doesn't know about this field
   * loses nothing.
   *
   * Field-level only. `CapabilityDocs` deliberately has no `renamedFrom`
   * (see `core/document.ts`), so there is no `renamedCapabilities` -- a
   * capability-level rename has no authored field to correlate from, and
   * guessing one from a moved file would be exactly the inference this
   * model refuses to make.
   */
  readonly renamedFields: readonly RenamedField[]
}

/** The minimal capability shape `buildChangeModel` reads: identity for blast radius, plus each field's own declared `renamedFrom` for rename correlation. `CapabilityNode` satisfies it structurally. */
export interface ChangeModelCapability {
  readonly file: string
  readonly exportName: string
  readonly fields?: readonly {
    readonly path: readonly string[]
    readonly docs?: { readonly renamedFrom?: string } | undefined
  }[]
}

/**
 * Correlates each capability's added/removed field pair into one rename,
 * gated entirely on the *current* declaration's `renamedFrom`.
 *
 * Both halves must actually be present in this run's diff: a `renamedFrom`
 * naming a field that was never removed (a stale annotation left behind
 * after the rename already landed in an earlier run) correlates nothing, and
 * neither does one whose own field isn't newly added. That keeps this a
 * report about *this run's* diff rather than a running commentary on every
 * `renamedFrom` ever authored.
 */
function buildRenamedFields(
  manifest: ManifestChangeReport,
  capabilities: readonly ChangeModelCapability[],
): readonly RenamedField[] {
  const diffsByCapability = new Map(
    manifest.updatedCapabilities.map((update) => [update.capability, update.fields]),
  )

  const renames: RenamedField[] = []
  for (const capability of capabilities) {
    const key = `${capability.file}#${capability.exportName}`
    const diff = diffsByCapability.get(key)
    if (diff === undefined) continue

    // Drive off the diff's own newly-added field names (each a real `string`),
    // then look back to the declaring field for its `renamedFrom` -- so the
    // only condition left is "the previous name was also removed this run".
    for (const currentName of diff.added) {
      const declaringField = (capability.fields ?? []).find((f) => f.path[0] === currentName)
      if (declaringField?.docs?.renamedFrom === undefined) continue
      const previousName = declaringField.docs.renamedFrom
      if (diff.removed.some((removedName) => removedName === previousName)) {
        renames.push({ capability: key, previousName, currentName })
      }
    }
  }

  return renames.sort(
    (a, b) =>
      a.capability.localeCompare(b.capability) || a.currentName.localeCompare(b.currentName),
  )
}

function buildBlastRadius(
  manifest: ManifestChangeReport,
  capabilities: readonly ChangeModelCapability[],
  dependencyModel: DependencyModel,
): readonly BlastRadiusEntry[] {
  const consumersByCapability = new Map(
    groupEdgesByCapability(capabilities, dependencyModel.edges).map((entry) => [
      `${entry.capability.file}#${entry.capability.exportName}`,
      [...new Set(entry.edges.map((edge) => edge.from))].sort(),
    ]),
  )
  const changedKeys = [
    ...manifest.addedCapabilities,
    ...manifest.updatedCapabilities.map((u) => u.capability),
  ].sort()
  return changedKeys.map((capability) => ({
    capability,
    consumers: consumersByCapability.get(capability) ?? [],
  }))
}

/**
 * Projects a manifest diff (optionally combined with the current run's
 * Dependency Model) into `data-cap`'s Change Model. Pure -- takes
 * already-computed inputs, no filesystem access. `capabilities` is only
 * consulted when `dependencyModel` is supplied (it's what
 * `groupEdgesByCapability` needs to find a changed capability's current
 * consumers).
 */
export function buildChangeModel(
  manifest: ManifestChangeReport,
  capabilities: readonly ChangeModelCapability[],
  dependencyModel?: DependencyModel,
): ChangeModel {
  return {
    schemaVersion: CHANGE_MODEL_SCHEMA_VERSION,
    manifest,
    blastRadius:
      dependencyModel !== undefined
        ? buildBlastRadius(manifest, capabilities, dependencyModel)
        : undefined,
    // Unlike `blastRadius`, never gated on a Dependency Model: rename
    // correlation reads only the diff and the current declarations, both of
    // which every run already has.
    renamedFields: buildRenamedFields(manifest, capabilities),
  }
}
