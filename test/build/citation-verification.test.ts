import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildCitationSnapshots,
  verifyDynamicAccessCitations,
} from "../../src/build/citation-verification.js"
import { nodeBuildFs } from "../support/build-filesystem.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type {
  ManifestSnapshot,
  ManifestSnapshotCapability,
} from "../../src/build/manifest-snapshot.js"

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    kind: "buildData",
    docs: undefined,
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields: [
      {
        path: ["email"],
        docs: undefined,
        owner: { value: undefined, declaredOn: undefined },
        sensitivity: { value: undefined, declaredOn: undefined },
        purpose: { value: undefined, declaredOn: undefined },
        legalBasis: { value: undefined, declaredOn: undefined },
        dataResidency: { value: undefined, declaredOn: undefined },
        auditRequired: { value: undefined, declaredOn: undefined },
        declarationPosition: undefined,
        writtenBy: [],
        shape: "",
      },
    ],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

function inventory(capabilities: readonly CapabilityNode[]): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
}

function emptyField(path: readonly string[]): CapabilityNode["fields"][number] {
  return {
    path,
    docs: undefined,
    owner: { value: undefined, declaredOn: undefined },
    sensitivity: { value: undefined, declaredOn: undefined },
    purpose: { value: undefined, declaredOn: undefined },
    legalBasis: { value: undefined, declaredOn: undefined },
    dataResidency: { value: undefined, declaredOn: undefined },
    auditRequired: { value: undefined, declaredOn: undefined },
    declarationPosition: undefined,
    writtenBy: [],
    shape: "",
  }
}

function snapshotCapability(
  overrides: Partial<ManifestSnapshotCapability> = {},
): ManifestSnapshotCapability {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    active: true,
    owner: undefined,
    fields: ["email"],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

describe("citation-verification", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-citation-test-"))
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

  describe("buildCitationSnapshots", () => {
    it("computes a hash entry for a citation whose file currently exists", async () => {
      await writeFile("src/legacy.ts", "const x = 1;\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:5:3"] } } } },
      })
      const snapshots = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      const byField = snapshots.get("/project/user.ts#userCapability")
      expect(byField?.email).toHaveLength(1)
      expect(byField?.email?.[0]).toMatchObject({ file: "src/legacy.ts", line: 5, column: 3 })
      expect(typeof byField?.email?.[0]?.hash).toBe("string")
    })

    it("omits a citation whose file does not resolve, without throwing", async () => {
      const cap = capability({
        docs: {
          evidence: { fields: { email: { dynamicAccess: ["src/does-not-exist.ts:1:1"] } } },
        },
      })
      const snapshots = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      expect(snapshots.get("/project/user.ts#userCapability")).toBeUndefined()
    })

    it("returns an empty map when nothing declares evidence", async () => {
      const snapshots = await buildCitationSnapshots(inventory([capability()]), root, nodeBuildFs)
      expect(snapshots.size).toBe(0)
    })

    it("produces the same hash for identical content, a different hash after the file changes", async () => {
      const filePath = await writeFile("src/legacy.ts", "original content\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const first = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      const firstHash = first.get("/project/user.ts#userCapability")?.email?.[0]?.hash

      await fs.writeFile(filePath, "changed content\n", "utf8")
      const second = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      const secondHash = second.get("/project/user.ts#userCapability")?.email?.[0]?.hash

      expect(firstHash).toBeDefined()
      expect(secondHash).toBeDefined()
      expect(secondHash).not.toBe(firstHash)
    })
  })

  describe("verifyDynamicAccessCitations", () => {
    it("never flags a citation with no prior recorded hash -- nothing to have gone stale relative to", async () => {
      await writeFile("src/legacy.ts", "content\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const findings = await verifyDynamicAccessCitations(
        inventory([cap]),
        undefined,
        root,
        nodeBuildFs,
      )
      expect(findings).toEqual([])
    })

    it("flags DYNAMIC_ACCESS_CITATION_MISSING when the cited file no longer resolves", async () => {
      const cap = capability({
        docs: {
          evidence: { fields: { email: { dynamicAccess: ["src/does-not-exist.ts:1:1"] } } },
        },
      })
      const findings = await verifyDynamicAccessCitations(
        inventory([cap]),
        undefined,
        root,
        nodeBuildFs,
      )
      expect(findings).toContainEqual(
        expect.objectContaining({
          code: "DYNAMIC_ACCESS_CITATION_MISSING",
          family: "citation",
          severity: "warning",
          field: ["email"],
        }),
      )
    })

    it("never flags DYNAMIC_ACCESS_CITATION_STALE when the current hash matches the previous snapshot's recorded hash", async () => {
      const filePath = await writeFile("src/legacy.ts", "stable content\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const snapshots = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      const entry = snapshots.get("/project/user.ts#userCapability")?.email
      const previous: ManifestSnapshot = {
        snapshotSchemaVersion: 2,
        capabilities: [snapshotCapability({ citationSnapshots: { email: entry ?? [] } })],
      }

      // Sanity: the file is unchanged since the snapshot was built.
      await fs.readFile(filePath, "utf8")
      const findings = await verifyDynamicAccessCitations(
        inventory([cap]),
        previous,
        root,
        nodeBuildFs,
      )
      expect(findings).toEqual([])
    })

    it("flags DYNAMIC_ACCESS_CITATION_STALE when the cited file's content changed since the previous snapshot", async () => {
      const filePath = await writeFile("src/legacy.ts", "original content\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const snapshots = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      const entry = snapshots.get("/project/user.ts#userCapability")?.email
      const previous: ManifestSnapshot = {
        snapshotSchemaVersion: 2,
        capabilities: [snapshotCapability({ citationSnapshots: { email: entry ?? [] } })],
      }

      // The file the citation points to changes -- the developer's own
      // assertion can no longer be confirmed to still describe reality.
      await fs.writeFile(filePath, "the file changed underneath the citation\n", "utf8")

      const findings = await verifyDynamicAccessCitations(
        inventory([cap]),
        previous,
        root,
        nodeBuildFs,
      )
      expect(findings).toContainEqual(
        expect.objectContaining({
          code: "DYNAMIC_ACCESS_CITATION_STALE",
          family: "citation",
          severity: "warning",
          field: ["email"],
        }),
      )
    })

    it("never flags a capability/field with no declared citations at all", async () => {
      const findings = await verifyDynamicAccessCitations(
        inventory([capability()]),
        undefined,
        root,
        nodeBuildFs,
      )
      expect(findings).toEqual([])
    })

    it("emits DYNAMIC_ACCESS_CITATION_MISSING verbatim, with the field's own path and position", async () => {
      const cap = capability({
        fields: [
          {
            path: ["contact", "email"],
            docs: undefined,
            owner: { value: undefined, declaredOn: undefined },
            sensitivity: { value: undefined, declaredOn: undefined },
            purpose: { value: undefined, declaredOn: undefined },
            legalBasis: { value: undefined, declaredOn: undefined },
            dataResidency: { value: undefined, declaredOn: undefined },
            auditRequired: { value: undefined, declaredOn: undefined },
            declarationPosition: { line: 7, column: 4 },
            writtenBy: [],
            shape: "",
          },
        ],
        docs: {
          evidence: { fields: { contact: { dynamicAccess: ["src/missing.ts:12:34"] } } },
        },
      })
      const findings = await verifyDynamicAccessCitations(
        inventory([cap]),
        undefined,
        root,
        nodeBuildFs,
      )
      expect(findings).toEqual([
        {
          code: "DYNAMIC_ACCESS_CITATION_MISSING",
          family: "citation",
          severity: "warning",
          message:
            'Declared dynamicAccess citation "src/missing.ts:12:34" on field "contact" on "userCapability" no longer resolves to a real file -- the developer\'s own citation could not be re-confirmed this run.',
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["contact", "email"],
          position: { line: 7, column: 4 },
        },
      ])
    })

    it("falls back to [fieldKey] and an absent position when no field matches the evidence key", async () => {
      const cap = capability({
        fields: [],
        docs: { evidence: { fields: { ghost: { dynamicAccess: ["src/missing.ts:1:1"] } } } },
      })
      const findings = await verifyDynamicAccessCitations(
        inventory([cap]),
        undefined,
        root,
        nodeBuildFs,
      )
      expect(findings[0]).toMatchObject({ field: ["ghost"], position: undefined })
    })

    it("emits DYNAMIC_ACCESS_CITATION_STALE verbatim", async () => {
      const filePath = await writeFile("src/legacy.ts", "v1\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const snap = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      const previous: ManifestSnapshot = {
        snapshotSchemaVersion: 2,
        capabilities: [
          snapshotCapability({
            citationSnapshots: { email: snap.get("/project/user.ts#userCapability")?.email ?? [] },
          }),
        ],
      }
      await fs.writeFile(filePath, "v2 -- changed\n", "utf8")
      const findings = await verifyDynamicAccessCitations(
        inventory([cap]),
        previous,
        root,
        nodeBuildFs,
      )
      expect(findings).toEqual([
        {
          code: "DYNAMIC_ACCESS_CITATION_STALE",
          family: "citation",
          severity: "warning",
          message:
            'Declared dynamicAccess citation "src/legacy.ts:1:1" on field "email" on "userCapability" points to a file that has visibly changed since this citation was last confirmed -- re-verify it still describes real access at that location.',
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
          position: undefined,
        },
      ])
    })

    it.each([
      ["a different file", { file: "src/other.ts", line: 1, column: 1 }],
      ["a different line", { file: "src/legacy.ts", line: 2, column: 1 }],
      ["a different column", { file: "src/legacy.ts", line: 1, column: 2 }],
    ])(
      "does not match a previous citation hash recorded against %s (so never flags STALE)",
      async (_label, prevEntry) => {
        const filePath = await writeFile("src/legacy.ts", "v1\n")
        const cap = capability({
          docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
        })
        const previous: ManifestSnapshot = {
          snapshotSchemaVersion: 2,
          capabilities: [
            snapshotCapability({
              citationSnapshots: { email: [{ ...prevEntry, hash: "stale-hash-that-differs" }] },
            }),
          ],
        }
        await fs.writeFile(filePath, "v2\n", "utf8")
        const findings = await verifyDynamicAccessCitations(
          inventory([cap]),
          previous,
          root,
          nodeBuildFs,
        )
        expect(findings).toEqual([])
      },
    )

    it.each([
      "src/legacy.ts", // no line/column
      "src/legacy.ts:notaline:3", // line not numeric
      "::", // nothing
      "src/legacy.ts:1:2trailing", // junk after the column ($ anchor)
      "\nsrc/legacy.ts:1:1", // leading newline (^ anchor)
    ])("skips the malformed citation %j entirely", async (badCitation) => {
      await writeFile("src/legacy.ts", "content\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: [badCitation] } } } },
      })
      expect(
        await verifyDynamicAccessCitations(inventory([cap]), undefined, root, nodeBuildFs),
      ).toEqual([])
      expect((await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)).size).toBe(0)
    })

    it("does no work for a field whose evidence declares an empty or absent dynamicAccess list", async () => {
      const cap = capability({
        docs: {
          evidence: { fields: { email: { dynamicAccess: [] }, name: {} } },
        },
      })
      expect(
        await verifyDynamicAccessCitations(inventory([cap]), undefined, root, nodeBuildFs),
      ).toEqual([])
      expect((await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)).size).toBe(0)
    })

    it("matches the citation against the right prior capability and the right field, not just the first", async () => {
      const filePath = await writeFile("src/legacy.ts", "v1\n")
      const cap = capability({
        fields: [
          { ...emptyField(["other"]), path: ["other"] },
          { ...emptyField(["email"]), path: ["email"] },
        ],
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const snap = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      const emailEntry = snap.get("/project/user.ts#userCapability")?.email ?? []
      const previous: ManifestSnapshot = {
        snapshotSchemaVersion: 2,
        capabilities: [
          snapshotCapability({ file: "/project/other.ts", exportName: "otherCapability" }),
          snapshotCapability({
            citationSnapshots: {
              wrongField: [{ file: "src/legacy.ts", line: 1, column: 1, hash: "x" }],
              email: emailEntry,
            },
          }),
        ],
      }
      await fs.writeFile(filePath, "v2\n", "utf8")
      const findings = await verifyDynamicAccessCitations(
        inventory([cap]),
        previous,
        root,
        nodeBuildFs,
      )
      expect(findings).toMatchObject([{ code: "DYNAMIC_ACCESS_CITATION_STALE", field: ["email"] }])
    })

    it("uses the matched field's own path and position on a STALE finding, and falls back to [fieldKey] when no field matches", async () => {
      const filePath = await writeFile("src/legacy.ts", "v1\n")
      const withField = capability({
        fields: [
          { ...emptyField(["contact", "email"]), declarationPosition: { line: 8, column: 2 } },
        ],
        docs: { evidence: { fields: { contact: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const ghost = capability({
        file: "/project/g.ts",
        exportName: "ghostCapability",
        fields: [],
        docs: { evidence: { fields: { missingField: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const build = await buildCitationSnapshots(inventory([withField, ghost]), root, nodeBuildFs)
      const previous: ManifestSnapshot = {
        snapshotSchemaVersion: 2,
        capabilities: [
          snapshotCapability({
            citationSnapshots: {
              contact: build.get("/project/user.ts#userCapability")?.contact ?? [],
            },
          }),
          snapshotCapability({
            file: "/project/g.ts",
            exportName: "ghostCapability",
            citationSnapshots: {
              missingField: build.get("/project/g.ts#ghostCapability")?.missingField ?? [],
            },
          }),
        ],
      }
      await fs.writeFile(filePath, "v2\n", "utf8")
      const findings = await verifyDynamicAccessCitations(
        inventory([withField, ghost]),
        previous,
        root,
        nodeBuildFs,
      )
      expect(findings).toMatchObject([
        { field: ["contact", "email"], position: { line: 8, column: 2 } },
        { field: ["missingField"], position: undefined },
      ])
    })

    it("treats a prior capability with no citationSnapshots at all as 'no prior hash'", async () => {
      const filePath = await writeFile("src/legacy.ts", "v1\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:1:1"] } } } },
      })
      const previous: ManifestSnapshot = {
        snapshotSchemaVersion: 2,
        capabilities: [snapshotCapability({ citationSnapshots: undefined })],
      }
      await fs.writeFile(filePath, "v2\n", "utf8")
      expect(
        await verifyDynamicAccessCitations(inventory([cap]), previous, root, nodeBuildFs),
      ).toEqual([])
    })

    it("parses a multi-digit line and column exactly", async () => {
      const filePath = await writeFile("src/legacy.ts", "content\n")
      const cap = capability({
        docs: { evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:120:345"] } } } },
      })
      const snap = await buildCitationSnapshots(inventory([cap]), root, nodeBuildFs)
      expect(snap.get("/project/user.ts#userCapability")?.email?.[0]).toMatchObject({
        file: "src/legacy.ts",
        line: 120,
        column: 345,
      })
      await fs.rm(filePath)
    })
  })
})
