import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  checkArtifacts,
  normalizeForComparison,
  readOnDisk,
} from "../../src/build/check-artifacts.js"
import { generateDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

describe("checkArtifacts", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-check-test-"))
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

  it("reports every requested artifact as stale when nothing has been written yet, and writes nothing", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const location = path.join(root, "generated", "manifest.ts")
    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })
    expect(stale).toEqual([location, path.join(root, ".data-cap-manifest-snapshot.json")])
    await expect(fs.access(location)).rejects.toThrow()
  })

  it("reports nothing stale once the real generator has written matching content", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const location = path.join(root, "generated", "manifest.ts")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })
    expect(stale).toEqual([])
  })

  it("detects drift in exactly the file that was hand-edited, leaving the untouched one reported clean", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const location = path.join(root, "generated", "manifest.ts")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })

    // Simulate drift: someone hand-edits the generated file after the fact.
    await fs.writeFile(location, "// hand-edited, no longer matches\n", "utf8")

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })
    expect(stale).toEqual([location])
  })

  it("marks both the manifest and its snapshot stale when the underlying inventory itself changes", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const location = path.join(root, "generated", "manifest.ts")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })

    // A second capability appears after the manifest was generated.
    await writeFile(
      "post.ts",
      `export const postCapability = createData({ fields: { title: "" } });`,
    )

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, location })
    expect(stale).toEqual([location, path.join(root, ".data-cap-manifest-snapshot.json")])
  })

  it("never writes anything, even when the run would otherwise have blocking findings", async () => {
    await writeFile(
      "a.ts",
      `export const a = createData({ fields: { x: "" } });\ndocumentData({ fields: { x: "" } }, { exclusiveGroup: "group" });`,
    )
    await writeFile(
      "b.ts",
      `export const b = createData({ fields: { y: "" } });\ndocumentData({ fields: { y: "" } }, { exclusiveGroup: "group" });`,
    )
    const location = path.join(root, "generated", "manifest.ts")
    const { result, stale } = await checkArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      location,
    })
    expect(result.hasBlockingErrors).toBe(true)
    expect(stale).toEqual([location, path.join(root, ".data-cap-manifest-snapshot.json")])
    await expect(fs.access(location)).rejects.toThrow()
  })

  it("reports a fresh --evidence artifact as clean across two runs despite its live generatedAt stamp", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([])
  })

  it("stays clean when the on-disk generatedAt differs but every OTHER provenance field is identical -- the merge preserves siblings, not just the timestamp", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })

    const onDisk = JSON.parse(await fs.readFile(evidence, "utf8")) as {
      provenance: { generatedAt: string }
    }
    onDisk.provenance.generatedAt = "2000-01-01T00:00:00.000Z"
    await fs.writeFile(evidence, JSON.stringify(onDisk, null, 2), "utf8")

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([])
  })

  it("detects a real change to a provenance SIBLING field (not generatedAt) -- the whole provenance object isn't collapsed away", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })

    const onDisk = JSON.parse(await fs.readFile(evidence, "utf8")) as {
      provenance: Record<string, unknown>
    }
    onDisk.provenance["generatorVersion"] = "hand-edited-bogus-version"
    await fs.writeFile(evidence, JSON.stringify(onDisk, null, 2), "utf8")

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([evidence])
  })

  it("compares raw (never crashes) when the on-disk JSON has no provenance object at all", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    await fs.writeFile(evidence, JSON.stringify({ notProvenance: true }), "utf8")

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([evidence])
  })

  it("compares raw (never crashes) when provenance parses to a non-object primitive", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    await fs.writeFile(evidence, JSON.stringify({ provenance: "not an object" }), "utf8")

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([evidence])
  })

  it("reports stale, never silently matches, when the on-disk artifact's change field is missing (a well-formed provenance doesn't mask its absence)", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })

    const onDisk = JSON.parse(await fs.readFile(evidence, "utf8")) as Record<string, unknown>
    delete onDisk["change"]
    await fs.writeFile(evidence, JSON.stringify(onDisk, null, 2), "utf8")

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([evidence])
  })

  it("reports stale, never silently matches, when the on-disk artifact's change field is a non-object primitive", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })

    const onDisk = JSON.parse(await fs.readFile(evidence, "utf8")) as Record<string, unknown>
    onDisk["change"] = "not an object"
    await fs.writeFile(evidence, JSON.stringify(onDisk, null, 2), "utf8")

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([evidence])
  })

  it("still detects a real content change in the --evidence artifact (only the timestamp is masked)", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })

    // Hand-edit a real field of the evidence model (not its generatedAt stamp).
    const onDisk = JSON.parse(await fs.readFile(evidence, "utf8")) as {
      capability: { capabilities: unknown[] }
    }
    onDisk.capability.capabilities = []
    await fs.writeFile(evidence, JSON.stringify(onDisk, null, 2), "utf8")

    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([evidence])
  })

  it("reports a hand-written non-JSON file at the --evidence path as stale, never crashes", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await writeFile("docs/data.evidence.json", "not json at all")
    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    // `--evidence` alone now also drives the manifest snapshot sidecar's own
    // read/write (F2) -- never written on disk here, so it reports stale
    // too, alongside the hand-written evidence file itself.
    expect(stale).toEqual([path.join(root, ".data-cap-manifest-snapshot.json"), evidence])
  })

  it("reports the JSON literal `null` at the --evidence path as stale, never crashes", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const evidence = path.join(root, "docs", "data.evidence.json")
    await writeFile("docs/data.evidence.json", "null")
    const { stale } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false, evidence })
    expect(stale).toEqual([path.join(root, ".data-cap-manifest-snapshot.json"), evidence])
  })

  it("returns the underlying ReportResult unchanged", async () => {
    await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const { result } = await checkArtifacts({ fs: nodeBuildFs, root, tsconfig: false })
    expect(result.findings.some((f) => f.code === "CAPABILITY_MISSING_OWNER")).toBe(true)
  })
})

describe("normalizeForComparison", () => {
  const evidence = (extra: Record<string, unknown>) =>
    JSON.stringify({
      capability: "x",
      provenance: { generatedAt: "2026-01-01", tool: "t" },
      ...extra,
    })

  it("masks the generation timestamp and the change report, and nothing else", () => {
    const normalized = JSON.parse(
      normalizeForComparison(evidence({ change: { added: ["a"] } })),
    ) as {
      provenance: Record<string, unknown>
      change: unknown
      capability: string
    }
    expect(normalized.provenance).toStrictEqual({ generatedAt: "", tool: "t" })
    expect(normalized.change).toBeNull()
    expect(normalized.capability).toBe("x")
  })

  it("returns text that is not JSON unchanged", () => {
    expect(normalizeForComparison("# not json")).toBe("# not json")
  })

  it("returns JSON that is not an object unchanged", () => {
    expect(normalizeForComparison("42")).toBe("42")
    expect(normalizeForComparison("null")).toBe("null")
  })

  it("returns an object with no provenance unchanged, not re-serialized", () => {
    expect(normalizeForComparison('{"a":1}')).toBe('{"a":1}')
  })

  it.each([
    ['{"provenance":null,"change":{}}', "a null provenance"],
    ['{"provenance":"text","change":{}}', "a non-object provenance"],
    ['{"provenance":{"generatedAt":"t"}}', "no change"],
    ['{"provenance":{"generatedAt":"t"},"change":null}', "a null change"],
    ['{"provenance":{"generatedAt":"t"},"change":"text"}', "a non-object change"],
  ])("returns %s unchanged (%s)", (content) => {
    expect(normalizeForComparison(content)).toBe(content)
  })
})

describe("readOnDisk", () => {
  it("reads a file that exists, and gives exactly the empty string for one that does not", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-read-on-disk-"))
    try {
      const file = path.join(dir, "present.txt")
      await fs.writeFile(file, "content", "utf8")
      expect(await readOnDisk(nodeBuildFs, file)).toBe("content")
      expect(await readOnDisk(nodeBuildFs, path.join(dir, "absent.txt"))).toBe("")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
