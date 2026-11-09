import { describe, expect, it } from "vitest"
import {
  buildFlowModel,
  compareById,
  flowBoundaryKinds,
  flowEdgeId,
  flowNodeId,
  FlowModelError,
} from "../../src/flow/flow-model.js"
import type { FlowNodeInput, FlowUnknownInput } from "../../src/flow/flow-model.js"

const field = (name: string): FlowNodeInput => ({
  kind: "field",
  scope: "f",
  name,
  status: "static",
})
const fn = (name: string): FlowNodeInput => ({
  kind: "function",
  scope: "f",
  name,
  status: "static",
})
const source = (line: number) => ({ file: "f", line, column: 1 })

describe("flowBoundaryKinds", () => {
  it("lists every boundary kind exactly, in declaration order", () => {
    expect(flowBoundaryKinds()).toEqual([
      "database",
      "cache",
      "storage",
      "queue",
      "api",
      "external-service",
      "user-input",
      "computed",
      "internal",
      "client-response",
      "log",
    ])
  })
})

describe("compareById", () => {
  it("orders by id, ascending, by code unit", () => {
    const records = ["b", "B", "a", "ab", "a b", "aa", "_"].map((id) => ({ id }))
    expect(records.sort(compareById).map((r) => r.id)).toEqual([
      "B",
      "_",
      "a",
      "a b",
      "aa",
      "ab",
      "b",
    ])
  })
  it("is antisymmetric", () => {
    expect(compareById({ id: "a" }, { id: "b" })).toBe(-1)
    expect(compareById({ id: "b" }, { id: "a" })).toBe(1)
  })
})

describe("FlowModelError", () => {
  it("carries its code and name", () => {
    const error = new FlowModelError("boom")
    expect(error.code).toBe("DATA_CAP_FLOW_MODEL_INVALID")
    expect(error.name).toBe("FlowModelError")
    expect(error.message).toBe("boom")
  })
})

describe("ids", () => {
  it("derives node and edge ids", () => {
    expect(flowNodeId("field", "f", "a.b")).toBe("field:f#a.b")
    expect(flowEdgeId("reads", "x", "y", ["p", "q"], "static", "o")).toBe("reads:x->y:p.q@static^o")
    expect(flowEdgeId("reads", "x", "y", [], "static")).toBe("reads:x->y:@static")
    expect(flowEdgeId("reads", "x", "y", undefined, "declared")).toBe("reads:x->y@declared")
  })
})

describe("buildFlowModel: errors state exactly what is wrong", () => {
  it("refuses an observed node", () => {
    expect(() =>
      buildFlowModel({
        nodes: [{ kind: "field", scope: "f", name: "a", status: "observed" }],
        edges: [],
        unknowns: [],
      }),
    ).toThrow(
      new FlowModelError(
        'Node field:f#a has status "observed"; observations belong to the Observation Model, not the Flow Model (ADR 0072).',
      ),
    )
  })

  it("refuses an observed edge", () => {
    expect(() =>
      buildFlowModel({
        nodes: [fn("a"), fn("b")],
        edges: [
          {
            kind: "calls",
            from: flowNodeId("function", "f", "a"),
            to: flowNodeId("function", "f", "b"),
            status: "observed",
          },
        ],
        unknowns: [],
      }),
    ).toThrow(
      new FlowModelError(
        'Edge calls function:f#a -> function:f#b has status "observed"; observations belong to the Observation Model, not the Flow Model (ADR 0072).',
      ),
    )
  })

  it("refuses a node described twice with different content", () => {
    expect(() =>
      buildFlowModel({
        nodes: [field("a"), { ...field("a"), classification: "pii" }],
        edges: [],
        unknowns: [],
      }),
    ).toThrow(
      new FlowModelError(
        "Node field:f#a is described twice with different content; epistemic statuses are never blended (ADR 0071).",
      ),
    )
  })

  it("accepts a node described twice identically, once", () => {
    const model = buildFlowModel({ nodes: [field("a"), field("a")], edges: [], unknowns: [] })
    expect(model.nodes).toHaveLength(1)
  })

  it("refuses an edge to a missing node and an origin that is missing or not a field", () => {
    const a = flowNodeId("function", "f", "a")
    expect(() =>
      buildFlowModel({
        nodes: [fn("a")],
        edges: [{ kind: "calls", from: a, to: "function:f#zz", status: "static" }],
        unknowns: [],
      }),
    ).toThrow(new FlowModelError("Edge calls refers to function:f#zz, which is not a node."))
    expect(() =>
      buildFlowModel({
        nodes: [fn("a")],
        edges: [{ kind: "calls", from: a, to: a, status: "static", origin: "nope" }],
        unknowns: [],
      }),
    ).toThrow(new FlowModelError("Edge calls has origin nope, which is not a node."))
    expect(() =>
      buildFlowModel({
        nodes: [fn("a")],
        edges: [{ kind: "calls", from: a, to: a, status: "static", origin: a }],
        unknowns: [],
      }),
    ).toThrow(new FlowModelError(`Edge calls has origin ${a}, which is not a field node.`))
  })

  it("refuses an unknown whose subject or data origin is not a node of the right kind", () => {
    const base = { reason: "unresolved-call", source: source(1) } as const
    expect(() =>
      buildFlowModel({ nodes: [], edges: [], unknowns: [{ ...base, subject: "zz" }] }),
    ).toThrow(new FlowModelError("Unknown refers to zz, which is not a node."))
    expect(() =>
      buildFlowModel({
        nodes: [fn("a")],
        edges: [],
        unknowns: [{ ...base, data: [{ origin: "function:f#a", path: [] }] }],
      }),
    ).toThrow(new FlowModelError("Unknown data refers to function:f#a, which is not a field node."))
  })
})

describe("buildFlowModel: ordering", () => {
  it("orders nodes, edges and unknowns by id regardless of input order", () => {
    const a = flowNodeId("function", "f", "a")
    const b = flowNodeId("function", "f", "b")
    const c = flowNodeId("function", "f", "c")
    const model = buildFlowModel({
      nodes: [fn("c"), fn("a"), fn("b")],
      edges: [
        { kind: "calls", from: c, to: a, status: "static" },
        { kind: "calls", from: b, to: c, status: "static" },
        { kind: "calls", from: a, to: b, status: "static" },
      ],
      unknowns: [
        { reason: "unresolved-call", source: source(9) },
        { reason: "dynamic-access", source: source(5) },
        { reason: "unresolved-call", source: source(2) },
      ],
    })
    expect(model.nodes.map((n) => n.id)).toEqual([a, b, c])
    expect(model.edges.map((e) => e.id)).toEqual([
      `calls:${a}->${b}@static`,
      `calls:${b}->${c}@static`,
      `calls:${c}->${a}@static`,
    ])
    expect(model.unknowns.map((u) => u.id)).toEqual([
      "unknown:dynamic-access:f:5:1",
      "unknown:unresolved-call:f:2:1",
      "unknown:unresolved-call:f:9:1",
    ])
  })
})

describe("buildFlowModel: unknown records", () => {
  const f1 = flowNodeId("field", "f", "a")
  const f2 = flowNodeId("field", "f", "ab")
  const base: FlowUnknownInput = { reason: "unresolved-call", source: source(3) }
  const build = (...unknowns: FlowUnknownInput[]) =>
    buildFlowModel({ nodes: [field("a"), field("ab"), fn("x")], edges: [], unknowns }).unknowns

  it("keeps subject and detail only when supplied", () => {
    expect(build(base)).toStrictEqual([
      { id: "unknown:unresolved-call:f:3:1", reason: "unresolved-call", source: source(3) },
    ])
    expect(build({ ...base, subject: f1, detail: "why" })).toStrictEqual([
      {
        id: "unknown:unresolved-call:f:3:1",
        reason: "unresolved-call",
        source: source(3),
        subject: f1,
        detail: "why",
      },
    ])
  })

  it("sorts and de-duplicates the data an unknown concerns, keeping origins and paths apart", () => {
    const [unknown] = build({
      ...base,
      data: [
        { origin: f2, path: [] },
        { origin: f1, path: ["b"] },
        { origin: f2, path: [] },
        { origin: f1, path: ["a", "c"] },
      ],
    })
    expect(unknown?.data).toEqual([
      { origin: f1, path: ["a", "c"] },
      { origin: f1, path: ["b"] },
      { origin: f2, path: [] },
    ])
  })

  it("keeps paths apart whose segments only differ in where they split", () => {
    const [unknown] = build({
      ...base,
      data: [
        { origin: f1, path: ["a", "b"] },
        { origin: f1, path: ["ab"] },
      ],
    })
    expect(unknown?.data).toEqual([
      { origin: f1, path: ["a", "b"] },
      { origin: f1, path: ["ab"] },
    ])
  })

  it("copies the data it is given", () => {
    const path = ["p"]
    const [unknown] = build({ ...base, data: [{ origin: f1, path }] })
    expect(unknown?.data?.[0]?.path).not.toBe(path)
  })

  it("merges the data of the same site reached twice", () => {
    const [unknown] = build(
      {
        ...base,
        data: [
          { origin: f2, path: ["z"] },
          { origin: f1, path: [] },
        ],
      },
      {
        ...base,
        data: [
          { origin: f1, path: [] },
          { origin: f1, path: ["q"] },
        ],
      },
    )
    expect(unknown?.data).toEqual([
      { origin: f1, path: [] },
      { origin: f1, path: ["q"] },
      { origin: f2, path: ["z"] },
    ])
  })

  it("a visit that does not say which data concerns everything, so the merge says nothing either", () => {
    const withData = { ...base, data: [{ origin: f1, path: [] }] }
    expect(build(withData, base)[0]).not.toHaveProperty("data")
    expect(build(base, withData)[0]).not.toHaveProperty("data")
    expect(build(base, base)[0]).not.toHaveProperty("data")
  })

  it("one visit's data stands alone", () => {
    expect(build(base, { ...base, source: source(4) })).toHaveLength(2)
    expect(build({ ...base, data: [{ origin: f1, path: [] }] })[0]?.data).toEqual([
      { origin: f1, path: [] },
    ])
  })
})
