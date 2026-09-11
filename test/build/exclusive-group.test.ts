import { describe, expect, it } from "vitest"
import { checkExclusiveGroups } from "../../src/build/exclusive-group.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "/project/a.ts",
    exportName: "a",
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

describe("checkExclusiveGroups", () => {
  it("produces no findings when no capability declares an exclusiveGroup", () => {
    const findings = checkExclusiveGroups(
      inventory([capability(), capability({ exportName: "b" })]),
    )
    expect(findings).toEqual([])
  })

  it("produces no findings when only one active capability is in a group", () => {
    const findings = checkExclusiveGroups(
      inventory([capability({ exclusiveGroup: "user-backend" })]),
    )
    expect(findings).toEqual([])
  })

  it("flags every member when two active capabilities share an exclusiveGroup", () => {
    const findings = checkExclusiveGroups(
      inventory([
        capability({ exportName: "a", file: "/project/a.ts", exclusiveGroup: "user-backend" }),
        capability({ exportName: "b", file: "/project/b.ts", exclusiveGroup: "user-backend" }),
      ]),
    )
    expect(findings).toHaveLength(2)
    expect(findings.every((f) => f.code === "EXCLUSIVE_GROUP_CONFLICT")).toBe(true)
    expect(findings.every((f) => f.severity === "error")).toBe(true)
    expect(findings.map((f) => f.capability?.exportName).sort()).toEqual(["a", "b"])
    expect(findings[0]!.message).toContain("user-backend")
  })

  it("emits each finding verbatim, singular 'capability' for exactly one other member", () => {
    const findings = checkExclusiveGroups(
      inventory([
        capability({
          exportName: "a",
          file: "/project/a.ts",
          exclusiveGroup: "user-backend",
          declarationPosition: { line: 3, column: 1 },
        }),
        capability({ exportName: "b", file: "/project/b.ts", exclusiveGroup: "user-backend" }),
      ]),
    )
    expect(findings.find((f) => f.capability?.exportName === "a")).toEqual({
      code: "EXCLUSIVE_GROUP_CONFLICT",
      family: "structural",
      severity: "error",
      message:
        '"a" shares exclusiveGroup "user-backend" with 1 other active capability (b) -- only one member of a group should be active at once.',
      capability: { file: "/project/a.ts", exportName: "a" },
      position: { line: 3, column: 1 },
    })
  })

  it("does not flag two capabilities in the same group when one is inactive", () => {
    const findings = checkExclusiveGroups(
      inventory([
        capability({ exportName: "a", exclusiveGroup: "user-backend", active: true }),
        capability({ exportName: "b", exclusiveGroup: "user-backend", active: false }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("pluralizes the message correctly when more than two members share a group", () => {
    const findings = checkExclusiveGroups(
      inventory([
        capability({ exportName: "a", exclusiveGroup: "user-backend" }),
        capability({ exportName: "b", exclusiveGroup: "user-backend" }),
        capability({ exportName: "c", exclusiveGroup: "user-backend" }),
      ]),
    )
    expect(findings).toHaveLength(3)
    const findingForA = findings.find((f) => f.capability?.exportName === "a")!
    expect(findingForA.message).toContain("2 other active capabilities")
    expect(findingForA.message).toContain("b, c")
  })

  it("keeps groups independent -- a third, unrelated group never appears in another group's findings", () => {
    const findings = checkExclusiveGroups(
      inventory([
        capability({ exportName: "a", exclusiveGroup: "group-1" }),
        capability({ exportName: "b", exclusiveGroup: "group-1" }),
        capability({ exportName: "c", exclusiveGroup: "group-2" }),
      ]),
    )
    expect(findings.map((f) => f.capability?.exportName).sort()).toEqual(["a", "b"])
  })

  it("populates position from each member's own declaration position (ADR 0052)", () => {
    const findings = checkExclusiveGroups(
      inventory([
        capability({
          exportName: "a",
          exclusiveGroup: "group-1",
          declarationPosition: { line: 10, column: 1 },
        }),
        capability({
          exportName: "b",
          exclusiveGroup: "group-1",
          declarationPosition: { line: 20, column: 1 },
        }),
      ]),
    )
    expect(findings.find((f) => f.capability?.exportName === "a")?.position).toEqual({
      line: 10,
      column: 1,
    })
    expect(findings.find((f) => f.capability?.exportName === "b")?.position).toEqual({
      line: 20,
      column: 1,
    })
  })
})
