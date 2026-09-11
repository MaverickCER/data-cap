/**
 * C9: the `--check` drift guard. Reuses C8's `computeDataArtifacts` so the
 * two can never disagree, diffs each computed artifact against what's
 * currently on disk, and writes nothing regardless of the outcome.
 */

import { computeDataArtifacts } from "./generate-data-artifacts.js"
import type { GenerateDataArtifactsOptions, ReportResult } from "./generate-data-artifacts.js"
import type { BuildFileSystem } from "./types.js"

/** What `checkArtifacts` found -- the full computed report, plus which of its artifacts are stale on disk. */
export interface CheckArtifactsResult {
  /** The full report this run would produce, had it been a real (non-`--check`) generation. */
  readonly result: ReportResult
  /** Paths that are missing or whose on-disk content doesn't match what this run would generate. */
  readonly stale: readonly string[]
}

/** On-disk content of `filePath`, or `""` when it is missing/unreadable -- an empty string never matches a real artifact's content, so it always reads as stale. */
async function readOnDisk(fs: BuildFileSystem, filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    // missing / unreadable -- an empty catch has no removable body
  }
  // Any value no real artifact's content can equal works here (a real artifact
  // is never empty), so the specific sentinel isn't behaviourally pinnable.
  // Stryker disable next-line StringLiteral
  return ""
}

/**
 * `EvidenceModel.provenance.generatedAt` is a live wall-clock stamp, fresh
 * on every run (OUT-06) -- comparing it byte-for-byte would report the
 * `--evidence` artifact stale on every single `--check`, forever, which
 * defeats the drift guard's whole purpose. Normalizing it to `""` on BOTH
 * sides compares everything else exactly, so a real content change is still
 * caught while a mere re-run is not. Deliberately narrow: only this one
 * property, only for the `--evidence` output path, and only for comparison
 * -- what actually gets written keeps the real timestamp.
 *
 * A file that isn't parseable JSON (a hand-written file occupying the
 * output path, a truncated write), or is JSON without a `provenance` object,
 * is returned unchanged -- so it compares exactly, and only the one live
 * timestamp is ever masked. Safe to run over every artifact: for anything but
 * the Evidence Model it is a no-op, which is why the caller does not special-
 * case the `--evidence` path.
 */
function normalizeForComparison(content: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    // not JSON -- compared raw; an empty catch has no removable body
  }
  if (typeof parsed !== "object" || parsed === null) return content
  const model: Record<string, unknown> = parsed as Record<string, unknown>
  const provenance: unknown = model.provenance
  // Bypassing (any variant of) this guard is a pure behavioral no-op, not a
  // real gap: JS's object-spread of `null`/`undefined`/a non-object
  // primitive never throws (`{...null}` and `{..."x"}` are both valid,
  // just spread nothing-or-index-properties), so the spread two lines down
  // still produces *some* valid JSON either way -- it just stops being the
  // one specific shape the doc comment above promises for a malformed
  // `provenance`. Since `write.content` (this function's OTHER argument at
  // every real call site) always comes from a genuine generation and
  // therefore always has a well-formed `provenance`, the two sides can only
  // ever disagree here when `onDisk`'s `provenance` is itself malformed --
  // and in that case `onDisk` was already going to compare unequal to a
  // freshly-generated `write.content` regardless of which branch masked its
  // (malformed-vs-absent) timestamp. Hand-verified: forcing every combination
  // of this guard's clauses and running the real suite passes unchanged.
  // Stryker disable next-line ConditionalExpression, LogicalOperator
  if (typeof provenance !== "object" || provenance === null) return content
  return JSON.stringify(
    {
      ...model,
      // The literal masked value itself is unpinnable the same way
      // `readIfExists`'s own sentinel above is: `write.content` and `onDisk`
      // are always masked with this SAME constant, so any value here keeps
      // them equal to each other when only the timestamp differs -- the
      // comparison never depends on which specific string is chosen.
      // Stryker disable next-line StringLiteral
      provenance: { ...(provenance as Record<string, unknown>), generatedAt: "" },
    },
    null,
    2,
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
