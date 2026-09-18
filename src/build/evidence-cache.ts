/**
 * A fast, honest read path for the persisted Evidence Model artifact -- for
 * a report/projection script, a CI step, or any consumer that just wants the
 * current `EvidenceModel` without paying a full `computeDataArtifacts()`
 * recompute (discovery, cross-file linking, the usage-scan AST pass, every
 * model build) on each invocation, and without ever risking silently-stale
 * data.
 *
 * The mechanism: a cheap content fingerprint, computed from each file's
 * UTF-8 text with zero TypeScript Compiler API involvement, lets a caller prove
 * "nothing relevant to evidence generation has changed since this file was
 * last written" before trusting it. That is precisely the objection ADR
 * 0054 raised against letting reports read `docs/data.evidence.json`
 * directly -- "no way to tell a stale cached file from a fresh one" -- and
 * it is answered here rather than ignored.
 *
 * Deliberately not an mtime check: a checkout, a rebase, or a `touch` all
 * bump a timestamp with no real edit, and content is the only thing that
 * actually invalidates a cached evidence artifact.
 */

import path from "node:path"
import { EVIDENCE_MODEL_SCHEMA_VERSION } from "./evidence-model.js"
import type { EvidenceModel } from "./evidence-model.js"
import { computeSourceFingerprint, fingerprintPathFor } from "./evidence-fingerprint.js"
import { computeDataArtifacts } from "./generate-data-artifacts.js"
import type { GenerateDataArtifactsOptions } from "./generate-data-artifacts.js"
import type { BuildFileSystem } from "./types.js"

// The fingerprint primitives moved to ./evidence-fingerprint.ts to break the
// evidence-cache <-> generate-data-artifacts import cycle; re-exported here so
// existing importers (src/build/index.ts, test/build/evidence-cache.test.ts) are
// unaffected.
export {
  computeSourceFingerprint,
  fingerprintPathFor,
  writeEvidenceFingerprint,
} from "./evidence-fingerprint.js"
export type { ComputeSourceFingerprintOptions } from "./evidence-fingerprint.js"

/**
 * Options for {@link getEvidenceModel} -- every `computeDataArtifacts()`
 * option, with `evidence` narrowed to required.
 *
 * Deliberately reuses `evidence` rather than introducing a separate
 * `location` for "where the cached artifact lives": that path and the path a
 * real run writes its Evidence Model to are the same file by definition, and
 * two option names for one file could disagree. (`location` was already
 * taken by the *manifest* output path on the base options -- reusing it here
 * would have quietly meant two different things depending on which function
 * read it.) Required, because there is no honest default `data-cap` could
 * guess at for where a project keeps this.
 */
export interface GetEvidenceModelOptions extends GenerateDataArtifactsOptions {
  /** Where the persisted evidence artifact (and its `.fingerprint` sidecar) live, e.g. `docs/data.evidence.json`. Resolved against `root` when relative. */
  readonly evidence: string
}

/** The result of {@link getEvidenceModel}. */
export interface GetEvidenceModelResult {
  /** The Evidence Model -- read from the cached artifact on a hit, freshly computed on a miss. Identical in shape either way. */
  readonly evidence: EvidenceModel
  /** `"hit"` -- the persisted artifact's fingerprint matched current source; read from disk, no recompute. `"miss"` -- a real `computeDataArtifacts()` call ran. */
  readonly source: "hit" | "miss"
  /** Set only when `source === "miss"` -- why the cache wasn't trusted, for a caller that wants to log it. Never a silent fallback. */
  readonly missReason: string | undefined
}

type ReadResult =
  | { readonly evidence: EvidenceModel; readonly problem: undefined }
  | { readonly evidence: undefined; readonly problem: string }

async function readEvidenceArtifact(
  fs: BuildFileSystem,
  evidencePath: string,
): Promise<ReadResult> {
  let raw: string
  try {
    raw = await fs.readFile(evidencePath, "utf8")
  } catch {
    return { evidence: undefined, problem: `no evidence artifact found at ${evidencePath}` }
  }

  let parsed: unknown
  try {
    if (raw.trim().length === 0) {
      return { evidence: undefined, problem: `evidence artifact at ${evidencePath} is empty` }
    }
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      evidence: undefined,
      problem: `evidence artifact at ${evidencePath} could not be parsed as JSON (${error instanceof Error ? error.message : String(error)})`,
    }
  }

  // A matching fingerprint proves the *source* is unchanged; it says nothing
  // about the artifact itself being the shape this version of `data-cap`
  // understands (a hand-edit, a partial write, a file from a much older
  // release with a matching-by-luck sidecar). Checked separately for that
  // reason.
  const version = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion
  if (version !== EVIDENCE_MODEL_SCHEMA_VERSION) {
    return {
      evidence: undefined,
      problem: `evidence artifact at ${evidencePath} has an unrecognized schemaVersion (${JSON.stringify(version)}; expected ${String(EVIDENCE_MODEL_SCHEMA_VERSION)})`,
    }
  }
  return { evidence: parsed as EvidenceModel, problem: undefined }
}

/**
 * Trusts the persisted evidence artifact at `options.location` only when its
 * paired `.fingerprint` sidecar matches a freshly (cheaply) computed
 * {@link computeSourceFingerprint} -- never on file presence alone, never on
 * a timestamp. On any mismatch (stale fingerprint, missing/corrupt evidence
 * file, no sidecar at all, an unrecognized `schemaVersion`), falls back to a
 * real `computeDataArtifacts()` call: never hard-fails, never silently
 * serves data that might be stale.
 *
 * @remarks
 * Never writes anything. A cache miss here does not self-heal the cache --
 * only an explicit generation run (`generateDataArtifacts()` with
 * `evidence`) refreshes the artifact and its fingerprint together, so "when
 * was this last regenerated" stays under explicit control rather than
 * becoming an implicit side effect of a read. Two callers hitting the same
 * stale cache both recompute independently; neither one's recompute changes
 * what the other reads.
 */
export async function getEvidenceModel(
  options: GetEvidenceModelOptions,
): Promise<GetEvidenceModelResult> {
  const root = options.root
  const evidencePath = path.resolve(root, options.evidence)

  const recompute = async (missReason: string): Promise<GetEvidenceModelResult> => {
    const { result } = await computeDataArtifacts(options)
    return { evidence: result.evidence, source: "miss", missReason }
  }

  let currentFingerprint: string
  try {
    currentFingerprint = await computeSourceFingerprint({
      fs: options.fs,
      root,
      ...(options.include !== undefined ? { include: options.include } : {}),
      ...(options.exclude !== undefined ? { exclude: options.exclude } : {}),
      ...(options.packages !== undefined ? { packages: options.packages } : {}),
    })
  } catch (error) {
    return recompute(
      `could not compute a source fingerprint (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  let storedFingerprint: string
  try {
    storedFingerprint = (await options.fs.readFile(fingerprintPathFor(evidencePath), "utf8")).trim()
  } catch {
    return recompute(`no fingerprint sidecar found at ${fingerprintPathFor(evidencePath)}`)
  }

  if (storedFingerprint !== currentFingerprint) {
    return recompute(
      "source fingerprint changed since the persisted evidence artifact was last generated",
    )
  }

  const read = await readEvidenceArtifact(options.fs, evidencePath)
  if (read.evidence === undefined) return recompute(read.problem)

  return { evidence: read.evidence, source: "hit", missReason: undefined }
}
