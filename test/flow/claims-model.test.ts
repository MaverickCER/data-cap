import { describe, expect, it } from "vitest"
import { buildClaimsModel, CLAIMS_MODEL_SCHEMA_VERSION } from "../../src/flow/claims-model.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowBoundaryKind, FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"
import type { FlowPolicyRule } from "../../src/flow/policy-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const FILE = "src/user.ts"
const field = (name: string, classification?: string): FlowNodeInput => ({
  kind: "field",
  scope: FILE,
  name,
  status: "static",
  ...(classification === undefined ? {} : { classification }),
})
const fn = (name: string, status: FlowNodeInput["status"] = "static"): FlowNodeInput => ({
  kind: "function",
  scope: FILE,
  name,
  status,
})
const boundary = (name: string, boundaryKind: FlowBoundaryKind): FlowNodeInput => ({
  kind: "boundary",
  scope: "boundary",
  name,
  status: "declared",
  boundaryKind,
})
const fid = (name: string): string => flowNodeId("field", FILE, name)
const bid = (name: string): string => flowNodeId("boundary", "boundary", name)
const edge = (
  kind: FlowEdgeInput["kind"],
  from: string,
  to: string,
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput => ({ kind, from, to, status: "static", ...extra })

function flow(
  status: FlowEdgeInput["status"] = "static",
  extraNodes: FlowNodeInput[] = [],
  extraEdges: FlowEdgeInput[] = [],
) {
  return buildFlowModel({
    nodes: [
      field("userData.email", "pii"),
      field("userData.name"),
      boundary("http-response", "client-response"),
      boundary("stripe", "external-service"),
      ...extraNodes,
    ],
    edges: [
      edge("side-effect", fid("userData.email"), bid("http-response"), { status }),
      ...extraEdges,
    ],
    unknowns: [],
  })
}

const observed = (overrides: Partial<ObservationEvent> = {}): ObservationEvent => ({
  scope: "test:profile",
  boundary: { kind: "client-response", name: "http-response" },
  field: "userData.email",
  ...overrides,
})

const rule: FlowPolicyRule = {
  id: "pii-not-to-client",
  appliesTo: { classification: "pii" },
  forbidDestinations: ["client-response"],
}

describe("buildClaimsModel: field-reaches-boundary", () => {
  it("stamps the schema version", () => {
    expect(buildClaimsModel({ flow: flow() }).schemaVersion).toBe(CLAIMS_MODEL_SCHEMA_VERSION)
  })

  it("makes a static, unobserved claim when no observation model was supplied", () => {
    const { claims } = buildClaimsModel({ flow: flow() })
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({
      kind: "field-reaches-boundary",
      subject: "userData.email",
      object: "http-response",
      status: "static",
      verification: "unobserved",
      scope: { observationScopes: [], traceComplete: true },
      derivedFrom: ["flow"],
    })
    expect(claims[0]?.supporting.map((ref) => ref.model)).toEqual(["flow"])
    expect(claims[0]?.contradicting).toEqual([])
  })

  it("is verified when an observation corroborates the static path", () => {
    const { claims } = buildClaimsModel({
      flow: flow(),
      observation: buildObservationModel([observed()]),
    })
    expect(claims[0]).toMatchObject({
      verification: "verified",
      scope: { observationScopes: ["test:profile"] },
      derivedFrom: ["flow", "observation"],
    })
    expect(claims[0]?.supporting.map((ref) => ref.model).sort()).toEqual(["flow", "observation"])
  })

  it("treats a declared path the same as a static one", () => {
    const { claims } = buildClaimsModel({ flow: flow("declared") })
    expect(claims[0]).toMatchObject({ status: "declared", verification: "unobserved" })
  })

  it("is only inferred when the path rests on an inferred edge and nothing was observed", () => {
    const { claims } = buildClaimsModel({ flow: flow("inferred") })
    expect(claims[0]).toMatchObject({ status: "inferred", verification: "inferred" })
  })

  it("promotes an inferred path to verified when it was observed", () => {
    const { claims } = buildClaimsModel({
      flow: flow("inferred"),
      observation: buildObservationModel([observed()]),
    })
    expect(claims[0]).toMatchObject({ status: "inferred", verification: "verified" })
  })

  it("makes no reach claim for a path that depends on an unknown edge", () => {
    const { claims } = buildClaimsModel({ flow: flow("unknown") })
    expect(claims).toEqual([])
  })

  it("marks the claim's scope incomplete when the trace touches an unknown fact", () => {
    const withUnknown = flow(
      "static",
      [fn("mystery", "unknown")],
      [edge("passes", fid("userData.email"), flowNodeId("function", FILE, "mystery"))],
    )
    const { claims } = buildClaimsModel({ flow: withUnknown })
    expect(claims[0]?.scope.traceComplete).toBe(false)
  })

  it("does not match an observation whose boundary kind differs from the static boundary", () => {
    const { claims } = buildClaimsModel({
      flow: flow(),
      observation: buildObservationModel([
        observed({ boundary: { kind: "database", name: "http-response" } }),
      ]),
    })
    const reach = claims.find(
      (c) => c.object === "http-response" && c.verification !== "observed-only",
    )
    expect(reach?.verification).toBe("unobserved")
  })

  it("an observation with no static path is contradicted when the field's static trace is complete", () => {
    const { claims } = buildClaimsModel({
      flow: flow(),
      observation: buildObservationModel([
        observed({ boundary: { kind: "external-service", name: "stripe" } }),
      ]),
    })
    const stripe = claims.find((c) => c.object === "stripe")
    expect(stripe).toMatchObject({
      kind: "field-reaches-boundary",
      status: "observed",
      verification: "contradicted",
    })
    // Supported by the observation; contradicted by the complete static trace from the field, which has no such path.
    expect(stripe?.supporting.map((ref) => ref.model)).toEqual(["observation"])
    expect(stripe?.contradicting).toEqual([{ model: "flow", id: fid("userData.email") }])
  })

  it("an observation with no static path is observed-only when the static trace is incomplete", () => {
    const incomplete = flow(
      "static",
      [fn("mystery", "unknown")],
      [edge("passes", fid("userData.email"), flowNodeId("function", FILE, "mystery"))],
    )
    const { claims } = buildClaimsModel({
      flow: incomplete,
      observation: buildObservationModel([
        observed({ boundary: { kind: "external-service", name: "stripe" } }),
      ]),
    })
    expect(claims.find((c) => c.object === "stripe")).toMatchObject({
      verification: "observed-only",
      scope: { traceComplete: false },
    })
  })

  it("an observation of a field or boundary the Flow Model does not know is observed-only", () => {
    const { claims } = buildClaimsModel({
      flow: flow(),
      observation: buildObservationModel([observed({ field: "userData.secretNote" })]),
    })
    expect(claims.find((c) => c.subject === "userData.secretNote")).toMatchObject({
      verification: "observed-only",
      status: "observed",
    })
  })

  it("collects observations from every scope as supporting evidence", () => {
    const { claims } = buildClaimsModel({
      flow: flow(),
      observation: buildObservationModel([observed(), observed({ scope: "test:other" })]),
    })
    expect(claims[0]?.scope.observationScopes).toEqual(["test:other", "test:profile"])
    expect(claims[0]?.supporting.filter((ref) => ref.model === "observation")).toHaveLength(2)
  })

  it("gives a claim a content-addressed id and orders claims by it", () => {
    const { claims } = buildClaimsModel({
      flow: flow("static", [], [edge("side-effect", fid("userData.name"), bid("stripe"))]),
    })
    expect(claims.map((c) => c.id)).toEqual([...claims.map((c) => c.id)].sort())
    expect(claims[0]?.id).toMatch(/^claim:field-reaches-boundary:/)
  })
})

describe("buildClaimsModel: policy-holds", () => {
  it("is unobserved when the rule is satisfied and nothing was observed", () => {
    const flowModel = buildFlowModel({
      nodes: [field("userData.email", "pii"), boundary("pg", "database")],
      edges: [edge("side-effect", fid("userData.email"), bid("pg"))],
      unknowns: [],
    })
    const { claims } = buildClaimsModel({
      flow: flowModel,
      policy: buildPolicyModel(flowModel, [rule]),
    })
    expect(claims.find((c) => c.kind === "policy-holds")).toMatchObject({
      subject: "userData.email",
      object: "pii-not-to-client",
      verification: "unobserved",
      derivedFrom: ["flow", "policy"],
    })
  })

  it("is verified when satisfied and observations of the field do not violate the rule", () => {
    const flowModel = buildFlowModel({
      nodes: [field("userData.email", "pii"), boundary("pg", "database")],
      edges: [edge("side-effect", fid("userData.email"), bid("pg"))],
      unknowns: [],
    })
    const { claims } = buildClaimsModel({
      flow: flowModel,
      policy: buildPolicyModel(flowModel, [rule]),
      observation: buildObservationModel([
        observed({ boundary: { kind: "database", name: "pg" } }),
      ]),
    })
    expect(claims.find((c) => c.kind === "policy-holds")?.verification).toBe("verified")
  })

  it("is contradicted when static evaluation found a violation", () => {
    const flowModel = flow()
    const { claims } = buildClaimsModel({
      flow: flowModel,
      policy: buildPolicyModel(flowModel, [rule]),
    })
    const claim = claims.find((c) => c.kind === "policy-holds")
    expect(claim).toMatchObject({ verification: "contradicted", status: "static" })
    expect(claim?.contradicting.length).toBeGreaterThan(0)
    expect(
      claim?.contradicting.every((ref) => ref.model === "flow" || ref.model === "policy"),
    ).toBe(true)
  })

  it("is contradicted when an observation violates a statically satisfied rule", () => {
    const flowModel = buildFlowModel({
      nodes: [field("userData.email", "pii"), boundary("pg", "database")],
      edges: [edge("side-effect", fid("userData.email"), bid("pg"))],
      unknowns: [],
    })
    const { claims } = buildClaimsModel({
      flow: flowModel,
      policy: buildPolicyModel(flowModel, [rule]),
      observation: buildObservationModel([observed()]),
    })
    const claim = claims.find((c) => c.kind === "policy-holds")
    expect(claim?.verification).toBe("contradicted")
    expect(claim?.contradicting.map((ref) => ref.model)).toEqual(["observation"])
  })

  it("is indeterminate when static evaluation could not decide and nothing contradicts", () => {
    const flowModel = buildFlowModel({
      nodes: [field("userData.email", "pii"), fn("mystery", "unknown")],
      edges: [edge("passes", fid("userData.email"), flowNodeId("function", FILE, "mystery"))],
      unknowns: [],
    })
    const { claims } = buildClaimsModel({
      flow: flowModel,
      policy: buildPolicyModel(flowModel, [rule]),
    })
    expect(claims.find((c) => c.kind === "policy-holds")).toMatchObject({
      verification: "indeterminate",
      scope: { traceComplete: false },
    })
  })

  it("makes no claim for a rule that matches nothing", () => {
    const flowModel = flow()
    const typo: FlowPolicyRule = { ...rule, id: "typo", appliesTo: { classification: "nope" } }
    const { claims } = buildClaimsModel({
      flow: flowModel,
      policy: buildPolicyModel(flowModel, [typo]),
    })
    expect(claims.filter((c) => c.kind === "policy-holds")).toEqual([])
  })
})

describe("buildClaimsModel: summary and determinism", () => {
  it("counts claims by verification", () => {
    const flowModel = flow()
    const { summary } = buildClaimsModel({
      flow: flowModel,
      policy: buildPolicyModel(flowModel, [rule]),
      observation: buildObservationModel([observed(), observed({ field: "userData.ghost" })]),
    })
    expect(summary).toEqual({
      verified: 1,
      inferred: 0,
      unobserved: 0,
      contradicted: 1,
      "observed-only": 1,
      indeterminate: 0,
    })
  })

  it("is deterministic", () => {
    const flowModel = flow()
    const inputs = {
      flow: flowModel,
      policy: buildPolicyModel(flowModel, [rule]),
      observation: buildObservationModel([observed()]),
    }
    expect(buildClaimsModel(inputs)).toEqual(buildClaimsModel(inputs))
  })
})

describe("buildClaimsModel: observations at a path inside a field", () => {
  // userData.user flows to the client by the "email" path only.
  const pathFlow = buildFlowModel({
    nodes: [field("userData.user", "pii"), boundary("http-response", "client-response")],
    edges: [
      edge("side-effect", fid("userData.user"), bid("http-response"), {
        path: ["email"],
        origin: fid("userData.user"),
      }),
    ],
    unknowns: [],
  })
  const obs = (fieldName: string) =>
    buildObservationModel([
      {
        scope: "t",
        boundary: { kind: "client-response", name: "http-response" },
        field: fieldName,
      },
    ])

  it("an observation of a path the static flow carries verifies the field-level claim", () => {
    const { claims } = buildClaimsModel({ flow: pathFlow, observation: obs("userData.user.email") })
    expect(claims.filter((c) => c.kind === "field-reaches-boundary")).toHaveLength(1)
    expect(claims[0]).toMatchObject({ subject: "userData.user", verification: "verified" })
  })

  it("an observation of a path the static flow does not carry contradicts a complete trace, as its own claim", () => {
    const { claims } = buildClaimsModel({
      flow: pathFlow,
      observation: obs("userData.user.passwordHash"),
    })
    const observed = claims.find((c) => c.subject === "userData.user.passwordHash")
    expect(observed).toMatchObject({ status: "observed", verification: "contradicted" })
    expect(observed?.contradicting).toEqual([{ model: "flow", id: fid("userData.user") }])
    // The static claim for the email path is untouched and still unobserved.
    expect(claims.find((c) => c.subject === "userData.user")).toMatchObject({
      verification: "unobserved",
    })
  })

  it("an observation of the whole field matches a static flow of any of its paths", () => {
    const { claims } = buildClaimsModel({ flow: pathFlow, observation: obs("userData.user") })
    expect(claims.find((c) => c.subject === "userData.user")).toMatchObject({
      verification: "verified",
    })
  })

  it("does not treat a field whose name merely starts with the same letters as a subtree", () => {
    const { claims } = buildClaimsModel({
      flow: pathFlow,
      observation: obs("userData.userExtra.email"),
    })
    expect(claims.find((c) => c.subject === "userData.userExtra.email")).toMatchObject({
      verification: "observed-only",
    })
  })

  it("a policy scoped to a path is judged only against observations of that path", () => {
    const policy = buildPolicyModel(pathFlow, [
      {
        id: "no-pw",
        appliesTo: { field: "userData.user", path: ["passwordHash"] },
        forbidDestinations: ["client-response"],
      },
    ])
    // An observed email at the client says nothing about a passwordHash rule: it is neither a violation nor evidence the rule holds.
    const unrelated = buildClaimsModel({
      flow: pathFlow,
      policy,
      observation: obs("userData.user.email"),
    })
    expect(unrelated.claims.find((c) => c.kind === "policy-holds")?.verification).toBe("unobserved")
    // A passwordHash observed somewhere the rule allows corroborates it...
    const fine = buildClaimsModel({
      flow: pathFlow,
      policy,
      observation: buildObservationModel([
        {
          scope: "t",
          boundary: { kind: "database", name: "pg" },
          field: "userData.user.passwordHash",
        },
      ]),
    })
    expect(fine.claims.find((c) => c.kind === "policy-holds")?.verification).toBe("verified")
    // ...and one observed at the client violates it.
    const bad = buildClaimsModel({
      flow: pathFlow,
      policy,
      observation: obs("userData.user.passwordHash"),
    })
    expect(bad.claims.find((c) => c.kind === "policy-holds")).toMatchObject({
      verification: "contradicted",
    })
  })

  it("an observation of a deeper path under the governed path violates the rule too", () => {
    const policy = buildPolicyModel(pathFlow, [
      {
        id: "no-pw",
        appliesTo: { field: "userData.user", path: ["passwordHash"] },
        forbidDestinations: ["client-response"],
      },
    ])
    const { claims } = buildClaimsModel({
      flow: pathFlow,
      policy,
      observation: obs("userData.user.passwordHash.salt"),
    })
    expect(claims.find((c) => c.kind === "policy-holds")?.verification).toBe("contradicted")
  })
})

describe("buildClaimsModel: declared sources (field-sourced-from-boundary)", () => {
  const pg = (name = "pg") => boundary(name, "database")
  function sourced(extraEdges: FlowEdgeInput[] = []) {
    return buildFlowModel({
      nodes: [field("userData.user", "pii"), pg(), boundary("http-response", "client-response")],
      edges: [
        edge("crosses-boundary", bid("pg"), fid("userData.user"), {
          status: "declared",
          origin: fid("userData.user"),
        }),
        ...extraEdges,
      ],
      unknowns: [],
    })
  }
  const seen = (
    kind: "database" | "client-response",
    name: string,
    fieldName = "userData.user.email",
  ) => buildObservationModel([{ scope: "t", boundary: { kind, name }, field: fieldName }])

  it("makes a declared, unobserved claim for every declared source", () => {
    const { claims } = buildClaimsModel({ flow: sourced() })
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({
      kind: "field-sourced-from-boundary",
      subject: "userData.user",
      object: "pg",
      status: "declared",
      verification: "unobserved",
      derivedFrom: ["flow"],
    })
    expect(claims[0]?.statement).toBe("userData.user is sourced from database pg")
  })

  it("is verified when the field is observed at that source", () => {
    const { claims } = buildClaimsModel({ flow: sourced(), observation: seen("database", "pg") })
    expect(claims.find((c) => c.kind === "field-sourced-from-boundary")).toMatchObject({
      verification: "verified",
      scope: { observationScopes: ["t"] },
    })
  })

  it("reading a field from its declared source is not a contradiction of the static flow", () => {
    const { claims } = buildClaimsModel({ flow: sourced(), observation: seen("database", "pg") })
    expect(claims.map((c) => c.verification)).not.toContain("contradicted")
    expect(claims.map((c) => c.verification)).not.toContain("observed-only")
    expect(claims.filter((c) => c.kind === "field-reaches-boundary")).toEqual([])
  })

  it("still treats an observation at an undeclared database as unexplained", () => {
    const { claims } = buildClaimsModel({
      flow: sourced(),
      observation: seen("database", "other-db"),
    })
    expect(claims.find((c) => c.object === "other-db")).toMatchObject({
      kind: "field-reaches-boundary",
      verification: "contradicted",
    })
  })

  it("an observation of a path the source does not concern does not verify it", () => {
    const { claims } = buildClaimsModel({
      flow: sourced(),
      observation: seen("database", "pg", "userData.team.name"),
    })
    expect(claims.find((c) => c.kind === "field-sourced-from-boundary")?.verification).toBe(
      "unobserved",
    )
  })

  it("counts sourced claims in the summary alongside the others", () => {
    const { summary } = buildClaimsModel({ flow: sourced(), observation: seen("database", "pg") })
    expect(summary.verified).toBe(1)
  })
})
