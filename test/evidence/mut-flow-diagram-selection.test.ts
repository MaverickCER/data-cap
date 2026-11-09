import { describe, expect, it } from "vitest"
import { edgeLabel, selectDiagram } from "../../src/evidence/flow-diagram-selection.js"
import type { DiagramInput } from "../../src/evidence/flow-diagram-selection.js"
import { buildFlowModel, flowEdgeId, flowNodeId } from "../../src/flow/flow-model.js"
import type {
  FlowEdge,
  FlowEdgeInput,
  FlowModel,
  FlowNode,
  FlowNodeInput,
  FlowUnknownInput,
} from "../../src/flow/flow-model.js"
import { POLICY_MODEL_SCHEMA_VERSION } from "../../src/flow/policy-model.js"
import type { PolicyModel, PolicyResult } from "../../src/flow/policy-model.js"

const S = "s.ts"
const nid = (kind: FlowNodeInput["kind"], name: string, scope = S): string =>
  flowNodeId(kind, scope, name)
const eid = (e: FlowEdgeInput): string =>
  flowEdgeId(e.kind, e.from, e.to, e.path, e.status, e.origin)

const F = nid("field", "cap.f")
const G = nid("field", "cap.g")
const f = nid("function", "f")
const g = nid("function", "g")
const h = nid("function", "h")
const y = nid("function", "y")
const Bsrc2 = nid("boundary", "src2", "boundary")
const fp = nid("parameter", "f.p")
const gr = nid("parameter", "g.r")
const fRet = nid("return", "f#return")
const B = nid("boundary", "out", "boundary")
const Bsrc = nid("boundary", "src", "boundary")

const nodeInputs: FlowNodeInput[] = [
  { kind: "field", scope: S, name: "cap.f", status: "declared" },
  { kind: "field", scope: S, name: "cap.g", status: "declared" },
  { kind: "function", scope: S, name: "f", status: "static" },
  { kind: "function", scope: S, name: "g", status: "static" },
  { kind: "function", scope: S, name: "h", status: "static" },
  { kind: "function", scope: S, name: "y", status: "static" },
  { kind: "boundary", scope: "boundary", name: "src2", status: "declared", boundaryKind: "api" },
  { kind: "parameter", scope: S, name: "f.p", status: "static" },
  { kind: "parameter", scope: S, name: "f.q", status: "static" },
  { kind: "parameter", scope: S, name: "g.r", status: "static" },
  { kind: "return", scope: S, name: "f#return", status: "static" },
  { kind: "return", scope: S, name: "g#return", status: "static" },
  { kind: "boundary", scope: "boundary", name: "out", status: "declared", boundaryKind: "log" },
  {
    kind: "boundary",
    scope: "boundary",
    name: "src",
    status: "declared",
    boundaryKind: "database",
  },
]

const edgeInputs: FlowEdgeInput[] = [
  { kind: "reads", from: F, to: f, status: "static", path: ["id"], origin: F },
  { kind: "passes", from: f, to: fp, status: "static", path: ["id"], origin: F },
  { kind: "returns", from: f, to: fRet, status: "declared", path: ["name"], origin: F },
  { kind: "side-effect", from: f, to: B, status: "static", path: ["id"], origin: F },
  { kind: "crosses-boundary", from: Bsrc, to: F, status: "declared" },
  { kind: "calls", from: f, to: g },
  { kind: "calls", from: g, to: gr },
  { kind: "calls", from: f, to: h },
  { kind: "calls", from: h, to: f },
  { kind: "calls", from: g, to: f },
  { kind: "writes", from: y, to: F },
  { kind: "crosses-boundary", from: Bsrc2, to: G },
  { kind: "reads", from: F, to: h, status: "static", path: ["id"], origin: F },
  { kind: "reads", from: G, to: g, status: "static", path: [], origin: G },
  { kind: "side-effect", from: g, to: B, status: "static", path: ["z"], origin: G },
].map((e) => ({ status: "static", ...e }) as FlowEdgeInput)

const unknownInputs: FlowUnknownInput[] = [
  { reason: "unresolved-call", source: { file: S, line: 2, column: 1 }, subject: f },
  { reason: "dynamic-access", source: { file: S, line: 1, column: 1 }, subject: g },
]

const model = (): FlowModel =>
  buildFlowModel({ nodes: nodeInputs, edges: edgeInputs, unknowns: unknownInputs })

const edgeOf = (kind: string, from: string, to: string): string => {
  const found = edgeInputs.find((e) => e.kind === kind && e.from === from && e.to === to)
  if (found === undefined) throw new Error("no such edge")
  return eid(found)
}

const policy = (results: readonly Partial<PolicyResult>[]): PolicyModel => ({
  schemaVersion: POLICY_MODEL_SCHEMA_VERSION,
  rules: [],
  results: results.map((r) => ({
    ruleId: "r",
    outcome: "satisfied",
    basis: "static",
    edges: [],
    ...r,
  })),
  summary: { satisfied: 0, violated: 0, indeterminate: 0 },
})

const input = (): DiagramInput => ({
  flow: model(),
  policy: policy([
    {
      outcome: "violated",
      edges: [edgeOf("side-effect", f, B), edgeOf("calls", f, g), "edge:not-in-the-graph"],
    },
    { outcome: "satisfied", edges: [edgeOf("reads", F, f)] },
    { outcome: "indeterminate", edges: [edgeOf("passes", f, fp)] },
    { outcome: "violated", edges: [edgeOf("side-effect", g, B)] },
  ]),
})

const summarize = (s: ReturnType<typeof selectDiagram>) =>
  s === undefined
    ? undefined
    : {
        nodes: s.nodes.map((n) => n.name),
        edges: s.edges.map((e) => `${e.kind} ${e.from} -> ${e.to}`),
        unknowns: s.unknowns.map((u) => u.id),
        violated: [...s.violated],
        complete: s.complete,
        missingField: s.missingField,
      }

describe("edgeLabel", () => {
  const edge = (over: Partial<FlowEdge>): FlowEdge => ({
    id: "e",
    kind: "reads",
    from: "a",
    to: "b",
    status: "static",
    ...over,
  })

  it("renders kind, path, handling and a non-static status exactly", () => {
    expect([
      edgeLabel(edge({})),
      edgeLabel(edge({ path: [] })),
      edgeLabel(edge({ path: ["a"] })),
      edgeLabel(edge({ path: ["a", "b"] })),
      edgeLabel(edge({ handling: "hashed" })),
      edgeLabel(edge({ status: "declared" })),
      edgeLabel(edge({ status: "unknown", kind: "calls" })),
      edgeLabel(edge({ path: ["x", "y"], handling: "masked", status: "inferred", kind: "passes" })),
      edgeLabel(edge({ path: [], handling: "redacted", status: "declared" })),
    ]).toEqual([
      "reads",
      "reads (whole)",
      "reads a",
      "reads a.b",
      "reads (hashed)",
      "reads [declared]",
      "calls [unknown]",
      "passes x.y (masked) [inferred]",
      "reads (whole) (redacted) [declared]",
    ])
  })
})

describe("selectDiagram", () => {
  it("returns undefined when no flow was computed", () => {
    expect(selectDiagram({ flow: undefined, policy: undefined })).toBeUndefined()
    expect(
      selectDiagram({ flow: undefined, policy: undefined }, { field: "cap.f" }),
    ).toBeUndefined()
  })

  it("draws the whole graph without calls by default, hiding parameters and returns nothing connects", () => {
    const s = selectDiagram(input())
    expect(summarize(s)).toMatchInlineSnapshot(`
      {
        "complete": false,
        "edges": [
          "crosses-boundary boundary:boundary#src -> field:s.ts#cap.f",
          "crosses-boundary boundary:boundary#src2 -> field:s.ts#cap.g",
          "passes function:s.ts#f -> parameter:s.ts#f.p",
          "reads field:s.ts#cap.f -> function:s.ts#f",
          "reads field:s.ts#cap.f -> function:s.ts#h",
          "reads field:s.ts#cap.g -> function:s.ts#g",
          "returns function:s.ts#f -> return:s.ts#f#return",
          "side-effect function:s.ts#f -> boundary:boundary#out",
          "side-effect function:s.ts#g -> boundary:boundary#out",
          "writes function:s.ts#y -> field:s.ts#cap.f",
        ],
        "missingField": undefined,
        "nodes": [
          "out",
          "src",
          "src2",
          "cap.f",
          "cap.g",
          "f",
          "g",
          "h",
          "y",
          "f.p",
          "f#return",
        ],
        "unknowns": [
          "unknown:dynamic-access:s.ts:1:1",
          "unknown:unresolved-call:s.ts:2:1",
        ],
        "violated": [
          "side-effect:function:s.ts#f->boundary:boundary#out:id@static^field:s.ts#cap.f",
          "side-effect:function:s.ts#g->boundary:boundary#out:z@static^field:s.ts#cap.g",
        ],
      }
    `)
    expect(s?.nodes.map((n) => n.id)).toEqual([...(s?.nodes.map((n) => n.id) ?? [])].sort())
    expect(selectDiagram(input(), {})).toEqual(s)
    expect(selectDiagram(input(), { includeCalls: false })).toEqual(s)
    expect(selectDiagram(input(), { field: undefined, path: undefined })).toEqual(s)
  })

  it("draws calls only when asked, and a parameter joined only by a call is then visible", () => {
    const s = selectDiagram(input(), { includeCalls: true })
    expect(summarize(s)).toMatchInlineSnapshot(`
      {
        "complete": false,
        "edges": [
          "calls function:s.ts#f -> function:s.ts#g",
          "calls function:s.ts#f -> function:s.ts#h",
          "calls function:s.ts#g -> function:s.ts#f",
          "calls function:s.ts#g -> parameter:s.ts#g.r",
          "calls function:s.ts#h -> function:s.ts#f",
          "crosses-boundary boundary:boundary#src -> field:s.ts#cap.f",
          "crosses-boundary boundary:boundary#src2 -> field:s.ts#cap.g",
          "passes function:s.ts#f -> parameter:s.ts#f.p",
          "reads field:s.ts#cap.f -> function:s.ts#f",
          "reads field:s.ts#cap.f -> function:s.ts#h",
          "reads field:s.ts#cap.g -> function:s.ts#g",
          "returns function:s.ts#f -> return:s.ts#f#return",
          "side-effect function:s.ts#f -> boundary:boundary#out",
          "side-effect function:s.ts#g -> boundary:boundary#out",
          "writes function:s.ts#y -> field:s.ts#cap.f",
        ],
        "missingField": undefined,
        "nodes": [
          "out",
          "src",
          "src2",
          "cap.f",
          "cap.g",
          "f",
          "g",
          "h",
          "y",
          "f.p",
          "g.r",
          "f#return",
        ],
        "unknowns": [
          "unknown:dynamic-access:s.ts:1:1",
          "unknown:unresolved-call:s.ts:2:1",
        ],
        "violated": [
          "calls:function:s.ts#f->function:s.ts#g@static",
          "side-effect:function:s.ts#f->boundary:boundary#out:id@static^field:s.ts#cap.f",
          "side-effect:function:s.ts#g->boundary:boundary#out:z@static^field:s.ts#cap.g",
        ],
      }
    `)
  })

  it("is complete only when the flow's coverage is", () => {
    const flow = model()
    expect(flow.coverage.complete).toBe(false)
    expect(selectDiagram({ flow, policy: undefined })?.complete).toBe(false)
    const clean = buildFlowModel({ nodes: nodeInputs, edges: edgeInputs, unknowns: [] })
    expect(clean.coverage.complete).toBe(true)
    expect(selectDiagram({ flow: clean, policy: undefined })?.complete).toBe(true)
  })

  it("has no violated edges without a policy or without violated results", () => {
    expect([...(selectDiagram({ flow: model(), policy: undefined })?.violated ?? [])]).toEqual([])
    expect([
      ...(selectDiagram({
        flow: model(),
        policy: policy([{ outcome: "satisfied", edges: [edgeOf("reads", F, f)] }]),
      })?.violated ?? []),
    ]).toEqual([])
    expect([...(selectDiagram({ flow: model(), policy: policy([]) })?.violated ?? [])]).toEqual([])
  })

  it("marks only drawn edges of violated results", () => {
    expect(summarize(selectDiagram(input()))?.violated).toEqual(
      [edgeOf("side-effect", f, B), edgeOf("side-effect", g, B)].sort(),
    )
    expect(summarize(selectDiagram(input(), { includeCalls: true }))?.violated).toEqual(
      [edgeOf("side-effect", f, B), edgeOf("calls", f, g), edgeOf("side-effect", g, B)].sort(),
    )
  })

  it("draws a field's downstream flow with its declared sources", () => {
    expect(summarize(selectDiagram(input(), { field: "cap.f" }))).toMatchInlineSnapshot(`
      {
        "complete": false,
        "edges": [
          "crosses-boundary boundary:boundary#src -> field:s.ts#cap.f",
          "passes function:s.ts#f -> parameter:s.ts#f.p",
          "reads field:s.ts#cap.f -> function:s.ts#f",
          "reads field:s.ts#cap.f -> function:s.ts#h",
          "returns function:s.ts#f -> return:s.ts#f#return",
          "side-effect function:s.ts#f -> boundary:boundary#out",
        ],
        "missingField": undefined,
        "nodes": [
          "out",
          "src",
          "cap.f",
          "f",
          "h",
          "f.p",
          "f#return",
        ],
        "unknowns": [
          "unknown:unresolved-call:s.ts:2:1",
        ],
        "violated": [
          "side-effect:function:s.ts#f->boundary:boundary#out:id@static^field:s.ts#cap.f",
        ],
      }
    `)
  })

  it("adds calls between drawn nodes only, when asked, in field mode", () => {
    expect(summarize(selectDiagram(input(), { field: "cap.f", includeCalls: true })))
      .toMatchInlineSnapshot(`
      {
        "complete": false,
        "edges": [
          "calls function:s.ts#f -> function:s.ts#h",
          "calls function:s.ts#h -> function:s.ts#f",
          "crosses-boundary boundary:boundary#src -> field:s.ts#cap.f",
          "passes function:s.ts#f -> parameter:s.ts#f.p",
          "reads field:s.ts#cap.f -> function:s.ts#f",
          "reads field:s.ts#cap.f -> function:s.ts#h",
          "returns function:s.ts#f -> return:s.ts#f#return",
          "side-effect function:s.ts#f -> boundary:boundary#out",
        ],
        "missingField": undefined,
        "nodes": [
          "out",
          "src",
          "cap.f",
          "f",
          "h",
          "f.p",
          "f#return",
        ],
        "unknowns": [
          "unknown:unresolved-call:s.ts:2:1",
        ],
        "violated": [
          "side-effect:function:s.ts#f->boundary:boundary#out:id@static^field:s.ts#cap.f",
        ],
      }
    `)
    expect(summarize(selectDiagram(input(), { field: "cap.f", includeCalls: false }))).toEqual(
      summarize(selectDiagram(input(), { field: "cap.f" })),
    )
  })

  it("narrows a field to one path, and keeps whole-field flow", () => {
    expect(summarize(selectDiagram(input(), { field: "cap.f", path: ["name"] })))
      .toMatchInlineSnapshot(`
      {
        "complete": true,
        "edges": [
          "crosses-boundary boundary:boundary#src -> field:s.ts#cap.f",
        ],
        "missingField": undefined,
        "nodes": [
          "src",
          "cap.f",
        ],
        "unknowns": [],
        "violated": [],
      }
    `)
    expect(summarize(selectDiagram(input(), { field: "cap.f", path: ["id"] })))
      .toMatchInlineSnapshot(`
      {
        "complete": false,
        "edges": [
          "crosses-boundary boundary:boundary#src -> field:s.ts#cap.f",
          "passes function:s.ts#f -> parameter:s.ts#f.p",
          "reads field:s.ts#cap.f -> function:s.ts#f",
          "reads field:s.ts#cap.f -> function:s.ts#h",
          "side-effect function:s.ts#f -> boundary:boundary#out",
        ],
        "missingField": undefined,
        "nodes": [
          "out",
          "src",
          "cap.f",
          "f",
          "h",
          "f.p",
        ],
        "unknowns": [
          "unknown:unresolved-call:s.ts:2:1",
        ],
        "violated": [
          "side-effect:function:s.ts#f->boundary:boundary#out:id@static^field:s.ts#cap.f",
        ],
      }
    `)
    expect(summarize(selectDiagram(input(), { field: "cap.f", path: [] }))).toEqual(
      summarize(selectDiagram(input(), { field: "cap.f" })),
    )
  })

  it("reports a missing field with an empty selection, and a non-field node does not count", () => {
    for (const name of ["cap.nope", "f", ""]) {
      const s = selectDiagram(input(), { field: name })
      expect(s).toEqual({
        nodes: [],
        edges: [],
        unknowns: [],
        violated: new Set(),
        complete: false,
        missingField: name,
      })
      expect(s?.violated.size).toBe(0)
    }
  })

  it("takes completeness and unknowns of a field from its own trace", () => {
    const own = selectDiagram(input(), { field: "cap.f" })
    expect(own?.complete).toBe(false)
    expect(own?.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
    const clean = buildFlowModel({ nodes: nodeInputs, edges: edgeInputs, unknowns: [] })
    const complete = selectDiagram({ flow: clean, policy: undefined }, { field: "cap.f" })
    expect(complete?.complete).toBe(true)
    expect(complete?.unknowns).toEqual([])
  })

  it("orders by id and does not reorder or mutate the model's own arrays", () => {
    const base = model()
    const node = (name: string): FlowNode => {
      const found = base.nodes.find((n) => n.name === name)
      if (found === undefined) throw new Error(name)
      return found
    }
    const unsortedNodes = Object.freeze([node("g"), node("cap.f"), node("f"), node("out")])
    const mk = (kind: FlowEdge["kind"], from: string, to: string, status: FlowEdge["status"]) =>
      ({ id: `${kind}:${from}->${to}@${status}`, kind, from, to, status }) satisfies FlowEdge
    const unsortedEdges = Object.freeze([
      mk("reads", F, f, "static"),
      mk("passes", f, B, "static"),
      mk("passes", f, B, "declared"),
      mk("calls", f, g, "static"),
    ])
    const unsortedUnknowns = Object.freeze([...base.unknowns].reverse())
    const flow: FlowModel = {
      ...base,
      nodes: unsortedNodes,
      edges: unsortedEdges,
      unknowns: unsortedUnknowns,
    }
    const s = selectDiagram({ flow, policy: undefined })
    expect(s?.nodes.map((n) => n.id)).toEqual([...unsortedNodes.map((n) => n.id)].sort())
    expect(s?.edges.map((e) => e.id)).toEqual(
      [unsortedEdges[2], unsortedEdges[1], unsortedEdges[0]].map((e) => e?.id),
    )
    expect(s?.unknowns.map((u) => u.id)).toEqual(base.unknowns.map((u) => u.id))
    expect(unsortedEdges.map((e) => e.id)).toEqual([
      mk("reads", F, f, "static").id,
      mk("passes", f, B, "static").id,
      mk("passes", f, B, "declared").id,
      mk("calls", f, g, "static").id,
    ])
  })

  it("keeps duplicate ids in input order", () => {
    const base = model()
    const dup = (tag: string): FlowNode => ({
      id: "function:dup",
      kind: "function",
      scope: S,
      name: tag,
      status: "static",
    })
    const flow: FlowModel = {
      ...base,
      nodes: [dup("one"), dup("two"), dup("three"), dup("four")],
      edges: [],
      unknowns: [],
    }
    expect(selectDiagram({ flow, policy: undefined })?.nodes.map((n) => n.name)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ])
  })

  it("drops edges with an endpoint outside the selected nodes", () => {
    const base = model()
    const node = (name: string): FlowNode => {
      const found = base.nodes.find((n) => n.name === name)
      if (found === undefined) throw new Error(name)
      return found
    }
    const mk = (from: string, to: string): FlowEdge => ({
      id: `reads:${from}->${to}`,
      kind: "reads",
      from,
      to,
      status: "static",
    })
    const flow: FlowModel = {
      ...base,
      nodes: [node("f"), node("g")],
      edges: [mk(f, g), mk(f, h), mk(h, g), mk(h, h)],
      unknowns: [],
    }
    expect(selectDiagram({ flow, policy: undefined })?.edges.map((e) => e.id)).toEqual([
      mk(f, g).id,
    ])
  })
})
