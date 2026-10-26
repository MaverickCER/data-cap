import { describe, expect, it } from "vitest"
import { buildFlowModel, flowNodeId, FlowModelError } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import { diffFlow, filterFlow, traceFlow } from "../../src/flow/flow-projections.js"

const FILE = "src/profile.ts"
const id = (kind: FlowNodeInput["kind"], name: string): string => flowNodeId(kind, FILE, name)

function node(
  kind: FlowNodeInput["kind"],
  name: string,
  extra: Partial<FlowNodeInput> = {},
): FlowNodeInput {
  return { kind, scope: FILE, name, status: "static", ...extra }
}

function edge(
  kind: FlowEdgeInput["kind"],
  from: string,
  to: string,
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput {
  return { kind, from, to, status: "static", ...extra }
}

/**
 * query -> (reads) buildUserProfile.user -> (returns) buildUserProfile#return
 * -> (passes) sendProfileToClient.profile -> (side-effect) http response
 * plus a discard of passwordHash and an unrelated control call.
 */
function profileModel(extraNodes: FlowNodeInput[] = [], extraEdges: FlowEdgeInput[] = []) {
  return buildFlowModel({
    nodes: [
      node("field", "User.email", { classification: "pii" }),
      node("field", "User.passwordHash", { classification: "secret" }),
      node("function", "buildUserProfile"),
      node("parameter", "buildUserProfile.user"),
      node("return", "buildUserProfile#return"),
      node("function", "sendProfileToClient"),
      node("parameter", "sendProfileToClient.profile"),
      { kind: "boundary", scope: "boundary", name: "http-response", status: "declared" },
      ...extraNodes,
    ],
    edges: [
      edge("reads", id("field", "User.email"), id("parameter", "buildUserProfile.user"), {
        path: ["email"],
      }),
      edge(
        "returns",
        id("parameter", "buildUserProfile.user"),
        id("return", "buildUserProfile#return"),
        {
          path: ["email"],
        },
      ),
      edge(
        "passes",
        id("return", "buildUserProfile#return"),
        id("parameter", "sendProfileToClient.profile"),
        {
          path: ["email"],
        },
      ),
      edge(
        "side-effect",
        id("parameter", "sendProfileToClient.profile"),
        flowNodeId("boundary", "boundary", "http-response"),
        { path: ["email"] },
      ),
      edge("discards", id("function", "buildUserProfile"), id("field", "User.passwordHash"), {
        path: ["passwordHash"],
      }),
      edge("calls", id("function", "sendProfileToClient"), id("function", "buildUserProfile")),
      ...extraEdges,
    ],
    unknowns: [],
  })
}

describe("traceFlow", () => {
  it("follows data edges downstream from a field to its destination", () => {
    const trace = traceFlow(profileModel(), id("field", "User.email"), "downstream")
    // Nodes are ordered by content-addressed id, not by traversal order.
    expect(trace.nodes.map((n) => n.name).sort()).toEqual(
      [
        "User.email",
        "buildUserProfile.user",
        "buildUserProfile#return",
        "sendProfileToClient.profile",
        "http-response",
      ].sort(),
    )
    expect(trace.nodes.map((n) => n.id)).toEqual([...trace.nodes.map((n) => n.id)].sort())
    expect(trace.complete).toBe(true)
  })

  it("follows data edges upstream from a destination to its source", () => {
    const trace = traceFlow(
      profileModel(),
      flowNodeId("boundary", "boundary", "http-response"),
      "upstream",
    )
    expect(trace.nodes.map((n) => n.name)).toContain("User.email")
    expect(trace.edges.every((e) => e.kind !== "calls" && e.kind !== "discards")).toBe(true)
  })

  it("never follows calls or discards edges (they carry no data)", () => {
    const trace = traceFlow(profileModel(), id("field", "User.passwordHash"), "downstream")
    expect(trace.nodes.map((n) => n.name)).toEqual(["User.passwordHash"])
  })

  it("filters hops by field path when a path is given", () => {
    const model = profileModel(
      [],
      [
        edge("reads", id("field", "User.email"), id("return", "buildUserProfile#return"), {
          path: ["name"],
        }),
      ],
    )
    const trace = traceFlow(model, id("field", "User.email"), "downstream", { path: ["email"] })
    expect(trace.edges.some((e) => e.path?.join(".") === "name")).toBe(false)
  })

  it("treats an edge with no path as applying to every path", () => {
    const model = buildFlowModel({
      nodes: [node("field", "A"), node("function", "f")],
      edges: [edge("reads", id("field", "A"), id("function", "f"))],
      unknowns: [],
    })
    const trace = traceFlow(model, id("field", "A"), "downstream", { path: ["x", "y"] })
    expect(trace.nodes).toHaveLength(2)
  })

  it("treats a path and its prefix as related in both directions", () => {
    const model = buildFlowModel({
      nodes: [node("field", "A"), node("function", "f"), node("function", "g")],
      edges: [
        edge("reads", id("field", "A"), id("function", "f"), { path: ["user"] }),
        edge("reads", id("field", "A"), id("function", "g"), { path: ["user", "email"] }),
      ],
      unknowns: [],
    })
    expect(
      traceFlow(model, id("field", "A"), "downstream", { path: ["user", "email"] }).nodes,
    ).toHaveLength(3)
    expect(traceFlow(model, id("field", "A"), "downstream", { path: ["user"] }).nodes).toHaveLength(
      3,
    )
    expect(
      traceFlow(model, id("field", "A"), "downstream", { path: ["other"] }).nodes,
    ).toHaveLength(1)
  })

  it("is not complete when a visited node has an attached unknown", () => {
    const model = buildFlowModel({
      nodes: [node("field", "A"), node("function", "f")],
      edges: [edge("reads", id("field", "A"), id("function", "f"))],
      unknowns: [
        {
          reason: "unresolved-call",
          subject: id("function", "f"),
          source: { file: FILE, line: 4, column: 2 },
        },
      ],
    })
    const trace = traceFlow(model, id("field", "A"), "downstream")
    expect(trace.complete).toBe(false)
    expect(trace.unknowns).toHaveLength(1)
  })

  it("is not complete when a traversed edge has status unknown", () => {
    const model = buildFlowModel({
      nodes: [node("field", "A"), node("function", "f")],
      edges: [edge("reads", id("field", "A"), id("function", "f"), { status: "unknown" })],
      unknowns: [],
    })
    expect(traceFlow(model, id("field", "A"), "downstream").complete).toBe(false)
  })

  it("is not complete when a visited node has status unknown", () => {
    const model = buildFlowModel({
      nodes: [node("field", "A"), node("function", "f", { status: "unknown" })],
      edges: [edge("reads", id("field", "A"), id("function", "f"))],
      unknowns: [],
    })
    expect(traceFlow(model, id("field", "A"), "downstream").complete).toBe(false)
  })

  it("stays complete when an unrelated part of the graph is unknown", () => {
    const model = buildFlowModel({
      nodes: [
        node("field", "A"),
        node("function", "f"),
        node("function", "far", { status: "unknown" }),
      ],
      edges: [edge("reads", id("field", "A"), id("function", "f"))],
      unknowns: [],
    })
    expect(traceFlow(model, id("field", "A"), "downstream").complete).toBe(true)
  })

  it("restricts a trace to the requested statuses", () => {
    const model = buildFlowModel({
      nodes: [node("field", "A"), node("function", "f"), node("function", "g")],
      edges: [
        edge("reads", id("field", "A"), id("function", "f"), { status: "static" }),
        edge("reads", id("field", "A"), id("function", "g"), { status: "inferred" }),
      ],
      unknowns: [],
    })
    const trace = traceFlow(model, id("field", "A"), "downstream", { statuses: ["static"] })
    expect(trace.nodes.map((n) => n.name)).toEqual(["A", "f"])
  })

  it("terminates on cycles", () => {
    const model = buildFlowModel({
      nodes: [node("function", "f"), node("function", "g")],
      edges: [
        edge("passes", id("function", "f"), id("function", "g")),
        edge("passes", id("function", "g"), id("function", "f")),
      ],
      unknowns: [],
    })
    expect(traceFlow(model, id("function", "f"), "downstream").nodes).toHaveLength(2)
  })

  it("throws for a start node that does not exist", () => {
    expect(() => traceFlow(profileModel(), id("field", "Nope"), "downstream")).toThrow(
      FlowModelError,
    )
  })
})

describe("traceFlow with edge origins", () => {
  // Two fields flow through one shared helper; only email's chain reaches the sink.
  function sharedHelper() {
    const email = id("field", "User.email")
    const name = id("field", "User.name")
    const helper = id("function", "helper")
    const sendOut = id("function", "send")
    const http = flowNodeId("boundary", "boundary", "http")
    const logSink = flowNodeId("boundary", "boundary", "log")
    return {
      email,
      name,
      http,
      logSink,
      model: buildFlowModel({
        nodes: [
          node("field", "User.email"),
          node("field", "User.name"),
          node("function", "helper"),
          node("function", "send"),
          { kind: "boundary", scope: "boundary", name: "http", status: "declared" },
          { kind: "boundary", scope: "boundary", name: "log", status: "declared" },
        ],
        edges: [
          edge("reads", email, helper, { origin: email }),
          edge("reads", name, helper, { origin: name }),
          edge("passes", helper, sendOut, { origin: email }),
          edge("side-effect", sendOut, flowNodeId("boundary", "boundary", "http"), {
            origin: email,
          }),
          edge("side-effect", helper, flowNodeId("boundary", "boundary", "log"), { origin: name }),
        ],
        unknowns: [],
      }),
    }
  }

  it("downstream from a field follows only edges of that origin", () => {
    const { model, email, name, http, logSink } = sharedHelper()
    const fromEmail = traceFlow(model, email, "downstream").nodes.map((n) => n.id)
    expect(fromEmail).toContain(http)
    expect(fromEmail).not.toContain(logSink)
    const fromName = traceFlow(model, name, "downstream").nodes.map((n) => n.id)
    expect(fromName).toContain(logSink)
    expect(fromName).not.toContain(http)
  })

  it("downstream from a non-field node follows every origin", () => {
    const { model, http, logSink } = sharedHelper()
    const ids = traceFlow(model, id("function", "helper"), "downstream").nodes.map((n) => n.id)
    expect(ids).toContain(http)
    expect(ids).toContain(logSink)
  })

  it("upstream from a boundary includes only the origins whose flow actually reaches it", () => {
    const { model, email, name, http } = sharedHelper()
    const trace = traceFlow(model, http, "upstream")
    const ids = trace.nodes.map((n) => n.id)
    expect(ids).toContain(email)
    expect(ids).not.toContain(name)
    expect(trace.edges.every((e) => e.origin === email)).toBe(true)
  })

  it("upstream from a boundary also reports a declared source feeding the origin field", () => {
    const email = id("field", "User.email")
    const db = flowNodeId("boundary", "boundary", "pg")
    const http = flowNodeId("boundary", "boundary", "http")
    const model = buildFlowModel({
      nodes: [
        node("field", "User.email"),
        { kind: "boundary", scope: "boundary", name: "pg", status: "declared" },
        { kind: "boundary", scope: "boundary", name: "http", status: "declared" },
      ],
      edges: [
        edge("crosses-boundary", db, email, { status: "declared", origin: email }),
        edge("side-effect", email, http, { origin: email }),
      ],
      unknowns: [],
    })
    const ids = traceFlow(model, http, "upstream").nodes.map((n) => n.id)
    expect(ids).toContain(db)
  })

  it("an edge without an origin applies to every field trace", () => {
    const email = id("field", "User.email")
    const fnId = id("function", "f")
    const model = buildFlowModel({
      nodes: [node("field", "User.email"), node("function", "f")],
      edges: [edge("reads", email, fnId)],
      unknowns: [],
    })
    expect(traceFlow(model, email, "downstream").nodes).toHaveLength(2)
  })
})

describe("traceFlow completeness honours what an unknown concerns", () => {
  const email = id("field", "User.email")
  const name = id("field", "User.name")
  const worker = id("function", "worker")
  function modelWith(data: { origin: string; path: string[] }[] | undefined) {
    return buildFlowModel({
      nodes: [node("field", "User.email"), node("field", "User.name"), node("function", "worker")],
      edges: [
        edge("reads", email, worker, { origin: email }),
        edge("reads", name, worker, { origin: name }),
      ],
      unknowns: [
        {
          reason: "unresolved-call",
          subject: worker,
          source: { file: FILE, line: 3, column: 1 },
          ...(data === undefined ? {} : { data }),
        },
      ],
    })
  }

  it("an unknown with no data concerns every trace that visits its subject", () => {
    const model = modelWith(undefined)
    expect(traceFlow(model, email, "downstream").complete).toBe(false)
    expect(traceFlow(model, name, "downstream").complete).toBe(false)
  })

  it("an unknown about one field does not make another field's trace incomplete", () => {
    const model = modelWith([{ origin: email, path: [] }])
    expect(traceFlow(model, email, "downstream").complete).toBe(false)
    expect(traceFlow(model, name, "downstream").complete).toBe(true)
  })

  it("an unknown about one path does not make a trace of an unrelated path incomplete", () => {
    const model = modelWith([{ origin: email, path: ["address"] }])
    expect(traceFlow(model, email, "downstream", { path: ["passwordHash"] }).complete).toBe(true)
    expect(traceFlow(model, email, "downstream", { path: ["address"] }).complete).toBe(false)
    expect(traceFlow(model, email, "downstream", { path: ["address", "city"] }).complete).toBe(
      false,
    )
    expect(traceFlow(model, email, "downstream").complete).toBe(false)
  })

  it("an unknown about the whole field concerns every path of it", () => {
    const model = modelWith([{ origin: email, path: [] }])
    expect(traceFlow(model, email, "downstream", { path: ["anything"] }).complete).toBe(false)
  })

  it("a trace that starts at a non-field node cannot tell and stays conservative", () => {
    const model = modelWith([{ origin: email, path: [] }])
    expect(traceFlow(model, worker, "downstream").complete).toBe(false)
  })

  it("an unrelated unknown is still returned in the trace's unknowns only when relevant", () => {
    const model = modelWith([{ origin: email, path: [] }])
    expect(traceFlow(model, name, "downstream").unknowns).toEqual([])
    expect(traceFlow(model, email, "downstream").unknowns).toHaveLength(1)
  })
})

describe("filterFlow", () => {
  it("keeps only nodes matching every criterion and edges between kept nodes", () => {
    const view = filterFlow(profileModel(), { classification: "pii" })
    expect(view.nodes.map((n) => n.name)).toEqual(["User.email"])
    expect(view.edges).toEqual([])
  })

  it("filters by kind, scope, name substring and status", () => {
    const model = profileModel()
    expect(filterFlow(model, { kinds: ["function"] }).nodes).toHaveLength(2)
    expect(filterFlow(model, { scope: "boundary" }).nodes.map((n) => n.name)).toEqual([
      "http-response",
    ])
    expect(filterFlow(model, { nameIncludes: "profile" }).nodes.length).toBeGreaterThan(0)
    expect(filterFlow(model, { statuses: ["declared"] }).nodes.map((n) => n.name)).toEqual([
      "http-response",
    ])
  })

  it("counts what it hid, so a filtered view is never mistaken for the whole graph", () => {
    const model = profileModel()
    const view = filterFlow(model, { kinds: ["function"] })
    expect(view.hiddenNodes).toBe(model.nodes.length - 2)
    expect(view.hiddenEdges).toBe(model.edges.length - view.edges.length)
    expect(view.complete).toBe(false)
  })

  it("reports complete only for an unfiltered view of a complete model", () => {
    const model = profileModel()
    expect(filterFlow(model, {}).complete).toBe(true)
    expect(filterFlow(model, {}).hiddenNodes).toBe(0)
  })

  it("keeps unknowns whose subject is kept, or that have no subject", () => {
    const model = buildFlowModel({
      nodes: [node("function", "f"), node("function", "g")],
      edges: [],
      unknowns: [
        { reason: "dynamic-access", source: { file: FILE, line: 1, column: 1 } },
        {
          reason: "unresolved-call",
          subject: id("function", "g"),
          source: { file: FILE, line: 2, column: 1 },
        },
      ],
    })
    const view = filterFlow(model, { nameIncludes: "f" })
    expect(view.unknowns.map((u) => u.reason)).toEqual(["dynamic-access"])
    expect(view.complete).toBe(false)
  })

  it("filters by policy-relevant field path via edge path", () => {
    const view = filterFlow(profileModel(), { edgePathIncludes: "email" })
    expect(view.edges.length).toBeGreaterThan(0)
    expect(view.edges.every((e) => e.path?.includes("email"))).toBe(true)
  })
})

describe("diffFlow", () => {
  it("reports added, removed and changed nodes, edges and unknowns by id", () => {
    const before = profileModel()
    const after = profileModel(
      [node("function", "audit")],
      [edge("calls", id("function", "sendProfileToClient"), id("function", "audit"))],
    )
    const diff = diffFlow(before, after)
    expect(diff.addedNodes.map((n) => n.name)).toEqual(["audit"])
    expect(diff.addedEdges).toHaveLength(1)
    expect(diff.removedNodes).toEqual([])
    expect(diffFlow(after, before).removedNodes.map((n) => n.name)).toEqual(["audit"])
    expect(diff.unchanged).toBe(false)
  })

  it("reports a node whose content changed under the same id", () => {
    const before = buildFlowModel({ nodes: [node("field", "A")], edges: [], unknowns: [] })
    const after = buildFlowModel({
      nodes: [node("field", "A", { classification: "pii" })],
      edges: [],
      unknowns: [],
    })
    const diff = diffFlow(before, after)
    expect(diff.changedNodes.map((c) => c.after.classification)).toEqual(["pii"])
    expect(diff.addedNodes).toEqual([])
  })

  it("reports unknown changes", () => {
    const before = buildFlowModel({ nodes: [], edges: [], unknowns: [] })
    const after = buildFlowModel({
      nodes: [],
      edges: [],
      unknowns: [{ reason: "dynamic-access", source: { file: FILE, line: 1, column: 1 } }],
    })
    expect(diffFlow(before, after).addedUnknowns).toHaveLength(1)
    expect(diffFlow(after, before).removedUnknowns).toHaveLength(1)
  })

  it("is unchanged for identical models", () => {
    const diff = diffFlow(profileModel(), profileModel())
    expect(diff.unchanged).toBe(true)
  })
})
