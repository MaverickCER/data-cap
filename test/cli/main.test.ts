import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataProjectGenerationError } from "../../src/build/errors.js"
import { EVIDENCE_MODEL_SCHEMA_VERSION } from "../../src/build/evidence-model.js"
import { main } from "../../src/cli/index.js"

// Real, end-to-end exercise of main()'s stdout-formatting path -- test/cli/index.test.ts
// only covers parseArgs(), and test/cli/bin.test.ts only spawns the built CLI for
// --help/error/exit-code cases, so the manifest/docs/ownership/flow summary
// formatting below was never actually exercised by any other test.

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
  // so both the manifest pass and the "missing owner" finding have something real.
  await write(
    "features/identity/user.ts",
    `import { createData, documentData } from "@maverickcer/data-cap";

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
    `import { createData } from "@maverickcer/data-cap";
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

describe("main() -- real --location/--docs run", () => {
  it("prints the manifest-written summary and the missing-owner finding, in the CLI's actual format", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--location",
      "src/generated/data.manifest.ts",
      "--docs",
      "docs/DATA.md",
    ]

    await main()

    const output = writes.join("")

    expect(output).toContain("Wrote manifest: ")
    expect(output).toContain(path.join(fixtureRoot, "src/generated/data.manifest.ts"))
    expect(output).toContain("Discovered 2 active capability(ies).")
    expect(output).toContain("Wrote docs: ")
    expect(output).toContain(path.join(fixtureRoot, "docs/DATA.md"))

    expect(output).toContain("warning(s)")
    expect(output).toContain("[CAPABILITY_MISSING_OWNER]")
    expect(output).toContain("[orphanCapability]")

    await expect(
      fs.access(path.join(fixtureRoot, "src/generated/data.manifest.ts")),
    ).resolves.toBeUndefined()
    await expect(fs.access(path.join(fixtureRoot, "docs/DATA.md"))).resolves.toBeUndefined()
  })
})

describe("main() -- --check", () => {
  it("exits 0 and reports everything up to date against a clean, already-generated fixture", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--location",
      "src/generated/data.manifest.ts",
    ]
    await main()
    writes = []

    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--location",
      "src/generated/data.manifest.ts",
      "--check",
    ]
    const manifestPath = path.join(fixtureRoot, "src/generated/data.manifest.ts")
    const before = await fs.readFile(manifestPath, "utf8")

    await main()

    const output = writes.join("")
    expect(output).toContain("manifest")
    expect(output).toContain("OK")
    expect(output).toContain("All generated artifacts are up to date.")
    expect(process.exitCode).toBe(0)
    expect(await fs.readFile(manifestPath, "utf8")).toBe(before)
  })

  it("exits 1 and lists stale artifacts, without touching fixture files, once a capability is added after generation", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--location",
      "src/generated/data.manifest.ts",
    ]
    await main()

    const manifestPath = path.join(fixtureRoot, "src/generated/data.manifest.ts")
    const before = await fs.readFile(manifestPath, "utf8")

    await write(
      "features/billing/billing.ts",
      `import { createData, documentData } from "@maverickcer/data-cap";
const fields = { plan: "" };
export const billingCapability = createData({ fields: fields });
documentData({ fields: fields }, { owner: "billing-team" });
`,
    )

    writes = []
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--location",
      "src/generated/data.manifest.ts",
      "--check",
    ]
    await main()

    const output = writes.join("")
    expect(output).toContain("STALE")
    expect(output).toContain("artifact(s) are stale or missing")
    expect(process.exitCode).toBe(1)
    expect(await fs.readFile(manifestPath, "utf8")).toBe(before)
  })

  it("reports ownership and flow rows too, when both are requested alongside --location", async () => {
    const flags = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--location",
      "src/generated/all.manifest.ts",
      "--ownership",
      "docs/all.OWNERSHIP.md",
      "--flow",
      "docs/all-flow",
    ]
    process.argv = [...flags]
    await main()

    writes = []
    process.argv = [...flags, "--check"]
    await main()

    const output = writes.join("")
    expect(output).toContain("manifest")
    expect(output).toContain("ownership")
    expect(output).toContain("flow")
    expect(output).toContain("All generated artifacts are up to date.")
    expect(process.exitCode).toBe(0)
  })

  it("reports the Removed: section once a previously-generated capability's file is deleted", async () => {
    const location = "src/generated/removed.manifest.ts"
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--location", location]
    await main()

    await fs.rm(path.join(fixtureRoot, "features/orphan/orphan.ts"))

    writes = []
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--location", location]
    await main()

    const output = writes.join("")
    expect(output).toContain("Removed:")
    expect(output).toContain("orphanCapability")
  })
})

describe("main() -- --json wiring", () => {
  it("emits a parseable ok:true JSON report on success", async () => {
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--docs", "docs/DATA.md", "--json"]

    await main()

    const output = writes.join("")
    const payload = JSON.parse(output) as {
      ok: boolean
      documentation?: { location?: string }
      findings?: unknown[]
    }
    expect(payload.ok).toBe(true)
    expect(payload.documentation?.location).toBeDefined()
    expect(payload.findings).toBeDefined()
  })

  it("emits a parseable ok:false JSON report when --strict-docs turns a missing owner into a hard failure", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--docs",
      "docs/DATA.md",
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

describe("main() -- --help", () => {
  it("prints HELP_TEXT and exits 0, without touching any generation path", async () => {
    process.argv = ["node", "data-cap", "--help"]

    await main()

    const output = writes.join("")
    expect(output).toContain("data-cap - generate a manifest")
    expect(output).toContain("Usage:")
    expect(process.exitCode).toBe(0)
  })
})

describe("main() -- none of --location/--docs/--ownership/--flow given", () => {
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
    expect(payload.error?.message).toContain(
      "At least one of --location, --docs, --ownership, --flow, or --evidence is required.",
    )
    expect(process.exitCode).toBe(1)
  })
})

describe("main() -- --ownership output block", () => {
  it("lists an abandoned capability and never claims a write happened when only --flow (not --ownership) is requested", async () => {
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--flow", "docs/flow"]

    await main()

    const output = writes.join("")
    expect(output).toContain("Wrote data flow diagram set to: ")
    expect(output).not.toContain("Wrote dependency & ownership report")
    expect(output).toContain("[ABANDONED_CAPABILITY]")
  })

  it("prints the ownership report path only when --ownership is actually requested", async () => {
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--ownership", "docs/OWNERSHIP.md"]

    await main()

    const output = writes.join("")
    expect(output).toContain("Wrote dependency & ownership report: ")
    expect(output).toContain(path.join(fixtureRoot, "docs/OWNERSHIP.md"))
    await expect(fs.access(path.join(fixtureRoot, "docs/OWNERSHIP.md"))).resolves.toBeUndefined()
  })
})

describe("main() -- --evidence output block", () => {
  it("writes the composed Evidence Model as JSON and prints its path", async () => {
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
    const written = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, "docs/data.evidence.json"), "utf8"),
    ) as { schemaVersion: number; capability: { capabilities: readonly unknown[] } }
    expect(written.schemaVersion).toBe(EVIDENCE_MODEL_SCHEMA_VERSION)
    expect(written.capability.capabilities).toHaveLength(2)
  })

  it("--evidence alone satisfies the 'at least one target' requirement, with no --location/--docs/--ownership/--flow", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
    ]

    await main()

    expect(process.exitCode).not.toBe(1)
    await expect(
      fs.access(path.join(fixtureRoot, "docs/data.evidence.json")),
    ).resolves.toBeUndefined()
  })

  it("--check reports the evidence artifact as its own row, OK when fresh", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
    ]
    await main()
    writes = []

    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--evidence",
      "docs/data.evidence.json",
      "--check",
    ]
    await main()

    const output = writes.join("")
    expect(output).toContain("evidence")
    expect(output).toContain("OK")
    expect(process.exitCode).toBe(0)
  })
})

describe("main() -- --flow output with a sensitive boundary crossing", () => {
  it("emits SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY for a restricted field with a declared external endpoint", async () => {
    await write(
      "features/payments/payments.ts",
      `import { createData, documentData } from "@maverickcer/data-cap";
const fields = { cardNumber: "" };
export const paymentsCapability = createData({
  fields: fields,
  getters: { getCard: { writes: { cardNumber: true } } },
});
documentData({ fields: fields }, {
  owner: "payments-team",
  fields: { cardNumber: { sensitivity: "restricted", protections: "encrypted at rest" } },
  getters: {
    getCard: { endpoints: [{ direction: "input", kind: "external-service", name: "stripe-api" }] },
  },
});
`,
    )

    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--include",
      "features/payments/**",
      "--flow",
      "docs/flow",
    ]

    await main()

    const output = writes.join("")
    expect(output).toContain("[SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY]")
    expect(output).toContain("Wrote data flow diagram set to: ")
    await expect(
      fs.access(path.join(fixtureRoot, "docs/flow/overview.md")),
    ).resolves.toBeUndefined()
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
      "--location",
      "src/generated/exclude-package.manifest.ts",
    ]

    await main()

    const output = writes.join("")
    expect(output).toContain("Discovered 1 active capability(ies).") // orphan is filtered out by --exclude
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
      `import { createData } from "@maverickcer/data-cap";\nexport const aliasCapability = createData({ fields: { key: "" } });\n`,
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
      "--ownership",
      "docs/alias.OWNERSHIP.md",
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
      "--ownership",
      "docs/alias-disabled.OWNERSHIP.md",
      "--no-tsconfig",
    ]

    await main()

    const output = writes.join("")
    expect(output).toContain("[UNRESOLVED_CONSUMER]")
    expect(output).not.toContain("[ABANDONED_CAPABILITY]")
  })
})

describe("main() -- manifest changes since last execution", () => {
  it("reports everything as added on the first run, and 'No changes.' on an immediate rerun against the same source", async () => {
    const location = "src/generated/changes.manifest.ts"
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--location", location]

    await main()
    const firstOutput = writes.join("")
    expect(firstOutput).toContain("Manifest changes since last execution:")
    expect(firstOutput).toContain("Added:")
    expect(firstOutput).toContain("userCapability")

    writes.length = 0
    await main()
    const secondOutput = writes.join("")
    expect(secondOutput).toContain("Manifest changes since last execution:")
    expect(secondOutput).toContain("No changes.")
    expect(secondOutput).not.toContain("Added:")
  })

  it("reports an Updated: section after a field is added to an existing capability", async () => {
    const location = "src/generated/changes-updated.manifest.ts"
    process.argv = ["node", "data-cap", "--root", fixtureRoot, "--location", location]
    await main()
    writes.length = 0

    await write(
      "features/identity/user.ts",
      `import { createData, documentData } from "@maverickcer/data-cap";

const fields = { email: "", displayName: "" };

export const userCapability = createData({ fields: fields });

documentData({ fields: fields }, {
  owner: "identity-team",
  fields: { email: { description: "The user's email address." } },
});
`,
    )

    await main()
    const output = writes.join("")
    expect(output).toContain("Updated:")
    expect(output).toContain("userCapability:")
    expect(output).not.toContain("Added:")
  })
})

describe("main() -- --check surfaces findings for visibility without changing its stale-only exit code", () => {
  // checkArtifacts() never throws (see check-artifacts.ts) -- --check's own
  // exit code reflects staleness only, per HELP_TEXT ("exits 1 if any is
  // stale or missing"), even with --strict-docs escalating a finding to
  // error severity. This is a deliberate scope boundary from the approved
  // plan, not an oversight: --check answers "did someone forget to
  // regenerate," a different question from "does the content pass strict
  // review" (which the real, --check-less run's DataProjectGenerationError
  // throw already answers).
  it("still reports up to date and exits 0 even with --strict-docs, once the docs artifact is actually current", async () => {
    const flags = ["node", "data-cap", "--root", fixtureRoot, "--docs", "docs/DATA.md"]
    process.argv = [...flags]
    await main()

    writes = []
    process.argv = [...flags, "--check", "--strict-docs"]
    await main()

    const output = writes.join("")
    expect(output).toContain("All generated artifacts are up to date.")
    expect(output).toContain("[CAPABILITY_MISSING_OWNER]") // surfaced for visibility
    expect(process.exitCode).toBe(0)
  })

  it("--json: ok:true with a checkResult.ok:true and the findings array populated, even with --strict-docs", async () => {
    const flags = ["node", "data-cap", "--root", fixtureRoot, "--docs", "docs/DATA.md"]
    process.argv = [...flags]
    await main()

    writes = []
    process.argv = [...flags, "--check", "--strict-docs", "--json"]
    await main()

    const output = writes.join("")
    const payload = JSON.parse(output) as {
      ok: boolean
      checkResult?: { ok: boolean; stale: string[] }
      findings?: { code: string }[]
    }
    expect(payload.ok).toBe(true)
    expect(payload.checkResult?.ok).toBe(true)
    expect(payload.checkResult?.stale).toEqual([])
    expect(payload.findings?.some((f) => f.code === "CAPABILITY_MISSING_OWNER")).toBe(true)
    expect(process.exitCode).toBe(0)
  })
})

describe("main() -- normal-flow non---json error propagation", () => {
  it("propagates the raw error via a bare throw when --json was not passed", async () => {
    process.argv = [
      "node",
      "data-cap",
      "--root",
      fixtureRoot,
      "--docs",
      "docs/DATA.md",
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
    process.argv = ["node", "data-cap", "init"]
    const originalCwd = process.cwd()
    await fs.mkdir(fixtureRoot, { recursive: true })
    await fs.writeFile(path.join(fixtureRoot, "package.json"), '{"name": "demo"}')
    process.chdir(fixtureRoot)
    try {
      await main()
    } finally {
      process.chdir(originalCwd)
    }

    expect(process.exitCode).toBe(0)
    expect(writes.join("")).toContain("data-cap initialized")
    await expect(fs.access(path.join(fixtureRoot, "data.ts"))).resolves.toBeUndefined()
  })

  it("`--help` alone (no init token) still prints the generator help", async () => {
    process.argv = ["node", "data-cap", "--help"]
    await main()
    const output = writes.join("")
    expect(output).toContain("data-cap - generate a manifest")
    expect(output).not.toContain("Usage: data-cap init\n\nScaffolds")
  })
})
