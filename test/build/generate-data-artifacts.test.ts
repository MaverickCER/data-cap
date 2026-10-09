import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { generateDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import { checkArtifacts } from "../../src/build/check-artifacts.js"
import { DataProjectGenerationError } from "../../src/build/errors.js"
import type { ManifestSnapshot } from "../../src/build/manifest-snapshot.js"
import { EVIDENCE_MODEL_SCHEMA_VERSION } from "../../src/build/evidence-model.js"
import type { EvidenceModel } from "../../src/build/evidence-model.js"
import { PACKAGE_VERSION } from "../../src/build/package-version.js"
import { nodeBuildFs } from "../support/build-filesystem.js"
import * as generateUsageModule from "../../src/build/generate-usage.js"
import * as generateDocumentationModule from "../../src/build/generate-documentation.js"
import * as generateFlowModule from "../../src/build/generate-flow.js"
import * as evidenceModelModule from "../../src/build/evidence-model.js"
import * as evidenceFingerprintModule from "../../src/build/evidence-fingerprint.js"

describe("generateDataArtifacts", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-artifacts-test-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function writeFile(relativePath: string, content: string): Promise<string> {
    const filePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, "utf8")
    return filePath
  }

  it("writes a manifest file and its snapshot sidecar", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const location = path.join(root, "generated", "manifest.ts")
    const result = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })

    expect(result.hasBlockingErrors).toBe(false)
    const content = await fs.readFile(location, "utf8")
    expect(content).toContain("userCapability")
    const snapshot = await fs.readFile(path.join(root, ".data-cap-manifest-snapshot.json"), "utf8")
    const parsed = JSON.parse(snapshot) as ManifestSnapshot
    expect(parsed.capabilities).toHaveLength(1)
    // A capability with no dynamicAccess citations gets no `citationSnapshots`
    // key at all -- not the key set to `undefined`.
    expect("citationSnapshots" in result.manifest!.snapshot.capabilities[0]!).toBe(false)
  })

  it("writes nothing at all and throws when a blocking finding exists", async () => {
    await writeFile(
      "a.ts",
      `export const a = createData({ fields: { x: "" } });\ndocumentData({ fields: { x: "" } }, { exclusiveGroup: "group" });`,
    )
    await writeFile(
      "b.ts",
      `export const b = createData({ fields: { y: "" } });\ndocumentData({ fields: { y: "" } }, { exclusiveGroup: "group" });`,
    )
    const location = path.join(root, "generated", "manifest.ts")

    await expect(
      generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location }),
    ).rejects.toThrow(DataProjectGenerationError)
    await expect(fs.access(location)).rejects.toThrow()
  })

  it("computes documentation's changes-since-last-report against a real persisted snapshot across two runs", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const location = path.join(root, "generated", "manifest.ts")
    const docs = path.join(root, "generated", "CAPABILITIES.md")

    const first = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      location,
      docs,
    })
    expect(first.documentation?.content).toContain("**Added:**")

    const second = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      location,
      docs,
    })
    expect(second.documentation?.content).toContain("_No changes since the last report._")
  })

  it("renders 'no previous snapshot' when --docs is used without --location or --evidence (no change-detection ran at all)", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const docs = path.join(root, "generated", "CAPABILITIES.md")
    const result = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, docs })
    expect(result.documentation?.content).toContain(
      "_No previous snapshot to compare against (first report)._",
    )
  })

  it("renders a real changes-since-last-report section for --docs+--evidence with no --location (F2)", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const docs = path.join(root, "generated", "CAPABILITIES.md")
    const evidence = path.join(root, "evidence.json")

    // First run: no previous snapshot yet, so userCapability is "added" --
    // change-detection ran because of --evidence, not --location.
    const first = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      docs,
      evidence,
    })
    expect(first.manifest).toBeUndefined()
    expect(first.documentation?.content).toContain("**Added:**")

    // Second run against the persisted sidecar: nothing changed.
    const second = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      docs,
      evidence,
    })
    expect(second.documentation?.content).toContain("_No changes since the last report._")
  })

  it("generates the ownership report only when --ownership is requested", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const ownership = path.join(root, "generated", "OWNERSHIP.md")
    const result = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      ownership,
    })
    expect(result.usage).toBeDefined()
    await expect(fs.access(ownership)).resolves.toBeUndefined()
  })

  it("generates the full flow artifact set only when --flow is requested", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const flow = path.join(root, "generated", "flow")
    const result = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, flow })
    expect(result.flow).toBeDefined()
    await expect(fs.access(path.join(flow, "overview.md"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(flow, "overview.mmd"))).resolves.toBeUndefined()
  })

  it("does not write an ownership report file when only --flow (not --ownership) is requested, but still scans usage", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const flow = path.join(root, "generated", "flow")
    const result = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, flow })
    expect(result.usage).toBeDefined()
    expect(result.findings.some((f) => f.code === "ABANDONED_CAPABILITY")).toBe(true)
  })

  it("feeds the usage scan's real edges and the static findings into the --flow artifacts", async () => {
    await writeFile(
      "user.ts",
      [
        `export const userCapability = createData({`,
        `  fields: { email: "" },`,
        `  getters: { getEmail: { execute: async () => "", processor: (r) => ({ email: r }), writes: { email: true } } },`,
        `});`,
      ].join("\n"),
    )
    await writeFile(
      "consumer.ts",
      `import { userCapability } from "./user.js";\nuserCapability.fields.email;`,
    )
    const flowDir = path.join(root, "generated", "flow")
    const result = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      flow: flowDir,
    })

    const overview = result.flow?.files.find((f) => f.path.endsWith("overview.md"))?.content ?? ""
    // The static CAPABILITY_MISSING_OWNER finding is folded into the flow review.
    expect(overview).toContain("**CAPABILITY_MISSING_OWNER**")

    // The scan's real edges reach the diagram: the consumer node is drawn.
    const capDiagram =
      result.flow?.files.find((f) => f.path.endsWith("userCapability.mmd"))?.content ?? ""
    expect(capDiagram).toContain('["consumer.ts"]')

    expect(result.findings.some((f) => f.code === "ABANDONED_CAPABILITY")).toBe(false)
    expect(result.usage.edges.length).toBeGreaterThan(0)
  })

  it("applies the default 30-day expiring-soon window to the Lifecycle Model when --expiring-within-days is omitted", async () => {
    await writeFile(
      "user.ts",
      [
        `export const u = createData({ fields: { email: "" } });`,
        `documentData({ fields: { email: "" } }, { owner: "team", expiresAt: "2026-01-20" });`,
      ].join("\n"),
    )
    const result = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      generatedAt: new Date("2026-01-01T00:00:00.000Z"), // 19 days before the expiry
    })
    expect(result.evidence.lifecycle.expiring.map((e) => e.exportName)).toContain("u")
  })

  it("honors a caller-supplied expiringWithinDays, not silently falling back to the default", async () => {
    await writeFile(
      "user.ts",
      [
        `export const u = createData({ fields: { email: "" } });`,
        `documentData({ fields: { email: "" } }, { owner: "team", expiresAt: "2026-01-21" });`,
      ].join("\n"),
    )
    // 20 days out: inside the 30-day default window, outside a 5-day one.
    const result = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiringWithinDays: 5,
    })
    expect(result.evidence.lifecycle.expiring.map((e) => e.exportName)).not.toContain("u")
  })

  describe("cross-package discovery (--package)", () => {
    it("surfaces one warning for a --package name that cannot be resolved", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const location = path.join(root, "generated", "manifest.ts")
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location,
        packages: ["@fixtures/does-not-exist"],
      })
      expect(
        result.warnings.some(
          (w) => w.file === "(package) @fixtures/does-not-exist" && w.message.includes("installed"),
        ),
      ).toBe(true)
    })

    it("resolves an omitted --package list to an empty allowlist -- no phantom package warning", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const result = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false })
      expect(result.warnings.filter((w) => w.file.startsWith("(package)"))).toEqual([])
    })

    it("threads an explicit --tsconfig path through to linkCapabilityFiles, not just the default auto-detected tsconfig.json", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const customPath = path.join(root, "custom.tsconfig.json")
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: customPath,
      })
      // A nonexistent *explicit* tsconfig path warns (see
      // loadTsconfigPaths's own isExplicit distinction) -- unlike the
      // default auto-detect, which silently no-ops when tsconfig.json
      // simply isn't there. Getting this warning at all proves `tsconfig`
      // was actually forwarded, not silently dropped.
      expect(result.warnings.some((w) => w.file === "custom.tsconfig.json")).toBe(true)
    })

    it("eagerly discovers and links a capability declared via an allow-listed package's dataCap.schema field", async () => {
      await writeFile("package.json", JSON.stringify({ name: "fixture-root", private: true }))
      await writeFile(
        "node_modules/@fixtures/pkg-a/package.json",
        JSON.stringify({
          name: "@fixtures/pkg-a",
          main: "./index.js",
          dataCap: { schema: "./data.schema.ts" },
        }),
      )
      await writeFile("node_modules/@fixtures/pkg-a/index.js", "module.exports = {};\n")
      await writeFile(
        "node_modules/@fixtures/pkg-a/data.schema.ts",
        `export const pkgACapability = createData({ fields: { id: "" } });`,
      )

      const location = path.join(root, "generated", "manifest.ts")
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location,
        packages: ["@fixtures/pkg-a"],
      })

      expect(
        result.manifest?.snapshot.capabilities.some((c) => c.exportName === "pkgACapability"),
      ).toBe(true)
      const content = await fs.readFile(location, "utf8")
      expect(content).toContain("pkgACapability")
    })
  })

  it("the usage scan's real edges populate --docs's consumption column even without --ownership requested (F1)", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });\ndocumentData({ fields: { email: "" } }, { owner: "team" });`,
    )
    await writeFile(
      "consumer.ts",
      `import { userCapability } from "./user.js";\nuserCapability.fields.email;`,
    )
    const docs = path.join(root, "generated", "CAPABILITIES.md")

    // F1: the usage scan always runs now, so --docs alone (no --ownership)
    // already sees the real, proven consumption position -- never
    // "(not scanned)" any more.
    const docsOnly = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, docs })
    expect(docsOnly.documentation?.content).not.toContain("(not scanned)")
    expect(docsOnly.documentation?.content).toContain("consumer.ts")

    const docsAndOwnership = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      docs,
      ownership: path.join(root, "generated", "OWNERSHIP.md"),
    })
    expect(docsAndOwnership.documentation?.content).toContain("consumer.ts")
  })

  it("computes zero written artifacts when nothing is requested, but still runs static rules and the usage scan", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const result = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false })
    expect(result.manifest).toBeUndefined()
    expect(result.documentation).toBeUndefined()
    // F1: the usage scan always runs now, regardless of flags -- only its
    // report *file write* stays opt-in (gated on --ownership).
    expect(result.usage).toBeDefined()
    expect(result.usage.location).toBeUndefined()
    expect(result.flow).toBeUndefined()
    expect(result.findings.some((f) => f.code === "CAPABILITY_MISSING_OWNER")).toBe(true)
  })

  describe("dynamicAccess citation lifecycle end to end (ADR 0053)", () => {
    it("ages a citation across two real runs: declared+fresh, then stale after the cited file changes", async () => {
      await writeFile("legacy.ts", "// pretend legacy dynamic-access site\nconst x = 1;\n")
      await writeFile(
        "user.ts",
        [
          `export const userCapability = createData({`,
          `  fields: { email: "" },`,
          `  getters: { getUser: { execute: async () => "", processor: (r) => ({ email: r }), writes: { email: true } } },`,
          `});`,
          `documentData({ fields: { email: "" } }, {`,
          `  evidence: { fields: { email: { dynamicAccess: ["legacy.ts:2:7"] } } },`,
          `});`,
        ].join("\n"),
      )
      // A real (bare-import) consumer -- without one, the capability itself
      // is "abandoned" and deriveUsageFindings short-circuits before it
      // ever reaches the per-field dynamicAccess check. Deliberately never
      // reads `.fields.email` directly -- the field must stay unproven for
      // this test to actually exercise the dynamicAccess precedence path.
      await writeFile(
        "consumer.ts",
        `import { userCapability } from "./user.js";\nvoid userCapability;`,
      )
      const location = path.join(root, "generated", "manifest.ts")
      const ownership = path.join(root, "generated", "OWNERSHIP.md")

      // Run 1: the citation is declared and its cited file exists -- fresh,
      // no prior snapshot to compare against, so no staleness finding yet.
      const first = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location,
        ownership,
      })
      expect(first.findings.some((f) => f.code === "STALE_DYNAMIC_ACCESS_CITATION")).toBe(false)
      expect(first.findings.some((f) => f.code === "MISSING_DYNAMIC_ACCESS_CITATION")).toBe(false)
      const snapshotAfterFirst = JSON.parse(
        await fs.readFile(path.join(root, ".data-cap-manifest-snapshot.json"), "utf8"),
      ) as { capabilities: { citationSnapshots?: Record<string, unknown> }[] }
      expect(snapshotAfterFirst.capabilities[0]?.citationSnapshots?.["email"]).toBeDefined()

      // The cited file changes underneath the citation.
      await writeFile("legacy.ts", "// this file has now changed\nconst x = 2;\n")

      // Run 2: same declared citation, but the previous run's recorded
      // hash no longer matches -- the developer's own assertion can't be
      // re-confirmed, and this must be a real, warning-severity finding.
      const second = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location,
        ownership,
      })
      expect(second.findings).toContainEqual(
        expect.objectContaining({
          code: "STALE_DYNAMIC_ACCESS_CITATION",
          family: "citation",
          severity: "warning",
          field: ["email"],
        }),
      )
      // FIELD_DYNAMIC_ACCESS_DECLARED still fires too -- it states what was
      // asserted, independent of the assertion's own integrity check.
      expect(second.findings.some((f) => f.code === "FIELD_DYNAMIC_ACCESS_DECLARED")).toBe(true)
    })

    it("flags MISSING_DYNAMIC_ACCESS_CITATION when a previously-valid citation's file is deleted", async () => {
      const legacyPath = await writeFile("legacy.ts", "const x = 1;\n")
      await writeFile(
        "user.ts",
        [
          `export const userCapability = createData({ fields: { email: "" } });`,
          `documentData({ fields: { email: "" } }, {`,
          `  evidence: { fields: { email: { dynamicAccess: ["legacy.ts:1:1"] } } },`,
          `});`,
        ].join("\n"),
      )
      const location = path.join(root, "generated", "manifest.ts")
      await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })

      await fs.rm(legacyPath)

      const second = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location,
      })
      expect(second.findings).toContainEqual(
        expect.objectContaining({ code: "MISSING_DYNAMIC_ACCESS_CITATION", severity: "warning" }),
      )
    })
  })

  describe("--strict* severity escalation", () => {
    async function setupUnownedCapability(): Promise<void> {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
    }

    it("--strict escalates a static warning finding to error, causing the run to throw", async () => {
      await setupUnownedCapability()
      await expect(
        generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          docs: path.join(root, "d.md"),
          strict: true,
        }),
      ).rejects.toThrow(DataProjectGenerationError)
    })

    it("--strict-docs escalates the static findings the same way --strict does", async () => {
      await setupUnownedCapability()
      await expect(
        generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          docs: path.join(root, "d.md"),
          strictDocs: true,
        }),
      ).rejects.toThrow(DataProjectGenerationError)
    })

    it("--strict-ownership does not escalate static (docs-scoped) findings", async () => {
      await setupUnownedCapability()
      // F1: the usage scan always runs now, so a real consumer is needed
      // here to keep this capability from *also* tripping the
      // ownership-scoped ABANDONED_CAPABILITY warning -- this test is
      // specifically about static/docs-scoped findings staying unescalated,
      // not about ownership-scoped ones (see the dedicated
      // "--strict-ownership escalates ABANDONED_CAPABILITY" test below).
      await writeFile(
        "consumer.ts",
        `import { userCapability } from "./user.js";\nuserCapability.fields.email;`,
      )
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        docs: path.join(root, "d.md"),
        strictOwnership: true,
      })
      expect(result.hasBlockingErrors).toBe(false)
    })

    it("--strict escalation leaves an already-info-severity finding untouched", async () => {
      await writeFile(
        "a.ts",
        `export const a = createData({ fields: { x: "" } });\ndocumentData({ fields: { x: "" } }, { owner: "team" });`,
      )
      await writeFile(
        "b.ts",
        `export const b = createData({ fields: { x: "" } });\ndocumentData({ fields: { x: "" } }, { owner: "team" });`,
      )
      // F1: the usage scan always runs now -- real consumers keep "a"/"b"
      // from also tripping ABANDONED_CAPABILITY (a warning `--strict` would
      // legitimately escalate), which would otherwise mask the one thing
      // this test actually checks: that an already-info finding stays info.
      await writeFile(
        "consumer.ts",
        `import { a } from "./a.js";\nimport { b } from "./b.js";\na.fields.x;\nb.fields.x;`,
      )
      const location = path.join(root, "generated", "manifest.ts")
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location,
        strict: true,
      })
      const duplicate = result.findings.find(
        (f) => f.code === "DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES",
      )
      expect(duplicate?.severity).toBe("info")
    })

    it("--strict-ownership escalates ABANDONED_CAPABILITY (a usage-scoped warning)", async () => {
      await setupUnownedCapability()
      await expect(
        generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          ownership: path.join(root, "o.md"),
          strictOwnership: true,
        }),
      ).rejects.toThrow(DataProjectGenerationError)
    })

    it("without any strict flag, warning-level findings never block the run", async () => {
      await setupUnownedCapability()
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        docs: path.join(root, "d.md"),
        ownership: path.join(root, "o.md"),
      })
      expect(result.hasBlockingErrors).toBe(false)
      expect(result.warningCount).toBeGreaterThan(0)
    })

    it("counts each finding under exactly one severity bucket (error/warning/info partition the whole list)", async () => {
      // Two unowned capabilities (a CAPABILITY_MISSING_OWNER warning each) that
      // also share a field shape (one DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES
      // info) -- so the list spans two distinct severities.
      await writeFile("a.ts", `export const a = createData({ fields: { email: "" } });`)
      await writeFile("b.ts", `export const b = createData({ fields: { email: "" } });`)
      // No --location: also proves the `citationFindings` seed stays an empty
      // list (not a phantom entry) when citation verification never runs.
      const result = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false })
      expect(result.warningCount).toBeGreaterThan(0)
      expect(result.infoCount).toBeGreaterThan(0)
      expect(result.errorCount + result.warningCount + result.infoCount).toBe(
        result.findings.length,
      )
    })
  })

  describe("evidence model composition (ADR 0050/0054)", () => {
    it("result.evidence is always composed, even when only --location is requested (no --ownership/--flow)", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location: path.join(root, "manifest.ts"),
      })
      expect(result.evidence.schemaVersion).toBe(EVIDENCE_MODEL_SCHEMA_VERSION)
      expect(result.evidence.capability.capabilities).toHaveLength(1)
      // OUT-06: provenance is always stamped -- generatedAt + a real toolVersion.
      expect(result.evidence.provenance.toolVersion).toBe(PACKAGE_VERSION)
      expect(result.evidence.provenance.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
      // Ownership/Finding/Runtime Contract/Dependency Model are all cheap
      // projections over already-in-memory data (F1: the usage scan always
      // runs now) -- always populated, even though nothing here consumes
      // `userCapability` (an empty `edges` array, not an absent model).
      // Change Model is populated whenever change-detection ran (F2:
      // `--location` alone is enough), and since a real Dependency Model is
      // always available now too, its own `blastRadius` is always populated
      // alongside it -- just with an empty `consumers` list here.
      expect(result.evidence.ownership).toBeDefined()
      expect(result.evidence.finding).toBeDefined()
      expect(result.evidence.runtimeContract).toBeDefined()
      expect(result.evidence.dependency).toBeDefined()
      expect(result.evidence.dependency?.edges).toEqual([])
      expect(result.evidence.change?.manifest.addedCapabilities).toHaveLength(1)
      expect(result.evidence.change?.blastRadius).toEqual([
        { capability: "user.ts#userCapability", consumers: [] },
      ])
      // OUT-04: every sub-model genuinely computed this run.
      expect(result.evidence.computed).toEqual({
        dependency: true,
        ownership: true,
        finding: true,
        change: true,
      })
    })

    it("result.evidence.dependency/.change carry real edges and a non-empty blast radius when a real consumer exists", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      await writeFile(
        "consumer.ts",
        `import { userCapability } from "./user.js";\nuserCapability.fields.email;`,
      )
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location: path.join(root, "manifest.ts"),
        ownership: path.join(root, "OWNERSHIP.md"),
      })
      expect(result.evidence.dependency?.edges).toHaveLength(1)
      // First run against a fresh snapshot -- userCapability is "added",
      // so it shows up in Change Model's own blast-radius index.
      // Root-relative capability key (OUT-01) -- never the absolute path.
      expect(result.evidence.change?.manifest.addedCapabilities).toContain("user.ts#userCapability")
      // OUT-04: the usage scan genuinely ran this time, so every flag is true.
      expect(result.evidence.computed).toEqual({
        dependency: true,
        ownership: true,
        finding: true,
        change: true,
      })
      expect(result.evidence.change?.blastRadius).toEqual([
        { capability: "user.ts#userCapability", consumers: ["consumer.ts"] },
      ])
    })

    it("an --evidence-only run (no --location/--docs/--ownership/--flow) still populates a real Dependency Model and correct change/citation facts (F1+F2)", async () => {
      await writeFile("legacy.ts", "// pretend legacy dynamic-access site\nconst x = 1;\n")
      await writeFile(
        "user.ts",
        [
          `export const userCapability = createData({ fields: { email: "" } });`,
          `documentData({ fields: { email: "" } }, {`,
          `  evidence: { fields: { email: { dynamicAccess: ["legacy.ts:2:7"] } } },`,
          `});`,
        ].join("\n"),
      )
      await writeFile(
        "consumer.ts",
        `import { userCapability } from "./user.js";\nuserCapability.fields.email;`,
      )
      const evidencePath = path.join(root, "evidence.json")

      // Run 1: evidence-only -- no --location/--docs/--ownership/--flow at all.
      const first = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
      })
      expect(first.manifest).toBeUndefined()
      expect(first.documentation).toBeUndefined()
      expect(first.flow).toBeUndefined()
      // F1: a real, proven dependency edge from consumer.ts, even though
      // --ownership was never requested.
      expect(first.evidence.dependency?.edges.length).toBeGreaterThan(0)
      expect(first.evidence.computed.dependency).toBe(true)
      // F2: a real manifest diff, even though --location never ran -- first
      // run, so userCapability shows up as added.
      expect(first.evidence.change?.manifest.addedCapabilities).toContain("user.ts#userCapability")
      expect(first.evidence.computed.change).toBe(true)
      // The manifest snapshot sidecar was persisted so a *second*
      // --evidence-only run can diff against it and re-verify the citation.
      await expect(
        fs.access(path.join(root, ".data-cap-manifest-snapshot.json")),
      ).resolves.toBeUndefined()

      // The cited file changes underneath the citation.
      await writeFile("legacy.ts", "// this file has now changed\nconst x = 2;\n")

      // Run 2: still evidence-only -- change-detection/citation-verification
      // must still fire without --location ever being requested.
      const second = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
      })
      expect(second.findings).toContainEqual(
        expect.objectContaining({ code: "STALE_DYNAMIC_ACCESS_CITATION", severity: "warning" }),
      )
      // Nothing about the capability's own shape changed between the two
      // runs -- only the cited file's content did.
      expect(second.evidence.change?.manifest.addedCapabilities).toEqual([])
      expect(second.evidence.change?.manifest.updatedCapabilities).toEqual([])
    })

    it("--evidence writes the composed model to disk as parseable JSON matching result.evidence", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const evidencePath = path.join(root, "evidence.json")
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
      })
      const written = JSON.parse(await fs.readFile(evidencePath, "utf8")) as EvidenceModel
      expect(written).toEqual(JSON.parse(JSON.stringify(result.evidence)))
    })

    it("omitting --evidence composes the model in memory but never writes a file", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        location: path.join(root, "manifest.ts"),
      })
      expect(result.evidence).toBeDefined()
      await expect(fs.access(path.join(root, "evidence.json"))).rejects.toThrow()
    })

    it("a blocking error prevents the evidence file from being written too, same atomicity guarantee as every other artifact", async () => {
      await writeFile(
        "a.ts",
        `export const a = createData({ fields: { x: "" } });\ndocumentData({ fields: { x: "" } }, { exclusiveGroup: "group" });`,
      )
      await writeFile(
        "b.ts",
        `export const b = createData({ fields: { y: "" } });\ndocumentData({ fields: { y: "" } }, { exclusiveGroup: "group" });`,
      )
      const evidencePath = path.join(root, "evidence.json")
      await expect(
        generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence: evidencePath }),
      ).rejects.toThrow(DataProjectGenerationError)
      await expect(fs.access(evidencePath)).rejects.toThrow()
    })

    it("threads --evidence's path into the ownership report's projection note, not just the manifest", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const ownership = path.join(root, "generated", "OWNERSHIP.md")
      const evidencePath = path.join(root, "evidence.json")

      const withEvidence = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        ownership,
        evidence: evidencePath,
      })
      expect(withEvidence.usage.content).toContain(`This run also wrote it to`)
      expect(withEvidence.usage.content).toContain("evidence.json")

      const withoutEvidence = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        ownership,
      })
      expect(withoutEvidence.usage.content).not.toContain("This run also wrote it to")
    })

    it("threads --evidence's path into the documentation catalog's projection note", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const docs = path.join(root, "generated", "CAPABILITIES.md")
      const evidencePath = path.join(root, "evidence.json")

      const withEvidence = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        docs,
        evidence: evidencePath,
      })
      expect(withEvidence.documentation?.content).toContain("This run also wrote it to")
      expect(withEvidence.documentation?.content).toContain("evidence.json")

      const withoutEvidence = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        docs,
      })
      expect(withoutEvidence.documentation?.content).not.toContain("This run also wrote it to")
    })

    it("threads --evidence's path into the flow report set's projection note", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const flowDir = path.join(root, "generated", "flow")
      const evidencePath = path.join(root, "evidence.json")

      const withEvidence = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        flow: flowDir,
        evidence: evidencePath,
      })
      const overviewWith =
        withEvidence.flow?.files.find((f) => f.path.endsWith("overview.md"))?.content ?? ""
      expect(overviewWith).toContain("This run also wrote it to")
      expect(overviewWith).toContain("evidence.json")

      const withoutEvidence = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        flow: flowDir,
      })
      const overviewWithout =
        withoutEvidence.flow?.files.find((f) => f.path.endsWith("overview.md"))?.content ?? ""
      expect(overviewWithout).not.toContain("This run also wrote it to")
    })

    it("--evidence's fingerprint sidecar reflects real --include/--exclude/--packages values, not the defaults", async () => {
      await writeFile("only.ts", `export const a = createData({ fields: { x: "" } });`)
      await writeFile("other.ts", `export const b = createData({ fields: { y: "" } });`)
      const evidencePath = path.join(root, "evidence.json")
      const fingerprintPath = `${evidencePath}.fingerprint`

      await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
        include: ["only.ts"],
        exclude: ["other.ts"],
      })
      const narrowFingerprint = await fs.readFile(fingerprintPath, "utf8")

      await fs.rm(evidencePath)
      await fs.rm(fingerprintPath)

      await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
      })
      const defaultFingerprint = await fs.readFile(fingerprintPath, "utf8")

      expect(narrowFingerprint).not.toBe(defaultFingerprint)
    })

    it("--evidence's fingerprint sidecar reflects a real --packages allowlist, not the default empty one", async () => {
      await writeFile("package.json", JSON.stringify({ name: "fixture-root", private: true }))
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { id: "" } });`,
      )
      await writeFile(
        "node_modules/@fixtures/pkg-a/package.json",
        JSON.stringify({
          name: "@fixtures/pkg-a",
          main: "./index.js",
          dataCap: { schema: "./data.schema.ts" },
        }),
      )
      await writeFile("node_modules/@fixtures/pkg-a/index.js", "module.exports = {};\n")
      await writeFile(
        "node_modules/@fixtures/pkg-a/data.schema.ts",
        `export const pkgACapability = createData({ fields: { pkgId: "" } });`,
      )
      const evidencePath = path.join(root, "evidence.json")
      const fingerprintPath = `${evidencePath}.fingerprint`

      await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
        packages: ["@fixtures/pkg-a"],
      })
      const withPackageFingerprint = await fs.readFile(fingerprintPath, "utf8")

      await fs.rm(evidencePath)
      await fs.rm(fingerprintPath)

      await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
      })
      const withoutPackageFingerprint = await fs.readFile(fingerprintPath, "utf8")

      expect(withPackageFingerprint).not.toBe(withoutPackageFingerprint)
    })

    it("result.evidence.change stays undefined when neither --location nor --evidence ran, even alongside other options", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const result = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        docs: path.join(root, "d.md"),
      })
      expect(result.evidence.change).toBeUndefined()
    })

    it("--evidence participates in --check's staleness detection like every other artifact", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const evidencePath = path.join(root, "evidence.json")
      await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
      })

      const cleanCheck = await checkArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
      })
      expect(cleanCheck.stale).toHaveLength(0)

      await writeFile(
        "second.ts",
        `export const secondCapability = createData({ fields: { id: "" } });`,
      )
      const dirtyCheck = await checkArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        evidence: evidencePath,
      })
      expect(dirtyCheck.stale).toContain(evidencePath)
    })
  })

  // These mutants (a `!== undefined` guard flipped to always-`true`, or the
  // guarded object literal emptied to `{}`) change nothing any downstream
  // consumer can observe *when the option is actually omitted*: whether the
  // key is spread as `{ key: undefined }` or left absent entirely, every
  // consumer that later reads it does so through its own `!== undefined`
  // check (or a destructuring default), so the value each one sees is
  // identical either way -- only the immediate call argument's own key
  // presence differs. That is only observable by inspecting the literal
  // object handed to the very next function in the pipeline, so these tests
  // spy on that function (letting the real implementation run underneath)
  // and assert `Object.hasOwn` directly on the captured call argument.
  describe("option pass-through spreads only the key when the option is actually provided", () => {
    it("threads a caller-supplied --tsconfig into the usage scan's own options, and omits the key entirely otherwise", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const spy = vi.spyOn(generateUsageModule, "generateUsage")
      try {
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          ownership: path.join(root, "OWNERSHIP.md"),
        })
        const withTsconfig = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(withTsconfig?.scan ?? {}, "tsconfig")).toBe(true)
        expect(withTsconfig?.scan.tsconfig).toBe(false)

        spy.mockClear()
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          ownership: path.join(root, "OWNERSHIP2.md"),
        })
        const withoutTsconfig = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(withoutTsconfig?.scan ?? {}, "tsconfig")).toBe(false)
      } finally {
        spy.mockRestore()
      }
    })

    it("threads --evidence's path into the usage scan's own options, and leaves it unset otherwise", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const spy = vi.spyOn(generateUsageModule, "generateUsage")
      try {
        const evidencePath = path.join(root, "evidence.json")
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          ownership: path.join(root, "OWNERSHIP.md"),
          evidence: evidencePath,
        })
        const withEvidence = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(withEvidence ?? {}, "evidencePath")).toBe(true)
        expect(withEvidence?.evidencePath).toBe(evidencePath)

        spy.mockClear()
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          ownership: path.join(root, "OWNERSHIP2.md"),
        })
        const withoutEvidence = spy.mock.calls.at(-1)?.[0]
        expect(withoutEvidence?.evidencePath).toBeUndefined()
      } finally {
        spy.mockRestore()
      }
    })

    it("threads --evidence's path into the documentation generator's own options, and leaves it unset otherwise", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const spy = vi.spyOn(generateDocumentationModule, "generateDocumentation")
      try {
        const evidencePath = path.join(root, "evidence.json")
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          docs: path.join(root, "CAPABILITIES.md"),
          evidence: evidencePath,
        })
        const withEvidence = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(withEvidence ?? {}, "evidencePath")).toBe(true)
        expect(withEvidence?.evidencePath).toBe(evidencePath)

        spy.mockClear()
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          docs: path.join(root, "CAPABILITIES2.md"),
        })
        const withoutEvidence = spy.mock.calls.at(-1)?.[0]
        expect(withoutEvidence?.evidencePath).toBeUndefined()
      } finally {
        spy.mockRestore()
      }
    })

    it("threads --evidence's path into the flow generator's own options, and leaves it unset otherwise", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const spy = vi.spyOn(generateFlowModule, "generateFlow")
      try {
        const evidencePath = path.join(root, "evidence.json")
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          flow: path.join(root, "flow"),
          evidence: evidencePath,
        })
        const withEvidence = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(withEvidence ?? {}, "evidencePath")).toBe(true)
        expect(withEvidence?.evidencePath).toBe(evidencePath)

        spy.mockClear()
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          flow: path.join(root, "flow2"),
        })
        const withoutEvidence = spy.mock.calls.at(-1)?.[0]
        expect(withoutEvidence?.evidencePath).toBeUndefined()
      } finally {
        spy.mockRestore()
      }
    })

    it("always spreads `dependency` into buildEvidenceModel's input (F1); `change` only when change-detection ran (F2)", async () => {
      await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const spy = vi.spyOn(evidenceModelModule, "buildEvidenceModel")
      try {
        // Neither --ownership nor --location/--evidence: the usage scan
        // still ran (F1), so `dependency` is always spread now; no manifest
        // diff ran, so `change` isn't.
        await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false })
        const neither = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(neither ?? {}, "dependency")).toBe(true)
        expect(Object.hasOwn(neither ?? {}, "change")).toBe(false)

        spy.mockClear()
        // --location alone now drives `change` too (F2) -- no --ownership needed.
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          location: path.join(root, "manifest.ts"),
        })
        const locationOnly = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(locationOnly ?? {}, "dependency")).toBe(true)
        expect(Object.hasOwn(locationOnly ?? {}, "change")).toBe(true)

        spy.mockClear()
        // --evidence alone (no --location/--ownership/--flow/--docs at all)
        // drives `change` too now -- the whole point of F2.
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          evidence: path.join(root, "evidence.json"),
        })
        const evidenceOnly = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(evidenceOnly ?? {}, "dependency")).toBe(true)
        expect(Object.hasOwn(evidenceOnly ?? {}, "change")).toBe(true)
      } finally {
        spy.mockRestore()
      }
    })

    it("threads include/exclude/packages into the evidence fingerprint's own recompute only when each was actually provided", async () => {
      await writeFile(
        "src/user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const spy = vi.spyOn(evidenceFingerprintModule, "computeSourceFingerprint")
      try {
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          evidence: path.join(root, "evidence.json"),
          include: ["src/**"],
          exclude: ["src/skip/**"],
          packages: [],
        })
        const withAll = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(withAll ?? {}, "include")).toBe(true)
        expect(Object.hasOwn(withAll ?? {}, "exclude")).toBe(true)
        expect(Object.hasOwn(withAll ?? {}, "packages")).toBe(true)
        expect(withAll?.include).toEqual(["src/**"])
        expect(withAll?.exclude).toEqual(["src/skip/**"])
        expect(withAll?.packages).toEqual([])

        spy.mockClear()
        await fs.rm(path.join(root, "evidence.json"), { force: true })
        await fs.rm(path.join(root, "evidence.json.fingerprint"), { force: true })
        await generateDataArtifacts({
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          evidence: path.join(root, "evidence.json"),
        })
        const withNone = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(withNone ?? {}, "include")).toBe(false)
        expect(Object.hasOwn(withNone ?? {}, "exclude")).toBe(false)
        expect(Object.hasOwn(withNone ?? {}, "packages")).toBe(false)
      } finally {
        spy.mockRestore()
      }
    })
  })
})
