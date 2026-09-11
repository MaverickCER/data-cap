import { describe, expect, it } from "vitest"
import { generateManifest } from "../../src/build/generate-manifest.js"
import { buildManifestSnapshot } from "../../src/build/manifest-snapshot.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    kind: "buildData",
    docs: undefined,
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields: [],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

function inventory(capabilities: readonly CapabilityNode[]): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
}

describe("generateManifest", () => {
  it("renders content, a snapshot, and an added-capability change report on a first run", () => {
    const result = generateManifest({
      root: "/project",
      inventory: inventory([capability()]),
      location: "/project/generated/manifest.ts",
      previousSnapshot: undefined,
    })
    expect(result.location).toBe("/project/generated/manifest.ts")
    expect(result.content).toContain("userCapability")
    expect(result.changes.addedCapabilities).toEqual(["/project/user.ts#userCapability"])
    expect(result.findings).toEqual([])
  })

  it("computes an empty change report when the previous snapshot matches", () => {
    const inv = inventory([capability()])
    const previousSnapshot = buildManifestSnapshot(inv)
    const result = generateManifest({
      root: "/project",
      inventory: inv,
      location: "/project/generated/manifest.ts",
      previousSnapshot,
    })
    expect(result.changes).toEqual({
      addedCapabilities: [],
      removedCapabilities: [],
      updatedCapabilities: [],
    })
  })

  it("produces an error finding when two active capabilities collide on export name", () => {
    const result = generateManifest({
      root: "/project",
      inventory: inventory([
        capability({ exportName: "userCapability", file: "/project/a.ts" }),
        capability({ exportName: "userCapability", file: "/project/b.ts" }),
      ]),
      location: "/project/generated/manifest.ts",
      previousSnapshot: undefined,
    })
    expect(result.findings).toEqual([
      {
        code: "MANIFEST_EXPORT_NAME_COLLISION",
        family: "structural",
        severity: "error",
        message:
          'Manifest export name "userCapability" is claimed by 2 different active capability files (/project/a.ts, /project/b.ts) -- the generated manifest cannot re-export both under the same identifier. Rename one, or mark one inactive.',
      },
    ])
  })
})
