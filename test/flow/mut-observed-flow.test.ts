import { describe, expect, it } from "vitest"
import { buildFlowModel, flowEdgeId, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { observedFlow } from "../../src/flow/observed-flow.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const F = "f.ts"
const nd = (
  kind: FlowNodeInput["kind"],
  name: string,
  extra: Partial<FlowNodeInput> = {},
): FlowNodeInput => ({
  kind,
  scope: kind === "boundary" ? "b" : F,
  name,
  status: "static",
  ...extra,
})
const nid = (kind: FlowNodeInput["kind"], name: string) =>
  flowNodeId(kind, kind === "boundary" ? "b" : F, name)
const U = nid("field", "userData.user")
const ed = (
  kind: FlowEdgeInput["kind"],
  from: string,
  to: string,
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput => ({ kind, from, to, status: "static", origin: U, ...extra })
const ev = (
  field: string,
  name: string,
  scope = "s",
  kind: ObservationEvent["boundary"]["kind"] = "client-response",
): ObservationEvent => ({ scope, boundary: { kind, name }, field })
const edgeId = (kind: FlowEdgeInput["kind"], from: string, to: string, path?: string[]) =>
  flowEdgeId(kind, from, to, path, "static", U)
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id)

describe("observedFlow", () => {
  const flow = buildFlowModel({
    nodes: [
      nd("field", "userData.user"),
      nd("field", "userData.other"),
      nd("function", "a"),
      nd("function", "z"),
      nd("function", "userData.user"),
      nd("boundary", "http", { boundaryKind: "client-response" }),
      nd("boundary", "log", { boundaryKind: "log" }),
      nd("boundary", "anykind"),
      nd("function", "http"),
      nd("function", "fnonly"),
    ],
    edges: [
      ed("side-effect", nid("function", "z"), nid("boundary", "http"), { path: ["name"] }),
      ed("reads", U, nid("function", "z"), { path: ["name"] }),
      ed("reads", U, nid("function", "a"), { path: ["id"] }),
      ed("side-effect", nid("function", "a"), nid("boundary", "log"), { path: ["id"] }),
      ed("side-effect", nid("function", "a"), nid("boundary", "anykind"), { path: ["id"] }),
      ed("passes", nid("function", "a"), nid("function", "fnonly"), { path: ["id"] }),
      // not this field's data, and not from a field node
      ed("side-effect", nid("function", "userData.user"), nid("boundary", "http"), {
        origin: nid("field", "userData.other"),
      }),
      ed("reads", nid("field", "userData.other"), nid("function", "a"), {
        origin: nid("field", "userData.other"),
      }),
    ],
    unknowns: [],
  })
  const observation = buildObservationModel([
    ev("userData.user.name", "http", "s1"),
    ev("userData.user.id", "log", "s2", "log"),
    ev("userData.user.id", "anykind", "s2", "database"),
    ev("userData.user.id", "http", "s3"),
    ev("userData.user.name", "log", "s3", "log"),
    ev("userData.user", "log", "s4", "log"),
    ev("userData.user.name", "http", "s5", "database"),
    ev("userData.unseen", "http", "s6"),
    ev("userData.user.name", "ghost", "s6"),
    ev("userData.user.id", "fnonly", "s7"),
  ])
  const run = () => observedFlow(flow, observation)

  it("names every scope, whichever was selected", () => {
    expect(run().scopes).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7"])
    expect(observedFlow(flow, observation, "s2").scopes).toEqual(run().scopes)
    expect(observedFlow(flow, observation, "nothing").scopes).toEqual(run().scopes)
  })

  it("separates observations the flow carries a route for from those it does not", () => {
    expect(ids(run().explained)).toEqual([
      "observation:s1|client-response:http|userData.user.name|-",
      "observation:s2|database:anykind|userData.user.id|-",
      "observation:s2|log:log|userData.user.id|-",
      "observation:s4|log:log|userData.user|-",
    ])
    expect(ids(run().unexplained)).toEqual([
      "observation:s3|client-response:http|userData.user.id|-",
      "observation:s3|log:log|userData.user.name|-",
      "observation:s5|database:http|userData.user.name|-",
      "observation:s6|client-response:ghost|userData.user.name|-",
      "observation:s6|client-response:http|userData.unseen|-",
      "observation:s7|client-response:fnonly|userData.user.id|-",
    ])
  })

  it("returns the nodes and edges of the witnessed routes, each ordered by id", () => {
    expect(ids(run().nodes)).toEqual([
      "boundary:b#anykind",
      "boundary:b#http",
      "boundary:b#log",
      "field:f.ts#userData.user",
      "function:f.ts#a",
      "function:f.ts#z",
    ])
    expect(ids(run().edges)).toEqual([
      edgeId("reads", U, nid("function", "a"), ["id"]),
      edgeId("reads", U, nid("function", "z"), ["name"]),
      edgeId("side-effect", nid("function", "a"), nid("boundary", "anykind"), ["id"]),
      edgeId("side-effect", nid("function", "a"), nid("boundary", "log"), ["id"]),
      edgeId("side-effect", nid("function", "z"), nid("boundary", "http"), ["name"]),
    ])
  })

  it("filters to one scope", () => {
    const only = observedFlow(flow, observation, "s2")
    expect(ids(only.explained)).toEqual([
      "observation:s2|database:anykind|userData.user.id|-",
      "observation:s2|log:log|userData.user.id|-",
    ])
    expect(only.unexplained).toEqual([])
    expect(ids(only.nodes)).toEqual([
      "boundary:b#anykind",
      "boundary:b#log",
      "field:f.ts#userData.user",
      "function:f.ts#a",
    ])
    const lost = observedFlow(flow, observation, "s3")
    expect(lost.explained).toEqual([])
    expect(lost.nodes).toEqual([])
    expect(lost.edges).toEqual([])
    expect(ids(lost.unexplained)).toHaveLength(2)
  })

  it("is empty for no observations", () => {
    expect(observedFlow(flow, buildObservationModel([]))).toEqual({
      scopes: [],
      nodes: [],
      edges: [],
      explained: [],
      unexplained: [],
    })
  })
})
