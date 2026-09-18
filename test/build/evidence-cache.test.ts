import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  computeSourceFingerprint,
  fingerprintPathFor,
  getEvidenceModel,
  writeEvidenceFingerprint,
} from "../../src/build/evidence-cache.js"
import { nodeBuildFs } from "../support/build-filesystem.js"
import * as evidenceFingerprint from "../../src/build/evidence-fingerprint.js"
import { generateDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import { EVIDENCE_MODEL_SCHEMA_VERSION } from "../../src/build/evidence-model.js"

describe("evidence cache", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-evidence-cache-"))
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

  const EVIDENCE_RELATIVE = "docs/data.evidence.json"

  /**
   * Every output path is absolute on purpose. `generateDataArtifacts` uses
   * them verbatim (only the CLI resolves them against `--root`), so a
   * relative `location` here would write the manifest into the *repo's* own
   * `docs/` rather than this test's temp root -- which is exactly the leak
   * this comment exists to stop from coming back.
   */
  function optionsFor(): {
    fs: typeof nodeBuildFs
    root: string
    tsconfig: false
    location: string
    evidence: string
  } {
    return {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      location: path.join(root, "src/generated/data.manifest.ts"),
      evidence: path.join(root, EVIDENCE_RELATIVE),
    }
  }

  async function writePackage(name: string, schemaContent: string): Promise<void> {
    await writeFile("package.json", JSON.stringify({ name: "fixture-root", private: true }))
    await writeFile(
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, main: "./index.js", dataCap: { schema: "./data.schema.ts" } }),
    )
    await writeFile(`node_modules/${name}/index.js`, "module.exports = {};\n")
    await writeFile(`node_modules/${name}/data.schema.ts`, schemaContent)
  }

  async function seedCapability(): Promise<void> {
    await writeFile(
      "src/user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
  }

  describe("computeSourceFingerprint", () => {
    it("is stable across two runs over identical source", async () => {
      await seedCapability()
      const a = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      const b = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      expect(a).toBe(b)
      expect(a).toMatch(/^[0-9a-f]{64}$/)
    })

    it("changes when a discovered file's content changes", async () => {
      await seedCapability()
      const before = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      await writeFile(
        "src/user.ts",
        `export const userCapability = createData({ fields: { email: "", name: "" } });`,
      )
      expect(await computeSourceFingerprint({ fs: nodeBuildFs, root })).not.toBe(before)
    })

    it("changes when identical content moves to a different path (the path is hashed too)", async () => {
      const body = `export const userCapability = createData({ fields: { email: "" } });`
      await writeFile("src/user.ts", body)
      const before = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      await fs.rm(path.join(root, "src/user.ts"))
      await writeFile("src/renamed.ts", body)
      expect(await computeSourceFingerprint({ fs: nodeBuildFs, root })).not.toBe(before)
    })

    it("changes when a new file appears under the discovery globs", async () => {
      await seedCapability()
      const before = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      await writeFile("src/other.ts", `export const other = 1;`)
      expect(await computeSourceFingerprint({ fs: nodeBuildFs, root })).not.toBe(before)
    })

    it("ignores a file the discovery globs exclude", async () => {
      await seedCapability()
      const before = await computeSourceFingerprint({ fs: nodeBuildFs, root, include: ["src/**"] })
      await writeFile("scripts/unrelated.ts", `export const unrelated = 1;`)
      expect(await computeSourceFingerprint({ fs: nodeBuildFs, root, include: ["src/**"] })).toBe(
        before,
      )
    })

    it("ignores a file matched by an explicit exclude glob", async () => {
      await seedCapability()
      const withoutExtra = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      await writeFile("src/scratch.ts", `export const scratch = 1;`)
      const excluded = await computeSourceFingerprint({
        fs: nodeBuildFs,
        root,
        exclude: ["src/scratch.ts"],
      })
      expect(excluded).toBe(withoutExtra)
    })

    it("treats an omitted packages list identically to an explicit empty one", async () => {
      await seedCapability()
      expect(await computeSourceFingerprint({ fs: nodeBuildFs, root })).toBe(
        await computeSourceFingerprint({ fs: nodeBuildFs, root, packages: [] }),
      )
    })

    it("does not conflate two distinct paths that differ only in where the slash falls", async () => {
      const body = `export const x = createData({ fields: { a: "" } });`
      await writeFile("a/bc.ts", body)
      const fp1 = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      await fs.rm(path.join(root, "a/bc.ts"))
      await writeFile("ab/c.ts", body)
      const fp2 = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      expect(fp1).not.toBe(fp2)
    })

    it("keeps a file's path and its body unambiguously separated", async () => {
      // "a.ts" + "xhello"  vs  "a.tsx" + "hello"  -> identical only if the
      // path/body boundary is unmarked.
      await writeFile("a.ts", "xhello")
      const fp1 = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      await fs.rm(path.join(root, "a.ts"))
      await writeFile("a.tsx", "hello")
      const fp2 = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      expect(fp1).not.toBe(fp2)
    })

    it("delimits one file's entry from the next so a body cannot impersonate a following path", async () => {
      await writeFile("x.ts", "A")
      await writeFile("y.ts", "B")
      const fpTwoFiles = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      await fs.rm(path.join(root, "y.ts"))
      await writeFile("x.ts", "Ay.ts\u0000B")
      const fpOneFile = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      expect(fpOneFile).not.toBe(fpTwoFiles)
    })

    it("does not depend on the order allow-listed packages are passed in", async () => {
      await seedCapability()
      await writePackage("@fixtures/pkg-z", `export const z = createData({ fields: { z: "" } });`)
      await writePackage("@fixtures/pkg-a", `export const a = createData({ fields: { a: "" } });`)
      const forward = await computeSourceFingerprint({
        fs: nodeBuildFs,
        root,
        packages: ["@fixtures/pkg-z", "@fixtures/pkg-a"],
      })
      const reverse = await computeSourceFingerprint({
        fs: nodeBuildFs,
        root,
        packages: ["@fixtures/pkg-a", "@fixtures/pkg-z"],
      })
      expect(forward).toBe(reverse)
    })

    it("folds an unreadable discovered file in as a distinct marker rather than throwing", async () => {
      await writeFile("src/a.ts", "")
      const emptyFp = await computeSourceFingerprint({ fs: nodeBuildFs, root })
      await writeFile("src/a.ts", "real content")
      await fs.chmod(path.join(root, "src/a.ts"), 0o000)
      try {
        const unreadableFp = await computeSourceFingerprint({ fs: nodeBuildFs, root })
        expect(unreadableFp).toMatch(/^[0-9a-f]{64}$/)
        // The "(unreadable)" marker is a real, distinct contribution -- not the
        // same as an empty file, and not a silent skip.
        expect(unreadableFp).not.toBe(emptyFp)
      } finally {
        await fs.chmod(path.join(root, "src/a.ts"), 0o644)
      }
    })
  })

  describe("getEvidenceModel", () => {
    it("misses when no fingerprint sidecar exists, and says so", async () => {
      await seedCapability()
      const result = await getEvidenceModel(optionsFor())
      expect(result.source).toBe("miss")
      expect(result.missReason).toContain("no fingerprint sidecar")
      expect(result.evidence.schemaVersion).toBe(EVIDENCE_MODEL_SCHEMA_VERSION)
    })

    it("hits when the artifact and its sidecar both match current source", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      const result = await getEvidenceModel(optionsFor())
      expect(result.source).toBe("hit")
      expect(result.missReason).toBeUndefined()
      expect(result.evidence.capability.capabilities).toHaveLength(1)
    })

    it("misses once a discovered file's content changes underneath a previously-valid cache", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      expect((await getEvidenceModel(optionsFor())).source).toBe("hit")

      await writeFile(
        "src/user.ts",
        `export const userCapability = createData({ fields: { email: "", name: "" } });`,
      )
      const result = await getEvidenceModel(optionsFor())
      expect(result.source).toBe("miss")
      expect(result.missReason).toContain("fingerprint changed")
      // The recompute reflects the NEW source, never the cached artifact.
      expect(result.evidence.capability.capabilities[0]!.fields.map((f) => f.path[0])).toEqual([
        "email",
        "name",
      ])
    })

    it("misses when the sidecar matches but the artifact itself is missing", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      await fs.rm(path.join(root, EVIDENCE_RELATIVE))
      const result = await getEvidenceModel(optionsFor())
      expect(result.source).toBe("miss")
      expect(result.missReason).toContain("no evidence artifact found")
    })

    it("misses when the artifact is unparseable JSON, rather than throwing", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      await writeFile(EVIDENCE_RELATIVE, "{ not json")
      // The sidecar is unchanged and still matches the source, so this
      // isolates the artifact-integrity check from the fingerprint check.
      await writeEvidenceFingerprint(
        path.join(root, EVIDENCE_RELATIVE),
        await computeSourceFingerprint({ fs: nodeBuildFs, root }),
        nodeBuildFs,
      )
      const result = await getEvidenceModel(optionsFor())
      expect(result.source).toBe("miss")
      expect(result.missReason).toContain("could not be parsed as JSON")
    })

    it("misses without throwing when the artifact is the JSON literal null, not an object", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      await writeFile(EVIDENCE_RELATIVE, "null")
      await writeEvidenceFingerprint(
        path.join(root, EVIDENCE_RELATIVE),
        await computeSourceFingerprint({ fs: nodeBuildFs, root }),
        nodeBuildFs,
      )
      const result = await getEvidenceModel(optionsFor())
      expect(result.source).toBe("miss")
      expect(result.missReason).toContain("unrecognized schemaVersion")
    })

    it("misses when the artifact is an empty (e.g. truncated/partial-write) file", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      await writeFile(EVIDENCE_RELATIVE, "   \n")
      await writeEvidenceFingerprint(
        path.join(root, EVIDENCE_RELATIVE),
        await computeSourceFingerprint({ fs: nodeBuildFs, root }),
        nodeBuildFs,
      )
      const result = await getEvidenceModel(optionsFor())
      expect(result.source).toBe("miss")
      expect(result.missReason).toContain("is empty")
    })

    it("misses with a clear reason -- never throws -- when the source fingerprint cannot be computed", async () => {
      await seedCapability()
      const spy = vi
        .spyOn(evidenceFingerprint, "computeSourceFingerprint")
        .mockRejectedValueOnce(new Error("simulated disk failure"))
      try {
        const result = await getEvidenceModel(optionsFor())
        expect(result.source).toBe("miss")
        expect(result.missReason).toContain("could not compute a source fingerprint")
        expect(result.missReason).toContain("simulated disk failure")
        expect(result.evidence.schemaVersion).toBe(EVIDENCE_MODEL_SCHEMA_VERSION)
      } finally {
        spy.mockRestore()
      }
    })

    it("misses when the artifact's schemaVersion is unrecognized, even with a matching sidecar", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      await writeFile(EVIDENCE_RELATIVE, JSON.stringify({ schemaVersion: 999 }))
      await writeEvidenceFingerprint(
        path.join(root, EVIDENCE_RELATIVE),
        await computeSourceFingerprint({ fs: nodeBuildFs, root }),
        nodeBuildFs,
      )
      const result = await getEvidenceModel(optionsFor())
      expect(result.source).toBe("miss")
      expect(result.missReason).toContain("unrecognized schemaVersion")
    })

    // A `!== undefined` guard flipped to always-`true` (or the guarded
    // object literal emptied to `{}`) changes nothing any downstream
    // consumer can observe *when the option is actually omitted*: whether
    // the key is spread as `{ key: undefined }` or left absent entirely,
    // `computeSourceFingerprint`'s own destructuring defaults (and its own
    // `!== undefined` checks) treat both identically. That is only
    // observable by inspecting the literal object handed to
    // `computeSourceFingerprint` itself, so this spies on it (letting the
    // real implementation run underneath) and asserts `Object.hasOwn`
    // directly on the captured call argument.
    it("threads include/exclude/packages into computeSourceFingerprint's own call only when each was actually provided", async () => {
      await seedCapability()
      const spy = vi.spyOn(evidenceFingerprint, "computeSourceFingerprint")
      try {
        await getEvidenceModel({
          ...optionsFor(),
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
        await getEvidenceModel(optionsFor())
        const withNone = spy.mock.calls.at(-1)?.[0]
        expect(Object.hasOwn(withNone ?? {}, "include")).toBe(false)
        expect(Object.hasOwn(withNone ?? {}, "exclude")).toBe(false)
        expect(Object.hasOwn(withNone ?? {}, "packages")).toBe(false)
      } finally {
        spy.mockRestore()
      }
    })

    it("never writes anything -- a miss does not self-heal the cache", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      await writeFile(
        "src/user.ts",
        `export const userCapability = createData({ fields: { email: "", name: "" } });`,
      )
      const staleSidecar = await fs.readFile(
        fingerprintPathFor(path.join(root, EVIDENCE_RELATIVE)),
        "utf8",
      )
      const staleArtifact = await fs.readFile(path.join(root, EVIDENCE_RELATIVE), "utf8")

      expect((await getEvidenceModel(optionsFor())).source).toBe("miss")

      expect(
        await fs.readFile(fingerprintPathFor(path.join(root, EVIDENCE_RELATIVE)), "utf8"),
      ).toBe(staleSidecar)
      expect(await fs.readFile(path.join(root, EVIDENCE_RELATIVE), "utf8")).toBe(staleArtifact)
    })
  })

  describe("generateDataArtifacts writes the paired sidecar", () => {
    it("writes a sidecar next to the evidence artifact whenever --evidence is requested", async () => {
      await seedCapability()
      await generateDataArtifacts(optionsFor())
      const sidecar = await fs.readFile(
        fingerprintPathFor(path.join(root, EVIDENCE_RELATIVE)),
        "utf8",
      )
      expect(sidecar.trim()).toBe(await computeSourceFingerprint({ fs: nodeBuildFs, root }))
    })

    it("writes no sidecar when --evidence was not requested", async () => {
      await seedCapability()
      await generateDataArtifacts({
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        docs: path.join(root, "DATA.md"),
      })
      await expect(
        fs.readFile(fingerprintPathFor(path.join(root, EVIDENCE_RELATIVE)), "utf8"),
      ).rejects.toThrow()
    })
  })
})
