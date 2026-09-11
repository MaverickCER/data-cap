import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runInitCommand } from "../../src/cli/init.js"

// `runInitCommand` reads `process.cwd()` and writes to stdout/stderr. Each
// test runs in a throwaway directory it chdir's into, and captures output.

let tmp: string
let originalCwd: string
let out: string[]
let err: string[]

beforeEach(() => {
  originalCwd = process.cwd()
  tmp = mkdtempSync(path.join(os.tmpdir(), "data-cap-init-"))
  process.chdir(tmp)
  out = []
  err = []
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk))
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(originalCwd)
  rmSync(tmp, { recursive: true, force: true })
})

function writePackageJson(content = '{"name": "demo"}'): void {
  writeFileSync(path.join(tmp, "package.json"), content)
}

describe("runInitCommand", () => {
  it("scaffolds the starter capability and generator script, exit 0", () => {
    writePackageJson()

    const code = runInitCommand([])

    expect(code).toBe(0)
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(true)
    expect(existsSync(path.join(tmp, "scripts/generate-data.mjs"))).toBe(true)
    const report = out.join("")
    expect(report).toContain("data-cap initialized")
    expect(report).toContain("Created:")
    expect(report).toContain("data.ts")
    expect(report).toContain("scripts/generate-data.mjs")
    expect(report).toContain("Next:")
  })

  it("places the capability in src/ when src/ already exists", () => {
    writePackageJson()
    mkdirSync(path.join(tmp, "src"))

    runInitCommand([])

    expect(existsSync(path.join(tmp, "src/data.ts"))).toBe(true)
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("creates the scripts/ directory when it does not exist yet", () => {
    writePackageJson()
    expect(existsSync(path.join(tmp, "scripts"))).toBe(false)

    runInitCommand([])

    expect(existsSync(path.join(tmp, "scripts/generate-data.mjs"))).toBe(true)
  })

  it("never overwrites an existing file -- reports it as skipped, exit 0", () => {
    writePackageJson()
    writeFileSync(path.join(tmp, "data.ts"), "// mine\n")

    const code = runInitCommand([])

    expect(code).toBe(0)
    expect(readFileSync(path.join(tmp, "data.ts"), "utf8")).toBe("// mine\n")
    const report = out.join("")
    expect(report).toContain("Skipped (already exists):")
    expect(report).toMatch(/Skipped \(already exists\):\n {2}- data\.ts/)
    expect(existsSync(path.join(tmp, "scripts/generate-data.mjs"))).toBe(true)
  })

  it("fails with exit 1 and writes nothing when there is no package.json", () => {
    const code = runInitCommand([])

    expect(code).toBe(1)
    expect(err.join("")).toContain("npm init")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
    expect(existsSync(path.join(tmp, "scripts"))).toBe(false)
  })

  it("fails with exit 1 when package.json is not valid JSON", () => {
    writePackageJson("{ not json")

    const code = runInitCommand([])

    expect(code).toBe(1)
    expect(err.join("")).toContain("not valid JSON")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("fails with exit 1 when package.json is a JSON array, not an object", () => {
    writePackageJson("[]")

    expect(runInitCommand([])).toBe(1)
    expect(err.join("")).toContain("top-level object")
  })

  it("fails with exit 1 and writes nothing when a scaffold target is blocked by a directory", () => {
    writePackageJson()
    mkdirSync(path.join(tmp, "data.ts"))

    const code = runInitCommand([])

    expect(code).toBe(1)
    expect(err.join("")).toContain("already exists and is a directory")
    expect(existsSync(path.join(tmp, "scripts/generate-data.mjs"))).toBe(false)
  })

  it("--help prints usage and exits 0 without scaffolding", () => {
    writePackageJson()

    const code = runInitCommand(["--help"])

    expect(code).toBe(0)
    expect(out.join("")).toContain("Usage: data-cap init")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("rejects extra arguments with exit 1", () => {
    writePackageJson()

    const code = runInitCommand(["--location", "x"])

    expect(code).toBe(1)
    expect(err.join("")).toContain("takes no arguments")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })
})
