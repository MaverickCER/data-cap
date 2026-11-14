import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * The README's quick start, run for real: the built `data-cap init` in an empty project, then the
 * `scripts/generate-data.mjs` it scaffolds, with and without `--check`. The project resolves
 * `data-cap` through a `node_modules` symlink to this checkout, so the script runs against the
 * built `dist`.
 *
 * Needs `npm run build` first. Every CI job that runs the tests builds before them, so on CI a
 * missing `dist` fails this test instead of skipping it.
 */
const projectRoot = path.resolve(import.meta.dirname, "../..")
const cliDist = path.join(projectRoot, "dist/cli/index.js")
const distMissing = !existsSync(cliDist)

describe.skipIf(distMissing && process.env["CI"] === undefined)("the README quick start", () => {
  let project: string
  const run = (args: readonly string[]) =>
    spawnSync(process.execPath, args, { cwd: project, encoding: "utf8" })

  beforeAll(() => {
    project = mkdtempSync(path.join(os.tmpdir(), "data-cap-quick-start-"))
    writeFileSync(path.join(project, "package.json"), '{"name": "demo", "type": "module"}')
    mkdirSync(path.join(project, "node_modules"))
    symlinkSync(projectRoot, path.join(project, "node_modules/data-cap"), "dir")
  })

  afterAll(() => {
    rmSync(project, { recursive: true, force: true })
  })

  it("init scaffolds a generator whose --check passes when fresh and fails after an edit", () => {
    expect(existsSync(cliDist), "dist/cli/index.js is missing; run `npm run build`").toBe(true)

    const init = run([cliDist, "init"])
    expect(init.stderr).toBe("")
    expect(init.status).toBe(0)

    const generate = run(["scripts/generate-data.mjs"])
    expect(generate.stderr).toBe("")
    expect(generate.status).toBe(0)
    expect(generate.stdout).toContain("Discovered 1 active capability(ies).")
    for (const file of [
      "src/generated/data.manifest.ts",
      "docs/DATA.md",
      "docs/DATA-OWNERSHIP.md",
    ]) {
      expect(existsSync(path.join(project, file)), `${file} was not generated`).toBe(true)
    }

    const fresh = run(["scripts/generate-data.mjs", "--check"])
    expect(fresh.stderr).toBe("")
    expect(fresh.stdout).toContain("The data docs are up to date.")
    expect(fresh.status).toBe(0)

    const capability = path.join(project, "data.ts")
    writeFileSync(
      capability,
      readFileSync(capability, "utf8").replace(
        'example: { id: "", label: "" },',
        '$&\n    note: "",',
      ),
    )
    const catalog = readFileSync(path.join(project, "docs/DATA.md"), "utf8")
    const stale = run(["scripts/generate-data.mjs", "--check"])
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain("Stale or missing; run node scripts/generate-data.mjs:")
    expect(stale.stderr).toContain("  - docs/DATA.md")
    expect(readFileSync(path.join(project, "docs/DATA.md"), "utf8")).toBe(catalog)
  }, 60_000)
})
