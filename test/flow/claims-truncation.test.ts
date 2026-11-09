import { describe, expect, it } from "vitest"
import { buildClaimsModel } from "../../src/flow/claims-model.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowNodeInput } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"
import type { ObservationEvent, ObservationSkip } from "../../src/observe/index.js"

const FILE = "src/user.ts"
const fieldNode = (name: string): FlowNodeInput => ({
  kind: "field",
  scope: FILE,
  name,
  status: "static",
})
const fid = (name: string): string => flowNodeId("field", FILE, name)
const bid = flowNodeId("boundary", "boundary", "http-response")
const CLIENT = { kind: "client-response", name: "http-response" } as const
const PG = { kind: "database", name: "pg" } as const

const flow = buildFlowModel({
  nodes: [
    fieldNode("userData.user"),
    fieldNode("otherData.thing"),
    {
      kind: "boundary",
      scope: "boundary",
      name: "http-response",
      status: "declared",
      boundaryKind: "client-response",
    },
  ],
  edges: [
    { kind: "side-effect", from: fid("userData.user"), to: bid, status: "static" },
    { kind: "side-effect", from: fid("otherData.thing"), to: bid, status: "static" },
  ],
  unknowns: [],
})

const ev = (field: string, scope = "t"): ObservationEvent => ({ scope, boundary: CLIENT, field })
const skip = (
  field: string,
  scope = "t",
  reason: ObservationSkip["reason"] = "max-depth",
): ObservationSkip => ({ scope, boundary: CLIENT, field, reason })

function claimsFor(events: ObservationEvent[], skips: ObservationSkip[], withPolicy = false) {
  const observation = buildObservationModel(events, skips)
  const policy = withPolicy
    ? buildPolicyModel(flow, [
        { id: "no-db", appliesTo: { field: "userData.user" }, forbidDestinations: ["database"] },
      ])
    : undefined
  return buildClaimsModel({ flow, observation, ...(policy === undefined ? {} : { policy }) }).claims
}
const reach = (claims: ReturnType<typeof claimsFor>, subject: string) =>
  claims.find((c) => c.kind === "field-reaches-boundary" && c.subject === subject)

describe("claims over a truncated scope", () => {
  it("a verified claim whose field lives under a skipped path becomes indeterminate", () => {
    const claims = claimsFor([ev("userData.user.email")], [skip("userData")])
    expect(reach(claims, "userData.user")).toMatchObject({
      verification: "indeterminate",
      scope: { observationScopes: ["t"], traceComplete: true, truncatedScopes: ["t"] },
    })
  })

  it("a skip inside the field (the claim's own subtree was cut) also makes it indeterminate", () => {
    const claims = claimsFor([ev("userData.user.email")], [skip("userData.user.address")])
    expect(reach(claims, "userData.user")?.verification).toBe("indeterminate")
  })

  it("a skip at the field itself counts", () => {
    const claims = claimsFor(
      [ev("userData.user.email")],
      [skip("userData.user", "t", "dotted-key")],
    )
    expect(reach(claims, "userData.user")?.verification).toBe("indeterminate")
  })

  it("keeps the supporting evidence and the other fields' verdicts", () => {
    const claims = claimsFor(
      [ev("userData.user.email"), ev("otherData.thing")],
      [skip("userData.user.address")],
    )
    const user = reach(claims, "userData.user")
    expect(user?.supporting.map((r) => r.model).sort()).toEqual(["flow", "observation"])
    expect(reach(claims, "otherData.thing")).toMatchObject({ verification: "verified" })
    expect(reach(claims, "otherData.thing")?.scope).not.toHaveProperty("truncatedScopes")
  })

  it("a skip with a lookalike prefix does not relate (userData.users is not under userData.user)", () => {
    const claims = claimsFor([ev("userData.user.email")], [skip("userData.users")])
    expect(reach(claims, "userData.user")?.verification).toBe("verified")
    expect(reach(claims, "userData.user")?.scope).not.toHaveProperty("truncatedScopes")
  })

  it("a skip in a different scope than the corroborating observation does not downgrade", () => {
    const claims = claimsFor([ev("userData.user.email", "a")], [skip("userData", "b")])
    expect(reach(claims, "userData.user")).toMatchObject({ verification: "verified" })
    expect(reach(claims, "userData.user")?.scope).not.toHaveProperty("truncatedScopes")
  })

  it("lists only the truncated scopes among the contributing ones, sorted", () => {
    const claims = claimsFor(
      [ev("userData.user.email", "b"), ev("userData.user.email", "a"), ev("userData.user.x", "c")],
      [skip("userData", "b"), skip("userData", "a"), skip("userData", "elsewhere")],
    )
    expect(reach(claims, "userData.user")?.scope).toMatchObject({
      observationScopes: ["a", "b", "c"],
      truncatedScopes: ["a", "b"],
    })
  })

  it("a contradiction is not softened by truncation", () => {
    const observation = buildObservationModel(
      [{ scope: "t", boundary: PG, field: "userData.user.email" }],
      [skip("userData")],
    )
    const claims = buildClaimsModel({ flow, observation }).claims
    expect(claims.find((c) => c.object === "pg")?.verification).toBe("contradicted")
  })

  it("an unobserved claim stays unobserved", () => {
    const claims = claimsFor([ev("otherData.thing")], [skip("userData.user")])
    expect(reach(claims, "userData.user")?.verification).toBe("unobserved")
  })

  it("a verified policy claim over a truncated scope is indeterminate, not verified", () => {
    const claims = claimsFor([ev("userData.user.email")], [skip("userData.user")], true)
    expect(claims.find((c) => c.kind === "policy-holds")).toMatchObject({
      verification: "indeterminate",
      scope: { truncatedScopes: ["t"] },
    })
  })

  it("a policy violation seen in a truncated scope is still contradicted", () => {
    const observation = buildObservationModel(
      [{ scope: "t", boundary: PG, field: "userData.user.email" }],
      [skip("userData.user")],
    )
    const policy = buildPolicyModel(flow, [
      { id: "no-db", appliesTo: { field: "userData.user" }, forbidDestinations: ["database"] },
    ])
    const claims = buildClaimsModel({ flow, policy, observation }).claims
    expect(claims.find((c) => c.kind === "policy-holds")?.verification).toBe("contradicted")
  })

  it("a sourced claim is downgraded the same way", () => {
    const pgId = flowNodeId("boundary", "boundary", "pg")
    const sourced = buildFlowModel({
      nodes: [
        fieldNode("userData.user"),
        {
          kind: "boundary",
          scope: "boundary",
          name: "pg",
          status: "declared",
          boundaryKind: "database",
        },
      ],
      edges: [
        { kind: "crosses-boundary", from: pgId, to: fid("userData.user"), status: "declared" },
      ],
      unknowns: [],
    })
    const observation = buildObservationModel(
      [{ scope: "t", boundary: PG, field: "userData.user.email" }],
      [{ scope: "t", boundary: PG, field: "userData", reason: "cycle" }],
    )
    const claim = buildClaimsModel({ flow: sourced, observation }).claims.find(
      (c) => c.kind === "field-sourced-from-boundary",
    )
    expect(claim?.verification).toBe("indeterminate")
  })

  it("no skips: exactly the previous verdicts", () => {
    const claims = claimsFor([ev("userData.user.email")], [])
    expect(reach(claims, "userData.user")?.verification).toBe("verified")
  })
})
