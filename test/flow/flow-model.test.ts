import { describe, expect, it } from "vitest"
import {
  buildFlowModel,
  FLOW_MODEL_SCHEMA_VERSION,
  flowEdgeId,
  flowNodeId,
  FlowModelError,
} from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"

const FILE = "src/profile.ts"

function fn(name: string, overrides: Partial<FlowNodeInput> = {}): FlowNodeInput {
  return { kind: "function", scope: FILE, name, status: "static", ...overrides }
}

function field(name: string, overrides: Partial<FlowNodeInput> = {}): FlowNodeInput {
  return { kind: "field", scope: FILE, name, status: "static", ...overrides }
}

describe("flowNodeId / flowEdgeId", () => {
  it("derives a node id from kind, scope and name only", () => {
    expect(flowNodeId("function", FILE, "buildUserProfile")).toBe(
      "function:src/profile.ts#buildUserProfile",
    )
  })

  it("derives an edge id from kind, endpoints, field path and status", () => {
    const from = flowNodeId("function", FILE, "a")
    const to = flowNodeId("function", FILE, "b")
    expect(flowEdgeId("passes", from, to, ["user", "email"], "static")).toBe(
      `passes:${from}->${to}:user.email@static`,
    )
  })

  it("omits the path segment when an edge carries no field path", () => {
    const from = flowNodeId("function", FILE, "a")
    const to = flowNodeId("function", FILE, "b")
    expect(flowEdgeId("calls", from, to, undefined, "static")).toBe(`calls:${from}->${to}@static`)
  })

  it("includes the origin field in the edge id when the edge carries one", () => {
    const from = flowNodeId("function", FILE, "a")
    const to = flowNodeId("function", FILE, "b")
    const origin = flowNodeId("field", FILE, "User.email")
    expect(flowEdgeId("passes", from, to, ["x"], "static", origin)).toBe(
      `passes:${from}->${to}:x@static^${origin}`,
    )
    expect(flowEdgeId("passes", from, to, ["x"], "static", origin)).not.toBe(
      flowEdgeId("passes", from, to, ["x"], "static", flowNodeId("field", FILE, "User.name")),
    )
  })

  it("distinguishes the same edge asserted with two different statuses", () => {
    const from = flowNodeId("function", FILE, "a")
    const to = flowNodeId("function", FILE, "b")
    expect(flowEdgeId("passes", from, to, undefined, "declared")).not.toBe(
      flowEdgeId("passes", from, to, undefined, "static"),
    )
  })
})

describe("buildFlowModel", () => {
  it("stamps the schema version and assigns content-addressed ids", () => {
    const model = buildFlowModel({ nodes: [fn("a")], edges: [], unknowns: [] })
    expect(model.schemaVersion).toBe(FLOW_MODEL_SCHEMA_VERSION)
    expect(model.nodes).toEqual([
      {
        id: "function:src/profile.ts#a",
        kind: "function",
        scope: FILE,
        name: "a",
        status: "static",
      },
    ])
  })

  it("is deterministic regardless of input order", () => {
    const a = fn("a")
    const b = fn("b")
    const edge: FlowEdgeInput = {
      kind: "calls",
      from: flowNodeId("function", FILE, "a"),
      to: flowNodeId("function", FILE, "b"),
      status: "static",
    }
    const first = buildFlowModel({ nodes: [a, b], edges: [edge], unknowns: [] })
    const second = buildFlowModel({ nodes: [b, a], edges: [edge], unknowns: [] })
    expect(second).toEqual(first)
    expect(first.nodes.map((node) => node.name)).toEqual(["a", "b"])
  })

  it("collapses byte-identical duplicate nodes", () => {
    const model = buildFlowModel({ nodes: [fn("a"), fn("a")], edges: [], unknowns: [] })
    expect(model.nodes).toHaveLength(1)
  })

  it("rejects two nodes with the same id but a different status (statuses are never blended)", () => {
    expect(() =>
      buildFlowModel({
        nodes: [fn("a", { status: "static" }), fn("a", { status: "inferred" })],
        edges: [],
        unknowns: [],
      }),
    ).toThrow(FlowModelError)
  })

  it("collapses identical duplicate edges", () => {
    const edge: FlowEdgeInput = {
      kind: "calls",
      from: flowNodeId("function", FILE, "a"),
      to: flowNodeId("function", FILE, "b"),
      status: "static",
    }
    const model = buildFlowModel({
      nodes: [fn("a"), fn("b")],
      edges: [edge, edge],
      unknowns: [],
    })
    expect(model.edges).toHaveLength(1)
  })

  it("keeps a declared and a static record of the same edge as two edges", () => {
    const base = {
      kind: "passes" as const,
      from: flowNodeId("function", FILE, "a"),
      to: flowNodeId("function", FILE, "b"),
    }
    const model = buildFlowModel({
      nodes: [fn("a"), fn("b")],
      edges: [
        { ...base, status: "declared" },
        { ...base, status: "static" },
      ],
      unknowns: [],
    })
    expect(model.edges.map((edge) => edge.status).sort()).toEqual(["declared", "static"])
  })

  it("rejects an edge whose endpoint is not a node", () => {
    expect(() =>
      buildFlowModel({
        nodes: [fn("a")],
        edges: [
          {
            kind: "calls",
            from: flowNodeId("function", FILE, "a"),
            to: flowNodeId("function", FILE, "ghost"),
            status: "static",
          },
        ],
        unknowns: [],
      }),
    ).toThrow(/ghost/)
  })

  it("rejects an unknown whose subject is not a node", () => {
    expect(() =>
      buildFlowModel({
        nodes: [fn("a")],
        edges: [],
        unknowns: [
          {
            reason: "unresolved-call",
            subject: flowNodeId("function", FILE, "ghost"),
            source: { file: FILE, line: 3, column: 5 },
          },
        ],
      }),
    ).toThrow(/ghost/)
  })

  it("assigns an unknown a content-addressed id from reason and location", () => {
    const model = buildFlowModel({
      nodes: [],
      edges: [],
      unknowns: [{ reason: "dynamic-access", source: { file: FILE, line: 7, column: 9 } }],
    })
    expect(model.unknowns[0]?.id).toBe("unknown:dynamic-access:src/profile.ts:7:9")
  })

  it("collapses identical duplicate unknowns", () => {
    const unknown = {
      reason: "dynamic-access" as const,
      source: { file: FILE, line: 7, column: 9 },
    }
    const model = buildFlowModel({ nodes: [], edges: [], unknowns: [unknown, unknown] })
    expect(model.unknowns).toHaveLength(1)
  })

  it("rejects an edge whose status is observed (observations live in the Observation Model)", () => {
    expect(() =>
      buildFlowModel({
        nodes: [fn("a"), fn("b")],
        edges: [
          {
            kind: "calls",
            from: flowNodeId("function", FILE, "a"),
            to: flowNodeId("function", FILE, "b"),
            status: "observed",
          },
        ],
        unknowns: [],
      }),
    ).toThrow(FlowModelError)
  })

  it("rejects a node whose status is observed", () => {
    expect(() =>
      buildFlowModel({ nodes: [fn("a", { status: "observed" })], edges: [], unknowns: [] }),
    ).toThrow(FlowModelError)
  })
})

describe("buildFlowModel edge origin", () => {
  it("keeps the same hop for two different origins as two edges", () => {
    const a = flowNodeId("function", FILE, "a")
    const b = flowNodeId("function", FILE, "b")
    const model = buildFlowModel({
      nodes: [fn("a"), fn("b"), field("User.email"), field("User.name")],
      edges: [
        {
          kind: "passes",
          from: a,
          to: b,
          status: "static",
          origin: flowNodeId("field", FILE, "User.email"),
        },
        {
          kind: "passes",
          from: a,
          to: b,
          status: "static",
          origin: flowNodeId("field", FILE, "User.name"),
        },
      ],
      unknowns: [],
    })
    expect(model.edges).toHaveLength(2)
  })

  it("rejects an edge whose origin is not a field node", () => {
    const a = flowNodeId("function", FILE, "a")
    expect(() =>
      buildFlowModel({
        nodes: [fn("a"), fn("b")],
        edges: [
          {
            kind: "passes",
            from: a,
            to: flowNodeId("function", FILE, "b"),
            status: "static",
            origin: a,
          },
        ],
        unknowns: [],
      }),
    ).toThrow(/origin/)
  })

  it("rejects an edge whose origin does not exist", () => {
    const a = flowNodeId("function", FILE, "a")
    expect(() =>
      buildFlowModel({
        nodes: [fn("a"), fn("b")],
        edges: [
          {
            kind: "passes",
            from: a,
            to: flowNodeId("function", FILE, "b"),
            status: "static",
            origin: flowNodeId("field", FILE, "ghost"),
          },
        ],
        unknowns: [],
      }),
    ).toThrow(/ghost/)
  })
})

describe("buildFlowModel unknown data", () => {
  const email = flowNodeId("field", FILE, "User.email")
  const base = { reason: "unresolved-call" as const, source: { file: FILE, line: 1, column: 1 } }

  it("carries the data an unknown concerns, deduplicated and ordered", () => {
    const model = buildFlowModel({
      nodes: [field("User.email")],
      edges: [],
      unknowns: [
        {
          ...base,
          data: [
            { origin: email, path: ["b"] },
            { origin: email, path: ["a"] },
            { origin: email, path: ["a"] },
          ],
        },
      ],
    })
    expect(model.unknowns[0]?.data).toEqual([
      { origin: email, path: ["a"] },
      { origin: email, path: ["b"] },
    ])
  })

  it("omits data when none was given (the unknown concerns everything)", () => {
    const model = buildFlowModel({ nodes: [], edges: [], unknowns: [base] })
    expect(model.unknowns[0]).not.toHaveProperty("data")
  })

  it("rejects data whose origin is not a field node", () => {
    expect(() =>
      buildFlowModel({
        nodes: [fn("f")],
        edges: [],
        unknowns: [{ ...base, data: [{ origin: flowNodeId("function", FILE, "f"), path: [] }] }],
      }),
    ).toThrow(/data/)
    expect(() =>
      buildFlowModel({
        nodes: [],
        edges: [],
        unknowns: [{ ...base, data: [{ origin: email, path: [] }] }],
      }),
    ).toThrow(/data/)
  })
})

describe("buildFlowModel coverage", () => {
  it("is complete only when nothing is unknown, unanalyzed or unresolved", () => {
    const model = buildFlowModel({ nodes: [fn("a")], edges: [], unknowns: [] })
    expect(model.coverage).toEqual({
      functionsAnalyzed: 1,
      functionsUnanalyzed: 0,
      edgesUnresolved: 0,
      unknowns: 0,
      complete: true,
    })
  })

  it("counts a function node with status unknown as unanalyzed and never complete", () => {
    const model = buildFlowModel({
      nodes: [fn("a"), fn("b", { status: "unknown" })],
      edges: [],
      unknowns: [],
    })
    expect(model.coverage.functionsAnalyzed).toBe(1)
    expect(model.coverage.functionsUnanalyzed).toBe(1)
    expect(model.coverage.complete).toBe(false)
  })

  it("counts an unknown-status edge as unresolved and never complete", () => {
    const model = buildFlowModel({
      nodes: [fn("a"), fn("b")],
      edges: [
        {
          kind: "calls",
          from: flowNodeId("function", FILE, "a"),
          to: flowNodeId("function", FILE, "b"),
          status: "unknown",
        },
      ],
      unknowns: [],
    })
    expect(model.coverage.edgesUnresolved).toBe(1)
    expect(model.coverage.complete).toBe(false)
  })

  it("is never complete when an unknown record exists, even with every node analyzed", () => {
    const model = buildFlowModel({
      nodes: [fn("a")],
      edges: [],
      unknowns: [{ reason: "unsupported-construct", source: { file: FILE, line: 1, column: 1 } }],
    })
    expect(model.coverage.unknowns).toBe(1)
    expect(model.coverage.complete).toBe(false)
  })

  it("ignores non-function nodes when counting analyzed functions", () => {
    const model = buildFlowModel({ nodes: [field("User.email")], edges: [], unknowns: [] })
    expect(model.coverage.functionsAnalyzed).toBe(0)
    expect(model.coverage.complete).toBe(true)
  })
})
