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
