/**
 * The one place the example runs data-cap: discovery, the flow pass, the
 * recorded observations. Everything else -- the explorer, the standards
 * exports, the checks -- reads the evidence this produces and nothing else.
 *
 * `generatedAt` and `commit` are fixed on purpose. The evidence is committed and
 * `npm run check` diffs it byte for byte, so it must not change when the clock
 * does. A real project stamps the real time and commit.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { computeDataArtifacts } from "data-cap/build"
import type { EvidenceModel, ReportResult } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"
import type { ObservationEvent } from "data-cap/observe"

export const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export const GENERATED_AT = new Date("2026-01-01T00:00:00.000Z")
export const COMMIT = "0000000000000000000000000000000000000000"

/** Maps a policy rule to the controls it is evidence for. Supplied by whoever owns the control catalog; data-cap never infers it. */
export const CONTROLS: Readonly<Record<string, readonly string[]>> = {
  "userData/no-password-to-client": ["ac-4", "sc-28"],
  "userData/no-role-to-log": ["au-3"],
}

export interface PipelineOptions {
  readonly observations?: readonly ObservationEvent[]
  /** Files (root-relative globs) to leave out, for building a "before" revision to compare against. */
  readonly exclude?: readonly string[]
}

/** Runs the analysis. A violated policy is a blocking finding by design; the result is returned either way so it can be inspected. */
export async function runPipeline(options: PipelineOptions = {}): Promise<ReportResult> {
  const { result } = await computeDataArtifacts({
    fs: nodeBuildFileSystem,
    root: exampleRoot,
    include: ["src/features/**", "src/app/**"],
    ...(options.exclude === undefined ? {} : { exclude: [...options.exclude] }),
    tsconfig: false,
    flowEvidence: true,
    ...(options.observations === undefined ? {} : { observations: [...options.observations] }),
    generatedAt: GENERATED_AT,
    commit: COMMIT,
  })
  return result
}

export type { EvidenceModel }
