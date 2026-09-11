import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"

/**
 * Shared, non-test plumbing for every `test/integration/<category>/<name>.test.ts`
 * file -- the same shape as `test/examples/support.ts`, kept as its own
 * copy (not a shared import) because the two answer different questions:
 * `test/examples/` proves the 3 flagship examples work end to end;
 * `test/integration/` proves each individual mechanism the flagships don't
 * themselves exercise still works, via the 16 fixtures relocated out of
 * `examples/` (see examples/README.md and this session's restructuring).
 * Each fixture is `<category>/<name>`, its own standalone npm project with
 * its own node_modules, installed by CI's `integration-fixtures` job
 * (.github/workflows/ci.yml), not by the root `npm ci`. Every helper below
 * skips gracefully rather than failing when that fixture's node_modules
 * isn't present, via `isInstalled()`, which every fixture test file gates
 * on.
 */

export const integrationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".")

export function isInstalled(fixturePath: string): boolean {
  return existsSync(path.join(integrationRoot, fixturePath, "node_modules"))
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
function runNpmScript(fixturePath: string, script: string): RunResult {
  const result = spawnSync("npm", ["run", "--silent", script], {
    cwd: path.join(integrationRoot, fixturePath),
    encoding: "utf8",
  })
  return { stdout: result.stdout, stderr: result.stderr, status: result.status }
}

/** Runs any npm script expected to succeed and returns its combined stdout+stderr. Fails the test itself if the script exits non-zero. */
export function runScript(fixturePath: string, script: string): string {
  const { stdout, stderr, status } = runNpmScript(fixturePath, script)
  if (status !== 0) {
    throw new Error(
      `Expected "npm run ${script}" in ${fixturePath} to succeed, but it exited ${String(status)}.\n${stdout}${stderr}`,
    )
  }
  return `${stdout}${stderr}`
}

/** Runs `npm start` (every fixture's own real-assertions-plus-golden-write script) and returns its combined stdout+stderr. */
export function runStart(fixturePath: string): string {
  return runScript(fixturePath, "start")
}

/**
 * Byte-for-byte comparison of `<fixturePath>/output.json` (written fresh by
 * this run's `npm start`) against its committed `expected/output.json`
 * golden. Compares parsed JSON (not raw text) so key ordering never causes
 * a spurious diff -- `JSON.stringify`'s own key order is stable per-object
 * regardless, but this keeps the comparison robust to that regardless.
 */
export function compareGoldenOutput(fixturePath: string): void {
  const fixtureDir = path.join(integrationRoot, fixturePath)
  const actual: unknown = JSON.parse(readFileSync(path.join(fixtureDir, "output.json"), "utf8"))
  const expected: unknown = JSON.parse(
    readFileSync(path.join(fixtureDir, "expected/output.json"), "utf8"),
  )
  expect(actual, `${fixturePath}/output.json does not match expected/output.json`).toEqual(expected)
}
