import { describe, expect, it } from "vitest"
import {
  projectFields,
  projectGetters,
  projectMutators,
  projectOperationInventory,
  projectSubscriptions,
} from "../../src/build/inventory-projections.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"

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

const getter = {
  kind: "getter" as const,
  name: "getUser",
  docs: undefined,
  writes: [],
  hasProcessor: false,
  hasOptimistic: false,
  endpoints: [],
}
const mutator = { ...getter, kind: "mutator" as const, name: "updateUser" }
const subscription = { ...getter, kind: "subscription" as const, name: "subscribeToUser" }
const field = {
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
}

describe("inventory-projections", () => {
  it("projectGetters returns only getters, tagged with their capability", () => {
    const result = projectGetters(
      inventory([capability({ getters: [getter], mutators: [mutator] })]),
    )
    expect(result).toEqual([
      { capability: { file: "/project/user.ts", exportName: "userCapability" }, node: getter },
    ])
  })

  it("projectMutators returns only mutators", () => {
    const result = projectMutators(
      inventory([capability({ getters: [getter], mutators: [mutator] })]),
    )
    expect(result.map((r) => r.node.name)).toEqual(["updateUser"])
  })

  it("projectSubscriptions returns only subscriptions", () => {
    const result = projectSubscriptions(inventory([capability({ subscriptions: [subscription] })]))
    expect(result.map((r) => r.node.name)).toEqual(["subscribeToUser"])
  })

  it("projectOperationInventory concatenates getters, mutators, and subscriptions in that order", () => {
    const result = projectOperationInventory(
      inventory([
        capability({ getters: [getter], mutators: [mutator], subscriptions: [subscription] }),
      ]),
    )
    expect(result.map((r) => r.node.name)).toEqual(["getUser", "updateUser", "subscribeToUser"])
  })

  it("projectFields returns every field across every capability", () => {
    const result = projectFields(
      inventory([
        capability({ exportName: "a", fields: [field] }),
        capability({ exportName: "b", fields: [] }),
      ]),
    )
    expect(result).toEqual([
      { capability: { file: "/project/user.ts", exportName: "a" }, node: field },
    ])
  })

  it("returns an empty array when there are no capabilities", () => {
    expect(projectGetters(inventory([]))).toEqual([])
    expect(projectFields(inventory([]))).toEqual([])
  })
})
