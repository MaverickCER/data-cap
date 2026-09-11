/**
 * A persisted, JSON-serializable snapshot of the capability inventory,
 * diffed run-over-run to compute "changes since last report." The
 * generated manifest `.ts` file itself carries no metadata (just
 * re-exports) -- this is the sidecar that makes change detection possible
 * without re-parsing the manifest's own generated source. Pure -- no
 * filesystem access; the caller reads/writes the snapshot JSON.
 */

import type { CapabilityInventory, CapabilityNode } from "./inventory.js"
import type { SourceLocation } from "./source-position.js"

/** One `dynamicAccess` citation's integrity snapshot -- see `ManifestSnapshotCapability.citationSnapshots`. */
export interface CitationSnapshotEntry extends SourceLocation {
  /** Whole-file SHA-256 (hex) of the cited file's content, at the moment this citation was last confirmed to exist. An integrity signal only -- "this file hasn't visibly changed since the citation was written" -- never proof the citation's own underlying claim is semantically correct (see ADR 0053). */
  readonly hash: string
}

/** One capability's diffable shape at snapshot time -- field/operation names only, never their runtime values. */
export interface ManifestSnapshotCapability {
  /** Root-relative POSIX path of the file declaring this capability -- copied verbatim from `CapabilityNode.file` (OUT-01, see `display-path.ts`), which is what makes a committed snapshot diffable between two machines at all. */
  readonly file: string
  /** The binding name the capability is exported as. */
  readonly exportName: string
  /** Whether the capability was active at snapshot time. */
  readonly active: boolean
  /** Resolved owner at snapshot time, if any. */
  readonly owner: string | undefined
  /** Sorted, dot-joined field paths. */
  readonly fields: readonly string[]
  /** Sorted getter names. */
  readonly getters: readonly string[]
  /** Sorted mutator names. */
  readonly mutators: readonly string[]
  /** Sorted subscription names. */
  readonly subscriptions: readonly string[]
  /** Per-field citation integrity snapshots for declared `evidence.fields[key].dynamicAccess` entries, keyed by field name -- only present for a field that declares at least one citation that resolved to a real file at snapshot time (see `citation-verification.ts`). */
  readonly citationSnapshots?: Readonly<Record<string, readonly CitationSnapshotEntry[]>>
}

/** A persisted, JSON-serializable snapshot of the inventory at one point in time -- see `buildManifestSnapshot`. */
export interface ManifestSnapshot {
  /** Bumped only on a breaking change to this snapshot's own shape. Bumped 1 -> 2 by OUT-01: every capability key (`file#exportName`) is now built from a root-relative `file`, so a v1 snapshot's keys can never match a v2 run's. */
  readonly snapshotSchemaVersion: 2
  /** Every capability, active or not, at snapshot time. */
  readonly capabilities: readonly ManifestSnapshotCapability[]
}

function capabilityKey(
  capability: Pick<ManifestSnapshotCapability, "file" | "exportName">,
): string {
  return `${capability.file}#${capability.exportName}`
}

function toSnapshotCapability(capability: CapabilityNode): ManifestSnapshotCapability {
  return {
    file: capability.file,
    exportName: capability.exportName,
    active: capability.active,
    owner: capability.docs?.owner,
    fields: capability.fields.map((f) => f.path.join(".")).sort(),
    getters: capability.getters.map((op) => op.name).sort(),
    mutators: capability.mutators.map((op) => op.name).sort(),
    subscriptions: capability.subscriptions.map((op) => op.name).sort(),
  }
}

/** Builds a deterministic snapshot of the current inventory -- every capability included, active or not (so deactivating a capability is a detectable, diffable change, not a silent disappearance). */
export function buildManifestSnapshot(inventory: CapabilityInventory): ManifestSnapshot {
  const capabilities = inventory.capabilities
    .map(toSnapshotCapability)
    .sort((a, b) => capabilityKey(a).localeCompare(capabilityKey(b)))
  return { snapshotSchemaVersion: 2, capabilities }
}

/** The structured added/removed field-name diff for one changed capability. */
export interface ManifestFieldDiff {
  /** Field names present now but not in the previous snapshot, sorted. */
  readonly added: readonly string[]
  /** Field names present in the previous snapshot but not now, sorted. */
  readonly removed: readonly string[]
}

/** One capability whose snapshot shape changed between two runs. */
export interface ManifestCapabilityUpdate {
  /** The capability key (`file#exportName`) that changed. */
  readonly capability: string
  /** Human-readable description of each individual change (e.g. `"owner changed from ... to ..."`). */
  readonly changes: readonly string[]
  /**
   * The same field-level diff `changes` describes in prose, as data (EVD-05).
   * Added so `ChangeModel`'s rename correlation has something to match
   * against without re-parsing a human-readable sentence -- a report
   * deriving structure back out of its own prose is exactly the kind of
   * fragility this codebase avoids. `changes` is unaffected and still reads
   * the same.
   */
  readonly fields: ManifestFieldDiff
}

/** The diff between two `ManifestSnapshot`s, in a fixed Added/Removed/Updated shape. */
export interface ManifestChangeReport {
  /** Capability keys present in the new snapshot but not the previous one. */
  readonly addedCapabilities: readonly string[]
  /** Capability keys present in the previous snapshot but not the new one. */
  readonly removedCapabilities: readonly string[]
  /** Capability keys present in both snapshots whose shape changed. */
  readonly updatedCapabilities: readonly ManifestCapabilityUpdate[]
}

/** The raw added/removed split between two sorted name lists -- the one place that comparison happens, so the prose and the structured `fields` diff can never disagree. */
function splitStringArrays(
  previous: readonly string[],
  current: readonly string[],
): { added: string[]; removed: string[] } {
  const previousSet = new Set(previous)
  const currentSet = new Set(current)
  return {
    added: current.filter((item) => !previousSet.has(item)),
    removed: previous.filter((item) => !currentSet.has(item)),
  }
}

function diffStringArrays(previous: readonly string[], current: readonly string[]): string[] {
  const changes: string[] = []
  const { added, removed } = splitStringArrays(previous, current)
  if (added.length > 0) changes.push(`added ${added.join(", ")}`)
  if (removed.length > 0) changes.push(`removed ${removed.join(", ")}`)
  return changes
}

function diffCapability(
  previous: ManifestSnapshotCapability,
  current: ManifestSnapshotCapability,
): readonly string[] {
  const changes: string[] = []
  if (previous.active !== current.active) {
    changes.push(current.active ? "became active" : "became inactive")
  }
  if (previous.owner !== current.owner) {
    changes.push(`owner changed from ${previous.owner ?? "(none)"} to ${current.owner ?? "(none)"}`)
  }
  const fieldChanges = diffStringArrays(previous.fields, current.fields)
  if (fieldChanges.length > 0) changes.push(`fields: ${fieldChanges.join("; ")}`)
  const getterChanges = diffStringArrays(previous.getters, current.getters)
  if (getterChanges.length > 0) changes.push(`getters: ${getterChanges.join("; ")}`)
  const mutatorChanges = diffStringArrays(previous.mutators, current.mutators)
  if (mutatorChanges.length > 0) changes.push(`mutators: ${mutatorChanges.join("; ")}`)
  const subscriptionChanges = diffStringArrays(previous.subscriptions, current.subscriptions)
  if (subscriptionChanges.length > 0)
    changes.push(`subscriptions: ${subscriptionChanges.join("; ")}`)
  return changes
}

/**
 * Diffs two snapshots into a change report. `previous === undefined` means
 * no prior snapshot exists (a first run) -- every current capability is
 * reported `added`, never guessed to be "unchanged."
 */
export function diffManifestSnapshots(
  previous: ManifestSnapshot | undefined,
  current: ManifestSnapshot,
): ManifestChangeReport {
  const previousByKey = new Map((previous?.capabilities ?? []).map((c) => [capabilityKey(c), c]))
  const currentByKey = new Map(current.capabilities.map((c) => [capabilityKey(c), c]))

  const addedCapabilities: string[] = []
  const updatedCapabilities: ManifestCapabilityUpdate[] = []
  for (const [key, capability] of currentByKey) {
    const previousCapability = previousByKey.get(key)
    if (previousCapability === undefined) {
      addedCapabilities.push(key)
      continue
    }
    const changes = diffCapability(previousCapability, capability)
    if (changes.length > 0) {
      // `splitStringArrays` filters two already-sorted name lists (the snapshot
      // contract guarantees `fields` is sorted), and `.filter()` preserves order,
      // so `added`/`removed` are already sorted -- same assumption the prose diff
      // in `diffStringArrays` relies on when it `.join()`s without re-sorting.
      const { added, removed } = splitStringArrays(previousCapability.fields, capability.fields)
      updatedCapabilities.push({ capability: key, changes, fields: { added, removed } })
    }
  }

  const removedCapabilities = [...previousByKey.keys()].filter((key) => !currentByKey.has(key))

  return {
    addedCapabilities: addedCapabilities.sort(),
    removedCapabilities: removedCapabilities.sort(),
    updatedCapabilities: updatedCapabilities.sort((a, b) =>
      a.capability.localeCompare(b.capability),
    ),
  }
}
