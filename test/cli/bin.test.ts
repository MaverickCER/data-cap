import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import os from "node:os"
import path from "node:path"

/**
 * These tests spawn the *built* CLI (`dist/cli/index.js`) as a real child
 * process, through a symlink that mimics exactly how npm installs `bin`
 * entries (`node_modules/.bin/<name>` -> the real file inside the package).
 * That symlink indirection is the actual bug this suite guards against: a
 * naive `import.meta.url === pathToFileURL(process.argv[1]).href` check
 * matches when you run `node dist/cli/index.js` directly, but never matches
 * through the symlink npm actually creates -- so testing only the
 * direct-execution path would have passed even with the bug present.
 * Requires a prior `npm run build`; skipped otherwise.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const cliDist = path.resolve(projectRoot, "dist/cli/index.js")
const distMissing = !existsSync(cliDist)

describe.skipIf(distMissing)("CLI bin execution (requires `npm run build`)", () => {
  let binDir: string
  let binPath: string

  beforeAll(() => {
    binDir = mkdtempSync(path.join(os.tmpdir(), "data-cap-bin-"))
    binPath = path.join(binDir, "data-cap")
    // Mirrors npm's own `node_modules/.bin/<name> -> dist/cli/index.js` layout.
    symlinkSync(cliDist, binPath)
  })

  afterAll(() => {
    rmSync(binDir, { recursive: true, force: true })
  })

  it("prints help and exits 0 when invoked through a bin-style symlink", () => {
    const result = spawnSync(process.execPath, [binPath, "--help"], { encoding: "utf8" })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("data-cap - generate a manifest")
    expect(result.stdout).toContain("Usage:")
  })

  it("exits non-zero with no --location/--docs/--ownership/--flow and no --help, through the same symlink", () => {
    const result = spawnSync(process.execPath, [binPath], { encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Usage:")
  })

  it("exits non-zero for an unknown flag, through the same symlink", () => {
    const result = spawnSync(process.execPath, [binPath, "--location", "out.ts", "--bogus"], {
      encoding: "utf8",
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unknown argument")
  })

  it("still runs correctly via direct `node dist/cli/index.js` execution (non-symlink)", () => {
    const result = spawnSync(process.execPath, [cliDist, "--help"], { encoding: "utf8" })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Usage:")
  })

  it("emits stdout that round-trips through JSON.parse() when run with --json and no target flags", () => {
    // No --location/--docs/--ownership/--flow -- exercises the JSON-aware
    // usage-error path (src/cli/index.ts's "at least one of ... is
    // required" branch), not a real generation run, but proves the built
    // binary's --json output is well-formed JSON end-to-end through the
    // real symlinked entry point.
    const result = spawnSync(process.execPath, [binPath, "--json"], { encoding: "utf8" })
    expect(result.status).toBe(1)
    const payload = JSON.parse(result.stdout) as { ok: boolean; kind: string }
    expect(payload.ok).toBe(false)
    expect(payload.kind).toBe("data-cap-report")
  })

  it("does not run main() when the built CLI file is only imported, not executed", () => {
    // A fresh process whose only action is a dynamic import -- argv[1] is the
    // inline `-e` script, not the CLI file, so this must never print HELP_TEXT
    // or otherwise behave as if it were invoked as the entry point.
    const script = `import(${JSON.stringify(pathToFileURL(cliDist).href)}).then(() => {});`
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })
})
