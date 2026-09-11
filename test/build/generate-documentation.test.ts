import { describe, expect, it } from "vitest"
import { generateDocumentation } from "../../src/build/generate-documentation.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"

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

describe("generateDocumentation", () => {
  it("renders content at the requested location", () => {
    const result = generateDocumentation({
      inventory: inventory([capability()]),
      root: "/project",
      location: "/project/docs/CAPABILITIES.md",
    })
    expect(result.location).toBe("/project/docs/CAPABILITIES.md")
    expect(result.content).toContain("userCapability")
  })

  it("surfaces ownership/sensitivity findings from static-rules.ts", () => {
    const result = generateDocumentation({
      inventory: inventory([capability()]),
      root: "/project",
      location: "/project/docs/CAPABILITIES.md",
    })
    expect(result.findings.some((f) => f.code === "CAPABILITY_MISSING_OWNER")).toBe(true)
  })

  it("passes an optional changes report through to the rendered content", () => {
    const result = generateDocumentation({
      inventory: inventory([]),
      root: "/project",
      location: "/project/docs/CAPABILITIES.md",
      changes: {
        addedCapabilities: ["/project/a.ts#a"],
        removedCapabilities: [],
        updatedCapabilities: [],
      },
    })
    expect(result.content).toContain("/project/a.ts#a")
  })

  it("passes optional usage edges through, rendering exact proven consumption sites", () => {
    const edges: readonly DependencyEdge[] = [
      {
        relationship: "reads-field",
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
        },
        resolution: "resolved",
        position: { line: 7, column: 3 },
      },
    ]
    const result = generateDocumentation({
      inventory: inventory([
        capability({
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
        }),
      ]),
      root: "/project",
      location: "/project/docs/CAPABILITIES.md",
      edges,
    })
    expect(result.content).toContain("consumer.ts:7:3")
    expect(result.content).not.toContain("/project/consumer.ts:7:3")
  })

  it("uses the default 30-day expiring window (and a real 'now') when neither option is given", () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const result = generateDocumentation({
      inventory: inventory([capability({ docs: { expiresAt: soon } })]),
      root: "/project",
      location: "/project/docs/CAPABILITIES.md",
      // no expiringWithinDays, no generatedAt
    })
    expect(result.content).toContain("d remaining")
    expect(result.content).not.toContain(
      "Nothing declares an `expiresAt` within the configured window",
    )
  })

  it("honors a caller-supplied expiringWithinDays, not silently falling back to the default", () => {
    // 20 days out: inside the 30-day default window, outside a 5-day one.
    const result = generateDocumentation({
      inventory: inventory([capability({ docs: { expiresAt: "2026-01-21" } })]),
      root: "/project",
      location: "/project/docs/CAPABILITIES.md",
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiringWithinDays: 5,
    })
    expect(result.content).toContain("Nothing declares an `expiresAt` within the configured window")
    expect(result.content).not.toContain("d remaining")
  })

  it("measures 'days remaining' from an explicit generatedAt when supplied", () => {
    const result = generateDocumentation({
      inventory: inventory([capability({ docs: { expiresAt: "2026-01-15" } })]),
      root: "/project",
      location: "/project/docs/CAPABILITIES.md",
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    expect(result.content).toContain("14d remaining")
  })
})
