/**
 * C9: the `--check` drift guard. Reuses C8's `computeDataArtifacts` so the
 * two can never disagree, diffs each computed artifact against what's
 * currently on disk, and writes nothing regardless of the outcome.
 */

import { computeDataArtifacts } from "./generate-data-artifacts.js"
import type { GenerateDataArtifactsOptions, ReportResult } from "./generate-data-artifacts.js"
import type { BuildFileSystem } from "./types.js"

/** What `checkArtifacts` found: the full computed report, plus which of its artifacts are stale on disk. */
export interface CheckArtifactsResult {
  /** The full report this run would produce, had it been a real (non-`--check`) generation. */
  readonly result: ReportResult
  /** Paths that are missing or whose on-disk content doesn't match what this run would generate. */
  readonly stale: readonly string[]
}

/** On-disk content of `filePath`, or `""` when it is missing/unreadable: an empty string never matches a real artifact's content, so it always reads as stale. */
/** @internal Exported for direct unit coverage. */
export async function readOnDisk(fs: BuildFileSystem, filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    // missing / unreadable: an empty catch has no removable body.
  }
  // Any value no real artifact's content can equal works here (a real artifact
  // is never empty), so the specific sentinel isn't behaviourally pinnable.
  return ""
}

/**
 * `EvidenceModel.provenance.generatedAt` is a live wall-clock stamp, fresh
 * on every run: comparing it byte-for-byte would report the
 * `--evidence` artifact stale on every single `--check`, forever, which
 * defeats the drift guard's whole purpose. Normalizing it to `""` on BOTH
 * sides compares everything else exactly, so a real content change is still
 * caught while a mere re-run is not. Deliberately narrow: only this one
 * property, only for the `--evidence` output path, and only for comparison:
 * what actually gets written keeps the real timestamp.
 *
 * A file that isn't parseable JSON (a hand-written file occupying the
 * output path, a truncated write), or is JSON without a `provenance` object,
 * is returned unchanged: so it compares exactly, and only the one live
 * timestamp is ever masked. Safe to run over every artifact: for anything but
 * the Evidence Model it is a no-op, which is why the caller does not special-
 * case the `--evidence` path.
 *
 * `change` (populated whenever `--evidence` is requested, not only
 * alongside `--location`) gets the identical treatment, for the identical
 * reason. It describes "what's different from whatever manifest snapshot
 * was on disk the moment THIS run computed it". That is inherently not
 * reproducible by a second computation. By the time this comparison
 * re-derives it, the snapshot sidecar the first run already wrote *is* the
 * new baseline, so the diff naturally comes back empty against itself. This
 * isn't drift; it's `change`'s own definition: the same masking env-cap's
 * `evidence-snapshot.ts` already established for its own equivalent field
 * (`normalizeEvidenceSnapshotForComparison`). A real change anywhere else in
 * the model (including `capability` itself) is still caught.
 */
/** @internal Exported for direct unit coverage. */
export function normalizeForComparison(content: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    // not JSON: compared raw apart from the catalog's change section; an empty catch has no removable body.
  }
  if (typeof parsed !== "object" || parsed === null) return maskChangesSection(content)
  const model: Record<string, unknown> = parsed as Record<string, unknown>
  const provenance: unknown = model["provenance"]
  // Bypassing (any variant of) this guard is a pure behavioral no-op, not a
  // real gap. JS's object-spread of `null`/`undefined`/a non-object
  // primitive never throws (`{...null}` and `{..."x"}` are both valid,
  // they spread nothing or index properties). So the spread two lines down
  // still produces *some* valid JSON either way. It only stops being the
  // one specific shape the doc comment above promises for a malformed
  // `provenance`. `write.content` (this function's OTHER argument at every
  // real call site) always comes from a genuine generation. It therefore
  // always has a well-formed `provenance`. So the two sides can only ever
  // disagree here when `onDisk`'s `provenance` is itself malformed. In that
  // case `onDisk` was already going to compare unequal to a
  // freshly-generated `write.content` regardless of which branch masked its
  // (malformed-vs-absent) timestamp. Hand-verified: forcing every combination
  // of this guard's clauses and running the real suite passes unchanged.
  if (typeof provenance !== "object" || provenance === null) return content
  const change: unknown = model["change"]
  // Same defensive shape as the provenance guard directly above, and for the
  // same reason. Masking `change` unconditionally (regardless of its actual
  // presence/shape on disk) would let a missing or reshaped `change` field
  // hide behind the mask whenever every OTHER field happened to already
  // match. An omitted or malformed on-disk `change` must stay
  // distinguishable from a genuine generation's, not silently normalized
  // away. `write.content` (this function's other argument at every real
  // call site) always has a well-formed `change` object once `provenance`
  // does. Change-detection runs whenever `--evidence` does, the same run
  // that stamps `provenance`. So bypassing this guard is only ever
  // reachable for a malformed `onDisk`. That then correctly compares
  // unequal via the whole raw document, the same tradeoff the provenance
  // guard above already accepts.
  if (typeof change !== "object" || change === null) return content
  return JSON.stringify(
    {
      ...model,
      // The literal masked value itself is unpinnable the same way
      // `readIfExists`'s own sentinel above is. `write.content` and `onDisk`
      // are always masked with this SAME constant. So any value here keeps
      // them equal to each other when only the timestamp differs. The
      // comparison never depends on which specific string is chosen.
      provenance: { ...(provenance as Record<string, unknown>), generatedAt: "" },
      change: null,
    },
    null,
    2,
  )
}

/**
 * The documentation catalog's "Changes since last report" section, up to the next `## ` heading.
 * It lists what differs from the snapshot on disk when the catalog was written. Once that run
 * writes the new snapshot, a second computation finds no changes, so the section is masked for the
 * same reason as the Evidence Model's `change` above. Every other line still compares exactly.
 *
 * @internal Exported for direct unit coverage. The pattern is written inside the function, not as a
 * module constant, so that mutation testing credits it to the tests that call this function.
 */
export function maskChangesSection(content: string): string {
  return content.replace(
    /^## Changes since last report\n[\s\S]*?(?=^## )/m,
    "## Changes since last report\n\n",
  )
}

/** Computes every requested artifact and reports which ones are missing or stale, without writing anything. */
export async function checkArtifacts(
  options: GenerateDataArtifactsOptions,
): Promise<CheckArtifactsResult> {
  const { result, writes } = await computeDataArtifacts(options)

  const stale: string[] = []
  for (const write of writes) {
    const onDisk = await readOnDisk(options.fs, write.path)
    if (normalizeForComparison(write.content) !== normalizeForComparison(onDisk)) {
      stale.push(write.path)
    }
  }

  return { result, stale }
}
