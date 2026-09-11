import { describe, expect, it } from "vitest"
import {
  groupEdgesByCapability,
  groupEdgesByConsumer,
} from "../../src/build/dependency-projections.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"

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

const CAP_A = { file: "/project/user.ts", exportName: "a" }
const CAP_B = { file: "/project/user.ts", exportName: "b" }

describe("groupEdgesByCapability", () => {
  it("includes every capability, even one with zero edges", () => {
    const grouped = groupEdgesByCapability([CAP_A, CAP_B], [])
    expect(grouped).toEqual([
      { capability: CAP_A, edges: [] },
      { capability: CAP_B, edges: [] },
    ])
  })

  it("groups edges under the capability they target", () => {
    const targetEdge = edge()
    const grouped = groupEdgesByCapability(
      [{ file: "/project/user.ts", exportName: "userCapability" }],
      [targetEdge],
    )
    expect(grouped[0]!.edges).toEqual([targetEdge])
  })

  it("keeps two distinct capabilities' edges apart -- neither bucket sees the other's edge", () => {
    const edgeToA = edge({ to: { capability: CAP_A, field: ["email"] } })
    const edgeToB = edge({ to: { capability: CAP_B, field: ["name"] } })
    const grouped = groupEdgesByCapability([CAP_A, CAP_B], [edgeToA, edgeToB])
    const a = grouped.find((g) => g.capability.exportName === "a")
    const b = grouped.find((g) => g.capability.exportName === "b")
    expect(a?.edges).toEqual([edgeToA])
    expect(b?.edges).toEqual([edgeToB])
  })

  it("sorts by file, then exportName, regardless of input order", () => {
    const grouped = groupEdgesByCapability(
      [
        { file: "/project/z.ts", exportName: "z" },
        { file: "/project/a.ts", exportName: "mid" },
        { file: "/project/a.ts", exportName: "aaa" },
        { file: "/project/a.ts", exportName: "zzz" },
      ],
      [],
    )
    expect(grouped.map((e) => `${e.capability.file}#${e.capability.exportName}`)).toEqual([
      "/project/a.ts#aaa",
      "/project/a.ts#mid",
      "/project/a.ts#zzz",
      "/project/z.ts#z",
    ])
  })

  it("computes the same grouping buildDependencyModel's own byCapability field used to (regression, ADR 0056)", () => {
    const targetEdge = edge()
    const grouped = groupEdgesByCapability(
      [{ file: "/project/user.ts", exportName: "userCapability" }],
      [targetEdge],
    )
    expect(grouped).toEqual([
      {
        capability: { file: "/project/user.ts", exportName: "userCapability" },
        edges: [targetEdge],
      },
    ])
  })
})

describe("groupEdgesByConsumer", () => {
  it("builds the inverse index, keyed by consuming file", () => {
    const grouped = groupEdgesByConsumer([
      edge({ from: "/project/consumer-a.ts" }),
      edge({
        from: "/project/consumer-b.ts",
        relationship: "calls-getter",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          operation: "getUser",
        },
      }),
    ])
    expect(grouped.map((c) => c.file)).toEqual(["/project/consumer-a.ts", "/project/consumer-b.ts"])
    expect(grouped[0]!.edges).toHaveLength(1)
  })

  it("orders consumer entries by file, regardless of edge order", () => {
    const grouped = groupEdgesByConsumer([
      edge({ from: "/project/z.ts" }),
      edge({ from: "/project/a.ts" }),
      edge({ from: "/project/m.ts" }),
    ])
    expect(grouped.map((c) => c.file)).toEqual(["/project/a.ts", "/project/m.ts", "/project/z.ts"])
  })

  it("groups multiple edges from the same consumer under one entry", () => {
    const grouped = groupEdgesByConsumer([
      edge({
        relationship: "reads-field",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
        },
      }),
      edge({
        relationship: "reads-field",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["locale"],
        },
      }),
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.edges).toHaveLength(2)
  })

  it("omits a consumer file that has no edges at all -- never derived from every discovered file", () => {
    expect(groupEdgesByConsumer([])).toEqual([])
  })
})
