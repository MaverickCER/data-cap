import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildFlowGraphView, FLOW_GRAPH_VIEW_VERSION } from "../../src/evidence/flow-graph-view.js"
import type { FlowGraphView, FunctionView } from "../../src/evidence/flow-graph-view.js"
import { profileFixture } from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

describe("buildFlowGraphView (the user's illustration, through the real pipeline)", () => {
  let fixture: FlowEvidenceFixture
  let view: FlowGraphView

  beforeAll(async () => {
    fixture = await profileFixture()
    view = buildFlowGraphView(fixture.evidence)!
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  const fn = (name: string): FunctionView => {
    const found = view.functions.find((f) => f.name === name)
    if (found === undefined) throw new Error(`no function view for ${name}`)
    return found
  }
  const paths = (items: readonly { readonly path: readonly string[] }[]): string[] =>
    items.map((item) => item.path.join(".")).sort()

  it("is versioned and carries the flow's own coverage", () => {
    expect(view.schemaVersion).toBe(FLOW_GRAPH_VIEW_VERSION)
    expect(view.coverage).toEqual(fixture.evidence.flow?.coverage)
    expect(view.coverage.complete).toBe(false)
  })

  it("buildUserProfile: takes user, reads id/name/email, returns them, and discards passwordHash and role", () => {
    const f = fn("buildUserProfile")
    expect(f.inputs.map((input) => input.name)).toEqual(["buildUserProfile.user"])
    expect(f.output).toBeDefined()
    expect(paths(f.reads)).toEqual(["email", "id", "name"])
    expect(
      f.reads.every((read) => read.via === "parameter" && read.field === "userData.user"),
    ).toBe(true)
    expect(paths(f.forwards.filter((flow) => flow.kind === "returns"))).toEqual([
      "email",
      "id",
      "name",
    ])
    expect(paths(f.discards)).toEqual(["passwordHash", "role"])
    expect(f.sideEffects).toEqual([])
    expect(f.callers.map((caller) => caller.name)).toEqual(["profileHandler"])
    expect(f.callees).toEqual([])
    expect(f.classifications).toEqual(["confidential"])
    expect(f.confidence).toBe("static")
    expect(f.unknowns).toEqual([])
  })

  it("sendProfileToClient: serializes the profile into a client response, carrying only id/name/email", () => {
    const f = fn("sendProfileToClient")
    expect(f.sideEffects.map((effect) => `${effect.boundaryKind}:${effect.boundaryName}`)).toEqual([
      "client-response:http-response",
      "client-response:http-response",
      "client-response:http-response",
    ])
    expect(paths(f.sideEffects)).toEqual(["email", "id", "name"])
  })

  it("profileHandler: reads the whole field, calls both helpers, and receives the profile back from buildUserProfile", () => {
    const f = fn("profileHandler")
    expect(f.callees.map((callee) => callee.name).sort()).toEqual([
      "buildUserProfile",
      "sendProfileToClient",
    ])
    expect(f.reads.some((read) => read.via === "field" && read.path.length === 0)).toBe(true)
    expect(
      f.reads
        .filter((read) => read.via === "return")
        .map((read) => read.path.join("."))
        .sort(),
    ).toEqual(["email", "id", "name"])
  })

  it("exportEverything: sends the whole record to the client", () => {
    const f = fn("exportEverything")
    expect(f.sideEffects).toHaveLength(1)
    expect(f.sideEffects[0]?.path).toEqual([])
  })

  it("trackUser: hands email to code it cannot follow, so its confidence is inferred and the unknown is attached", () => {
    const f = fn("trackUser")
    expect(f.unknowns).toHaveLength(1)
    expect(f.confidence).toBe("inferred")
    expect(paths(f.discards)).toEqual(["id", "name", "passwordHash", "role"])
  })

  it("describes the field: where it is fetched from, where it ends up, who drops what, and its claims", () => {
    const field = view.fields.find((candidate) => candidate.name === "userData.user")
    expect(field).toBeDefined()
    expect(field?.classification).toBe("confidential")
    expect(field?.sources).toEqual([
      expect.objectContaining({
        boundaryName: "postgres:users",
        boundaryKind: "database",
        status: "declared",
      }),
    ])
    expect(field?.destinations).toHaveLength(1)
    expect(field?.destinations[0]).toMatchObject({
      boundaryName: "http-response",
      boundaryKind: "client-response",
      status: "static",
    })
    expect(field?.destinations[0]?.paths.map((p) => p.join(".")).sort()).toEqual([
      "",
      "email",
      "id",
      "name",
    ])
    expect(
      field?.discardedBy
        .filter((d) => d.functionName === "buildUserProfile")
        .map((d) => d.path.join("."))
        .sort(),
    ).toEqual(["passwordHash", "role"])
    expect(field?.readers.map((reader) => reader.functionName)).toEqual(
      expect.arrayContaining(["profileHandler", "trackUser", "exportEverything"]),
    )
    expect(field?.claims.length).toBeGreaterThan(0)
    expect(field?.complete).toBe(false)
  })

  it("passes every node, edge and unknown through, so a renderer needs nothing else", () => {
    const flow = fixture.evidence.flow
    expect(flow).toBeDefined()
    expect(view.nodes).toHaveLength(flow?.nodes.length ?? -1)
    expect(view.edges).toHaveLength(flow?.edges.length ?? -1)
    expect(view.unknowns).toEqual(fixture.evidence.flow?.unknowns)
    const handler = view.nodes.find((node) => node.name === "profileHandler")
    expect(handler).toMatchObject({ kind: "function", label: "profileHandler", status: "static" })
    expect(view.nodes.find((node) => node.name === "http-response")?.label).toBe(
      "client-response: http-response",
    )
    expect(view.nodes.find((node) => node.name === "buildUserProfile#return")?.label).toBe("return")
    expect(view.nodes.find((node) => node.name === "buildUserProfile.user")?.label).toBe("user")
  })

  it("summarizes the claims and documents the five statuses", () => {
    expect(view.claims).toEqual(fixture.evidence.claims?.summary)
    expect(view.statusLegend.map((entry) => entry.status)).toEqual([
      "declared",
      "static",
      "observed",
      "inferred",
      "unknown",
    ])
    expect(view.statusLegend.every((entry) => entry.meaning.length > 10)).toBe(true)
  })

  it("is JSON-serializable with no loss and is deterministic", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
    expect(buildFlowGraphView(fixture.evidence)).toEqual(view)
  })

  it("is ordered by id, so two revisions' views diff cleanly", () => {
    const ids = (items: readonly { readonly id: string }[]) => items.map((item) => item.id)
    expect(ids(view.functions)).toEqual([...ids(view.functions)].sort())
    expect(ids(view.fields)).toEqual([...ids(view.fields)].sort())
    expect(ids(view.nodes)).toEqual([...ids(view.nodes)].sort())
  })
})

describe("buildFlowGraphView without a flow", () => {
  it("returns undefined rather than an empty view that could be mistaken for 'no flows'", async () => {
    const fixture = await profileFixture({ flowEvidence: false })
    try {
      expect(fixture.evidence.computed.flow).toBe(false)
      expect(buildFlowGraphView(fixture.evidence)).toBeUndefined()
    } finally {
      await fixture.cleanup()
    }
  })
})
