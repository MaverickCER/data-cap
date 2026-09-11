import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Exercises the module-level `if (isDirectRun) { main().catch(...) }` guard
 * at the bottom of src/cli/index.ts -- the only way to hit it from vitest is
 * to make a *fresh* import of the module see `process.argv[1]` equal to its
 * own real (symlink-free) on-disk path before the module's top level runs,
 * since `isDirectRun` is computed once, at import time. Isolated into its own
 * file so `vi.resetModules()` + a dynamic re-import never interferes with the
 * static `import { main }` bindings the rest of the cli test suite relies on.
 *
 * An unknown flag makes `parseArgs()` throw synchronously inside `main()`,
 * so `main().catch()` fires almost immediately -- fast and deterministic,
 * no real generation work involved.
 */

const cliEntryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/cli/index.ts",
)

const originalArgv = process.argv

afterEach(() => {
  process.argv = originalArgv
  process.exitCode = undefined
  vi.restoreAllMocks()
  vi.resetModules()
})

describe("module auto-run guard (isDirectRun)", () => {
  it("runs main() and reports the error via main().catch() when this module is the process entry point", async () => {
    process.argv = ["node", cliEntryPath, "--this-flag-does-not-exist"]

    const stderrWrites: string[] = []
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk))
      return true
    })

    vi.resetModules()
    await import("../../src/cli/index.js")

    await vi.waitFor(() => {
      expect(stderrWrites.join("")).toContain("Unknown argument")
    })

    expect(process.exitCode).toBe(1)
  })

  it("never auto-runs when argv[1] is not this module's own path (a plain import)", async () => {
    process.argv = ["node", "/some/unrelated/entry-point.js", "--this-flag-does-not-exist"]

    const stderrWrites: string[] = []
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk))
      return true
    })

    vi.resetModules()
    await import("../../src/cli/index.js")

    // Give any (wrongly-)scheduled main().catch() a chance to run, so a
    // regression here fails instead of racing past a false negative.
    await new Promise((resolve) => setImmediate(resolve))

    expect(stderrWrites.join("")).toBe("")
    expect(process.exitCode).toBeUndefined()
  })

  it("stringifies a non-Error rejection value via String(error), not error.message", async () => {
    // Every real throw inside src/cli/index.ts is a genuine Error instance --
    // to reach the `String(error)` side of the catch handler's ternary at
    // all, generateDataArtifacts() itself has to be the one to reject with a
    // non-Error value, which only a mock can force.
    process.argv = ["node", cliEntryPath, "--location", "out.ts"]

    vi.doMock("../../src/build/generate-data-artifacts.js", () => ({
      generateDataArtifacts: vi.fn().mockRejectedValue("boom -- not an Error instance"),
    }))

    const stderrWrites: string[] = []
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk))
      return true
    })

    try {
      vi.resetModules()
      await import("../../src/cli/index.js")

      await vi.waitFor(() => {
        expect(stderrWrites.join("")).toContain("boom -- not an Error instance")
      })

      expect(process.exitCode).toBe(1)
    } finally {
      vi.doUnmock("../../src/build/generate-data-artifacts.js")
    }
  })
})
