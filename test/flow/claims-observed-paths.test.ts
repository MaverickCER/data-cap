import { describe, expect, it } from "vitest"
import { buildClaimsModel } from "../../src/flow/claims-model.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const FILE = "src/user.ts"
const fieldNode = (name: string): FlowNodeInput => ({
  kind: "field",
  scope: FILE,
  name,
  status: "static",
})
const boundaryNode = (
  name: string,
  boundaryKind: "client-response" | "database",
): FlowNodeInput => ({
  kind: "boundary",
  scope: "boundary",
  name,
  status: "declared",
  boundaryKind,
})
const fid = (name: string): string => flowNodeId("field", FILE, name)
const bid = (name: string): string => flowNodeId("boundary", "boundary", name)

const CLIENT = { kind: "client-response", name: "http-response" } as const
const ev = (field: string, over: Partial<ObservationEvent> = {}): ObservationEvent => ({
  scope: "t",
  boundary: CLIENT,
  field,
  ...over,
})

function wholeFieldFlow(path?: string[]) {
  const edge: FlowEdgeInput = {
    kind: "side-effect",
    from: fid("userData.user"),
    to: bid("http-response"),
    status: "static",
    ...(path === undefined ? {} : { path, origin: fid("userData.user") }),
  }
  return buildFlowModel({
    nodes: [fieldNode("userData.user"), boundaryNode("http-response", "client-response")],
    edges: [edge],
    unknowns: [],
  })
}

function reachClaim(flow: ReturnType<typeof wholeFieldFlow>, events: ObservationEvent[]) {
  const { claims } = buildClaimsModel({ flow, observation: buildObservationModel(events) })
  return claims.find((c) => c.kind === "field-reaches-boundary" && c.subject === "userData.user")
}

describe("claims record which paths were observed", () => {
  it("lists observed paths, capability-qualified, sorted and distinct", () => {
    const claim = reachClaim(wholeFieldFlow(), [
      ev("userData.user.name"),
      ev("userData.user.email"),
      ev("userData.user.email", { scope: "other" }),
    ])
    expect(claim?.observedPaths).toEqual(["userData.user.email", "userData.user.name"])
  })

  it("an observation narrower than a whole-field claim is partial coverage, the verification is unchanged", () => {
    const claim = reachClaim(wholeFieldFlow(), [ev("userData.user.email")])
    expect(claim).toMatchObject({ verification: "verified", pathCoverage: "partial" })
  })

  it("an observation of the field itself is whole coverage", () => {
    const claim = reachClaim(wholeFieldFlow(), [ev("userData.user")])
    expect(claim).toMatchObject({ verification: "verified", pathCoverage: "whole" })
  })

  it("whole coverage needs only one observation of the whole field among narrower ones", () => {
    const claim = reachClaim(wholeFieldFlow(), [ev("userData.user.email"), ev("userData.user")])
    expect(claim?.pathCoverage).toBe("whole")
  })

  it("a claim scoped by the static edge to a path is whole once that path (or an ancestor) is observed", () => {
    const flow = wholeFieldFlow(["email"])
    expect(reachClaim(flow, [ev("userData.user.email")])?.pathCoverage).toBe("whole")
    expect(reachClaim(flow, [ev("userData.user")])?.pathCoverage).toBe("whole")
  })

  it("an observation deeper than the claim's static path is narrower: partial", () => {
    const claim = reachClaim(wholeFieldFlow(["email"]), [ev("userData.user.email.domain")])
    expect(claim).toMatchObject({ verification: "verified", pathCoverage: "partial" })
  })

  it("an observation of a path the static flow does not carry is not part of the claim", () => {
    const claim = reachClaim(wholeFieldFlow(["email"]), [ev("userData.user.passwordHash")])
    expect(claim?.verification).toBe("unobserved")
    expect(claim?.observedPaths).toBeUndefined()
    expect(claim?.pathCoverage).toBeUndefined()
  })

  it("claims without matching observations carry no path metadata", () => {
    const { claims } = buildClaimsModel({ flow: wholeFieldFlow() })
    expect(claims[0]).not.toHaveProperty("observedPaths")
    expect(claims[0]).not.toHaveProperty("pathCoverage")
  })

  it("observed-only claims name the observed field, not a static scope", () => {
    const { claims } = buildClaimsModel({
      flow: wholeFieldFlow(),
      observation: buildObservationModel([
        { scope: "t", boundary: { kind: "database", name: "pg" }, field: "userData.user.email" },
      ]),
    })
    const only = claims.find((c) => c.object === "pg")
    expect(only?.verification).toBe("contradicted")
    expect(only).not.toHaveProperty("pathCoverage")
  })

  it("a policy claim about a path is partial until the governed path itself is observed", () => {
    const flow = wholeFieldFlow()
    const policy = buildPolicyModel(flow, [
      {
        id: "no-pw",
        appliesTo: { field: "userData.user", path: ["passwordHash"] },
        forbidDestinations: ["database"],
      },
    ])
    const claimFor = (events: ObservationEvent[]) =>
      buildClaimsModel({ flow, policy, observation: buildObservationModel(events) }).claims.find(
        (c) => c.kind === "policy-holds",
      )
    // email is outside the governed path: not evidence either way.
    expect(claimFor([ev("userData.user.email")])).toMatchObject({ verification: "unobserved" })
    expect(claimFor([ev("userData.user.email")])).not.toHaveProperty("observedPaths")
    // the governed path (and one inside it) is observed.
    expect(claimFor([ev("userData.user.passwordHash")])).toMatchObject({
      verification: "verified",
      observedPaths: ["userData.user.passwordHash"],
      pathCoverage: "whole",
    })
    expect(claimFor([ev("userData.user.passwordHash.salt")])).toMatchObject({
      verification: "verified",
      pathCoverage: "partial",
    })
    // an observation of the whole field covers the governed path.
    expect(claimFor([ev("userData.user")])).toMatchObject({ pathCoverage: "whole" })
  })

  it("a whole-field policy claim observed only at one path is partial", () => {
    const flow = wholeFieldFlow()
    const policy = buildPolicyModel(flow, [
      { id: "no-db", appliesTo: { field: "userData.user" }, forbidDestinations: ["database"] },
    ])
    const claim = buildClaimsModel({
      flow,
      policy,
      observation: buildObservationModel([ev("userData.user.email")]),
    }).claims.find((c) => c.kind === "policy-holds")
    expect(claim).toMatchObject({
      verification: "verified",
      observedPaths: ["userData.user.email"],
      pathCoverage: "partial",
    })
  })

  it("a sourced claim records the observed paths too", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("userData.user"), boundaryNode("pg", "database")],
      edges: [
        { kind: "crosses-boundary", from: bid("pg"), to: fid("userData.user"), status: "declared" },
      ],
      unknowns: [],
    })
    const claim = buildClaimsModel({
      flow,
      observation: buildObservationModel([
        { scope: "t", boundary: { kind: "database", name: "pg" }, field: "userData.user.email" },
      ]),
    }).claims.find((c) => c.kind === "field-sourced-from-boundary")
    expect(claim).toMatchObject({
      verification: "verified",
      observedPaths: ["userData.user.email"],
      pathCoverage: "partial",
    })
  })
})

describe("claims record when they were last observed", () => {
  it("lastObservedAt is the latest lastSeen among the supporting observations", () => {
    const claim = reachClaim(wholeFieldFlow(), [
      ev("userData.user.a", { at: Date.parse("2026-01-01T00:00:00Z") }),
      ev("userData.user.b", { at: Date.parse("2026-01-05T00:00:00Z") }),
      ev("userData.user.b", { at: Date.parse("2026-01-03T00:00:00Z") }),
    ])
    expect(claim?.lastObservedAt).toBe("2026-01-05T00:00:00.000Z")
  })

  it("is absent when no supporting observation carried a time", () => {
    expect(reachClaim(wholeFieldFlow(), [ev("userData.user.a")])).not.toHaveProperty(
      "lastObservedAt",
    )
  })

  it("ignores untimed observations alongside timed ones", () => {
    const claim = reachClaim(wholeFieldFlow(), [
      ev("userData.user.a"),
      ev("userData.user.b", { at: Date.parse("2026-01-02T00:00:00Z") }),
    ])
    expect(claim?.lastObservedAt).toBe("2026-01-02T00:00:00.000Z")
  })

  it("is carried by policy claims", () => {
    const flow = wholeFieldFlow()
    const policy = buildPolicyModel(flow, [
      { id: "no-db", appliesTo: { field: "userData.user" }, forbidDestinations: ["database"] },
    ])
    const claim = buildClaimsModel({
      flow,
      policy,
      observation: buildObservationModel([
        ev("userData.user.email", { at: Date.parse("2026-02-01T00:00:00Z") }),
      ]),
    }).claims.find((c) => c.kind === "policy-holds")
    expect(claim?.lastObservedAt).toBe("2026-02-01T00:00:00.000Z")
  })
})
