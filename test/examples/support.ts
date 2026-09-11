import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Shared, non-test plumbing for every `test/examples/<name>.test.ts` file --
 * kept out of the `*.test.ts` naming so vitest never tries to run it
 * directly. Each example is its own npm project with its own node_modules,
 * installed by CI's `examples` job (.github/workflows/ci.yml), not by the
 * root `npm ci`. Every helper below skips gracefully rather than failing
 * when that example's node_modules isn't present -- e.g. a local run that
 * hasn't gone through the per-example install steps -- via `isInstalled()`,
 * which every per-example test file gates on.
 *
 * Unlike env-cap's examples (which are primarily documentation/codegen
 * demonstrations, golden-compared against generated Markdown/manifests),
 * data-cap's examples exist first as end-to-end regression tests of real
 * runtime behavior against the actual built, installed package, and second
 * as adoption patterns a reader can copy -- see examples/README.md. Each
 * example's own `src/main.ts` performs real `node:assert/strict` invariant
 * checks -- a thrown assertion is a genuine non-zero-exit regression
 * signal. A silent behavior change that doesn't trip an assertion but does
 * change data-cap's own generated output is instead caught by diffing that
 * real, committed documentation (see each example's own `check` script,
 * run via `runScript`), not by a separate synthetic `output.json` summary
 * this package doesn't itself produce -- see this session's own removal of
 * that mechanism for why.
 */

export const examplesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../examples",
)

export function isInstalled(exampleName: string): boolean {
  return existsSync(path.join(examplesRoot, exampleName, "node_modules"))
}

interface RunResult {
  readonly stdout: string
  readonly stderr: string
  readonly status: number | null
}

/**
 * `spawnSync`, not `execFileSync` -- deliberately. `execFileSync` only
 * returns captured output on a *throw* (a non-zero exit); on success it
 * returns stdout alone and silently discards stderr. `spawnSync` always
 * returns both streams, regardless of exit code, so callers below can merge
 * them uniformly either way.
 */
function runNpmScript(exampleName: string, script: string): RunResult {
  const result = spawnSync("npm", ["run", "--silent", script], {
    cwd: path.join(examplesRoot, exampleName),
    encoding: "utf8",
  })
  return { stdout: result.stdout, stderr: result.stderr, status: result.status }
}

/** Runs any npm script expected to succeed and returns its combined stdout+stderr. Fails the test itself if the script exits non-zero. */
export function runScript(exampleName: string, script: string): string {
  const { stdout, stderr, status } = runNpmScript(exampleName, script)
  if (status !== 0) {
    throw new Error(
      `Expected "npm run ${script}" in ${exampleName} to succeed, but it exited ${String(status)}.\n${stdout}${stderr}`,
    )
  }
  return `${stdout}${stderr}`
}

/** Runs `npm start` (every example's own real-assertions script) and returns its combined stdout+stderr. */
export function runStart(exampleName: string): string {
  return runScript(exampleName, "start")
}

/**
 * Runs `npm run check` -- every example's own `data-cap --check` invocation
 * against its own real, committed, generated documentation (manifest/DATA.md/
 * OWNERSHIP.md/flow diagrams, or an example-specific report script). Fails
 * the test if anything is missing or stale, so a silent output change that
 * doesn't trip `runStart`'s own assertions still surfaces -- the replacement
 * for the old `output.json`/`expected/output.json` diff: this diffs
 * data-cap's own real output, not a synthetic summary invented for testing.
 */
export function checkDocsFresh(exampleName: string): void {
  runScript(exampleName, "check")
}
