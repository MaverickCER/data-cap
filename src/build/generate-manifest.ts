/**
 * Renders `manifest.ts`'s deterministic file content -- C8's `--location`
 * output. This run's `ManifestSnapshot` and its diff against whatever
 * snapshot preceded it (`ManifestChangeReport`) are no longer computed here:
 * `generate-data-artifacts.ts` (the orchestrator) computes both once,
 * itself, via `buildManifestSnapshot`/`diffManifestSnapshots` directly --
 * independent of whether a `manifest.ts` file is even being generated at
 * all (F2) -- and threads the results straight through as plain inputs.
 * Pure -- takes an already-built `CapabilityInventory` plus already-computed
 * `snapshot`/`changes` as input; performs no discovery, linking, diffing, or
 * filesystem access itself, so the orchestrator's one-discover-pass/atomic-
 * write guarantee holds regardless of how many artifacts are requested in
 * the same run.
 */

import { findManifestExportCollisions, renderManifest } from "./manifest.js"
import type { ManifestChangeReport, ManifestSnapshot } from "./manifest-snapshot.js"
import type { CapabilityInventory } from "./inventory.js"
import type { ReportFinding } from "./findings.js"

/** Options for `generateManifest`. */
export interface GenerateManifestOptions {
  /** The inventory to render the manifest from. */
  readonly inventory: CapabilityInventory
  /** Where the manifest `.ts` file will be written -- used to compute relative import specifiers, not written to here. */
  readonly location: string
  /** Discovery root every `CapabilityNode.file` is relative to (OUT-01) -- needed to lift each capability back to a real absolute path before computing its import specifier from `location`'s own directory. */
  readonly root: string
  /** This run's own snapshot of `inventory` -- see `buildManifestSnapshot`. Computed by the caller, once, shared with whatever else in the same run needs it (e.g. citation-verification's own baseline). */
  readonly snapshot: ManifestSnapshot
  /** `snapshot` diffed against whatever snapshot preceded it -- see `diffManifestSnapshots`. Also computed by the caller; an all-added report on a first run. */
  readonly changes: ManifestChangeReport
}

/** The rendered manifest plus everything needed to persist and diff it against a future run. */
export interface GenerateManifestResult {
  /** Where this manifest is intended to be written. */
  readonly location: string
  /** The rendered `.ts` source. */
  readonly content: string
  /** The current inventory's snapshot -- persist this to enable "changes since last report" on the next run. */
  readonly snapshot: ManifestSnapshot
  /** The diff against `previousSnapshot`, or an all-added report on a first run. */
  readonly changes: ManifestChangeReport
  /** Manifest-specific findings (e.g. `MANIFEST_EXPORT_NAME_COLLISION`). */
  readonly findings: readonly ReportFinding[]
}

/** Renders the deterministic manifest `.ts` file -- pure, no filesystem access, no diffing (see this module's own doc comment). */
export function generateManifest(options: GenerateManifestOptions): GenerateManifestResult {
  const { inventory, location, root, snapshot, changes } = options

  const collisions = findManifestExportCollisions(inventory)
  const findings: ReportFinding[] = []
  for (const [exportName, files] of collisions) {
    findings.push({
      code: "MANIFEST_EXPORT_NAME_COLLISION",
      family: "structural",
      severity: "error",
      message: `Manifest export name "${exportName}" is claimed by ${files.length} different active capability files (${files.join(", ")}) -- the generated manifest cannot re-export both under the same identifier. Rename one, or mark one inactive.`,
    })
  }

  return {
    location,
    content: renderManifest(inventory, location, root),
    snapshot,
    changes,
    findings,
  }
}
