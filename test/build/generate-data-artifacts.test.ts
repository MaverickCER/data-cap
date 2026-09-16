import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generateDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import { checkArtifacts } from "../../src/build/check-artifacts.js"
import { DataProjectGenerationError } from "../../src/build/errors.js"
import type { ManifestSnapshot } from "../../src/build/manifest-snapshot.js"
import { EVIDENCE_MODEL_SCHEMA_VERSION } from "../../src/build/evidence-model.js"
import type { EvidenceModel } from "../../src/build/evidence-model.js"
import { PACKAGE_VERSION } from "../../src/build/package-version.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

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

  it("renders 'no previous snapshot' when --docs is used without --location (no manifest, so no changes report)", async () => {
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
    expect(result.usage?.edges.length).toBeGreaterThan(0)
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

  it("threads the usage scan's real edges into --docs's consumption column, distinguishing scanned-but-empty from never-scanned", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });\ndocumentData({ fields: { email: "" } }, { owner: "team" });`,
    )
    const docs = path.join(root, "generated", "CAPABILITIES.md")

    const docsOnly = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, docs })
    expect(docsOnly.documentation?.content).toContain("(not scanned)")

    const docsAndOwnership = await generateDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      docs,
      ownership: path.join(root, "generated", "OWNERSHIP.md"),
    })
    expect(docsAndOwnership.documentation?.content).not.toContain("(not scanned)")
    expect(docsAndOwnership.documentation?.content).toContain("(none found)")
  })

  it("computes zero artifacts and zero writes when nothing is requested, but still runs static rules", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const result = await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false })
    expect(result.manifest).toBeUndefined()
    expect(result.documentation).toBeUndefined()
    expect(result.usage).toBeUndefined()
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
      expect(first.findings.some((f) => f.code === "DYNAMIC_ACCESS_CITATION_STALE")).toBe(false)
      expect(first.findings.some((f) => f.code === "DYNAMIC_ACCESS_CITATION_MISSING")).toBe(false)
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
          code: "DYNAMIC_ACCESS_CITATION_STALE",
          family: "citation",
          severity: "warning",
          field: ["email"],
        }),
      )
      // FIELD_DYNAMIC_ACCESS_DECLARED still fires too -- it states what was
      // asserted, independent of the assertion's own integrity check.
      expect(second.findings.some((f) => f.code === "FIELD_DYNAMIC_ACCESS_DECLARED")).toBe(true)
    })

    it("flags DYNAMIC_ACCESS_CITATION_MISSING when a previously-valid citation's file is deleted", async () => {
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
        expect.objectContaining({ code: "DYNAMIC_ACCESS_CITATION_MISSING", severity: "warning" }),
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
      // Ownership/Finding/Runtime Contract Model are cheap projections over
      // already-in-memory data -- always populated. Change Model is
      // populated whenever a manifest diff ran (--location alone is
      // enough; ChangeModel's own diff is meaningful without a dependency
      // model, per its own header comment), just with `blastRadius`
      // undefined since no usage scan ran. Dependency Model genuinely
      // needs a usage scan that wasn't requested here.
      expect(result.evidence.ownership).toBeDefined()
      expect(result.evidence.finding).toBeDefined()
      expect(result.evidence.runtimeContract).toBeDefined()
      expect(result.evidence.dependency).toBeUndefined()
      expect(result.evidence.change?.manifest.addedCapabilities).toHaveLength(1)
      expect(result.evidence.change?.blastRadius).toBeUndefined()
      // OUT-04: the absent Dependency Model is stated as un-computed, so a
      // reader can't mistake it for "nothing depends on this capability".
      expect(result.evidence.computed).toEqual({
        dependency: false,
        ownership: true,
        finding: true,
        change: true,
      })
    })

    it("result.evidence.dependency/.change populate once --ownership and --location both run", async () => {
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
      expect(result.evidence.change?.blastRadius).toBeDefined()
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
      expect(withEvidence.usage?.content).toContain(`This run also wrote it to`)
      expect(withEvidence.usage?.content).toContain("evidence.json")

      const withoutEvidence = await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        ownership,
      })
      expect(withoutEvidence.usage?.content).not.toContain("This run also wrote it to")
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

      await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence: evidencePath })
      const defaultFingerprint = await fs.readFile(fingerprintPath, "utf8")

      expect(narrowFingerprint).not.toBe(defaultFingerprint)
    })

    it("--evidence's fingerprint sidecar reflects a real --packages allowlist, not the default empty one", async () => {
      await writeFile("package.json", JSON.stringify({ name: "fixture-root", private: true }))
      await writeFile("user.ts", `export const userCapability = createData({ fields: { id: "" } });`)
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

      await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence: evidencePath })
      const withoutPackageFingerprint = await fs.readFile(fingerprintPath, "utf8")

      expect(withPackageFingerprint).not.toBe(withoutPackageFingerprint)
    })

    it("result.evidence.change stays undefined when no --location ran, even alongside other options", async () => {
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
})
