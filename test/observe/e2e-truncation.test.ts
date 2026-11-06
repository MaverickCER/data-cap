import { describe, expect, it } from "vitest"
import { buildClaimsModel } from "../../src/flow/claims-model.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { createMemorySink, observeValue } from "../../src/observe/index.js"

const FILE = "src/user.ts"
const flow = buildFlowModel({
  nodes: [
    { kind: "field", scope: FILE, name: "userData.user", status: "static" },
    {
      kind: "boundary",
      scope: "boundary",
      name: "http-response",
      status: "declared",
      boundaryKind: "client-response",
    },
  ],
  edges: [
    {
      kind: "side-effect",
      from: flowNodeId("field", FILE, "userData.user"),
      to: flowNodeId("boundary", "boundary", "http-response"),
      status: "static",
    },
  ],
  unknowns: [],
})
const context = {
  scope: "test:profile",
  capability: "userData",
  boundary: { kind: "client-response", name: "http-response" },
} as const

describe("recorder to claims: a cut-off value is never silently verified", () => {
  it("a complete walk verifies; the same walk with a dotted key inside the field does not", () => {
    const complete = createMemorySink()
    observeValue(complete.sink, context, { user: { email: "a" } })
    const verified = buildClaimsModel({
      flow,
      observation: buildObservationModel(complete.events(), complete.skips()),
    })
    expect(verified.claims[0]?.verification).toBe("verified")

    const cut = createMemorySink()
    observeValue(cut.sink, context, { user: { email: "a", "x.y": "b" } })
    const model = buildObservationModel(cut.events(), cut.skips())
    expect(model.truncatedScopes).toEqual(["test:profile"])
    const claims = buildClaimsModel({ flow, observation: model })
    expect(claims.claims[0]).toMatchObject({
      verification: "indeterminate",
      scope: { truncatedScopes: ["test:profile"] },
    })
    expect(claims.summary.indeterminate).toBe(1)
  })

  it("without passing the skips the model cannot know (the caller must pass them)", () => {
    const cut = createMemorySink()
    observeValue(cut.sink, context, { user: { email: "a", "x.y": "b" } })
    const model = buildObservationModel(cut.events())
    expect(buildClaimsModel({ flow, observation: model }).claims[0]?.verification).toBe("verified")
  })
})
