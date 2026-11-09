import { describe, expect, it } from "vitest"
import {
  buildFlowModel,
  flowEdgeId,
  flowNodeId,
  FlowModelError,
} from "../../src/flow/flow-model.js"
import type {
  FlowEdgeInput,
  FlowEdgeKind,
  FlowModel,
  FlowNodeInput,
  FlowStatus,
  FlowUnknownInput,
} from "../../src/flow/flow-model.js"
import {
  diffFlow,
  filterFlow,
  flowPathTo,
  pathsRelated,
  traceFlow,
  traceFlowBetween,
  weakestStatus,
} from "../../src/flow/flow-projections.js"

const S = "g.ts"
const scopeOf = (kind: FlowNodeInput["kind"]) => (kind === "boundary" ? "b" : S)
const nd = (
  kind: FlowNodeInput["kind"],
  name: string,
  status: FlowStatus = "static",
  extra: Partial<FlowNodeInput> = {},
): FlowNodeInput => ({ kind, scope: scopeOf(kind), name, status, ...extra })
const nid = (kind: FlowNodeInput["kind"], name: string) => flowNodeId(kind, scopeOf(kind), name)
const fld = (name: string) => nid("field", name)
const fun = (name: string) => nid("function", name)
const bnd = (name: string) => nid("boundary", name)
const ed = (
  kind: FlowEdgeKind,
  from: string,
  to: string,
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput => ({ kind, from, to, status: "static", ...extra })
const eid = (
  kind: FlowEdgeKind,
  from: string,
  to: string,
  path?: string[],
  status: FlowStatus = "static",
  origin?: string,
) => flowEdgeId(kind, from, to, path, status, origin)
const model = (
  nodes: FlowNodeInput[],
  edges: FlowEdgeInput[] = [],
  unknowns: FlowUnknownInput[] = [],
): FlowModel => buildFlowModel({ nodes, edges, unknowns })
const unknownAt = (line: number, extra: Partial<FlowUnknownInput> = {}): FlowUnknownInput => ({
  reason: "unresolved-call",
  source: { file: S, line, column: 1 },
  ...extra,
})
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id)
/** A model plus raw, unvalidated edges, for code paths a validated model cannot reach. */
const withRaw = (base: FlowModel, ...edges: FlowEdgeInput[]): FlowModel => ({
  ...base,
  edges: [...base.edges, ...edges.map((e) => ({ ...e, id: `raw:${e.kind}:${e.from}->${e.to}` }))],
})

describe("pathsRelated", () => {
  it.each([
    [[], [], true],
    [["a"], [], true],
    [[], ["a"], true],
    [["a"], ["a"], true],
    [["a", "b"], ["a"], true],
    [["a"], ["a", "b"], true],
    [["a", "b"], ["a", "c"], false],
    [["a", "b"], ["x", "b"], false],
    [["a"], ["b"], false],
    [["a", "b", "c"], ["a", "b"], true],
    [["a", "b"], ["a", "b", "c"], true],
    [["a", "x", "c"], ["a", "y"], false],
  ] as const)("%j and %j: %s", (a, b, expected) => {
    expect(pathsRelated(a, b)).toBe(expected)
  })
})

describe("weakestStatus", () => {
  it("is static for nothing, and for static and observed alone", () => {
    expect(weakestStatus([])).toBe("static")
    expect(weakestStatus(["static"])).toBe("static")
    expect(weakestStatus(["observed"])).toBe("static")
    expect(weakestStatus(["observed", "static"])).toBe("static")
  })
  it("ranks declared, inferred and unknown progressively weaker, whatever the order", () => {
    expect(weakestStatus(["declared"])).toBe("declared")
    expect(weakestStatus(["static", "declared"])).toBe("declared")
    expect(weakestStatus(["declared", "static"])).toBe("declared")
    expect(weakestStatus(["declared", "inferred"])).toBe("inferred")
    expect(weakestStatus(["inferred", "declared"])).toBe("inferred")
    expect(weakestStatus(["inferred", "unknown", "declared"])).toBe("unknown")
    expect(weakestStatus(["unknown", "inferred"])).toBe("unknown")
    expect(weakestStatus(["observed", "declared"])).toBe("declared")
  })
})

describe("traceFlow: which edges carry data", () => {
  const follow = (kind: FlowEdgeKind): string[] => {
    const flow = model([nd("function", "a"), nd("function", "b")], [ed(kind, fun("a"), fun("b"))])
    return ids(traceFlow(flow, fun("a"), "downstream").nodes)
  }
  it.each([
    "reads",
    "writes",
    "transforms",
    "passes",
    "returns",
    "crosses-boundary",
    "side-effect",
  ] as const)("%s is followed", (kind) => {
    expect(follow(kind)).toEqual([fun("a"), fun("b")])
  })
  it.each(["calls", "discards"] as const)("%s is not followed", (kind) => {
    expect(follow(kind)).toEqual([fun("a")])
  })
})

describe("traceFlow: errors", () => {
  it("names the node it cannot start from", () => {
    const flow = model([nd("function", "a")])
    expect(() => traceFlow(flow, "ghost", "downstream")).toThrow(
      new FlowModelError("Cannot trace from ghost: it is not a node of this model."),
    )
    expect(() => traceFlowBetween(flow, "ghost", fun("a"))).toThrow(
      new FlowModelError(
        "Cannot trace from ghost to function:g.ts#a: both must be nodes of this model.",
      ),
    )
    expect(() => traceFlowBetween(flow, fun("a"), "gone")).toThrow(
      new FlowModelError(
        "Cannot trace from function:g.ts#a to gone: both must be nodes of this model.",
      ),
    )
  })
})

describe("traceFlow: downstream", () => {
  it("returns the start, the direction and everything reached, ordered by id", () => {
    // a -writes-> b -passes-> c, and a -reads-> c: sorted edge ids differ from traversal order.
    const flow = model(
      [nd("function", "c"), nd("function", "a"), nd("function", "b")],
      [
        ed("passes", fun("b"), fun("c")),
        ed("writes", fun("a"), fun("b")),
        ed("transforms", fun("a"), fun("c")),
      ],
    )
    const trace = traceFlow(flow, fun("a"), "downstream")
    expect(trace.start).toBe(fun("a"))
    expect(trace.direction).toBe("downstream")
    expect(ids(trace.nodes)).toEqual([fun("a"), fun("b"), fun("c")])
    expect(ids(trace.edges)).toEqual([
      eid("passes", fun("b"), fun("c")),
      eid("transforms", fun("a"), fun("c")),
      eid("writes", fun("a"), fun("b")),
    ])
    expect(trace.unknowns).toEqual([])
    expect(trace.complete).toBe(true)
  })

  it("orders edges by id even when traversal reaches them in another order", () => {
    const flow = model(
      [nd("function", "a"), nd("function", "b"), nd("function", "c")],
      [ed("writes", fun("a"), fun("b")), ed("passes", fun("b"), fun("c"))],
    )
    expect(ids(traceFlow(flow, fun("a"), "downstream").edges)).toEqual([
      eid("passes", fun("b"), fun("c")),
      eid("writes", fun("a"), fun("b")),
    ])
  })

  it("ends on a cycle, and reaches around it", () => {
    const flow = model(
      [nd("function", "a"), nd("function", "b"), nd("function", "c")],
      [
        ed("passes", fun("a"), fun("b")),
        ed("passes", fun("b"), fun("a")),
        ed("passes", fun("b"), fun("c")),
        ed("passes", fun("c"), fun("c")),
      ],
    )
    const trace = traceFlow(flow, fun("a"), "downstream")
    expect(ids(trace.nodes)).toEqual([fun("a"), fun("b"), fun("c")])
    expect(trace.edges).toHaveLength(4)
  })

  it("follows only the start field's own data", () => {
    const flow = model(
      [
        nd("field", "F"),
        nd("field", "G"),
        nd("function", "h"),
        nd("boundary", "x"),
        nd("boundary", "y"),
        nd("boundary", "z"),
      ],
      [
        ed("reads", fld("F"), fun("h"), { origin: fld("F") }),
        ed("reads", fld("G"), fun("h"), { origin: fld("G") }),
        ed("side-effect", fun("h"), bnd("x"), { origin: fld("F") }),
        ed("side-effect", fun("h"), bnd("y"), { origin: fld("G") }),
        ed("side-effect", fun("h"), bnd("z")),
      ],
    )
    const trace = traceFlow(flow, fld("F"), "downstream")
    expect(ids(trace.nodes)).toEqual([bnd("x"), bnd("z"), fld("F"), fun("h")])
    // a non-field start has no owner, so it follows every origin
    expect(ids(traceFlow(flow, fun("h"), "downstream").nodes)).toEqual([
      bnd("x"),
      bnd("y"),
      bnd("z"),
      fun("h"),
    ])
  })

  it("follows only edges and nodes of the allowed statuses, but never judges the start", () => {
    const flow = model(
      [
        nd("function", "a", "inferred"),
        nd("function", "b"),
        nd("function", "c", "declared"),
        nd("function", "d"),
        nd("function", "e"),
      ],
      [
        ed("passes", fun("a"), fun("b")),
        ed("passes", fun("a"), fun("c")),
        ed("passes", fun("a"), fun("d"), { status: "inferred" }),
        ed("passes", fun("b"), fun("e")),
      ],
    )
    const trace = traceFlow(flow, fun("a"), "downstream", { statuses: ["static"] })
    expect(ids(trace.nodes)).toEqual([fun("a"), fun("b"), fun("e")])
    expect(ids(trace.edges)).toEqual([
      eid("passes", fun("a"), fun("b")),
      eid("passes", fun("b"), fun("e")),
    ])
  })

  it("an edge into an allowed-status node still needs an allowed-status edge", () => {
    const flow = model(
      [nd("function", "a"), nd("function", "b")],
      [ed("passes", fun("a"), fun("b"), { status: "declared" })],
    )
    expect(ids(traceFlow(flow, fun("a"), "downstream", { statuses: ["static"] }).nodes)).toEqual([
      fun("a"),
    ])
  })

  it("follows only edges whose path is related to the requested one; a pathless edge applies to all", () => {
    const flow = model(
      [
        nd("function", "a"),
        nd("function", "b"),
        nd("function", "c"),
        nd("function", "d"),
        nd("function", "e"),
      ],
      [
        ed("passes", fun("a"), fun("b"), { path: ["x"] }),
        ed("passes", fun("a"), fun("c"), { path: ["y"] }),
        ed("passes", fun("a"), fun("d")),
        ed("passes", fun("a"), fun("e"), { path: ["x", "deep"] }),
      ],
    )
    const trace = traceFlow(flow, fun("a"), "downstream", { path: ["x"] })
    expect(ids(trace.nodes)).toEqual([fun("a"), fun("b"), fun("d"), fun("e")])
    expect(ids(traceFlow(flow, fun("a"), "downstream").nodes)).toHaveLength(5)
    expect(ids(traceFlow(flow, fun("a"), "downstream", { path: [] }).nodes)).toHaveLength(5)
  })

  it("ignores an edge into a node the model does not contain", () => {
    const base = model([nd("function", "a")])
    const flow = withRaw(base, ed("passes", fun("a"), "ghost"))
    const trace = traceFlow(flow, fun("a"), "downstream")
    expect(ids(trace.nodes)).toEqual([fun("a")])
    expect(trace.edges).toEqual([])
    expect(trace.complete).toBe(true)
  })
})

describe("traceFlow: upstream", () => {
  // S -crosses-> F (declared source), F -reads-> f -side-effect-> B; F -reads-> h -side-effect-> B2 (a branch away from B);
  // G -reads-> g -side-effect-> B (another field into B); G -reads-> k (a branch of G away from B).
  const flow = model(
    [
      nd("boundary", "S"),
      nd("field", "F"),
      nd("field", "G"),
      nd("function", "f"),
      nd("function", "g"),
      nd("function", "h"),
      nd("function", "k"),
      nd("boundary", "B"),
      nd("boundary", "B2"),
    ],
    [
      ed("crosses-boundary", bnd("S"), fld("F"), { origin: fld("F") }),
      ed("reads", fld("F"), fun("f"), { origin: fld("F") }),
      ed("side-effect", fun("f"), bnd("B"), { origin: fld("F") }),
      ed("reads", fld("F"), fun("h"), { origin: fld("F") }),
      ed("side-effect", fun("h"), bnd("B2"), { origin: fld("F") }),
      ed("reads", fld("G"), fun("g"), { origin: fld("G") }),
      ed("side-effect", fun("g"), bnd("B"), { origin: fld("G") }),
      ed("reads", fld("G"), fun("k"), { origin: fld("G") }),
      // incoming to F but not F's own data, and one that is not a data edge
      ed("crosses-boundary", bnd("S"), fld("F"), { origin: fld("G"), path: ["other"] }),
      ed("calls", fun("k"), fld("F"), { origin: fld("F") }),
    ],
  )

  it("collects the routes of every field that reaches the start, and the declared sources", () => {
    const trace = traceFlow(flow, bnd("B"), "upstream")
    expect(trace.start).toBe(bnd("B"))
    expect(trace.direction).toBe("upstream")
    expect(ids(trace.nodes)).toEqual([bnd("B"), bnd("S"), fld("F"), fld("G"), fun("f"), fun("g")])
    expect(ids(trace.edges)).toEqual([
      eid("crosses-boundary", bnd("S"), fld("F"), undefined, "static", fld("F")),
      eid("reads", fld("F"), fun("f"), undefined, "static", fld("F")),
      eid("reads", fld("G"), fun("g"), undefined, "static", fld("G")),
      eid("side-effect", fun("f"), bnd("B"), undefined, "static", fld("F")),
      eid("side-effect", fun("g"), bnd("B"), undefined, "static", fld("G")),
    ])
  })

  it("keeps the start even when nothing reaches it", () => {
    const trace = traceFlow(flow, fun("k"), "upstream")
    expect(ids(trace.nodes)).toEqual([fld("G"), fun("k")])
    const lonely = model([nd("function", "x"), nd("field", "F")])
    expect(ids(traceFlow(lonely, fun("x"), "upstream").nodes)).toEqual([fun("x")])
    expect(traceFlow(lonely, fun("x"), "upstream").edges).toEqual([])
  })

  it("from a field includes the sources declared for that field and not those of other fields", () => {
    const trace = traceFlow(flow, fld("F"), "upstream")
    expect(ids(trace.nodes)).toEqual([bnd("S"), fld("F")])
    expect(ids(trace.edges)).toEqual([
      eid("crosses-boundary", bnd("S"), fld("F"), undefined, "static", fld("F")),
    ])
  })

  it("does not treat a node that is not a field as a source of data", () => {
    const pathless = model(
      [nd("function", "a"), nd("function", "b")],
      [ed("passes", fun("a"), fun("b"))],
    )
    const trace = traceFlow(pathless, fun("b"), "upstream")
    expect(ids(trace.nodes)).toEqual([fun("b")])
    expect(trace.edges).toEqual([])
  })

  it("leaves out a field that does not reach the start, and with it its declared sources", () => {
    const apart = model(
      [nd("boundary", "S"), nd("field", "F"), nd("function", "f"), nd("boundary", "B")],
      [
        ed("crosses-boundary", bnd("S"), fld("F"), { origin: fld("F") }),
        ed("reads", fld("F"), fun("f"), { origin: fld("F") }),
      ],
    )
    const trace = traceFlow(apart, bnd("B"), "upstream")
    expect(ids(trace.nodes)).toEqual([bnd("B")])
    expect(trace.edges).toEqual([])
  })

  it("skips a declared source whose origin is a node the model lacks", () => {
    const base = model(
      [nd("field", "F"), nd("function", "f")],
      [ed("reads", fld("F"), fun("f"), { origin: fld("F") })],
    )
    const dangling = withRaw(base, ed("crosses-boundary", "ghost", fld("F"), { origin: fld("F") }))
    const trace = traceFlow(dangling, fun("f"), "upstream")
    expect(ids(trace.nodes)).toEqual([fld("F"), fun("f")])
    expect(trace.edges).toHaveLength(2)
  })

  it("ends on a cycle", () => {
    const cyc = model(
      [nd("field", "F"), nd("function", "a"), nd("function", "b")],
      [
        ed("reads", fld("F"), fun("a"), { origin: fld("F") }),
        ed("passes", fun("a"), fun("b"), { origin: fld("F") }),
        ed("passes", fun("b"), fun("a"), { origin: fld("F") }),
      ],
    )
    expect(ids(traceFlow(cyc, fun("b"), "upstream").nodes)).toEqual([fld("F"), fun("a"), fun("b")])
  })
})

describe("traceFlow: unknowns", () => {
  const nodes = [
    nd("field", "F"),
    nd("field", "G"),
    nd("function", "f"),
    nd("function", "far"),
    nd("boundary", "B"),
  ]
  const edges = [
    ed("reads", fld("F"), fun("f"), { origin: fld("F") }),
    ed("side-effect", fun("f"), bnd("B"), { origin: fld("F") }),
    ed("reads", fld("G"), fun("f"), { origin: fld("G") }),
    ed("side-effect", fun("f"), bnd("B"), { origin: fld("G"), path: ["p"] }),
  ]
  const unknownLines = (
    flow: FlowModel,
    start: string,
    direction: "downstream" | "upstream",
    options = {},
  ) => traceFlow(flow, start, direction, options).unknowns.map((u) => u.source.line)

  it("attaches only unknowns whose subject was visited", () => {
    const flow = model(nodes, edges, [
      unknownAt(1, { subject: fun("f") }),
      unknownAt(2, { subject: fun("far") }),
      unknownAt(3),
    ])
    expect(unknownLines(flow, fld("F"), "downstream")).toEqual([1])
    expect(unknownLines(flow, bnd("B"), "upstream")).toEqual([1])
    expect(traceFlow(flow, fld("F"), "downstream").complete).toBe(false)
  })

  it("an unknown that does not say which data concerns every trace that reaches it", () => {
    const flow = model(nodes, edges, [unknownAt(1, { subject: fun("f") })])
    expect(unknownLines(flow, fld("F"), "downstream")).toEqual([1])
    expect(unknownLines(flow, fld("G"), "downstream")).toEqual([1])
    expect(unknownLines(flow, fun("f"), "downstream")).toEqual([1])
  })

  it("an unknown about particular data concerns only traces of that data", () => {
    const flow = model(nodes, edges, [
      unknownAt(1, { subject: fun("f"), data: [{ origin: fld("F"), path: [] }] }),
    ])
    expect(unknownLines(flow, fld("F"), "downstream")).toEqual([1])
    expect(unknownLines(flow, fld("G"), "downstream")).toEqual([])
    expect(traceFlow(flow, fld("G"), "downstream").complete).toBe(true)
    // from a node that is not a field it cannot tell, so it counts
    expect(unknownLines(flow, fun("f"), "downstream")).toEqual([1])
  })

  it("an unknown concerns a trace when any one of its data does", () => {
    const flow = model(nodes, edges, [
      unknownAt(1, {
        subject: fun("f"),
        data: [
          { origin: fld("G"), path: [] },
          { origin: fld("F"), path: [] },
        ],
      }),
    ])
    expect(unknownLines(flow, fld("F"), "downstream")).toEqual([1])
    expect(unknownLines(flow, fld("G"), "downstream")).toEqual([1])
  })

  it("an unknown about one path concerns a trace of a related path only", () => {
    const flow = model(nodes, edges, [
      unknownAt(1, { subject: fun("f"), data: [{ origin: fld("F"), path: ["a", "b"] }] }),
    ])
    expect(unknownLines(flow, fld("F"), "downstream", { path: ["a"] })).toEqual([1])
    expect(unknownLines(flow, fld("F"), "downstream", { path: ["a", "b", "c"] })).toEqual([1])
    expect(unknownLines(flow, fld("F"), "downstream", { path: ["z"] })).toEqual([])
    expect(unknownLines(flow, fld("F"), "downstream")).toEqual([1])
  })

  it("an upstream trace is about every field that reached its start", () => {
    const flow = model(nodes, edges, [
      unknownAt(1, { subject: fun("f"), data: [{ origin: fld("G"), path: [] }] }),
      unknownAt(2, { subject: fun("f"), data: [{ origin: fld("F"), path: [] }] }),
    ])
    expect(unknownLines(flow, bnd("B"), "upstream")).toEqual([1, 2])
    const onlyF = model(
      nodes,
      edges.filter((e) => e.origin !== fld("G")),
      [
        unknownAt(1, { subject: fun("f"), data: [{ origin: fld("G"), path: [] }] }),
        unknownAt(2, { subject: fun("f"), data: [{ origin: fld("F"), path: [] }] }),
      ],
    )
    expect(unknownLines(onlyF, bnd("B"), "upstream")).toEqual([2])
  })

  it("an upstream trace from a field is about that field", () => {
    const lone = model(
      [nd("field", "F"), nd("field", "G")],
      [],
      [
        unknownAt(1, { subject: fld("F"), data: [{ origin: fld("F"), path: [] }] }),
        unknownAt(2, { subject: fld("F"), data: [{ origin: fld("G"), path: [] }] }),
      ],
    )
    expect(unknownLines(lone, fld("F"), "upstream")).toEqual([1])
    expect(traceFlow(lone, fld("F"), "upstream").complete).toBe(false)
  })

  it("an upstream trace from a non-field with data-bearing unknowns uses the origins of its edges", () => {
    const flow = model(
      [nd("field", "F"), nd("function", "f")],
      [ed("reads", fld("F"), fun("f"), { origin: fld("F") }), ed("calls", fld("F"), fun("f"))],
      [unknownAt(1, { subject: fun("f"), data: [{ origin: fld("F"), path: [] }] })],
    )
    expect(unknownLines(flow, fun("f"), "upstream")).toEqual([1])
  })

  it("an edge without an origin contributes nobody's data", () => {
    const flow = model(
      [nd("function", "a"), nd("function", "b"), nd("field", "F")],
      [ed("passes", fun("a"), fun("b"))],
      [unknownAt(1, { subject: fun("b"), data: [{ origin: fld("F"), path: [] }] })],
    )
    expect(unknownLines(flow, fun("b"), "upstream")).toEqual([])
  })
})

describe("traceFlow: completeness", () => {
  it("is false when any visited node or traversed edge is unknown, and true otherwise", () => {
    const ok = model([nd("function", "a"), nd("function", "b")], [ed("passes", fun("a"), fun("b"))])
    expect(traceFlow(ok, fun("a"), "downstream").complete).toBe(true)
    const badNode = model(
      [nd("function", "a"), nd("function", "b", "unknown")],
      [ed("passes", fun("a"), fun("b"))],
    )
    expect(traceFlow(badNode, fun("a"), "downstream").complete).toBe(false)
    const badEdge = model(
      [nd("function", "a"), nd("function", "b")],
      [ed("passes", fun("a"), fun("b"), { status: "unknown" })],
    )
    expect(traceFlow(badEdge, fun("a"), "downstream").complete).toBe(false)
    const badStart = model([nd("function", "a", "unknown")])
    expect(traceFlow(badStart, fun("a"), "downstream").complete).toBe(false)
    const outside = model(
      [nd("function", "a"), nd("function", "b", "unknown")],
      [ed("calls", fun("a"), fun("b"))],
    )
    expect(traceFlow(outside, fun("a"), "downstream").complete).toBe(true)
  })
})

describe("projections do not rely on the model listing nodes in order", () => {
  it("orders the nodes of a trace by id", () => {
    const sorted = model(
      [nd("function", "a"), nd("function", "b"), nd("function", "c")],
      [ed("passes", fun("a"), fun("b")), ed("passes", fun("b"), fun("c"))],
    )
    const shuffled: FlowModel = { ...sorted, nodes: [...sorted.nodes].reverse() }
    expect(ids(traceFlow(shuffled, fun("a"), "downstream").nodes)).toEqual([
      fun("a"),
      fun("b"),
      fun("c"),
    ])
    expect(ids(traceFlow(shuffled, fun("c"), "upstream").nodes)).toEqual([fun("c")])
    expect(ids(traceFlowBetween(shuffled, fun("a"), fun("c")).nodes)).toEqual([
      fun("a"),
      fun("b"),
      fun("c"),
    ])
  })
})

describe("traceFlowBetween", () => {
  // a -> b -> t, a -> x (dead end), y -> t (not reachable from a), b -> b
  const flow = model(
    [
      nd("function", "a"),
      nd("function", "b"),
      nd("function", "t"),
      nd("function", "x"),
      nd("function", "y"),
    ],
    [
      ed("writes", fun("a"), fun("b")),
      ed("passes", fun("b"), fun("t")),
      ed("passes", fun("a"), fun("x")),
      ed("passes", fun("y"), fun("t")),
      ed("passes", fun("b"), fun("b")),
    ],
  )

  it("keeps only what lies on a route from start to target, ordered by id", () => {
    const trace = traceFlowBetween(flow, fun("a"), fun("t"))
    expect(trace.start).toBe(fun("a"))
    expect(trace.direction).toBe("downstream")
    expect(ids(trace.nodes)).toEqual([fun("a"), fun("b"), fun("t")])
    expect(ids(trace.edges)).toEqual([
      eid("passes", fun("b"), fun("b")),
      eid("passes", fun("b"), fun("t")),
      eid("writes", fun("a"), fun("b")),
    ])
    expect(trace.complete).toBe(true)
  })

  it("is empty when the target is not reached", () => {
    const trace = traceFlowBetween(flow, fun("a"), fun("y"))
    expect(trace.nodes).toEqual([])
    expect(trace.edges).toEqual([])
    expect(trace.unknowns).toEqual([])
    expect(trace.complete).toBe(true)
  })

  it("is the start alone when start is the target", () => {
    const trace = traceFlowBetween(flow, fun("a"), fun("a"))
    expect(ids(trace.nodes)).toEqual([fun("a")])
    expect(trace.edges).toEqual([])
  })

  it("follows a field start's own data only, and the requested path", () => {
    const fieldFlow = model(
      [nd("field", "F"), nd("field", "G"), nd("function", "h"), nd("boundary", "B")],
      [
        ed("reads", fld("F"), fun("h"), { origin: fld("F"), path: ["a"] }),
        ed("reads", fld("G"), fun("h"), { origin: fld("G") }),
        ed("side-effect", fun("h"), bnd("B"), { origin: fld("G") }),
        ed("side-effect", fun("h"), bnd("B"), { origin: fld("F"), path: ["a"] }),
      ],
    )
    expect(ids(traceFlowBetween(fieldFlow, fld("F"), bnd("B")).nodes)).toEqual([
      bnd("B"),
      fld("F"),
      fun("h"),
    ])
    expect(ids(traceFlowBetween(fieldFlow, fld("F"), bnd("B")).edges)).toEqual([
      eid("reads", fld("F"), fun("h"), ["a"], "static", fld("F")),
      eid("side-effect", fun("h"), bnd("B"), ["a"], "static", fld("F")),
    ])
    expect(traceFlowBetween(fieldFlow, fld("F"), bnd("B"), { path: ["b"] }).nodes).toEqual([])
    expect(ids(traceFlowBetween(fieldFlow, fun("h"), bnd("B")).edges)).toHaveLength(2)
  })

  it("passes the statuses filter through", () => {
    const statusFlow = model(
      [nd("function", "a"), nd("function", "b")],
      [ed("passes", fun("a"), fun("b"), { status: "inferred" })],
    )
    expect(
      traceFlowBetween(statusFlow, fun("a"), fun("b"), { statuses: ["static"] }).nodes,
    ).toEqual([])
    expect(ids(traceFlowBetween(statusFlow, fun("a"), fun("b")).nodes)).toEqual([
      fun("a"),
      fun("b"),
    ])
  })

  it("skips a node reachable through an edge to a node the model lacks", () => {
    const dangling = withRaw(
      model([nd("function", "a"), nd("function", "b")], [ed("passes", fun("a"), fun("b"))]),
      ed("passes", fun("b"), "ghost"),
      ed("passes", "ghost", fun("b")),
    )
    const trace = traceFlowBetween(dangling, fun("a"), fun("b"))
    expect(ids(trace.nodes)).toEqual([fun("a"), fun("b")])
  })

  it("attaches unknowns whose subject is on the route, and judges their data against the start field", () => {
    const fieldFlow = model(
      [
        nd("field", "F"),
        nd("field", "G"),
        nd("function", "h"),
        nd("function", "off"),
        nd("boundary", "B"),
      ],
      [
        ed("reads", fld("F"), fun("h"), { origin: fld("F") }),
        ed("side-effect", fun("h"), bnd("B"), { origin: fld("F") }),
        ed("reads", fld("F"), fun("off"), { origin: fld("F") }),
      ],
      [
        unknownAt(1, { subject: fun("h") }),
        unknownAt(2, { subject: fun("off") }),
        unknownAt(3),
        unknownAt(4, { subject: fun("h"), data: [{ origin: fld("F"), path: ["a"] }] }),
        unknownAt(5, { subject: fun("h"), data: [{ origin: fld("G"), path: [] }] }),
        unknownAt(6, {
          subject: fun("h"),
          data: [
            { origin: fld("G"), path: [] },
            { origin: fld("F"), path: [] },
          ],
        }),
      ],
    )
    const lines = (start: string, options = {}) =>
      traceFlowBetween(fieldFlow, start, bnd("B"), options).unknowns.map((u) => u.source.line)
    expect(lines(fld("F"))).toEqual([1, 4, 6])
    expect(lines(fld("F"), { path: ["a", "b"] })).toEqual([1, 4, 6])
    expect(lines(fld("F"), { path: ["z"] })).toEqual([1, 6])
    expect(lines(fun("h"))).toEqual([1, 4, 5, 6])
    expect(traceFlowBetween(fieldFlow, fld("F"), bnd("B")).complete).toBe(false)
  })

  it("is complete only when no unknown, unknown node or unknown edge lies on the route", () => {
    const build = (nodeStatus: FlowStatus, edgeStatus: FlowStatus, unknowns: FlowUnknownInput[]) =>
      traceFlowBetween(
        model(
          [nd("function", "a"), nd("function", "b", nodeStatus)],
          [ed("passes", fun("a"), fun("b"), { status: edgeStatus })],
          unknowns,
        ),
        fun("a"),
        fun("b"),
      ).complete
    expect(build("static", "static", [])).toBe(true)
    expect(build("unknown", "static", [])).toBe(false)
    expect(build("static", "unknown", [])).toBe(false)
    expect(build("static", "static", [unknownAt(1, { subject: fun("b") })])).toBe(false)
  })
})

describe("flowPathTo", () => {
  const trace = (...edges: FlowEdgeInput[]) => {
    const nodes = ["a", "b", "c", "d"].map((name) => nd("function", name))
    return traceFlow(model(nodes, edges), fun("a"), "downstream")
  }

  it("is the shortest route, in order", () => {
    const t = trace(
      ed("passes", fun("a"), fun("b")),
      ed("passes", fun("b"), fun("d")),
      ed("writes", fun("a"), fun("d")),
      ed("passes", fun("a"), fun("c")),
      ed("passes", fun("c"), fun("d")),
    )
    expect(flowPathTo(t, fun("a"), fun("d")).map((e) => e.id)).toEqual([
      eid("writes", fun("a"), fun("d")),
    ])
  })

  it("keeps the first shortest route found, not a later one to the same node", () => {
    const t = trace(
      ed("passes", fun("a"), fun("b")),
      ed("passes", fun("a"), fun("c")),
      ed("passes", fun("b"), fun("d")),
      ed("passes", fun("c"), fun("d")),
    )
    expect(flowPathTo(t, fun("a"), fun("d")).map((e) => e.id)).toEqual([
      eid("passes", fun("a"), fun("b")),
      eid("passes", fun("b"), fun("d")),
    ])
  })

  it("lists every hop in order along a chain", () => {
    const t = trace(
      ed("passes", fun("c"), fun("d")),
      ed("passes", fun("a"), fun("b")),
      ed("passes", fun("b"), fun("c")),
    )
    expect(flowPathTo(t, fun("a"), fun("d")).map((e) => e.id)).toEqual([
      eid("passes", fun("a"), fun("b")),
      eid("passes", fun("b"), fun("c")),
      eid("passes", fun("c"), fun("d")),
    ])
  })

  it("is empty for the start itself, an unreached target, and a start that is not in the trace", () => {
    const t = trace(ed("passes", fun("a"), fun("b")))
    expect(flowPathTo(t, fun("a"), fun("a"))).toEqual([])
    expect(flowPathTo(t, fun("a"), fun("c"))).toEqual([])
    expect(flowPathTo(t, fun("d"), fun("b"))).toEqual([])
  })

  it("is not led round a cycle back to the start", () => {
    const t = trace(
      ed("passes", fun("a"), fun("b")),
      ed("passes", fun("b"), fun("a")),
      ed("passes", fun("b"), fun("c")),
    )
    expect(flowPathTo(t, fun("a"), fun("a"))).toEqual([])
    expect(flowPathTo(t, fun("a"), fun("c")).map((e) => e.id)).toEqual([
      eid("passes", fun("a"), fun("b")),
      eid("passes", fun("b"), fun("c")),
    ])
  })
})

describe("filterFlow", () => {
  const flow = model(
    [
      nd("field", "User.email", "static", { classification: "pii" }),
      nd("function", "Mailer", "declared"),
      nd("boundary", "smtp", "static", { boundaryKind: "external-service" }),
    ],
    [
      ed("reads", fld("User.email"), fun("Mailer"), { path: ["x", "y"] }),
      ed("side-effect", fun("Mailer"), bnd("smtp")),
    ],
    [
      unknownAt(1, { subject: fun("Mailer") }),
      unknownAt(2),
      unknownAt(3, { subject: bnd("smtp") }),
    ],
  )

  it("an empty filter keeps everything and reports completeness of the source", () => {
    const view = filterFlow(flow, {})
    expect(view.nodes).toHaveLength(3)
    expect(view.edges).toHaveLength(2)
    expect(view.unknowns).toHaveLength(3)
    expect(view.hiddenNodes).toBe(0)
    expect(view.hiddenEdges).toBe(0)
    expect(view.complete).toBe(false)
    expect(filterFlow(model([nd("function", "a")]), {}).complete).toBe(true)
  })

  it("is incomplete whenever anything is hidden, even of a complete model", () => {
    const whole = model(
      [nd("function", "a"), nd("function", "b")],
      [ed("passes", fun("a"), fun("b"))],
    )
    expect(filterFlow(whole, {}).complete).toBe(true)
    expect(filterFlow(whole, { nameIncludes: "a" })).toMatchObject({
      hiddenNodes: 1,
      hiddenEdges: 1,
      complete: false,
    })
    const edgeOnly = filterFlow(whole, { edgePathIncludes: "q" })
    expect(edgeOnly).toMatchObject({ hiddenNodes: 0, hiddenEdges: 1, complete: false })
    const noEdges = model([nd("function", "a"), nd("function", "b")])
    expect(filterFlow(noEdges, { nameIncludes: "a" })).toMatchObject({
      hiddenNodes: 1,
      hiddenEdges: 0,
      complete: false,
    })
  })

  it("filters by every criterion", () => {
    const names = (filter: Parameters<typeof filterFlow>[1]) =>
      filterFlow(flow, filter).nodes.map((n) => n.name)
    expect(names({ kinds: ["field", "boundary"] })).toEqual(["smtp", "User.email"])
    expect(names({ statuses: ["declared"] })).toEqual(["Mailer"])
    expect(names({ classification: "pii" })).toEqual(["User.email"])
    expect(names({ scope: "b" })).toEqual(["smtp"])
    expect(names({ nameIncludes: "MAILER" })).toEqual(["Mailer"])
    expect(names({ kinds: ["field"], statuses: ["declared"] })).toEqual([])
    expect(names({ kinds: ["function"], nameIncludes: "mail" })).toEqual(["Mailer"])
    expect(names({ kinds: ["function"], scope: "b" })).toEqual([])
    expect(names({ classification: "pii", scope: "b" })).toEqual([])
    expect(names({ classification: "pii", nameIncludes: "zzz" })).toEqual([])
  })

  it("keeps the edges between kept nodes, and narrows by an edge path segment", () => {
    const edgeIds = (filter: Parameters<typeof filterFlow>[1]) =>
      ids(filterFlow(flow, filter).edges)
    expect(edgeIds({ kinds: ["function", "boundary"] })).toEqual([
      eid("side-effect", fun("Mailer"), bnd("smtp")),
    ])
    expect(edgeIds({ kinds: ["field"] })).toEqual([])
    expect(edgeIds({ kinds: ["function"] })).toEqual([])
    expect(edgeIds({ edgePathIncludes: "y" })).toEqual([
      eid("reads", fld("User.email"), fun("Mailer"), ["x", "y"]),
    ])
    expect(edgeIds({ edgePathIncludes: "x" })).toHaveLength(1)
    expect(edgeIds({ edgePathIncludes: "z" })).toEqual([])
  })

  it("keeps unknowns with no subject or a kept subject", () => {
    const lines = (filter: Parameters<typeof filterFlow>[1]) =>
      filterFlow(flow, filter).unknowns.map((u) => u.source.line)
    expect(lines({ kinds: ["function"] })).toEqual([1, 2])
    expect(lines({ kinds: ["boundary"] })).toEqual([2, 3])
    expect(lines({ kinds: ["field"] })).toEqual([2])
  })
})

describe("diffFlow", () => {
  const A = nd("function", "a")
  const B = nd("function", "b")
  const C = nd("function", "c")
  const edgeAB = ed("passes", fun("a"), fun("b"))
  const edgeBC = ed("passes", fun("b"), fun("c"))
  const U1 = unknownAt(1)
  const U2 = unknownAt(2)

  it("is unchanged for identical models", () => {
    const m = model([A, B], [edgeAB], [U1])
    expect(diffFlow(m, m)).toStrictEqual({
      addedNodes: [],
      removedNodes: [],
      changedNodes: [],
      addedEdges: [],
      removedEdges: [],
      addedUnknowns: [],
      removedUnknowns: [],
      unchanged: true,
    })
  })

  it("reports each kind of change by id, with a changed node as before and after", () => {
    const before = model([A, nd("function", "b", "static")], [edgeAB], [U1])
    const after = model([nd("function", "b", "inferred"), C], [edgeBC], [U2])
    const diff = diffFlow(before, after)
    expect(ids(diff.addedNodes)).toEqual([fun("c")])
    expect(ids(diff.removedNodes)).toEqual([fun("a")])
    expect(diff.changedNodes).toEqual([{ before: before.nodes[1], after: after.nodes[0] }])
    expect(ids(diff.addedEdges)).toEqual([eid("passes", fun("b"), fun("c"))])
    expect(ids(diff.removedEdges)).toEqual([eid("passes", fun("a"), fun("b"))])
    expect(ids(diff.addedUnknowns)).toEqual(["unknown:unresolved-call:g.ts:2:1"])
    expect(ids(diff.removedUnknowns)).toEqual(["unknown:unresolved-call:g.ts:1:1"])
    expect(diff.unchanged).toBe(false)
  })

  it("a node that is only added is not also a change", () => {
    const diff = diffFlow(model([A]), model([A, B]))
    expect(diff.changedNodes).toEqual([])
    expect(ids(diff.addedNodes)).toEqual([fun("b")])
  })

  it("a node that is only removed is not a change either", () => {
    const diff = diffFlow(model([A, B]), model([A]))
    expect(diff.changedNodes).toEqual([])
    expect(ids(diff.removedNodes)).toEqual([fun("b")])
  })

  describe("changes of different kinds never cancel", () => {
    const edgeAA = ed("passes", fun("a"), fun("a"))
    const changed = nd("function", "a", "inferred")
    const base = model([A, B], [edgeAA], [U1])
    // each variant differs from `base` in exactly one way
    const variants: Record<string, FlowModel> = {
      addedNodes: model([A, B, C], [edgeAA], [U1]),
      removedNodes: model([A], [edgeAA], [U1]),
      changedNodes: model([changed, B], [edgeAA], [U1]),
      addedEdges: model([A, B], [edgeAA, ed("reads", fun("a"), fun("a"))], [U1]),
      removedEdges: model([A, B], [], [U1]),
      addedUnknowns: model([A, B], [edgeAA], [U1, U2]),
      removedUnknowns: model([A, B], [edgeAA], []),
    }
    for (const [name, variant] of Object.entries(variants)) {
      it(`${name} alone is a change`, () => {
        const diff = diffFlow(base, variant)
        expect(diff.unchanged).toBe(false)
        expect(diff[name as keyof typeof diff]).toHaveLength(1)
      })
    }
    const names = Object.keys(variants)
    for (const [index, first] of names.entries()) {
      for (const second of names.slice(index + 1)) {
        it(`${first} together with ${second} is a change`, () => {
          const has = (name: string) => first === name || second === name
          const nodes = [
            has("changedNodes") ? changed : A,
            ...(has("removedNodes") ? [] : [B]),
            ...(has("addedNodes") ? [C] : []),
          ]
          const edges = [
            ...(has("removedEdges") ? [] : [edgeAA]),
            ...(has("addedEdges") ? [ed("reads", fun("a"), fun("a"))] : []),
          ]
          const unknowns = [
            ...(has("removedUnknowns") ? [] : [U1]),
            ...(has("addedUnknowns") ? [U2] : []),
          ]
          const both = diffFlow(base, model(nodes, edges, unknowns))
          expect(both.unchanged).toBe(false)
          expect(both[first as keyof typeof both]).toHaveLength(1)
          expect(both[second as keyof typeof both]).toHaveLength(1)
        })
      }
    }
  })
})
