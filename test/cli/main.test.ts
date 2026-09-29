import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataProjectGenerationError } from "../../src/build/errors.js"
import { EVIDENCE_MODEL_SCHEMA_VERSION } from "../../src/build/evidence-model.js"
import { main } from "../../src/cli/index.js"

// Real, end-to-end exercise of main()'s stdout-formatting path -- test/cli/index.test.ts
// only covers parseArgs()/the individual write*Summary() helpers, and
// test/cli/bin.test.ts only spawns the built CLI for --help/error/exit-code
// cases, so main()'s real generate/check wiring below was never actually
// exercised by any other test. `--evidence` is the only flag this CLI still
// accepts (ADR 0066) -- manifest/docs/ownership/flow generation (and their
// own summary formatting) moved to direct `data-cap/build` calls, covered by
// test/build/generate-data-artifacts.test.ts instead.

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.resolve(here, "fixtures-main")

async function write(relativePath: string, content: string): Promise<string> {
  const filePath = path.join(fixtureRoot, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
  return filePath
}

let writes: string[]
let originalArgv: string[]

beforeEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true })

  // One owned capability (userCapability) and one unowned one (orphanCapability),
  // so both the usage scan and the "missing owner" finding have something real.
  await write(
    "features/identity/user.ts",
    `import { createData, documentData } from "data-cap";

const fields = { email: "" };

export const userCapability = createData({ fields: fields });

documentData({ fields: fields }, {
  owner: "identity-team",
  fields: { email: { description: "The user's email address." } },
});
`,
  )
  await write(
    "features/orphan/orphan.ts",
    `import { createData } from "data-cap";
export const orphanCapability = createData({ fields: { note: "" } });
`,
  )

  writes = []
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk))
    return true
  })

  originalArgv = process.argv
})

afterEach(async () => {
  vi.restoreAllMocks()
  process.argv = originalArgv
  process.exitCode = undefined
  await fs.rm(fixtureRoot, { recursive: true, force: true })
})

describe("main() -- --help", () => {
  it("prints HELP_TEXT and exits 0, without touching any generation path", async () => {
    process.argv = ["node", "data-cap", "--help"]

    await main()

    const output = writes.join("")
    expect(output).toContain("data-cap - generate a persisted Evidence Model")
    expect(output).toContain("Usage:")
    expect(process.exitCode).toBe(0)
  })
})

describe("main() -- no --evidence given", () => {
  it("prints HELP_TEXT and exits 1 without --json", async () => {
    process.argv = ["node", "data-cap", "--root", fixtureRoot]

    await main()

    const output = writes.join("")
    expect(output).toContain("Usage:")
    expect(process.exitCode).toBe(1)
  })

  it("emits a machine-readable failure and exits 1 with --json", async () => {
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--json"]

    await main()

    const output = writes.join("")
    const payload = JSON.parse(output) as { ok: boolean; error?: { message: string } }
    expect(payload.ok).toBe(false)
    expect(payload.error?.message).toBe("--evidence is required.")
    expect(process.exitCode).toBe(1)
  })

  it("rejects each removed flag as unknown, through main()'s own parseArgs() call", async () => {
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--location", "out.ts"]

    await expect(main()).rejects.toThrow(/Unknown argument: --location/)
  })
})

describe("main() -- real --evidence run", () => {
  it("writes the composed Evidence Model as JSON, prints its path, and surfaces the missing-owner finding", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
    ]

    await main()

    const output = writes.join("")
    expect(output).toContain("Wrote evidence model: ")
    expect(output).toContain(path.join(fixtureRoot, "docs/data.evidence.json"))
    expect(output).toContain("warning(s)")
    expect(output).toContain("[CAPABILITY_MISSING_OWNER]")
    expect(output).toContain("[orphanCapability]")

    const written = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, "docs/data.evidence.json"), "utf8"),
    ) as { schemaVersion: number; capability: { capabilities: readonly unknown[] } }
    expect(written.schemaVersion).toBe(EVIDENCE_MODEL_SCHEMA_VERSION)
    expect(written.capability.capabilities).toHaveLength(2)
  })

  // The CLI can no longer request a manifest/docs/ownership report/flow set
  // (ADR 0066) -- `result.manifest`/`result.documentation`/`result.flow` are
  // always undefined from a real CLI run, so their own summary lines (and
  // the "changes since last execution" section) never print.
  it("never prints manifest/docs/ownership/flow lines, since the CLI can no longer request any of them", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
    ]

    await main()

    const output = writes.join("")
    expect(output).not.toContain("Wrote manifest")
    expect(output).not.toContain("Wrote docs")
    expect(output).not.toContain("dependency & ownership report")
    expect(output).not.toContain("Wrote data flow diagram")
    expect(output).not.toContain("Manifest changes since last execution")
  })
})

describe("main() -- --json wiring", () => {
  it("emits a parseable ok:true JSON report on success, with the full evidence model populated", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
      "--json",
    ]

    await main()

    const output = writes.join("")
    const payload = JSON.parse(output) as {
      ok: boolean
      evidence?: { schemaVersion: number }
      findings?: unknown[]
    }
    expect(payload.ok).toBe(true)
    expect(payload.evidence?.schemaVersion).toBe(EVIDENCE_MODEL_SCHEMA_VERSION)
    expect(payload.findings).toBeDefined()
  })

  it("emits a parseable ok:false JSON report when --strict-docs turns a missing owner into a hard failure", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
      "--strict-docs",
      "--json",
    ]

    await main()

    const output = writes.join("")
    const payload = JSON.parse(output) as { ok: boolean; error?: { name: string } }
    expect(payload.ok).toBe(false)
    expect(payload.error?.name).toBe("DataProjectGenerationError")
    expect(process.exitCode).toBe(1)
  })
})

describe("main() -- --check", () => {
  it("exits 0 and reports the evidence artifact up to date against a clean, already-generated fixture", async () => {
    const flags = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
    ]
    process.argv = [...flags]
    await main()
    writes = []

    process.argv = [...flags, "--check"]
    const evidencePath = path.join(fixtureRoot, "docs/data.evidence.json")
    const before = await fs.readFile(evidencePath, "utf8")

    await main()

    const output = writes.join("")
    expect(output).toContain("evidence")
    expect(output).toContain("OK")
    expect(output).toContain("All generated artifacts are up to date.")
    expect(process.exitCode).toBe(0)
    expect(await fs.readFile(evidencePath, "utf8")).toBe(before)
  })

  it("exits 1 and lists the stale evidence artifact, without touching fixture files, once a capability is added after generation", async () => {
    const flags = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
    ]
    process.argv = [...flags]
    await main()

    const evidencePath = path.join(fixtureRoot, "docs/data.evidence.json")
    const before = await fs.readFile(evidencePath, "utf8")

    await write(
      "features/billing/billing.ts",
      `import { createData, documentData } from "data-cap";
const fields = { plan: "" };
export const billingCapability = createData({ fields: fields });
documentData({ fields: fields }, { owner: "billing-team" });
`,
    )

    writes = []
    process.argv = [...flags, "--check"]
    await main()

    const output = writes.join("")
    expect(output).toContain("STALE")
    expect(output).toContain("artifact(s) are stale or missing")
    expect(process.exitCode).toBe(1)
    expect(await fs.readFile(evidencePath, "utf8")).toBe(before)
  })

  it("--check surfaces findings for visibility, escalated -- and, unlike --docs's DATA.md, --evidence's persisted JSON embeds the finding model itself, so a --strict-docs check against a non-strict generation genuinely IS stale, not just noisier", async () => {
    // checkArtifacts() never throws (see check-artifacts.ts) -- it diffs
    // computed content against disk and never itself blocks on a blocking
    // (error-severity) finding, unlike a real (--check-less) run, which
    // throws DataProjectGenerationError before writing anything. But
    // "content" for --evidence is the full persisted EvidenceModel, and
    // that model embeds `finding.findings` -- severities included -- so
    // adding --strict-docs on the check side alone (without regenerating)
    // changes the bytes `checkArtifacts` recomputes, and the artifact
    // correctly reads as stale. (--docs's DATA.md has no such coupling:
    // `generateDocumentation()`'s `findings` are a value returned
    // alongside `.content`, never rendered into it, which is why the
    // pre-ADR-0066 version of this test -- run against --docs -- could
    // stay "up to date" under the same kind of flag mismatch.)
    const flags = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
    ]
    process.argv = [...flags]
    await main()

    writes = []
    process.argv = [...flags, "--check", "--strict-docs"]
    await main()

    const output = writes.join("")
    expect(output).toContain("STALE")
    expect(output).toContain("[error] [CAPABILITY_MISSING_OWNER]") // surfaced for visibility, escalated
    // --check's own exit code still reflects staleness, not the escalated
    // severity directly -- it's just that here the two happen to coincide,
    // since the escalation is precisely what makes the recomputed content
    // differ from what's on disk.
    expect(process.exitCode).toBe(1)
  })

  it("--json: ok:true (the call itself succeeded) even though checkResult.ok is false and the findings array carries the escalated finding", async () => {
    const flags = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
    ]
    process.argv = [...flags]
    await main()

    writes = []
    process.argv = [...flags, "--check", "--strict-docs", "--json"]
    await main()

    const output = writes.join("")
    const payload = JSON.parse(output) as {
      ok: boolean
      checkResult?: { ok: boolean; stale: string[] }
      findings?: { code: string; severity: string }[]
    }
    expect(payload.ok).toBe(true)
    expect(payload.checkResult?.ok).toBe(false)
    expect(payload.checkResult?.stale).toEqual([path.join(fixtureRoot, "docs/data.evidence.json")])
    expect(
      payload.findings?.some(
        (f) => f.code === "CAPABILITY_MISSING_OWNER" && f.severity === "error",
      ),
    ).toBe(true)
    expect(process.exitCode).toBe(1)
  })
})

describe("main() -- --exclude and --package flow through to generateDataArtifacts()", () => {
  it("--exclude narrows discovery and --package (an unresolvable name) surfaces as a harmless parse warning", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--exclude",
      "**/orphan/**",
      "--package",
      "@fixtures/does-not-exist",
      "--evidence",
      "docs/data.evidence.json",
    ]

    await main()

    const output = writes.join("")
    const written = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, "docs/data.evidence.json"), "utf8"),
    ) as { capability: { capabilities: readonly unknown[] } }
    expect(written.capability.capabilities).toHaveLength(1) // orphan is filtered out by --exclude
    expect(output).toContain("parse warning(s):")
    expect(output).toContain("@fixtures/does-not-exist")
  })
})

describe("main() -- --tsconfig/--no-tsconfig flow through to generateDataArtifacts()", () => {
  beforeEach(async () => {
    await write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["features/*"] } } }),
    )
    await write(
      "features/alias/alias.ts",
      `import { createData } from "data-cap";\nexport const aliasCapability = createData({ fields: { key: "" } });\n`,
    )
    await write(
      "src/alias-consumer.ts",
      `import { aliasCapability } from "@/alias/alias.js";\naliasCapability.fields.key;\n`,
    )
  })

  it("default (auto-detected tsconfig.json): the aliased capability is not reported abandoned", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--include",
      "features/alias/**",
      "--include",
      "src/alias-consumer.ts",
      "--evidence",
      "docs/alias.evidence.json",
    ]

    await main()

    const output = writes.join("")
    expect(output).not.toContain("ABANDONED_CAPABILITY")
  })

  it("--no-tsconfig disables alias resolution -- the same-named import no longer resolves directly, downgrading to an unresolved-consumer finding", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--include",
      "features/alias/**",
      "--include",
      "src/alias-consumer.ts",
      "--evidence",
      "docs/alias-disabled.evidence.json",
      "--no-tsconfig",
    ]

    await main()

    const output = writes.join("")
    expect(output).toContain("[UNRESOLVED_CONSUMER]")
    expect(output).not.toContain("[ABANDONED_CAPABILITY]")
  })
})

describe("main() -- normal-flow non-json error propagation", () => {
  it("propagates the raw error via a bare throw when --json was not passed", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
      "--strict-docs",
    ]

    await expect(main()).rejects.toThrow(DataProjectGenerationError)
  })
})

describe("main() -- init subcommand dispatch", () => {
  it("routes `init` (first positional token) to the scaffolder, not parseArgs", async () => {
    // parseArgs() would throw "Unknown argument: init" -- reaching the init
    // help text at all proves main() intercepted before parseArgs.
    process.argv = ["node", "data-cap", "init", "--help"]

    await main()

    expect(writes.join("")).toContain("Usage: data-cap init")
    expect(process.exitCode).toBe(0)
  })

  it("scaffolds into the current directory and exits 0", async () => {
    // Mocks the `process.cwd` FUNCTION rather than calling the real
    // `process.chdir()` -- the latter genuinely cannot run under a
    // `worker_threads`-pooled test runner (Node itself throws
    // "process.chdir() is not supported in workers"), which is exactly the
    // pool Stryker's own coverageAnalysis dry run uses. Mocking the
    // function is ordinary object patching, unaffected by that
    // restriction, while still exercising `runInitCommand`'s real
    // `process.cwd()`-reading default path (see src/cli/init.ts).
    process.argv = ["node", "data-cap", "init"]
    await fs.mkdir(fixtureRoot, { recursive: true })
    await fs.writeFile(path.join(fixtureRoot, "package.json"), '{"name": "demo"}')
    vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot)

    await main()

    expect(process.exitCode).toBe(0)
    expect(writes.join("")).toContain("data-cap initialized")
    await expect(fs.access(path.join(fixtureRoot, "data.ts"))).resolves.toBeUndefined()
  })

  it("`--help` alone (no init token) still prints the generator help", async () => {
    process.argv = ["node", "data-cap", "--help"]
    await main()
    const output = writes.join("")
    expect(output).toContain("data-cap - generate a persisted Evidence Model")
    expect(output).not.toContain("Usage: data-cap init\n\nScaffolds")
  })
})
