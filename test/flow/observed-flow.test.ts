import { describe, expect, it } from "vitest"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { observedFlow } from "../../src/flow/observed-flow.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const FILE = "src/user.ts"
const field: FlowNodeInput = { kind: "field", scope: FILE, name: "userData.user", status: "static" }
const fn = (name: string): FlowNodeInput => ({
  kind: "function",
  scope: FILE,
  name,
  status: "static",
})
const boundary = (name: string, boundaryKind: "client-response" | "log"): FlowNodeInput => ({
  kind: "boundary",
  scope: "boundary",
  name,
  status: "static",
  boundaryKind,
})
const fid = flowNodeId("field", FILE, "userData.user")
const nid = (kind: FlowNodeInput["kind"], scope: string, name: string): string =>
  flowNodeId(kind, scope, name)
const edge = (
  kind: FlowEdgeInput["kind"],
  from: string,
  to: string,
  path?: string[],
): FlowEdgeInput => ({
  kind,
  from,
  to,
  status: "static",
  origin: fid,
  ...(path === undefined ? {} : { path }),
})

/** user.email -> profile -> http ; user.passwordHash -> export -> http ; user.role -> audit -> log */
const flow = buildFlowModel({
  nodes: [
    field,
    fn("profile"),
    fn("export"),
    fn("audit"),
    boundary("http", "client-response"),
    boundary("console", "log"),
  ],
  edges: [
    edge("reads", fid, nid("function", FILE, "profile"), ["email"]),
    edge("side-effect", nid("function", FILE, "profile"), nid("boundary", "boundary", "http"), [
      "email",
    ]),
    edge("reads", fid, nid("function", FILE, "export"), ["passwordHash"]),
    edge("side-effect", nid("function", FILE, "export"), nid("boundary", "boundary", "http"), [
      "passwordHash",
    ]),
    edge("reads", fid, nid("function", FILE, "audit"), ["role"]),
    edge("side-effect", nid("function", FILE, "audit"), nid("boundary", "boundary", "console"), [
      "role",
    ]),
  ],
  unknowns: [],
})

const seen = (
  scope: string,
  fieldName: string,
  name = "http",
  kind: "client-response" | "log" = "client-response",
): ObservationEvent => ({
  scope,
  boundary: { kind, name },
  field: fieldName,
})

describe("observedFlow", () => {
  it("is the part of the flow that was actually witnessed: only the observed path, not its siblings", () => {
    const observation = buildObservationModel([seen("run-a", "userData.user.email")])
    const result = observedFlow(flow, observation)
    const names = result.nodes.map((node) => node.name).sort()
    expect(names).toEqual(["http", "profile", "userData.user"])
    expect(result.edges.map((e) => e.kind).sort()).toEqual(["reads", "side-effect"])
  })

  it("restricts to one execution when a scope is given", () => {
    const observation = buildObservationModel([
      seen("run-a", "userData.user.email"),
      seen("run-b", "userData.user.passwordHash"),
    ])
    const a = observedFlow(flow, observation, "run-a")
    const b = observedFlow(flow, observation, "run-b")
    expect(a.nodes.map((n) => n.name)).toContain("profile")
    expect(a.nodes.map((n) => n.name)).not.toContain("export")
    expect(b.nodes.map((n) => n.name)).toContain("export")
    expect(b.nodes.map((n) => n.name)).not.toContain("profile")
    expect(observedFlow(flow, observation).nodes.map((n) => n.name)).toEqual(
      expect.arrayContaining(["profile", "export"]),
    )
  })

  it("an observation of the whole field lights every path to that boundary", () => {
    const observation = buildObservationModel([seen("run", "userData.user")])
    const names = observedFlow(flow, observation).nodes.map((n) => n.name)
    expect(names).toEqual(expect.arrayContaining(["profile", "export"]))
    expect(names).not.toContain("audit")
  })

  it("distinguishes boundaries: a log observation lights the audit path only", () => {
    const observation = buildObservationModel([seen("run", "userData.user.role", "console", "log")])
    const names = observedFlow(flow, observation).nodes.map((n) => n.name)
    expect(names).toContain("audit")
    expect(names).not.toContain("profile")
  })

  it("reports the observations it used, and the ones the static flow does not explain", () => {
    const observation = buildObservationModel([
      seen("run", "userData.user.email"),
      seen("run", "userData.user.email", "elsewhere"),
    ])
    const result = observedFlow(flow, observation)
    expect(result.explained.map((o) => o.boundary.name)).toEqual(["http"])
    expect(result.unexplained.map((o) => o.boundary.name)).toEqual(["elsewhere"])
  })

  it("lists the scopes that were observed, sorted", () => {
    const observation = buildObservationModel([
      seen("b", "userData.user.email"),
      seen("a", "userData.user.email"),
    ])
    expect(observedFlow(flow, observation).scopes).toEqual(["a", "b"])
  })

  it("is empty for no observations and for an unknown scope", () => {
    const observation = buildObservationModel([seen("run", "userData.user.email")])
    expect(observedFlow(flow, buildObservationModel([])).nodes).toEqual([])
    expect(observedFlow(flow, observation, "nope").nodes).toEqual([])
    expect(observedFlow(flow, observation, "nope").scopes).toEqual(["run"])
  })

  it("is deterministic and ordered by id", () => {
    const observation = buildObservationModel([seen("run", "userData.user")])
    const a = observedFlow(flow, observation)
    expect(observedFlow(flow, observation)).toEqual(a)
    expect(a.nodes.map((n) => n.id)).toEqual([...a.nodes.map((n) => n.id)].sort())
  })
})

describe("observedFlow, with names that more than one node has", () => {
  const OTHER = "src/other.ts"
  const fieldIn = (scope: string): FlowNodeInput => ({
    kind: "field",
    scope,
    name: "userData.user",
    status: "static",
  })
  const fnIn = (scope: string, name: string): FlowNodeInput => ({
    kind: "function",
    scope,
    name,
    status: "static",
  })
  const route = (
    scope: string,
    fnName: string,
    boundaryScope: string,
    boundaryName: string,
  ): FlowEdgeInput[] => {
    const origin = flowNodeId("field", scope, "userData.user")
    const through = flowNodeId("function", scope, fnName)
    return [
      { kind: "reads", from: origin, to: through, status: "static", origin, path: ["email"] },
      {
        kind: "side-effect",
        from: through,
        to: flowNodeId("boundary", boundaryScope, boundaryName),
        status: "static",
        origin,
        path: ["email"],
      },
    ]
  }
  const http = (
    boundaryScope: string,
    boundaryKind?: "client-response" | "log",
  ): FlowNodeInput => ({
    kind: "boundary",
    scope: boundaryScope,
    name: "http",
    status: "static",
    ...(boundaryKind === undefined ? {} : { boundaryKind }),
  })
  const observed = (kind: "client-response" | "log") =>
    buildObservationModel([seen("s", "userData.user.email", "http", kind)])

  it("lights the route of every field that has the observed name", () => {
    const two = buildFlowModel({
      nodes: [
        fieldIn(FILE),
        fieldIn(OTHER),
        fnIn(FILE, "a"),
        fnIn(OTHER, "b"),
        http("boundary", "client-response"),
      ],
      edges: [...route(FILE, "a", "boundary", "http"), ...route(OTHER, "b", "boundary", "http")],
      unknowns: [],
    })
    const result = observedFlow(two, observed("client-response"))
    expect(result.explained).toHaveLength(1)
    expect(result.nodes.map((node) => node.id)).toEqual(
      [
        flowNodeId("field", FILE, "userData.user"),
        flowNodeId("field", OTHER, "userData.user"),
        flowNodeId("function", FILE, "a"),
        flowNodeId("function", OTHER, "b"),
        flowNodeId("boundary", "boundary", "http"),
      ].sort(),
    )
  })

  it("lights only the boundary of the observed kind when two boundaries share a name", () => {
    const two = buildFlowModel({
      nodes: [
        fieldIn(FILE),
        fnIn(FILE, "a"),
        fnIn(FILE, "b"),
        http("boundary", "client-response"),
        http("boundary:log", "log"),
      ],
      edges: [...route(FILE, "a", "boundary", "http"), ...route(FILE, "b", "boundary:log", "http")],
      unknowns: [],
    })
    const clientIds = observedFlow(two, observed("client-response")).nodes.map((node) => node.id)
    expect(clientIds).toContain(flowNodeId("function", FILE, "a"))
    expect(clientIds).not.toContain(flowNodeId("function", FILE, "b"))
    const logIds = observedFlow(two, observed("log")).nodes.map((node) => node.id)
    expect(logIds).toContain(flowNodeId("function", FILE, "b"))
    expect(logIds).not.toContain(flowNodeId("function", FILE, "a"))
  })

  it("takes a boundary with no kind for any kind observed under its name", () => {
    const kindless = buildFlowModel({
      nodes: [fieldIn(FILE), fnIn(FILE, "a"), http("boundary")],
      edges: route(FILE, "a", "boundary", "http"),
      unknowns: [],
    })
    expect(observedFlow(kindless, observed("log")).explained).toHaveLength(1)
    expect(observedFlow(kindless, observed("client-response")).explained).toHaveLength(1)
  })

  it("explains nothing for a name that is no field, however its prefix looks", () => {
    const one = buildFlowModel({
      nodes: [fieldIn(FILE), fnIn(FILE, "a"), http("boundary", "client-response")],
      edges: route(FILE, "a", "boundary", "http"),
      unknowns: [],
    })
    const result = observedFlow(
      one,
      buildObservationModel([seen("s", "userData.userExtra.email", "http")]),
    )
    expect(result.explained).toHaveLength(0)
    expect(result.unexplained).toHaveLength(1)
  })
})
