/**
 * The fix for a real inefficiency: `litigation-evidence.ts` and
 * `audit-prep.ts` each used to call `computeDataArtifacts()` themselves --
 * two full discover -> link -> scan passes over the same source, every
 * `npm run reports`. ADR 0054's own "Alternatives considered" rejected
 * having reports read `docs/data.evidence.json` directly instead, on the
 * grounds that it would couple `npm run reports` to `npm run docs` having
 * already run, with no way to tell a *stale* cached file from a fresh one.
 *
 * That objection is answered by `data-cap` itself now: `getEvidenceModel()`
 * (`data-cap/build`) never trusts `docs/data.evidence.json` on
 * file presence alone -- it re-derives a cheap fingerprint of the exact same
 * source `computeDataArtifacts()` would read (a filesystem walk plus
 * `sha256` over raw bytes, no TypeScript Compiler API involvement at all,
 * plus the installed engine version) and only serves the cached file when
 * that fingerprint matches the one recorded when the file was written.
 *
 * This file used to hand-roll all of that. It no longer does: the mechanism
 * shipped into the package as `evidence-cache.ts` (EVD-01), and this example
 * is now a consumer of it rather than a parallel implementation that could
 * drift. What's left here is the part that is genuinely example-specific --
 * *where* this project keeps its evidence artifact, and which
 * `computeDataArtifacts()` options describe this project.
 *
 * On a cache miss (missing, stale, corrupt), `getEvidenceModel()` falls back
 * to a real `computeDataArtifacts()` call and reports why; this file logs
 * that reason out loud, so a CI log makes the fast vs. slow path visible
 * rather than hiding it. The `.fingerprint` sidecar is written by the
 * `data-cap` CLI itself whenever `--evidence` is passed (see `package.json`'s
 * own `docs` script), so there is exactly one place that boundary is
 * crossed, not two.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getEvidenceModel } from "data-cap/build"
import type { EvidenceModel, GetEvidenceModelOptions } from "data-cap/build"
// `./build` never imports `node:fs` (ADR 0058); a consumer running the
// generators from their own Node script hands in the published adapter.
import { nodeBuildFileSystem } from "data-cap/node"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Must match the `--evidence` path `package.json`'s own `docs` script passes
// to the `data-cap` CLI -- there is deliberately only one literal string for
// this path in the whole project; every other reference imports it from here.
export const EVIDENCE_PATH = path.join(root, "docs/data.evidence.json")

/** The exact `computeDataArtifacts()` options `litigation-evidence.ts`/`audit-prep.ts`/`npm run docs` all share. */
export const COMPUTE_OPTIONS: GetEvidenceModelOptions = {
  fs: nodeBuildFileSystem,
  root,
  include: ["src/**"],
  tsconfig: false as const,
  location: path.join(root, "src/generated/data.manifest.ts"),
  docs: path.join(root, "docs/DATA.md"),
  ownership: path.join(root, "docs/OWNERSHIP.md"),
  flow: path.join(root, "docs/flow"),
  // Both "where a real run writes the Evidence Model" and "where the cache
  // reads it from" -- one option, so the two can never point at different
  // files.
  evidence: EVIDENCE_PATH,
}

/**
 * The one entry point both report scripts call. Serves the cached, fully
 * fingerprint-verified `docs/data.evidence.json` when it's valid; otherwise
 * computes fresh (identical to what `npm run docs` itself runs) and says so.
 */
export async function getEvidence(): Promise<EvidenceModel> {
  const { evidence, source, missReason } = await getEvidenceModel(COMPUTE_OPTIONS)
  if (source === "miss") {
    console.error(
      `[evidence-cache] ${path.relative(root, EVIDENCE_PATH)}: ${missReason ?? "cache miss"} -- recomputing (run \`npm run docs\` to refresh the cache).`,
    )
  }
  return evidence
}
