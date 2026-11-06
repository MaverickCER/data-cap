import { describe, expect, it } from "vitest"
import { buildClaimsModel, CLAIMS_MODEL_SCHEMA_VERSION } from "../../src/flow/claims-model.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowBoundaryKind, FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { flowIndex } from "../../src/flow/flow-projections.js"
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

describe("buildClaimsModel, the exact model of a rich scenario", () => {
  const A = "src/a.ts"
  const B = "src/b.ts"
  const user = (scope: string): FlowNodeInput => ({
    kind: "field",
    scope,
    name: "userData.user",
    status: "static",
    classification: "pii",
  })
  const team: FlowNodeInput = { kind: "field", scope: A, name: "userData.team", status: "static" }
  const boundaryOf = (name: string, boundaryKind: FlowBoundaryKind): FlowNodeInput => ({
    kind: "boundary",
    scope: "boundary",
    name,
    status: "declared",
    boundaryKind,
  })
  const idOf = (scope: string, name: string): string => flowNodeId("field", scope, name)
  const edgeFrom = (
    kind: FlowEdgeInput["kind"],
    from: string,
    to: string,
    origin: string,
    path: string[],
    status: FlowEdgeInput["status"] = "static",
  ): FlowEdgeInput => ({ kind, from, to, origin, path, status })

  const scenario = () => {
    const flowModel = buildFlowModel({
      nodes: [
        user(A),
        user(B),
        team,
        boundaryOf("http", "client-response"),
        boundaryOf("db", "database"),
        boundaryOf("audit", "log"),
      ],
      edges: [
        edgeFrom("side-effect", idOf(A, "userData.user"), bid("http"), idOf(A, "userData.user"), [
          "email",
        ]),
        edgeFrom("side-effect", idOf(B, "userData.user"), bid("http"), idOf(B, "userData.user"), [
          "email",
        ]),
        edgeFrom(
          "side-effect",
          idOf(A, "userData.user"),
          bid("audit"),
          idOf(A, "userData.user"),
          ["name"],
          "inferred",
        ),
        edgeFrom(
          "crosses-boundary",
          bid("db"),
          idOf(A, "userData.user"),
          idOf(A, "userData.user"),
          ["id"],
          "declared",
        ),
        edgeFrom(
          "side-effect",
          idOf(A, "userData.team"),
          bid("http"),
          idOf(A, "userData.team"),
          [],
        ),
      ],
      unknowns: [],
    })
    const at = (
      scope: string,
      kind: FlowBoundaryKind,
      name: string,
      field: string,
      time?: number,
      handling?: "hashed",
    ): ObservationEvent => ({
      scope,
      boundary: { kind, name },
      field,
      ...(time === undefined ? {} : { at: time }),
      ...(handling === undefined ? {} : { handling }),
    })
    const observation = buildObservationModel(
      [
        at("s1", "client-response", "http", "userData.user.email", 1000),
        at("s1", "client-response", "http", "userData.user.email", 5000),
        at("s2", "client-response", "http", "userData.user.email", 3000),
        at("s1", "database", "db", "userData.user.id"),
        at("s1", "log", "audit", "userData.user.name", 2000, "hashed"),
        at("s3", "client-response", "http", "userData.team.x", 4000),
        at("s1", "queue", "mq", "userData.user.email", 9000),
        at("s1", "queue", "mq", "userData.user.email", 2000),
        at("s1", "client-response", "http", "other.thing"),
      ],
      [
        {
          scope: "s3",
          boundary: { kind: "client-response", name: "http" },
          field: "userData.team",
          reason: "max-depth",
        },
      ],
    )
    const rules: FlowPolicyRule[] = [
      {
        id: "pii-not-to-client",
        appliesTo: { classification: "pii" },
        forbidDestinations: ["client-response"],
      },
      {
        id: "name-not-to-log",
        appliesTo: { field: "user", path: ["name"] },
        forbidDestinations: ["log"],
      },
    ]
    return { flow: flowModel, observation, policy: buildPolicyModel(flowModel, rules) }
  }

  it("is exactly this", () => {
    expect(buildClaimsModel(scenario())).toMatchInlineSnapshot(`
      {
        "claims": [
          {
            "contradicting": [],
            "derivedFrom": [
              "flow",
              "observation",
            ],
            "id": "claim:field-reaches-boundary:other.thing->client-response:http",
            "kind": "field-reaches-boundary",
            "object": "http",
            "scope": {
              "observationScopes": [
                "s1",
              ],
              "traceComplete": false,
            },
            "statement": "other.thing reaches client-response http",
            "status": "observed",
            "subject": "other.thing",
            "supporting": [
              {
                "id": "observation:s1|client-response:http|other.thing|-",
                "model": "observation",
              },
            ],
            "verification": "observed-only",
          },
          {
            "contradicting": [],
            "derivedFrom": [
              "flow",
              "observation",
            ],
            "id": "claim:field-reaches-boundary:userData.team->client-response:http",
            "kind": "field-reaches-boundary",
            "lastObservedAt": "1970-01-01T00:00:04.000Z",
            "object": "http",
            "observedPaths": [
              "userData.team.x",
            ],
            "pathCoverage": "partial",
            "scope": {
              "observationScopes": [
                "s3",
              ],
              "traceComplete": true,
              "truncatedScopes": [
                "s3",
              ],
            },
            "statement": "userData.team reaches client-response http",
            "status": "static",
            "subject": "userData.team",
            "supporting": [
              {
                "id": "side-effect:field:src/a.ts#userData.team->boundary:boundary#http:@static^field:src/a.ts#userData.team",
                "model": "flow",
              },
              {
                "id": "observation:s3|client-response:http|userData.team.x|-",
                "model": "observation",
              },
            ],
            "verification": "indeterminate",
          },
          {
            "contradicting": [],
            "derivedFrom": [
              "flow",
              "observation",
            ],
            "id": "claim:field-reaches-boundary:userData.user->client-response:http",
            "kind": "field-reaches-boundary",
            "lastObservedAt": "1970-01-01T00:00:05.000Z",
            "object": "http",
            "observedPaths": [
              "userData.user.email",
            ],
            "pathCoverage": "whole",
            "scope": {
              "observationScopes": [
                "s1",
                "s2",
              ],
              "traceComplete": true,
            },
            "statement": "userData.user reaches client-response http",
            "status": "static",
            "subject": "userData.user",
            "supporting": [
              {
                "id": "side-effect:field:src/b.ts#userData.user->boundary:boundary#http:email@static^field:src/b.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "observation:s1|client-response:http|userData.user.email|-",
                "model": "observation",
              },
              {
                "id": "observation:s2|client-response:http|userData.user.email|-",
                "model": "observation",
              },
            ],
            "verification": "verified",
          },
          {
            "contradicting": [],
            "derivedFrom": [
              "flow",
              "observation",
            ],
            "id": "claim:field-reaches-boundary:userData.user->client-response:http",
            "kind": "field-reaches-boundary",
            "lastObservedAt": "1970-01-01T00:00:05.000Z",
            "object": "http",
            "observedPaths": [
              "userData.user.email",
            ],
            "pathCoverage": "whole",
            "scope": {
              "observationScopes": [
                "s1",
                "s2",
              ],
              "traceComplete": true,
            },
            "statement": "userData.user reaches client-response http",
            "status": "static",
            "subject": "userData.user",
            "supporting": [
              {
                "id": "side-effect:field:src/a.ts#userData.user->boundary:boundary#http:email@static^field:src/a.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "observation:s1|client-response:http|userData.user.email|-",
                "model": "observation",
              },
              {
                "id": "observation:s2|client-response:http|userData.user.email|-",
                "model": "observation",
              },
            ],
            "verification": "verified",
          },
          {
            "contradicting": [],
            "derivedFrom": [
              "flow",
              "observation",
            ],
            "id": "claim:field-reaches-boundary:userData.user->log:audit",
            "kind": "field-reaches-boundary",
            "lastObservedAt": "1970-01-01T00:00:02.000Z",
            "object": "audit",
            "observedPaths": [
              "userData.user.name",
            ],
            "pathCoverage": "whole",
            "scope": {
              "observationScopes": [
                "s1",
              ],
              "traceComplete": true,
            },
            "statement": "userData.user reaches log audit",
            "status": "inferred",
            "subject": "userData.user",
            "supporting": [
              {
                "id": "side-effect:field:src/a.ts#userData.user->boundary:boundary#audit:name@inferred^field:src/a.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "observation:s1|log:audit|userData.user.name|hashed",
                "model": "observation",
              },
            ],
            "verification": "verified",
          },
          {
            "contradicting": [
              {
                "id": "field:src/a.ts#userData.user",
                "model": "flow",
              },
            ],
            "derivedFrom": [
              "flow",
              "observation",
            ],
            "id": "claim:field-reaches-boundary:userData.user.email->queue:mq",
            "kind": "field-reaches-boundary",
            "lastObservedAt": "1970-01-01T00:00:09.000Z",
            "object": "mq",
            "scope": {
              "observationScopes": [
                "s1",
              ],
              "traceComplete": true,
            },
            "statement": "userData.user.email reaches queue mq",
            "status": "observed",
            "subject": "userData.user.email",
            "supporting": [
              {
                "id": "observation:s1|queue:mq|userData.user.email|-",
                "model": "observation",
              },
            ],
            "verification": "contradicted",
          },
          {
            "contradicting": [],
            "derivedFrom": [
              "flow",
              "observation",
            ],
            "id": "claim:field-sourced-from-boundary:userData.user<-database:db",
            "kind": "field-sourced-from-boundary",
            "object": "db",
            "observedPaths": [
              "userData.user.id",
            ],
            "pathCoverage": "whole",
            "scope": {
              "observationScopes": [
                "s1",
              ],
              "traceComplete": true,
            },
            "statement": "userData.user is sourced from database db",
            "status": "declared",
            "subject": "userData.user",
            "supporting": [
              {
                "id": "crosses-boundary:boundary:boundary#db->field:src/a.ts#userData.user:id@declared^field:src/a.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "observation:s1|database:db|userData.user.id|-",
                "model": "observation",
              },
            ],
            "verification": "verified",
          },
          {
            "contradicting": [
              {
                "id": "pii-not-to-client#field:src/b.ts#userData.user",
                "model": "policy",
              },
              {
                "id": "side-effect:field:src/b.ts#userData.user->boundary:boundary#http:email@static^field:src/b.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "observation:s1|client-response:http|userData.user.email|-",
                "model": "observation",
              },
              {
                "id": "observation:s2|client-response:http|userData.user.email|-",
                "model": "observation",
              },
            ],
            "derivedFrom": [
              "flow",
              "policy",
              "observation",
            ],
            "id": "claim:policy-holds:pii-not-to-client:userData.user",
            "kind": "policy-holds",
            "lastObservedAt": "1970-01-01T00:00:09.000Z",
            "object": "pii-not-to-client",
            "observedPaths": [
              "userData.user.email",
              "userData.user.id",
              "userData.user.name",
            ],
            "pathCoverage": "partial",
            "scope": {
              "observationScopes": [
                "s1",
                "s2",
              ],
              "traceComplete": true,
            },
            "statement": "Rule pii-not-to-client holds for userData.user",
            "status": "static",
            "subject": "userData.user",
            "supporting": [
              {
                "id": "pii-not-to-client#field:src/b.ts#userData.user",
                "model": "policy",
              },
              {
                "id": "observation:s1|database:db|userData.user.id|-",
                "model": "observation",
              },
              {
                "id": "observation:s1|log:audit|userData.user.name|hashed",
                "model": "observation",
              },
              {
                "id": "observation:s1|queue:mq|userData.user.email|-",
                "model": "observation",
              },
            ],
            "verification": "contradicted",
          },
          {
            "contradicting": [
              {
                "id": "pii-not-to-client#field:src/a.ts#userData.user",
                "model": "policy",
              },
              {
                "id": "side-effect:field:src/a.ts#userData.user->boundary:boundary#http:email@static^field:src/a.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "observation:s1|client-response:http|userData.user.email|-",
                "model": "observation",
              },
              {
                "id": "observation:s2|client-response:http|userData.user.email|-",
                "model": "observation",
              },
            ],
            "derivedFrom": [
              "flow",
              "policy",
              "observation",
            ],
            "id": "claim:policy-holds:pii-not-to-client:userData.user",
            "kind": "policy-holds",
            "lastObservedAt": "1970-01-01T00:00:09.000Z",
            "object": "pii-not-to-client",
            "observedPaths": [
              "userData.user.email",
              "userData.user.id",
              "userData.user.name",
            ],
            "pathCoverage": "partial",
            "scope": {
              "observationScopes": [
                "s1",
                "s2",
              ],
              "traceComplete": true,
            },
            "statement": "Rule pii-not-to-client holds for userData.user",
            "status": "static",
            "subject": "userData.user",
            "supporting": [
              {
                "id": "pii-not-to-client#field:src/a.ts#userData.user",
                "model": "policy",
              },
              {
                "id": "observation:s1|database:db|userData.user.id|-",
                "model": "observation",
              },
              {
                "id": "observation:s1|log:audit|userData.user.name|hashed",
                "model": "observation",
              },
              {
                "id": "observation:s1|queue:mq|userData.user.email|-",
                "model": "observation",
              },
            ],
            "verification": "contradicted",
          },
        ],
        "schemaVersion": 1,
        "summary": {
          "contradicted": 3,
          "indeterminate": 1,
          "inferred": 0,
          "observed-only": 1,
          "unobserved": 0,
          "verified": 4,
        },
      }
    `)
  })
})

describe("buildClaimsModel, the details the scenario does not reach", () => {
  const A = "src/a.ts"
  const B = "src/b.ts"
  const fieldIn = (scope: string, name: string): FlowNodeInput => ({
    kind: "field",
    scope,
    name,
    status: "static",
  })
  const http: FlowNodeInput = {
    kind: "boundary",
    scope: "boundary",
    name: "http",
    status: "declared",
    boundaryKind: "client-response",
  }
  const sideEffect = (scope: string, name: string, path: string[] | undefined): FlowEdgeInput => ({
    kind: "side-effect",
    from: flowNodeId("field", scope, name),
    to: flowNodeId("boundary", "boundary", "http"),
    origin: flowNodeId("field", scope, name),
    status: "static",
    ...(path === undefined ? {} : { path }),
  })
  const event = (
    scope: string,
    field: string,
    at?: number,
    kind: FlowBoundaryKind = "client-response",
    name = "http",
  ): ObservationEvent => ({
    scope,
    boundary: { kind, name },
    field,
    ...(at === undefined ? {} : { at }),
  })

  it("marks a claim indeterminate when a cut in the middle of a scope's cuts concerns it, not only the first or the last", () => {
    const flowModel = buildFlowModel({
      nodes: [fieldIn(A, "userData.team"), http],
      edges: [sideEffect(A, "userData.team", [])],
      unknowns: [],
    })
    const skip = (field: string) => ({
      scope: "s3",
      boundary: { kind: "client-response", name: "http" } as const,
      field,
      reason: "max-depth" as const,
    })
    const observation = buildObservationModel(
      [event("s3", "userData.team.x"), event("s4", "userData.team.x")],
      [skip("userData.aaa"), skip("userData.team"), skip("userData.zzz")],
    )
    const [claim] = buildClaimsModel({ flow: flowModel, observation }).claims
    expect(claim?.verification).toBe("indeterminate")
    expect(claim?.scope.truncatedScopes).toEqual(["s3"])
  })

  it("anchors a contradiction on the first field in model order, whatever order the names are tried in", () => {
    const flowModel = buildFlowModel({
      nodes: [fieldIn(A, "userData.user.profile"), fieldIn(B, "userData.user"), http],
      edges: [],
      unknowns: [],
    })
    const observation = buildObservationModel([event("s", "userData.user.profile.x")])
    const { claims } = buildClaimsModel({ flow: flowModel, observation })
    expect(claims).toHaveLength(1)
    expect(claims[0]?.verification).toBe("contradicted")
    expect(claims[0]?.contradicting).toEqual([
      { model: "flow", id: flowNodeId("field", A, "userData.user.profile") },
    ])
  })

  describe("how much of the required path an observation covers", () => {
    const flowModel = buildFlowModel({
      nodes: [fieldIn(A, "userData.user"), http],
      edges: [sideEffect(A, "userData.user", ["email", "domain"])],
      unknowns: [],
    })
    const coverage = (field: string) =>
      buildClaimsModel({
        flow: flowModel,
        observation: buildObservationModel([event("s", field)]),
      }).claims.find((claim) => claim.subject === "userData.user")?.pathCoverage

    it.each([
      ["the whole field", "userData.user", "whole"],
      ["a part of the path", "userData.user.email", "whole"],
      ["the path itself", "userData.user.email.domain", "whole"],
      ["something inside the path", "userData.user.email.domain.tld", "partial"],
    ])("%s is %s", (_label, field, expected) => {
      expect(coverage(field)).toBe(expected)
    })
  })

  it("calls a path only partly covered when it must cover every edge of the route, not just one", () => {
    const through = flowNodeId("function", A, "f")
    const origin = flowNodeId("field", A, "userData.user")
    const flowModel = buildFlowModel({
      nodes: [
        fieldIn(A, "userData.user"),
        { kind: "function", scope: A, name: "f", status: "static" },
        http,
      ],
      edges: [
        { kind: "reads", from: origin, to: through, origin, status: "static", path: ["email"] },
        {
          kind: "side-effect",
          from: through,
          to: flowNodeId("boundary", "boundary", "http"),
          origin,
          status: "static",
          path: ["email", "domain"],
        },
      ],
      unknowns: [],
    })
    const coverage = (field: string) =>
      buildClaimsModel({
        flow: flowModel,
        observation: buildObservationModel([event("s", field)]),
      }).claims.find((claim) => claim.subject === "userData.user")?.pathCoverage
    expect(coverage("userData.user.email")).toBe("whole")
    expect(coverage("userData.user.email.domain")).toBe("partial")
  })

  it("takes the latest time of the observations behind a claim, ignoring those with none", () => {
    const flowModel = buildFlowModel({
      nodes: [fieldIn(A, "userData.user"), http],
      edges: [sideEffect(A, "userData.user", ["email"])],
      unknowns: [],
    })
    const claim = (events: ObservationEvent[]) =>
      buildClaimsModel({ flow: flowModel, observation: buildObservationModel(events) }).claims.find(
        (candidate) => candidate.subject === "userData.user",
      )
    const timed = [
      event("s0", "userData.user.email", 12000),
      event("s1", "userData.user.email", 9000),
      event("s2", "userData.user.email", 2000),
    ]
    expect(claim(timed)?.lastObservedAt).toBe("1970-01-01T00:00:12.000Z")
    expect(claim([...timed, event("s3", "userData.user.email")])?.lastObservedAt).toBe(
      "1970-01-01T00:00:12.000Z",
    )
    expect(claim([event("s3", "userData.user.email")])?.lastObservedAt).toBeUndefined()
  })

  it("takes the latest time of the observations behind an observed-only claim, ignoring those with none", () => {
    const flowModel = buildFlowModel({
      nodes: [fieldIn(A, "userData.user"), http],
      edges: [],
      unknowns: [],
    })
    const run = (events: ObservationEvent[]) =>
      buildClaimsModel({ flow: flowModel, observation: buildObservationModel(events) }).claims[0]
    const timed = [
      event("s0", "userData.user.email", 12000),
      event("s1", "userData.user.email", 9000),
      event("s2", "userData.user.email", 2000),
    ]
    expect(run(timed)?.lastObservedAt).toBe("1970-01-01T00:00:12.000Z")
    expect(run([...timed, event("s3", "userData.user.email")])?.lastObservedAt).toBe(
      "1970-01-01T00:00:12.000Z",
    )
    expect(run([event("s3", "userData.user.email")])?.lastObservedAt).toBeUndefined()
  })

  it("follows the flow once for each path observed, however many observations share it", () => {
    const flowModel = buildFlowModel({
      nodes: [fieldIn(A, "userData.user"), http],
      edges: [sideEffect(A, "userData.user", ["email"])],
      unknowns: [],
    })
    const index = flowIndex(flowModel)
    let reads = 0
    const counted = new Proxy(index.outgoing, {
      get(target, property) {
        if (property === "get") reads += 1
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value
      },
    })
    Object.defineProperty(index, "outgoing", { value: counted })
    const run = (scopes: string[]) => {
      reads = 0
      buildClaimsModel({
        flow: flowModel,
        observation: buildObservationModel(
          scopes.map((scope) => event(scope, "userData.user.email")),
        ),
      })
      return reads
    }
    expect(run(["a", "b", "c", "d"])).toBe(run(["a"]))
  })
})
