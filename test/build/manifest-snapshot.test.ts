import { describe, expect, it } from "vitest"
import { buildManifestSnapshot, diffManifestSnapshots } from "../../src/build/manifest-snapshot.js"
import type {
  ManifestSnapshot,
  ManifestSnapshotCapability,
} from "../../src/build/manifest-snapshot.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

function field(overrides: Partial<FieldNode> = {}): FieldNode {
  return {
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
    ...overrides,
  }
}

function operation(overrides: Partial<OperationNode> = {}): OperationNode {
  return {
    kind: "getter",
    name: "getUser",
    docs: undefined,
    writes: [],
    hasProcessor: false,
    hasOptimistic: false,
    endpoints: [],
    ...overrides,
  }
}

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

function snapshotCapability(
  overrides: Partial<ManifestSnapshotCapability> = {},
): ManifestSnapshotCapability {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    active: true,
    owner: undefined,
    fields: [],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

function rawSnapshot(capabilities: readonly ManifestSnapshotCapability[]): ManifestSnapshot {
  return { snapshotSchemaVersion: 2, capabilities }
}

describe("buildManifestSnapshot", () => {
  it("includes both active and inactive capabilities", () => {
    const snapshot = buildManifestSnapshot(
      inventory([capability({ exportName: "a" }), capability({ exportName: "b", active: false })]),
    )
    expect(snapshot.capabilities.map((c) => c.exportName)).toEqual(["a", "b"])
  })

  it("sorts fields/getters/mutators/subscriptions alphabetically regardless of declaration order", () => {
    const snapshot = buildManifestSnapshot(
      inventory([
        capability({
          fields: [field({ path: ["zField"] }), field({ path: ["aField"] })],
          getters: [operation({ name: "zGetter" }), operation({ name: "aGetter" })],
          mutators: [operation({ name: "zMutator" }), operation({ name: "aMutator" })],
          subscriptions: [operation({ name: "zSub" }), operation({ name: "aSub" })],
        }),
      ]),
    )
    expect(snapshot.capabilities[0]!.fields).toEqual(["aField", "zField"])
    expect(snapshot.capabilities[0]!.getters).toEqual(["aGetter", "zGetter"])
    expect(snapshot.capabilities[0]!.mutators).toEqual(["aMutator", "zMutator"])
    expect(snapshot.capabilities[0]!.subscriptions).toEqual(["aSub", "zSub"])
  })

  it("sorts capabilities deterministically by file then export name", () => {
    const snapshot = buildManifestSnapshot(
      inventory([
        capability({ file: "/project/z.ts", exportName: "z" }),
        capability({ file: "/project/a.ts", exportName: "a" }),
      ]),
    )
    expect(snapshot.capabilities.map((c) => c.file)).toEqual(["/project/a.ts", "/project/z.ts"])
  })

  it("carries the resolved owner through", () => {
    const snapshot = buildManifestSnapshot(
      inventory([capability({ docs: { owner: "identity-team" } })]),
    )
    expect(snapshot.capabilities[0]!.owner).toBe("identity-team")
  })

  it("joins a multi-segment field path with dots", () => {
    const snapshot = buildManifestSnapshot(
      inventory([capability({ fields: [field({ path: ["profile", "contact", "email"] })] })]),
    )
    expect(snapshot.capabilities[0]!.fields).toEqual(["profile.contact.email"])
  })
})

describe("diffManifestSnapshots", () => {
  it("reports every capability as added when there is no previous snapshot", () => {
    const current = buildManifestSnapshot(inventory([capability()]))
    const report = diffManifestSnapshots(undefined, current)
    expect(report.addedCapabilities).toEqual(["/project/user.ts#userCapability"])
    expect(report.removedCapabilities).toEqual([])
    expect(report.updatedCapabilities).toEqual([])
  })

  it("reports no changes when the snapshot is identical", () => {
    const snapshot = buildManifestSnapshot(inventory([capability()]))
    const report = diffManifestSnapshots(snapshot, snapshot)
    expect(report).toEqual({
      addedCapabilities: [],
      removedCapabilities: [],
      updatedCapabilities: [],
    })
  })

  it("reports a removed capability", () => {
    const previous = buildManifestSnapshot(inventory([capability()]))
    const current = buildManifestSnapshot(inventory([]))
    const report = diffManifestSnapshots(previous, current)
    expect(report.removedCapabilities).toEqual(["/project/user.ts#userCapability"])
  })

  it("reports an active -> inactive transition as an update", () => {
    const previous = buildManifestSnapshot(inventory([capability({ active: true })]))
    const current = buildManifestSnapshot(inventory([capability({ active: false })]))
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities).toHaveLength(1)
    expect(report.updatedCapabilities[0]!.changes).toContain("became inactive")
  })

  it("reports an inactive -> active transition as an update", () => {
    const previous = buildManifestSnapshot(inventory([capability({ active: false })]))
    const current = buildManifestSnapshot(inventory([capability({ active: true })]))
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities[0]!.changes).toContain("became active")
  })

  it("reports an owner change as an update", () => {
    const previous = buildManifestSnapshot(inventory([capability({ docs: { owner: "team-a" } })]))
    const current = buildManifestSnapshot(inventory([capability({ docs: { owner: "team-b" } })]))
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities[0]!.changes[0]).toContain("team-a")
    expect(report.updatedCapabilities[0]!.changes[0]).toContain("team-b")
  })

  it("renders (none) when the owner was previously undefined", () => {
    const previous = buildManifestSnapshot(inventory([capability()]))
    const current = buildManifestSnapshot(inventory([capability({ docs: { owner: "team-a" } })]))
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities[0]!.changes[0]).toBe("owner changed from (none) to team-a")
  })

  it("renders (none) when the owner becomes undefined", () => {
    const previous = buildManifestSnapshot(inventory([capability({ docs: { owner: "team-a" } })]))
    const current = buildManifestSnapshot(inventory([capability()]))
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities[0]!.changes[0]).toBe("owner changed from team-a to (none)")
  })

  it("reports added and removed fields on the same capability", () => {
    const previous = buildManifestSnapshot(
      inventory([capability({ fields: [field({ path: ["email"] })] })]),
    )
    const current = buildManifestSnapshot(
      inventory([capability({ fields: [field({ path: ["locale"] })] })]),
    )
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities[0]!.changes.join(" ")).toContain("added locale")
    expect(report.updatedCapabilities[0]!.changes.join(" ")).toContain("removed email")
  })

  it("reports added/removed getters, mutators, and subscriptions independently", () => {
    const previous = buildManifestSnapshot(
      inventory([
        capability({
          getters: [operation({ kind: "getter", name: "getUser" })],
          mutators: [operation({ kind: "mutator", name: "updateUser" })],
          subscriptions: [operation({ kind: "subscription", name: "subscribeToUser" })],
        }),
      ]),
    )
    const current = buildManifestSnapshot(inventory([capability()]))
    const report = diffManifestSnapshots(previous, current)
    const changes = report.updatedCapabilities[0]!.changes.join(" | ")
    expect(changes).toContain("getters: removed getUser")
    expect(changes).toContain("mutators: removed updateUser")
    expect(changes).toContain("subscriptions: removed subscribeToUser")
  })

  it("sorts multiple updated capabilities deterministically by key", () => {
    const previous = buildManifestSnapshot(
      inventory([
        capability({ exportName: "z", file: "/project/z.ts", docs: { owner: "team-a" } }),
        capability({ exportName: "a", file: "/project/a.ts", docs: { owner: "team-a" } }),
      ]),
    )
    const current = buildManifestSnapshot(
      inventory([
        capability({ exportName: "z", file: "/project/z.ts", docs: { owner: "team-b" } }),
        capability({ exportName: "a", file: "/project/a.ts", docs: { owner: "team-b" } }),
      ]),
    )
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities.map((u) => u.capability)).toEqual([
      "/project/a.ts#a",
      "/project/z.ts#z",
    ])
  })

  it("renders every change category as an exact prose sentence and a structured field diff", () => {
    const previous = rawSnapshot([
      snapshotCapability({
        active: true,
        owner: "team-a",
        fields: ["email", "phone", "ssn"],
        getters: ["getA", "getB", "getD"],
        mutators: ["mutA", "mutB", "mutD"],
        subscriptions: ["subA", "subB", "subD"],
      }),
    ])
    const current = rawSnapshot([
      snapshotCapability({
        active: false,
        owner: "team-b",
        fields: ["email", "locale", "zip"],
        getters: ["getA", "getC", "getE"],
        mutators: ["mutA", "mutC", "mutE"],
        subscriptions: ["subA", "subC", "subE"],
      }),
    ])
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities[0]!.changes).toEqual([
      "became inactive",
      "owner changed from team-a to team-b",
      "fields: added locale, zip; removed phone, ssn",
      "getters: added getC, getE; removed getB, getD",
      "mutators: added mutC, mutE; removed mutB, mutD",
      "subscriptions: added subC, subE; removed subB, subD",
    ])
    expect(report.updatedCapabilities[0]!.fields).toEqual({
      added: ["locale", "zip"],
      removed: ["phone", "ssn"],
    })
  })

  it("omits the added/removed clause that has no members", () => {
    const previous = rawSnapshot([
      snapshotCapability({ fields: ["email", "phone"], getters: ["getA"] }),
    ])
    const current = rawSnapshot([
      snapshotCapability({ fields: ["email"], getters: ["getA", "getB"] }),
    ])
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities[0]!.changes).toEqual([
      "fields: removed phone",
      "getters: added getB",
    ])
  })

  it("sorts addedCapabilities even when the current snapshot lists them out of order", () => {
    const current = rawSnapshot([
      snapshotCapability({ file: "/project/z.ts", exportName: "z" }),
      snapshotCapability({ file: "/project/a.ts", exportName: "a" }),
    ])
    const report = diffManifestSnapshots(rawSnapshot([]), current)
    expect(report.addedCapabilities).toEqual(["/project/a.ts#a", "/project/z.ts#z"])
  })

  it("sorts removedCapabilities even when the previous snapshot lists them out of order", () => {
    const previous = rawSnapshot([
      snapshotCapability({ file: "/project/z.ts", exportName: "z" }),
      snapshotCapability({ file: "/project/a.ts", exportName: "a" }),
    ])
    const report = diffManifestSnapshots(previous, rawSnapshot([]))
    expect(report.removedCapabilities).toEqual(["/project/a.ts#a", "/project/z.ts#z"])
  })

  it("sorts updatedCapabilities even when the current snapshot lists them out of order", () => {
    const previous = rawSnapshot([
      snapshotCapability({ file: "/project/z.ts", exportName: "z", owner: "team-a" }),
      snapshotCapability({ file: "/project/a.ts", exportName: "a", owner: "team-a" }),
    ])
    const current = rawSnapshot([
      snapshotCapability({ file: "/project/z.ts", exportName: "z", owner: "team-b" }),
      snapshotCapability({ file: "/project/a.ts", exportName: "a", owner: "team-b" }),
    ])
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities.map((u) => u.capability)).toEqual([
      "/project/a.ts#a",
      "/project/z.ts#z",
    ])
  })

  it("does not report a capability as updated when nothing about it changed, even alongside other real changes", () => {
    const unchanged = capability({ exportName: "unchanged", file: "/project/unchanged.ts" })
    const previous = buildManifestSnapshot(
      inventory([unchanged, capability({ docs: { owner: "team-a" } })]),
    )
    const current = buildManifestSnapshot(
      inventory([unchanged, capability({ docs: { owner: "team-b" } })]),
    )
    const report = diffManifestSnapshots(previous, current)
    expect(report.updatedCapabilities).toHaveLength(1)
    expect(report.updatedCapabilities[0]!.capability).toContain("userCapability")
  })
})
