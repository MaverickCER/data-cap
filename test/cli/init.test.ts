import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import type * as NodeFs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isFileExistsError, runInitCommand } from "../../src/cli/init.js"

// A mutable, per-test flag rather than `vi.spyOn(fs, "writeFileSync")`:
// Vitest/Node's ESM interop exposes "node:fs" as a non-configurable module
// namespace object, so `vi.spyOn` throws "Cannot redefine property" for a
// built-in module's own export (confirmed directly) -- `vi.mock`'s factory
// form is the real, supported way to substitute one named export while
// keeping every other `node:fs` function genuine. Typed `unknown`, not
// `Error`, because one test (see below) deliberately throws a non-Error
// value to exercise `runInitCommand`'s own `error instanceof Error`
// fallback -- an intentional, real test case, not a type-safety gap.
let simulatedWriteError: unknown
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>): void => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- see this file's own top-of-file comment: deliberately throws a non-Error value in one test, to exercise runInitCommand's real `error instanceof Error` fallback branch.
      if (simulatedWriteError !== undefined) throw simulatedWriteError
      actual.writeFileSync(...args)
    },
  }
})

// `runInitCommand`'s optional second parameter targets each test's own
// throwaway directory directly -- no `process.chdir()`. That isn't just
// tidier: `process.chdir()` genuinely cannot run under a `worker_threads`
// -pooled test runner (Node itself throws "process.chdir() is not
// supported in workers"), which is exactly the pool Stryker's own
// coverageAnalysis dry run uses -- confirmed directly: with the previous
// chdir-based version of this file, every mutant in src/cli/init.ts
// reported NoCoverage under `npm run mutation`, despite this file's own
// vitest run showing ~97% real statement coverage. Passing an explicit cwd
// avoids the whole class of problem, matching this codebase's own
// capability-injection convention (ADR 0058) rather than mutating global
// process state.

let tmp: string
let out: string[]
let err: string[]

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "data-cap-init-"))
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
  simulatedWriteError = undefined
  rmSync(tmp, { recursive: true, force: true })
})

function writePackageJson(content = '{"name": "demo"}'): void {
  writeFileSync(path.join(tmp, "package.json"), content)
}

describe("runInitCommand", () => {
  it("scaffolds the starter capability and generator script, exit 0", () => {
    writePackageJson()

    const code = runInitCommand([], tmp)

    expect(code).toBe(0)
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(true)
    expect(existsSync(path.join(tmp, "scripts/generate-data.mjs"))).toBe(true)
    const report = out.join("")
    expect(report).toContain("data-cap initialized")
    expect(report).toContain("Created:")
    expect(report).toContain("data.ts")
    expect(report).toContain("scripts/generate-data.mjs")
    expect(report).toContain("Next:")
    expect(report).not.toContain("Skipped (already exists):")
  })

  it("places the capability in src/ when src/ already exists", () => {
    writePackageJson()
    mkdirSync(path.join(tmp, "src"))

    runInitCommand([], tmp)

    expect(existsSync(path.join(tmp, "src/data.ts"))).toBe(true)
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("creates the scripts/ directory when it does not exist yet", () => {
    writePackageJson()
    expect(existsSync(path.join(tmp, "scripts"))).toBe(false)

    runInitCommand([], tmp)

    expect(existsSync(path.join(tmp, "scripts/generate-data.mjs"))).toBe(true)
  })

  it("never overwrites an existing file -- reports it as skipped, exit 0", () => {
    writePackageJson()
    writeFileSync(path.join(tmp, "data.ts"), "// mine\n")

    const code = runInitCommand([], tmp)

    expect(code).toBe(0)
    expect(readFileSync(path.join(tmp, "data.ts"), "utf8")).toBe("// mine\n")
    const report = out.join("")
    expect(report).toContain("Skipped (already exists):")
    expect(report).toMatch(/Skipped \(already exists\):\n {2}- data\.ts/)
    expect(existsSync(path.join(tmp, "scripts/generate-data.mjs"))).toBe(true)
  })

  it("fails with exit 1 and writes nothing when there is no package.json", () => {
    const code = runInitCommand([], tmp)

    expect(code).toBe(1)
    expect(err.join("")).toContain("npm init")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
    expect(existsSync(path.join(tmp, "scripts"))).toBe(false)
  })

  it("fails with exit 1 when package.json is not valid JSON", () => {
    writePackageJson("{ not json")

    const code = runInitCommand([], tmp)

    expect(code).toBe(1)
    expect(err.join("")).toContain("not valid JSON")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("fails with exit 1 when package.json is a JSON array, not an object", () => {
    writePackageJson("[]")

    expect(runInitCommand([], tmp)).toBe(1)
    expect(err.join("")).toContain("top-level object")
  })

  it("fails with exit 1 when package.json is a top-level JSON scalar, not an object", () => {
    writePackageJson('"just a string"')

    expect(runInitCommand([], tmp)).toBe(1)
    expect(err.join("")).toContain("top-level object")
  })

  it("fails with exit 1 when package.json is top-level JSON null", () => {
    writePackageJson("null")

    expect(runInitCommand([], tmp)).toBe(1)
    expect(err.join("")).toContain("top-level object")
  })

  it("fails with exit 1 and writes nothing when a scaffold target is blocked by a directory", () => {
    writePackageJson()
    mkdirSync(path.join(tmp, "data.ts"))

    const code = runInitCommand([], tmp)

    expect(code).toBe(1)
    expect(err.join("")).toContain("already exists and is a directory")
    expect(existsSync(path.join(tmp, "scripts/generate-data.mjs"))).toBe(false)
  })

  it("--help prints usage and exits 0 without scaffolding", () => {
    writePackageJson()

    const code = runInitCommand(["--help"], tmp)

    expect(code).toBe(0)
    expect(out.join("")).toContain("Usage: data-cap init")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("rejects extra arguments with exit 1", () => {
    writePackageJson()

    const code = runInitCommand(["--location", "x"], tmp)

    expect(code).toBe(1)
    // Exact substring, space included: pins `rest.join(" ")` (not `rest.join("")`)
    // -- the args must be re-printed space-separated, not concatenated.
    expect(err.join("")).toContain("takes no arguments (got: --location x)")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("rejects a single empty-string argument (not confused with --help/-h) with exit 1", () => {
    writePackageJson()

    const code = runInitCommand([""], tmp)

    expect(code).toBe(1)
    expect(err.join("")).toContain("takes no arguments")
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("defaults to process.cwd() when no cwd argument is given", () => {
    // Mocks the `process.cwd` FUNCTION rather than calling the real
    // `process.chdir()` -- the latter is what breaks under Stryker's
    // worker-pooled dry run (see this file's own top-of-file comment);
    // mocking the function is ordinary object patching, unaffected by that
    // restriction, while still exercising the real default-parameter
    // expression (`cwd: string = process.cwd()`).
    vi.spyOn(process, "cwd").mockReturnValue(tmp)
    writePackageJson()

    const code = runInitCommand([])

    expect(code).toBe(0)
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(true)
  })

  it("renders the exact full report -- both a Created and a Skipped section together", () => {
    // Exact `toBe()`, not `toContain()`, deliberately: this is the one test
    // that pins renderReport()'s entire output byte-for-byte, so every
    // static line of "Next:" boilerplate (and every section-presence
    // branch) has a real test distinguishing it from a mutated version,
    // rather than relying on a scattering of substring checks that a text
    // mutation could slip past.
    writePackageJson()
    writeFileSync(path.join(tmp, "data.ts"), "// mine\n")

    const code = runInitCommand([], tmp)

    expect(code).toBe(0)
    expect(out.join("")).toBe(
      [
        "data-cap initialized",
        "",
        "Created:",
        "  + scripts/generate-data.mjs",
        "",
        "Skipped (already exists):",
        "  - data.ts",
        "",
        "Next:",
        "  1. Generate the manifest + docs:  node scripts/generate-data.mjs",
        "  2. Add operations -- switch buildData to createData for the",
        "     batteries-included getter/mutator/subscription layer:",
        "",
        '       import { createData } from "data-cap/runtime"',
        "",
        "  3. Read fields directly (buildData returns a synchronous snapshot):",
        "     exampleData.fields.example  -- or getSnapshot().fields once on createData",
        "",
        "data-cap init edited no package.json script -- add one if you want, e.g.",
        '  "generate:data": "node scripts/generate-data.mjs"',
        "",
      ].join("\n"),
    )
  })

  it("writes the exact starter capability template", () => {
    writePackageJson()

    runInitCommand([], tmp)

    const content = readFileSync(path.join(tmp, "data.ts"), "utf8")
    expect(content).toContain('import { buildData, documentData } from "data-cap"')
    expect(content).toContain("export const exampleData = buildData(schema)")
    expect(content).toContain('owner: "your-team"')
    expect(content).toContain("example: {")
  })

  it("writes the exact generator script template", () => {
    writePackageJson()

    runInitCommand([], tmp)

    const content = readFileSync(path.join(tmp, "scripts/generate-data.mjs"), "utf8")
    expect(content).toContain('import { generateDataArtifacts } from "data-cap/build"')
    expect(content).toContain('import { nodeBuildFileSystem } from "data-cap/node"')
    expect(content).toContain('location: "src/generated/data.manifest.ts"')
    expect(content).toContain('docs: "docs/DATA.md"')
    expect(content).toContain('ownership: "docs/OWNERSHIP.md"')
    expect(content).toContain("Discovered ${active} active capability(ies).")
    expect(content).toContain("Wrote manifest: ${result.manifest.location}")
    expect(content).toContain("Wrote docs: ${result.documentation.location}")
  })

  it("--help prints the exact usage text", () => {
    const code = runInitCommand(["--help"], tmp)

    expect(code).toBe(0)
    expect(out.join("")).toBe(
      [
        "Usage: data-cap init",
        "",
        "Scaffolds a minimal data-cap starting point into the current directory:",
        "",
        "  <src>/data.ts            a starter capability (buildData + documentData)",
        "  scripts/generate-data.mjs a script that generates the manifest + docs artifacts",
        "",
        "Never overwrites an existing file, never runs anything, never edits",
        "package.json. Everything else -- generating artifacts, adding getters/",
        "mutators, reading the snapshot -- is printed as a next step. Run generation",
        "afterwards with `node scripts/generate-data.mjs` or",
        "`npx data-cap --location <path>`.",
        "",
      ].join("\n"),
    )
  })

  it("fails with exit 1 when scripts/ already exists as a file, not a directory", () => {
    writePackageJson()
    writeFileSync(path.join(tmp, "scripts"), "not a directory\n")

    const code = runInitCommand([], tmp)

    expect(code).toBe(1)
    expect(err.join("")).toContain(
      `${path.join(tmp, "scripts")} already exists and is not a directory.`,
    )
    expect(existsSync(path.join(tmp, "data.ts"))).toBe(false)
  })

  it("propagates a non-EEXIST write failure rather than treating it as skipped", () => {
    writePackageJson()
    const error = new Error("simulated disk failure") as NodeJS.ErrnoException
    error.code = "ENOSPC"
    simulatedWriteError = error

    const code = runInitCommand([], tmp)

    expect(code).toBe(1)
    expect(err.join("")).toContain("simulated disk failure")
  })

  it("stringifies a thrown non-Error value rather than reading .message off it", () => {
    writePackageJson()
    simulatedWriteError = "just a string, not an Error"

    const code = runInitCommand([], tmp)

    expect(code).toBe(1)
    expect(err.join("")).toContain("data-cap init failed: just a string, not an Error")
  })

  it("renders only a Skipped section when every target already exists", () => {
    writePackageJson()
    writeFileSync(path.join(tmp, "data.ts"), "// mine\n")
    mkdirSync(path.join(tmp, "scripts"))
    writeFileSync(path.join(tmp, "scripts/generate-data.mjs"), "// mine too\n")

    const code = runInitCommand([], tmp)

    expect(code).toBe(0)
    const report = out.join("")
    expect(report).not.toContain("Created:")
    expect(report).toContain("Skipped (already exists):")
  })
})

describe("isFileExistsError", () => {
  it("is true for an Error-like object with code EEXIST", () => {
    expect(isFileExistsError({ code: "EEXIST" })).toBe(true)
  })

  it("is false when error is not an object", () => {
    expect(isFileExistsError("EEXIST")).toBe(false)
    expect(isFileExistsError(42)).toBe(false)
    expect(isFileExistsError(undefined)).toBe(false)
  })

  it("is false when error is null", () => {
    expect(isFileExistsError(null)).toBe(false)
  })

  it("is false when error is an object with no code property", () => {
    expect(isFileExistsError({})).toBe(false)
    expect(isFileExistsError(new Error("plain error"))).toBe(false)
  })

  it("is false when error's code is a different value", () => {
    expect(isFileExistsError({ code: "ENOENT" })).toBe(false)
  })
})
