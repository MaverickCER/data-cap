import { describe, expect, it } from "vitest"
import { buildChangeModel, CHANGE_MODEL_SCHEMA_VERSION } from "../../src/build/change-model.js"
import { buildDependencyModel } from "../../src/build/dependency-model.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"
import type { ManifestChangeReport } from "../../src/build/manifest-snapshot.js"

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

function edge(overrides: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    relationship: "reads-field",
    from: "/project/consumer.ts",
    to: {
      capability: { file: "/project/user.ts", exportName: "userCapability" },
      field: ["email"],
    },
    resolution: "resolved",
    position: { line: 1, column: 1 },
    ...overrides,
  }
}

const emptyManifest: ManifestChangeReport = {
  addedCapabilities: [],
  removedCapabilities: [],
  updatedCapabilities: [],
}

describe("buildChangeModel", () => {
  it("stamps schemaVersion and carries the manifest diff through unchanged", () => {
    const model = buildChangeModel(emptyManifest, [])
    expect(model.schemaVersion).toBe(CHANGE_MODEL_SCHEMA_VERSION)
    expect(model.manifest).toBe(emptyManifest)
  })

  it("leaves blastRadius undefined when no DependencyModel is supplied", () => {
    const model = buildChangeModel(emptyManifest, [])
    expect(model.blastRadius).toBeUndefined()
  })

  it("computes blastRadius for an added capability from the current DependencyModel", () => {
    const dependencyModel = buildDependencyModel([edge()])
    const manifest: ManifestChangeReport = {
      addedCapabilities: ["/project/user.ts#userCapability"],
      removedCapabilities: [],
      updatedCapabilities: [],
    }
    const model = buildChangeModel(
      manifest,
      inventory([capability()]).capabilities,
      dependencyModel,
    )
    expect(model.blastRadius).toEqual([
      { capability: "/project/user.ts#userCapability", consumers: ["/project/consumer.ts"] },
    ])
  })

  it("computes blastRadius for an updated capability, deduplicating multiple edges from the same consumer", () => {
    const dependencyModel = buildDependencyModel([
      edge({
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
        },
      }),
      edge({
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["locale"],
        },
      }),
    ])
    const manifest: ManifestChangeReport = {
      addedCapabilities: [],
      removedCapabilities: [],
      updatedCapabilities: [
        {
          capability: "/project/user.ts#userCapability",
          changes: ["fields: added locale"],
          fields: { added: [], removed: [] },
        },
      ],
    }
    const model = buildChangeModel(
      manifest,
      inventory([capability()]).capabilities,
      dependencyModel,
    )
    expect(model.blastRadius).toEqual([
      { capability: "/project/user.ts#userCapability", consumers: ["/project/consumer.ts"] },
    ])
  })

  it("does not produce a blastRadius entry for a removed capability -- no current Dependency Model row exists for it", () => {
    const dependencyModel = buildDependencyModel([])
    const manifest: ManifestChangeReport = {
      addedCapabilities: [],
      removedCapabilities: ["/project/gone.ts#goneCapability"],
      updatedCapabilities: [],
    }
    const model = buildChangeModel(manifest, inventory([]).capabilities, dependencyModel)
    expect(model.blastRadius).toEqual([])
  })

  it("reports an empty consumers array for a changed capability with no known consumers", () => {
    const dependencyModel = buildDependencyModel([])
    const manifest: ManifestChangeReport = {
      addedCapabilities: ["/project/user.ts#userCapability"],
      removedCapabilities: [],
      updatedCapabilities: [],
    }
    const model = buildChangeModel(
      manifest,
      inventory([capability()]).capabilities,
      dependencyModel,
    )
    expect(model.blastRadius).toEqual([
      { capability: "/project/user.ts#userCapability", consumers: [] },
    ])
  })

  it("reports an empty consumers array for a changed key that has no Dependency Model row at all", () => {
    const model = buildChangeModel(
      {
        addedCapabilities: ["/project/ghost.ts#ghostCapability"],
        removedCapabilities: [],
        updatedCapabilities: [],
      },
      inventory([capability()]).capabilities,
      buildDependencyModel([]),
    )
    expect(model.blastRadius).toEqual([
      { capability: "/project/ghost.ts#ghostCapability", consumers: [] },
    ])
  })

  it("sorts each entry's consumers and orders entries by capability key, regardless of input order", () => {
    const dependencyModel = buildDependencyModel([
      edge({ from: "/project/z.ts" }),
      edge({ from: "/project/a.ts" }),
      edge({ from: "/project/m.ts" }),
    ])
    const model = buildChangeModel(
      {
        addedCapabilities: ["/project/user.ts#userCapability"],
        removedCapabilities: [],
        updatedCapabilities: [
          {
            capability: "/project/aaa.ts#aaaCapability",
            changes: ["x"],
            fields: { added: [], removed: [] },
          },
        ],
      },
      inventory([capability()]).capabilities,
      dependencyModel,
    )
    expect(model.blastRadius).toEqual([
      { capability: "/project/aaa.ts#aaaCapability", consumers: [] },
      {
        capability: "/project/user.ts#userCapability",
        consumers: ["/project/a.ts", "/project/m.ts", "/project/z.ts"],
      },
    ])
  })
})

describe("buildChangeModel -- rename correlation (EVD-05)", () => {
  const KEY = "/project/user.ts#userCapability"

  function updatedWith(added: readonly string[], removed: readonly string[]): ManifestChangeReport {
    return {
      addedCapabilities: [],
      removedCapabilities: [],
      updatedCapabilities: [
        {
          capability: KEY,
          changes: [`fields: added ${added.join(", ")}; removed ${removed.join(", ")}`],
          fields: { added: [...added], removed: [...removed] },
        },
      ],
    }
  }

  function fieldNamed(name: string, renamedFrom?: string): CapabilityNode["fields"][number] {
    return {
      path: [name],
      docs: renamedFrom === undefined ? undefined : { renamedFrom },
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

  it("correlates an added/removed pair into one rename via the current declaration's renamedFrom", () => {
    const model = buildChangeModel(
      updatedWith(["contactEmail"], ["email"]),
      inventory([
        capability({
          // the renamed field is deliberately NOT first, so the lookup must
          // match on the field's own path, not just take the first field
          fields: [fieldNamed("unrelated"), fieldNamed("contactEmail", "email")],
        }),
      ]).capabilities,
    )
    expect(model.renamedFields).toEqual([
      { capability: KEY, previousName: "email", currentName: "contactEmail" },
    ])
  })

  it("never guesses a rename from name similarity alone -- an unauthored pair correlates nothing", () => {
    const model = buildChangeModel(
      updatedWith(["emailAddress"], ["email"]),
      inventory([capability({ fields: [fieldNamed("emailAddress")] })]).capabilities,
    )
    expect(model.renamedFields).toEqual([])
  })

  it("tolerates a ChangeModelCapability that omits `fields` entirely", () => {
    const model = buildChangeModel(updatedWith(["contactEmail"], ["email"]), [
      { file: "/project/user.ts", exportName: "userCapability" },
    ])
    expect(model.renamedFields).toEqual([])
  })

  it("never correlates a rename in a capability that is not part of this run's diff", () => {
    const model = buildChangeModel(
      updatedWith(["contactEmail"], ["email"]),
      inventory([
        capability({ fields: [fieldNamed("contactEmail", "email")] }),
        // present in the model but NOT in `updatedCapabilities` -> must be skipped
        capability({
          file: "/project/other.ts",
          exportName: "otherCapability",
          fields: [fieldNamed("contactPhone", "phone")],
        }),
      ]).capabilities,
    )
    expect(model.renamedFields).toEqual([
      { capability: KEY, previousName: "email", currentName: "contactEmail" },
    ])
  })

  it("ignores a stale renamedFrom whose named field was not actually removed this run", () => {
    const model = buildChangeModel(
      updatedWith(["contactEmail"], ["somethingElse"]),
      inventory([capability({ fields: [fieldNamed("contactEmail", "email")] })]).capabilities,
    )
    expect(model.renamedFields).toEqual([])
  })

  it("ignores a renamedFrom on a field that is not newly added this run", () => {
    const model = buildChangeModel(
      updatedWith([], ["email"]),
      inventory([capability({ fields: [fieldNamed("contactEmail", "email")] })]).capabilities,
    )
    expect(model.renamedFields).toEqual([])
  })

  it("leaves the manifest diff's own added/removed halves listed separately (additive, not a filter)", () => {
    const manifest = updatedWith(["contactEmail"], ["email"])
    const model = buildChangeModel(
      manifest,
      inventory([capability({ fields: [fieldNamed("contactEmail", "email")] })]).capabilities,
    )
    expect(model.manifest.updatedCapabilities[0]!.fields).toEqual({
      added: ["contactEmail"],
      removed: ["email"],
    })
  })

  it("is computed with no DependencyModel supplied, unlike blastRadius", () => {
    const model = buildChangeModel(
      updatedWith(["contactEmail"], ["email"]),
      inventory([capability({ fields: [fieldNamed("contactEmail", "email")] })]).capabilities,
    )
    expect(model.blastRadius).toBeUndefined()
    expect(model.renamedFields).toHaveLength(1)
  })

  it("sorts renames by capability key then current name", () => {
    const manifest: ManifestChangeReport = {
      addedCapabilities: [],
      removedCapabilities: [],
      updatedCapabilities: [
        {
          capability: KEY,
          changes: ["fields changed"],
          fields: { added: ["zeta", "alpha"], removed: ["oldZeta", "oldAlpha"] },
        },
      ],
    }
    const model = buildChangeModel(
      manifest,
      inventory([
        capability({
          fields: [fieldNamed("zeta", "oldZeta"), fieldNamed("alpha", "oldAlpha")],
        }),
      ]).capabilities,
    )
    expect(model.renamedFields.map((r) => r.currentName)).toEqual(["alpha", "zeta"])
  })
})
