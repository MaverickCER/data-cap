import { realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  helpText,
  directRunUrl,
  formatFieldChanges,
  formatFieldPath,
  parseArgs,
  resolveOptions,
  writeCheckSummary,
  writeFindings,
  writeGenerationSummary,
  writeManifestChanges,
} from "../../src/cli/index.js"
import type { ParsedArgs } from "../../src/cli/index.js"
import type { CheckArtifactsResult, ReportResult } from "../../src/build/index.js"
import type { ReportFinding } from "../../src/build/findings.js"

/** Captures everything written to stdout while `fn` runs. */
function captureStdout(fn: () => void): string {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return chunks.join("")
}

function baseArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    include: [],
    exclude: [],
    packages: [],
    strict: false,
    strictDocs: false,
    strictOwnership: false,
    strictFlow: false,
    json: false,
    check: false,
    help: false,
    ...overrides,
  }
}

describe("parseArgs", () => {
  it("parses --location with no other flags", () => {
    const args = parseArgs(["--location", "src/generated/data.manifest.ts"])
    expect(args.location).toBe("src/generated/data.manifest.ts")
    expect(args.help).toBe(false)
    expect(args.strict).toBe(false)
    expect(args.strictDocs).toBe(false)
    expect(args.strictOwnership).toBe(false)
    expect(args.strictFlow).toBe(false)
    expect(args.include).toEqual([])
    expect(args.exclude).toEqual([])
  })

  it("parses --root, --docs, and --ownership", () => {
    const args = parseArgs([
      "--root",
      "/repo",
      "--location",
      "out.ts",
      "--docs",
      "docs/DATA.md",
      "--ownership",
      "docs/OWNERSHIP.md",
    ])
    expect(args.root).toBe("/repo")
    expect(args.docs).toBe("docs/DATA.md")
    expect(args.ownership).toBe("docs/OWNERSHIP.md")
  })

  it("parses --flow", () => {
    const args = parseArgs(["--flow", "docs/flow"])
    expect(args.flow).toBe("docs/flow")
  })

  it("parses --evidence", () => {
    const args = parseArgs(["--evidence", "docs/data.evidence.json"])
    expect(args.evidence).toBe("docs/data.evidence.json")
  })

  it("collects repeatable --include and --exclude flags", () => {
    const args = parseArgs([
      "--location",
      "out.ts",
      "--include",
      "features/**/*.ts",
      "--include",
      "packages/**/*.ts",
      "--exclude",
      "**/fixtures/**",
    ])
    expect(args.include).toEqual(["features/**/*.ts", "packages/**/*.ts"])
    expect(args.exclude).toEqual(["**/fixtures/**"])
  })

  it("collects repeatable --package flags", () => {
    const args = parseArgs([
      "--location",
      "out.ts",
      "--package",
      "@acme/pkg-a",
      "--package",
      "@acme/pkg-b",
    ])
    expect(args.packages).toEqual(["@acme/pkg-a", "@acme/pkg-b"])
  })

  it("parses --tsconfig <path>", () => {
    const args = parseArgs(["--location", "out.ts", "--tsconfig", "tsconfig.build.json"])
    expect(args.tsconfig).toBe("tsconfig.build.json")
  })

  it("parses --no-tsconfig as false, and leaves tsconfig undefined when neither flag is given", () => {
    expect(parseArgs(["--location", "out.ts", "--no-tsconfig"]).tsconfig).toBe(false)
    expect(parseArgs(["--location", "out.ts"]).tsconfig).toBeUndefined()
  })

  it("sets strict, strict-docs, strict-ownership, strict-flow, json, check, and help flags", () => {
    expect(parseArgs(["--location", "out.ts", "--strict"]).strict).toBe(true)
    expect(parseArgs(["--location", "out.ts", "--strict-docs"]).strictDocs).toBe(true)
    expect(parseArgs(["--ownership", "out.md", "--strict-ownership"]).strictOwnership).toBe(true)
    expect(parseArgs(["--flow", "out", "--strict-flow"]).strictFlow).toBe(true)
    expect(parseArgs(["--location", "out.ts", "--json"]).json).toBe(true)
    expect(parseArgs(["--location", "out.ts"]).json).toBe(false)
    expect(parseArgs(["--location", "out.ts", "--check"]).check).toBe(true)
    expect(parseArgs(["--location", "out.ts"]).check).toBe(false)
    expect(parseArgs(["--help"]).help).toBe(true)
    expect(parseArgs(["-h"]).help).toBe(true)
  })

  it("throws for an unknown argument", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/)
  })

  it("throws when a value-taking flag is missing its value", () => {
    expect(() => parseArgs(["--location"])).toThrow(/requires a value/)
    expect(() => parseArgs(["--include"])).toThrow(/requires a value/)
    expect(() => parseArgs(["--ownership"])).toThrow(/requires a value/)
    expect(() => parseArgs(["--flow"])).toThrow(/requires a value/)
    expect(() => parseArgs(["--evidence"])).toThrow(/requires a value/)
  })

  it("parses with none of --location/--docs/--ownership/--flow/--evidence given -- parseArgs itself never enforces requiredness, main() does", () => {
    const args = parseArgs(["--strict"])
    expect(args.location).toBeUndefined()
    expect(args.docs).toBeUndefined()
    expect(args.ownership).toBeUndefined()
    expect(args.flow).toBeUndefined()
    expect(args.evidence).toBeUndefined()
  })
})

// directRunUrl() is exported purely for this direct-unit-test path -- see the
// comment above its definition in src/cli/index.ts for why it exists at all
// (npm's `.bin` symlink indirection). module-level `isDirectRun`/auto-run
// behavior itself is exercised separately in test/cli/direct-run.test.ts,
// since re-executing this module's top level doesn't belong alongside the
// static `import { main }` bindings the rest of this suite relies on.
describe("directRunUrl", () => {
  const originalArgv1 = process.argv[1] ?? ""

  afterEach(() => {
    process.argv[1] = originalArgv1
  })

  it("returns undefined when process.argv[1] is falsy", () => {
    process.argv[1] = ""
    expect(directRunUrl()).toBeUndefined()
  })

  it("resolves a real, symlink-free path via realpathSync", () => {
    const here = fileURLToPath(import.meta.url)
    process.argv[1] = here
    expect(directRunUrl()).toBe(pathToFileURL(realpathSync(here)).href)
  })

  it("falls back to the unresolved path when realpathSync throws (e.g. a nonexistent argv[1])", () => {
    const nonexistent = path.join(path.dirname(fileURLToPath(import.meta.url)), "does-not-exist.ts")
    process.argv[1] = nonexistent
    expect(directRunUrl()).toBe(pathToFileURL(nonexistent).href)
  })
})

describe("parseArgs -- --expiring-within-days", () => {
  it("parses a whole number of days", () => {
    expect(parseArgs(["--expiring-within-days", "90"]).expiringWithinDays).toBe(90)
  })

  it("accepts 0 (only what's already expired counts)", () => {
    expect(parseArgs(["--expiring-within-days", "0"]).expiringWithinDays).toBe(0)
  })

  it("leaves it undefined when the flag is absent, so the default applies downstream", () => {
    expect(parseArgs([]).expiringWithinDays).toBeUndefined()
  })

  it("throws on a non-numeric value rather than silently becoming NaN", () => {
    expect(() => parseArgs(["--expiring-within-days", "soon"])).toThrow(
      /--expiring-within-days requires a non-negative whole number/,
    )
  })

  it("throws on a negative value", () => {
    expect(() => parseArgs(["--expiring-within-days", "-5"])).toThrow(/non-negative whole number/)
  })
})

describe("parseArgs -- every flag sets exactly its own field", () => {
  it("each value flag records its value", () => {
    expect(parseArgs(["--root", "/r"]).root).toBe("/r")
    expect(parseArgs(["--location", "m.ts"]).location).toBe("m.ts")
    expect(parseArgs(["--tsconfig", "tsc.json"]).tsconfig).toBe("tsc.json")
    expect(parseArgs(["--docs", "D.md"]).docs).toBe("D.md")
    expect(parseArgs(["--ownership", "O.md"]).ownership).toBe("O.md")
    expect(parseArgs(["--flow", "flow/"]).flow).toBe("flow/")
    expect(parseArgs(["--evidence", "e.json"]).evidence).toBe("e.json")
  })

  it("repeatable value flags accumulate in order", () => {
    expect(parseArgs(["--include", "a", "--include", "b"]).include).toEqual(["a", "b"])
    expect(parseArgs(["--exclude", "x", "--exclude", "y"]).exclude).toEqual(["x", "y"])
    expect(parseArgs(["--package", "@a/p", "--package", "@b/q"]).packages).toEqual(["@a/p", "@b/q"])
  })

  it("each bool flag sets exactly its own boolean", () => {
    expect(parseArgs(["--no-tsconfig"]).tsconfig).toBe(false)
    expect(parseArgs(["--strict"]).strict).toBe(true)
    expect(parseArgs(["--strict-docs"]).strictDocs).toBe(true)
    expect(parseArgs(["--strict-ownership"]).strictOwnership).toBe(true)
    expect(parseArgs(["--strict-flow"]).strictFlow).toBe(true)
    expect(parseArgs(["--json"]).json).toBe(true)
    expect(parseArgs(["--check"]).check).toBe(true)
    expect(parseArgs(["--help"]).help).toBe(true)
    expect(parseArgs(["-h"]).help).toBe(true)
  })

  it("a bool flag does not consume the next token", () => {
    // `--strict --json`: if `--strict` wrongly consumed `--json`, json would be false.
    const args = parseArgs(["--strict", "--json"])
    expect(args.strict).toBe(true)
    expect(args.json).toBe(true)
  })

  it("an unset flag leaves its field at the documented default", () => {
    const args = parseArgs([])
    expect(args).toEqual(baseArgs())
  })
})

describe("helpText", () => {
  it("names every flag and the requiredness rule", () => {
    for (const flag of [
      "--root",
      "--location",
      "--include",
      "--exclude",
      "--package",
      "--tsconfig",
      "--no-tsconfig",
      "--docs",
      "--ownership",
      "--flow",
      "--evidence",
      "--expiring-within-days",
      "--strict",
      "--strict-docs",
      "--strict-ownership",
      "--strict-flow",
      "--json",
      "--check",
      "--help",
    ]) {
      expect(helpText()).toContain(flag)
    }
    expect(helpText()).toContain(
      "At least one of --location, --docs, --ownership, --flow, or --evidence is required",
    )
    expect(helpText().startsWith("data-cap - generate a manifest")).toBe(true)
  })

  it("lists the init subcommand", () => {
    expect(helpText()).toContain("data-cap init")
    expect(helpText()).toContain("init                      Scaffold a minimal starting point")
  })
})

describe("formatFieldPath (direct)", () => {
  it("wraps a non-empty dotted path in parens, else returns empty", () => {
    expect(formatFieldPath(["user", "email"])).toBe(" (user.email)")
    expect(formatFieldPath(["email"])).toBe(" (email)")
    expect(formatFieldPath([])).toBe("")
    expect(formatFieldPath(undefined)).toBe("")
  })
})

describe("formatFieldChanges (direct)", () => {
  it("comma-joins the changes list", () => {
    expect(
      formatFieldChanges({
        capability: "c",
        changes: ["added a", "removed b"],
        fields: { added: [], removed: [] },
      }),
    ).toBe("added a, removed b")
  })
})

describe("writeFindings (direct)", () => {
  const finding = (over: Partial<ReportFinding>): ReportFinding => ({
    code: "CAPABILITY_MISSING_OWNER",
    family: "governance",
    severity: "warning",
    message: "no owner",
    ...over,
  })

  it("writes nothing for an empty list", () => {
    expect(
      captureStdout(() => {
        writeFindings([])
      }),
    ).toBe("")
  })

  it("prints the count line then each finding, errors before warnings before infos", () => {
    const out = captureStdout(() => {
      writeFindings([
        finding({ severity: "info", code: "UNRESOLVED_CONSUMER", message: "i", source: "x" }),
        finding({
          severity: "error",
          code: "EXCLUSIVE_GROUP_CONFLICT",
          message: "e",
          capability: { file: "f", exportName: "capE" },
        }),
        finding({
          severity: "warning",
          message: "w",
          field: ["user", "email"],
          capability: { file: "f", exportName: "capW" },
        }),
      ])
    })
    expect(out).toBe(
      [
        "",
        "1 error(s), 1 warning(s), 1 info finding(s):",
        "  - [error] [EXCLUSIVE_GROUP_CONFLICT] [capE] e",
        "  - [warning] [CAPABILITY_MISSING_OWNER] [capW] (user.email) w",
        "  - [info] [UNRESOLVED_CONSUMER] i",
        "",
      ].join("\n"),
    )
  })
})

describe("writeManifestChanges (direct)", () => {
  it("prints 'No changes.' when all three buckets are empty", () => {
    const out = captureStdout(() => {
      writeManifestChanges({
        addedCapabilities: [],
        removedCapabilities: [],
        updatedCapabilities: [],
      })
    })
    expect(out).toBe("\nManifest changes since last execution:\n  No changes.\n")
  })

  it("prints Added, Updated, then Removed sections, each only when non-empty", () => {
    const out = captureStdout(() => {
      writeManifestChanges({
        addedCapabilities: ["a1", "a2"],
        updatedCapabilities: [
          { capability: "u1", changes: ["owner: x -> y"], fields: { added: [], removed: [] } },
        ],
        removedCapabilities: ["r1"],
      })
    })
    expect(out).toBe(
      [
        "",
        "Manifest changes since last execution:",
        "  Added:",
        "    - a1",
        "    - a2",
        "  Updated:",
        "    - u1: owner: x -> y",
        "  Removed:",
        "    - r1",
        "",
      ].join("\n"),
    )
  })

  it("prints only the non-empty section (Added alone, no spurious Updated/Removed headers)", () => {
    const out = captureStdout(() => {
      writeManifestChanges({
        addedCapabilities: ["a1"],
        updatedCapabilities: [],
        removedCapabilities: [],
      })
    })
    expect(out).toBe("\nManifest changes since last execution:\n  Added:\n    - a1\n")
    expect(out).not.toContain("Updated:")
    expect(out).not.toContain("Removed:")
  })

  it("prints only Updated when that is the sole non-empty bucket", () => {
    const out = captureStdout(() => {
      writeManifestChanges({
        addedCapabilities: [],
        updatedCapabilities: [
          { capability: "u1", changes: ["c"], fields: { added: [], removed: [] } },
        ],
        removedCapabilities: [],
      })
    })
    expect(out).not.toContain("Added:")
    expect(out).not.toContain("Removed:")
    expect(out).toContain("  Updated:\n    - u1: c\n")
  })
})

describe("resolveOptions (direct)", () => {
  it("resolves every output path against --root and turns empty repeatable lists into undefined", () => {
    const opts = resolveOptions(
      baseArgs({
        root: "/proj",
        location: "out/m.ts",
        docs: "out/D.md",
        ownership: "out/O.md",
        flow: "out/flow",
        evidence: "out/e.json",
      }),
    )
    expect(opts.root).toBe(path.resolve("/proj"))
    expect(opts.location).toBe(path.resolve("/proj", "out/m.ts"))
    expect(opts.evidence).toBe(path.resolve("/proj", "out/e.json"))
    expect(opts.include).toBeUndefined()
    expect(opts.exclude).toBeUndefined()
    expect(opts.packages).toBeUndefined()
  })

  it("keeps non-empty repeatable lists verbatim and passes strict flags + tsconfig through", () => {
    const opts = resolveOptions(
      baseArgs({
        include: ["a"],
        exclude: ["b"],
        packages: ["@x/p"],
        tsconfig: false,
        strict: true,
        strictFlow: true,
        expiringWithinDays: 12,
      }),
    )
    expect(opts.include).toEqual(["a"])
    expect(opts.exclude).toEqual(["b"])
    expect(opts.packages).toEqual(["@x/p"])
    expect(opts.tsconfig).toBe(false)
    expect(opts.strict).toBe(true)
    expect(opts.strictFlow).toBe(true)
    expect(opts.expiringWithinDays).toBe(12)
    // paths left undefined when the flag was absent
    expect(opts.location).toBeUndefined()
  })

  it("defaults root to process.cwd() when --root is absent", () => {
    expect(resolveOptions(baseArgs()).root).toBe(process.cwd())
  })
})

describe("writeGenerationSummary (direct)", () => {
  const emptyChanges = { addedCapabilities: [], removedCapabilities: [], updatedCapabilities: [] }

  it("prints each requested artifact's line, the warning banner, the findings, and the parse-warning list", () => {
    const result = {
      manifest: {
        location: "/p/m.ts",
        snapshot: { capabilities: [{}, {}, {}] },
        changes: emptyChanges,
      },
      documentation: { location: "/p/D.md" },
      usage: { location: "/p/O.md" },
      flow: { location: "/p/flow", files: ["a", "b"] },
      findings: [
        {
          code: "CAPABILITY_MISSING_OWNER",
          family: "governance",
          severity: "warning",
          message: "no owner",
          capability: { file: "f", exportName: "capW" },
        },
      ],
      warnings: [{ file: "x.ts", message: "could not resolve" }],
    } as unknown as ReportResult

    const out = captureStdout(() => {
      writeGenerationSummary({ ownership: "/p/O.md", evidence: "/p/e.json" }, result)
    })
    expect(out).toContain("⚠ 1 unresolved/dropped-capability warning(s) found")
    expect(out).toContain("Wrote manifest: /p/m.ts")
    expect(out).toContain("Discovered 3 active capability(ies).")
    expect(out).toContain("Wrote docs: /p/D.md")
    expect(out).toContain("Wrote dependency & ownership report: /p/O.md")
    expect(out).toContain("Wrote data flow diagram set to: /p/flow (2 file(s))")
    expect(out).toContain("Wrote evidence model: /p/e.json")
    expect(out).toContain("[warning] [CAPABILITY_MISSING_OWNER] [capW] no owner")
    expect(out).toContain("1 parse warning(s):")
    expect(out).toContain("  - x.ts: could not resolve")
  })

  it("omits the ownership line when only --flow (not --ownership) was requested", () => {
    const result = {
      manifest: undefined,
      documentation: undefined,
      usage: { location: "/p/O.md" }, // populated for --flow, but must NOT be printed
      flow: { location: "/p/flow", files: [] },
      findings: [],
      warnings: [],
    } as unknown as ReportResult
    const out = captureStdout(() => {
      writeGenerationSummary({}, result)
    })
    expect(out).not.toContain("dependency & ownership report")
    expect(out).toContain("Wrote data flow diagram set to: /p/flow (0 file(s))")
  })

  it("emits no warning banner, no parse-warning list, and no evidence line when none apply", () => {
    const result = {
      manifest: undefined,
      documentation: undefined,
      usage: undefined,
      flow: undefined,
      findings: [],
      warnings: [],
    } as unknown as ReportResult
    const out = captureStdout(() => {
      writeGenerationSummary({}, result)
    })
    expect(out).not.toContain("⚠")
    expect(out).not.toContain("parse warning(s)")
    expect(out).not.toContain("Wrote evidence model")
    expect(out).toBe("")
  })
})

describe("writeCheckSummary (direct)", () => {
  it("prints an OK/STALE row per requested artifact and the all-up-to-date footer", () => {
    const checkResult = {
      stale: [],
      result: { flow: { files: [] }, findings: [] },
    } as unknown as CheckArtifactsResult
    const out = captureStdout(() => {
      writeCheckSummary(
        { location: "/p/m.ts", docs: "/p/D.md", ownership: "/p/O.md", evidence: "/p/e.json" },
        checkResult,
      )
    })
    expect(out).toContain("Checking for drift")
    expect(out).toContain("manifest")
    expect(out).toContain("evidence")
    expect(out).toContain("OK")
    expect(out).toContain("All generated artifacts are up to date.")
    expect(out).not.toContain("STALE")
  })

  it("marks exactly the stale paths STALE and prints the stale-count footer", () => {
    const checkResult = {
      stale: ["/p/D.md"],
      result: { flow: { files: [] }, findings: [] },
    } as unknown as CheckArtifactsResult
    const out = captureStdout(() => {
      writeCheckSummary({ location: "/p/m.ts", docs: "/p/D.md" }, checkResult)
    })
    expect(out).toMatch(/manifest\s+\S+\s+OK/)
    expect(out).toMatch(/docs\s+\S+\s+STALE/)
    expect(out).toContain("1 artifact(s) are stale or missing")
  })

  it("reports a flow directory stale when any of its files is stale", () => {
    const checkResult = {
      stale: ["/p/flow/a.mmd"],
      result: {
        flow: { files: [{ path: "/p/flow/a.mmd" }, { path: "/p/flow/b.md" }] },
        findings: [],
      },
    } as unknown as CheckArtifactsResult
    const out = captureStdout(() => {
      writeCheckSummary({ flow: "/p/flow" }, checkResult)
    })
    expect(out).toMatch(/flow\s+.*2 file\(s\).*STALE/)
  })

  it("reports a flow directory OK (0 file(s)) when the check produced no flow result at all", () => {
    const checkResult = {
      stale: [],
      result: { flow: undefined, findings: [] },
    } as unknown as CheckArtifactsResult
    const out = captureStdout(() => {
      writeCheckSummary({ flow: "/p/flow" }, checkResult)
    })
    expect(out).toMatch(/flow\s+.*\(0 file\(s\)\)\s+OK/)
    // The row's own label column reads "flow" (not blank).
    expect(out).toMatch(/^ {2}flow {2,}\S/m)
    expect(out).toContain("All generated artifacts are up to date.")
  })

  it("marks a flow directory OK when its files are all clean", () => {
    const checkResult = {
      stale: [],
      result: {
        flow: { files: [{ path: "/p/flow/a.mmd" }, { path: "/p/flow/b.md" }] },
        findings: [],
      },
    } as unknown as CheckArtifactsResult
    const out = captureStdout(() => {
      writeCheckSummary({ flow: "/p/flow" }, checkResult)
    })
    expect(out).toMatch(/flow\s+.*2 file\(s\).*OK/)
    expect(out).not.toContain("STALE")
  })
})

describe("runCheck / runGenerate error handling", () => {
  const opts = () => resolveOptions(baseArgs({ location: "out.ts" }))

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it("runCheck: a non-json run re-throws the underlying failure", async () => {
    const { runCheck } = await import("../../src/cli/index.js")
    const build = await import("../../src/build/index.js")
    vi.spyOn(build, "checkArtifacts").mockRejectedValueOnce(new Error("disk exploded"))
    await expect(runCheck(baseArgs({ location: "out.ts" }), opts())).rejects.toThrow(
      "disk exploded",
    )
  })

  it("runCheck: a --json run swallows the failure into a JSON payload and sets exitCode 1", async () => {
    const { runCheck } = await import("../../src/cli/index.js")
    const build = await import("../../src/build/index.js")
    vi.spyOn(build, "checkArtifacts").mockRejectedValueOnce(new Error("disk exploded"))
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
      chunks.push(String(c))
      return true
    })
    await runCheck(baseArgs({ location: "out.ts", json: true }), opts())
    spy.mockRestore()
    const parsed = JSON.parse(chunks.join("")) as { ok: boolean; error?: { message: string } }
    expect(parsed.ok).toBe(false)
    expect(parsed.error?.message).toContain("disk exploded")
    expect(process.exitCode).toBe(1)
  })

  it("runGenerate: a --json run swallows the failure into a JSON payload and sets exitCode 1", async () => {
    const { runGenerate } = await import("../../src/cli/index.js")
    const build = await import("../../src/build/index.js")
    vi.spyOn(build, "generateDataArtifacts").mockRejectedValueOnce(new Error("boom"))
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
      chunks.push(String(c))
      return true
    })
    await runGenerate(baseArgs({ location: "out.ts", json: true }), opts())
    spy.mockRestore()
    const parsed = JSON.parse(chunks.join("")) as { ok: boolean }
    expect(parsed.ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  it("runGenerate: a non-json run re-throws", async () => {
    const { runGenerate } = await import("../../src/cli/index.js")
    const build = await import("../../src/build/index.js")
    vi.spyOn(build, "generateDataArtifacts").mockRejectedValueOnce(new Error("boom"))
    await expect(runGenerate(baseArgs({ location: "out.ts" }), opts())).rejects.toThrow("boom")
  })
})

describe("writeCheckSummary -- no flow requested", () => {
  it("emits no flow row when --flow was not passed", () => {
    const checkResult = {
      stale: [],
      result: { flow: undefined, findings: [] },
    } as unknown as CheckArtifactsResult
    const out = captureStdout(() => {
      writeCheckSummary({ location: "/p/m.ts" }, checkResult)
    })
    expect(out).not.toMatch(/\bflow\b/)
    expect(out).toContain("manifest")
  })
})

describe("runCheck / runGenerate -- success paths", () => {
  const opts = () => resolveOptions(baseArgs({ location: "out.ts" }))
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it("runCheck: a non-json clean run prints the human summary (not JSON) and exits 0", async () => {
    const { runCheck } = await import("../../src/cli/index.js")
    const build = await import("../../src/build/index.js")
    vi.spyOn(build, "checkArtifacts").mockResolvedValueOnce({
      stale: [],
      result: { flow: undefined, findings: [] },
    } as unknown as CheckArtifactsResult)
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
      chunks.push(String(c))
      return true
    })
    await runCheck(baseArgs({ location: "out.ts" }), opts())
    spy.mockRestore()
    const out = chunks.join("")
    expect(out).toContain("Checking for drift")
    expect(out).toContain("All generated artifacts are up to date.")
    expect(() => JSON.parse(out) as unknown).toThrow()
    expect(process.exitCode).toBe(0)
  })

  it("runCheck: a stale run exits 1", async () => {
    const { runCheck } = await import("../../src/cli/index.js")
    const build = await import("../../src/build/index.js")
    vi.spyOn(build, "checkArtifacts").mockResolvedValueOnce({
      stale: ["out.ts"],
      result: { flow: undefined, findings: [] },
    } as unknown as CheckArtifactsResult)
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    await runCheck(baseArgs({ location: "out.ts" }), opts())
    spy.mockRestore()
    expect(process.exitCode).toBe(1)
  })

  it("runCheck --json: `ok` mirrors staleness (true when clean, false when stale)", async () => {
    const { runCheck } = await import("../../src/cli/index.js")
    const build = await import("../../src/build/index.js")
    const checkSpy = vi.spyOn(build, "checkArtifacts")
    const outSpy = vi.spyOn(process.stdout, "write")
    const run = async (
      stale: string[],
    ): Promise<{ checkResult: { ok: boolean; stale: string[] } }> => {
      checkSpy.mockResolvedValueOnce({
        stale,
        result: { flow: undefined, findings: [] },
      } as unknown as CheckArtifactsResult)
      const chunks: string[] = []
      outSpy.mockImplementationOnce((c: string | Uint8Array) => {
        chunks.push(String(c))
        return true
      })
      await runCheck(baseArgs({ location: "out.ts", json: true }), opts())
      return JSON.parse(chunks.join("")) as { checkResult: { ok: boolean; stale: string[] } }
    }
    const clean = await run([])
    expect(clean.checkResult.ok).toBe(true)
    expect(clean.checkResult.stale).toEqual([])
    const stale = await run(["out.ts"])
    expect(stale.checkResult.ok).toBe(false)
    expect(stale.checkResult.stale).toEqual(["out.ts"])
  })
})
