import { describe, expect, it } from "vitest"
import { buildFlowModel, flowEdgeId, flowNodeId } from "../../src/flow/flow-model.js"
import type {
  FlowEdgeInput,
  FlowEdgeKind,
  FlowModel,
  FlowNodeInput,
  FlowStatus,
} from "../../src/flow/flow-model.js"
import { buildClaimsModel } from "../../src/flow/claims-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"
import type { FlowPolicyRule, PolicyModel, PolicyResult } from "../../src/flow/policy-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const CAP = "cap.ts"
const scopeOf = (kind: FlowNodeInput["kind"]) => (kind === "boundary" ? "b" : CAP)
const nd = (
  kind: FlowNodeInput["kind"],
  name: string,
  extra: Partial<FlowNodeInput> = {},
): FlowNodeInput => ({ kind, scope: scopeOf(kind), name, status: "static", ...extra })
const nid = (kind: FlowNodeInput["kind"], name: string) => flowNodeId(kind, scopeOf(kind), name)
const fld = (name: string) => nid("field", `userData.${name}`)
const fun = (name: string) => nid("function", name)
const bnd = (name: string) => nid("boundary", name)
const ed = (
  kind: FlowEdgeKind,
  from: string,
  to: string,
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput => ({ kind, from, to, status: "static", ...extra })
const eid = (
  kind: FlowEdgeKind,
  from: string,
  to: string,
  path: string[] | undefined,
  status: FlowStatus,
  origin: string,
) => flowEdgeId(kind, from, to, path, status, origin)
const field = (name: string, extra: Partial<FlowNodeInput> = {}) =>
  nd("field", `userData.${name}`, extra)
const model = (
  nodes: FlowNodeInput[],
  edges: FlowEdgeInput[] = [],
  unknowns: Parameters<typeof buildFlowModel>[0]["unknowns"] = [],
): FlowModel => buildFlowModel({ nodes, edges, unknowns })
const event = (
  fieldName: string,
  boundaryName: string,
  scope = "s",
  kind: ObservationEvent["boundary"]["kind"] = "client-response",
  handling?: ObservationEvent["handling"],
): ObservationEvent => ({
  scope,
  boundary: { kind, name: boundaryName },
  field: fieldName,
  ...(handling === undefined ? {} : { handling }),
})
const obsId = (e: ObservationEvent) =>
  `observation:${e.scope}|${e.boundary.kind}:${e.boundary.name}|${e.field}|${e.handling ?? "-"}`

describe("buildClaimsModel: claims from the flow alone", () => {
  const U = fld("user")
  const flow = model(
    [
      nd("boundary", "form", { boundaryKind: "user-input", status: "declared" }),
      nd("boundary", "anon"),
      field("user"),
      field("other"),
      nd("function", "f"),
      nd("boundary", "http", { boundaryKind: "client-response" }),
      nd("boundary", "mystery"),
      nd("boundary", "pg", { boundaryKind: "database" }),
    ],
    [
      ed("crosses-boundary", bnd("form"), U, { origin: U, status: "declared" }),
      ed("reads", U, fun("f"), { origin: U }),
      ed("side-effect", fun("f"), bnd("http"), { origin: U }),
      ed("side-effect", fun("f"), bnd("mystery"), { origin: U }),
      ed("side-effect", fun("f"), bnd("pg"), { origin: U, status: "inferred" }),
      // a source with no kind, and things that are not declared sources
      ed("crosses-boundary", bnd("anon"), fld("other"), {
        origin: fld("other"),
        status: "declared",
      }),
      ed("passes", bnd("form"), fld("other"), { origin: fld("other") }),
      ed("crosses-boundary", bnd("form"), fun("f"), { origin: U }),
      ed("crosses-boundary", fun("f"), fld("other"), { origin: fld("other") }),
    ],
  )
  const claimsOf = () => buildClaimsModel({ flow })

  it("states every claim exactly, ordered by id", () => {
    const reads = eid("reads", U, fun("f"), undefined, "static", U)
    const claims = claimsOf()
    expect(claims.claims).toStrictEqual([
      {
        id: "claim:field-reaches-boundary:userData.user->-:mystery",
        kind: "field-reaches-boundary",
        statement: "userData.user reaches boundary mystery",
        subject: "userData.user",
        object: "mystery",
        status: "static",
        verification: "unobserved",
        scope: { observationScopes: [], traceComplete: true },
        supporting: [
          { model: "flow", id: reads },
          {
            model: "flow",
            id: eid("side-effect", fun("f"), bnd("mystery"), undefined, "static", U),
          },
        ],
        contradicting: [],
        derivedFrom: ["flow"],
      },
      {
        id: "claim:field-reaches-boundary:userData.user->client-response:http",
        kind: "field-reaches-boundary",
        statement: "userData.user reaches client-response http",
        subject: "userData.user",
        object: "http",
        status: "static",
        verification: "unobserved",
        scope: { observationScopes: [], traceComplete: true },
        supporting: [
          { model: "flow", id: reads },
          { model: "flow", id: eid("side-effect", fun("f"), bnd("http"), undefined, "static", U) },
        ],
        contradicting: [],
        derivedFrom: ["flow"],
      },
      {
        id: "claim:field-reaches-boundary:userData.user->database:pg",
        kind: "field-reaches-boundary",
        statement: "userData.user reaches database pg",
        subject: "userData.user",
        object: "pg",
        status: "inferred",
        verification: "inferred",
        scope: { observationScopes: [], traceComplete: true },
        supporting: [
          { model: "flow", id: reads },
          { model: "flow", id: eid("side-effect", fun("f"), bnd("pg"), undefined, "inferred", U) },
        ],
        contradicting: [],
        derivedFrom: ["flow"],
      },
      {
        id: "claim:field-sourced-from-boundary:userData.other<--:anon",
        kind: "field-sourced-from-boundary",
        statement: "userData.other is sourced from boundary anon",
        subject: "userData.other",
        object: "anon",
        status: "declared",
        verification: "unobserved",
        scope: { observationScopes: [], traceComplete: true },
        supporting: [
          {
            model: "flow",
            id: eid(
              "crosses-boundary",
              bnd("anon"),
              fld("other"),
              undefined,
              "declared",
              fld("other"),
            ),
          },
        ],
        contradicting: [],
        derivedFrom: ["flow"],
      },
      {
        id: "claim:field-sourced-from-boundary:userData.user<-user-input:form",
        kind: "field-sourced-from-boundary",
        statement: "userData.user is sourced from user-input form",
        subject: "userData.user",
        object: "form",
        status: "declared",
        verification: "unobserved",
        scope: { observationScopes: [], traceComplete: true },
        supporting: [
          { model: "flow", id: eid("crosses-boundary", bnd("form"), U, undefined, "declared", U) },
        ],
        contradicting: [],
        derivedFrom: ["flow"],
      },
    ])
    expect(claims.schemaVersion).toBe(1)
    expect(claims.summary).toStrictEqual({
      verified: 0,
      inferred: 1,
      unobserved: 4,
      contradicted: 0,
      "observed-only": 0,
      indeterminate: 0,
    })
  })
})

describe("buildClaimsModel: claims joined to observations", () => {
  const U = fld("user")
  const f = fun("f")
  const flow = model(
    [
      field("user"),
      nd("function", "f"),
      nd("boundary", "http", { boundaryKind: "client-response" }),
      nd("boundary", "mystery"),
    ],
    [
      ed("reads", U, f, { origin: U, path: ["name"] }),
      ed("side-effect", f, bnd("http"), { origin: U, path: ["name"] }),
      ed("side-effect", f, bnd("mystery"), { origin: U }),
    ],
  )
  const events = [
    event("userData.user.name", "http", "a"),
    event("userData.user.name", "http", "a b"),
    event("userData.user.name", "mystery", "m", "database"),
    event("userData.user.email", "http", "c"),
    event("userData.user.email", "http", "c2"),
    event("userData.user", "http", "d"),
    event("userData.user.name", "nowhere", "d"),
    event("userData.ghost", "http", "d"),
    event("userData.user.name", "http", "e", "database"),
  ]
  const build = () => buildClaimsModel({ flow, observation: buildObservationModel(events) })
  const byId = (id: string) => build().claims.find((c) => c.id === id)
  const reads = eid("reads", U, f, ["name"], "static", U)
  const toHttp = eid("side-effect", f, bnd("http"), ["name"], "static", U)
  const toMystery = eid("side-effect", f, bnd("mystery"), undefined, "static", U)

  it("lists claims in id order and counts them", () => {
    const claims = build()
    expect(claims.claims.map((c) => c.id)).toEqual([
      "claim:field-reaches-boundary:userData.ghost->client-response:http",
      "claim:field-reaches-boundary:userData.user->-:mystery",
      "claim:field-reaches-boundary:userData.user->client-response:http",
      "claim:field-reaches-boundary:userData.user.email->client-response:http",
      "claim:field-reaches-boundary:userData.user.name->client-response:nowhere",
      "claim:field-reaches-boundary:userData.user.name->database:http",
    ])
    expect(claims.summary).toStrictEqual({
      verified: 2,
      inferred: 0,
      unobserved: 0,
      contradicted: 3,
      "observed-only": 1,
      indeterminate: 0,
    })
  })

  it("an observation corroborates when the static flow carries the very path observed", () => {
    expect(byId("claim:field-reaches-boundary:userData.user->client-response:http")).toStrictEqual({
      id: "claim:field-reaches-boundary:userData.user->client-response:http",
      kind: "field-reaches-boundary",
      statement: "userData.user reaches client-response http",
      subject: "userData.user",
      object: "http",
      status: "static",
      verification: "verified",
      scope: { observationScopes: ["a", "a b", "d"], traceComplete: true },
      supporting: [
        { model: "flow", id: reads },
        { model: "flow", id: toHttp },
        { model: "observation", id: obsId(events[1]!) },
        { model: "observation", id: obsId(events[0]!) },
        { model: "observation", id: obsId(events[5]!) },
      ],
      contradicting: [],
      derivedFrom: ["flow", "observation"],
      // Additive path metadata (W8): the observed names, and the whole-field observation covers the static "name" path.
      observedPaths: ["userData.user", "userData.user.name"],
      pathCoverage: "whole",
    })
  })

  it("a boundary without a kind accepts an observation of any kind", () => {
    expect(byId("claim:field-reaches-boundary:userData.user->-:mystery")).toMatchObject({
      verification: "verified",
      scope: { observationScopes: ["m"], traceComplete: true },
      supporting: [
        { model: "flow", id: reads },
        { model: "flow", id: toMystery },
        { model: "observation", id: obsId(events[2]!) },
      ],
    })
  })

  it("an observation of a path the static flow does not carry is reported on its own, as a contradiction", () => {
    expect(
      byId("claim:field-reaches-boundary:userData.user.email->client-response:http"),
    ).toStrictEqual({
      id: "claim:field-reaches-boundary:userData.user.email->client-response:http",
      kind: "field-reaches-boundary",
      statement: "userData.user.email reaches client-response http",
      subject: "userData.user.email",
      object: "http",
      status: "observed",
      verification: "contradicted",
      scope: { observationScopes: ["c", "c2"], traceComplete: true },
      supporting: [
        { model: "observation", id: obsId(events[4]!) },
        { model: "observation", id: obsId(events[3]!) },
      ],
      contradicting: [{ model: "flow", id: U }],
      derivedFrom: ["flow", "observation"],
    })
  })

  it("a boundary the flow does not know, or of another kind, is a contradiction too", () => {
    expect(
      byId("claim:field-reaches-boundary:userData.user.name->client-response:nowhere"),
    ).toMatchObject({
      statement: "userData.user.name reaches client-response nowhere",
      subject: "userData.user.name",
      object: "nowhere",
      verification: "contradicted",
      contradicting: [{ model: "flow", id: U }],
    })
    expect(byId("claim:field-reaches-boundary:userData.user.name->database:http")).toMatchObject({
      statement: "userData.user.name reaches database http",
      verification: "contradicted",
      scope: { observationScopes: ["e"], traceComplete: true },
    })
  })

  it("an observation of a field the flow does not know is observed-only, and the trace is not complete", () => {
    expect(byId("claim:field-reaches-boundary:userData.ghost->client-response:http")).toStrictEqual(
      {
        id: "claim:field-reaches-boundary:userData.ghost->client-response:http",
        kind: "field-reaches-boundary",
        statement: "userData.ghost reaches client-response http",
        subject: "userData.ghost",
        object: "http",
        status: "observed",
        verification: "observed-only",
        scope: { observationScopes: ["d"], traceComplete: false },
        supporting: [{ model: "observation", id: obsId(events[7]!) }],
        contradicting: [],
        derivedFrom: ["flow", "observation"],
      },
    )
  })

  it("a field and a path that merely share a name prefix are different", () => {
    const sibling = model(
      [field("user"), field("userExtra"), nd("function", "f"), nd("boundary", "http")],
      [
        ed("reads", fld("userExtra"), fun("f"), { origin: fld("userExtra") }),
        ed("side-effect", fun("f"), bnd("http"), { origin: fld("userExtra") }),
      ],
    )
    const result = buildClaimsModel({
      flow: sibling,
      observation: buildObservationModel([event("userData.userExtra", "http")]),
    })
    const [claim] = result.claims
    expect(claim).toMatchObject({
      id: "claim:field-reaches-boundary:userData.userExtra->-:http",
      verification: "verified",
    })
    expect(result.claims).toHaveLength(1)
  })
})

describe("buildClaimsModel: observations the flow cannot place", () => {
  const unknownFn = nd("function", "g", { status: "unknown" })
  const flow = model(
    [field("user"), field("user.email"), unknownFn, nd("function", "f")],
    [
      ed("reads", fld("user"), fun("f"), { origin: fld("user") }),
      ed("reads", fld("user.email"), fun("g"), { origin: fld("user.email") }),
    ],
  )

  it("asserts a contradiction only when every field the observation could be about has a complete trace", () => {
    const result = buildClaimsModel({
      flow,
      observation: buildObservationModel([event("userData.user.email.deep", "nowhere")]),
    })
    expect(result.claims).toStrictEqual([
      {
        id: "claim:field-reaches-boundary:userData.user.email.deep->client-response:nowhere",
        kind: "field-reaches-boundary",
        statement: "userData.user.email.deep reaches client-response nowhere",
        subject: "userData.user.email.deep",
        object: "nowhere",
        status: "observed",
        verification: "observed-only",
        scope: { observationScopes: ["s"], traceComplete: false },
        supporting: [
          {
            model: "observation",
            id: "observation:s|client-response:nowhere|userData.user.email.deep|-",
          },
        ],
        contradicting: [],
        derivedFrom: ["flow", "observation"],
      },
    ])
  })

  it("only a field node counts as the field an observation is about", () => {
    const result = buildClaimsModel({
      flow: model([nd("function", "userData.user"), nd("function", "userData")]),
      observation: buildObservationModel([event("userData.user.email", "nowhere")]),
    })
    expect(
      result.claims.map((c) => [c.verification, c.scope.traceComplete, c.contradicting]),
    ).toEqual([["observed-only", false, []]])
  })

  it("a complete field alone allows the contradiction", () => {
    const result = buildClaimsModel({
      flow,
      observation: buildObservationModel([event("userData.user.other", "nowhere")]),
    })
    expect(result.claims[0]).toMatchObject({
      verification: "contradicted",
      scope: { observationScopes: ["s"], traceComplete: true },
      contradicting: [{ model: "flow", id: fld("user") }],
    })
  })

  it("cites only the first of several complete fields as contradicting", () => {
    const result = buildClaimsModel({
      flow: model([field("user"), field("user.email")]),
      observation: buildObservationModel([event("userData.user.email.deep", "nowhere")]),
    })
    expect(result.claims[0]).toMatchObject({
      verification: "contradicted",
      scope: { traceComplete: true },
      contradicting: [{ model: "flow", id: fld("user") }],
    })
    expect(result.claims[0]?.contradicting).toHaveLength(1)
  })

  it("an incomplete first field blocks the contradiction", () => {
    const result = buildClaimsModel({
      flow: model(
        [field("user"), unknownFn, nd("function", "f")],
        [ed("reads", fld("user"), fun("g"), { origin: fld("user") })],
      ),
      observation: buildObservationModel([event("userData.user.other", "nowhere")]),
    })
    expect(result.claims[0]).toMatchObject({
      verification: "observed-only",
      scope: { traceComplete: false },
      contradicting: [],
    })
  })

  it("groups observations by field, boundary kind and boundary name", () => {
    const result = buildClaimsModel({
      flow: model([nd("function", "f")]),
      observation: buildObservationModel([
        event("a.b", "x", "s1"),
        event("a.b", "x", "s2"),
        event("a.b", "x", "s3", "database"),
        event("a.b", "y", "s1"),
        event("a.c", "x", "s1"),
      ]),
    })
    expect(
      result.claims.map((c) => [c.id, c.scope.observationScopes, c.supporting.length]),
    ).toEqual([
      ["claim:field-reaches-boundary:a.b->client-response:x", ["s1", "s2"], 2],
      ["claim:field-reaches-boundary:a.b->client-response:y", ["s1"], 1],
      ["claim:field-reaches-boundary:a.b->database:x", ["s3"], 1],
      ["claim:field-reaches-boundary:a.c->client-response:x", ["s1"], 1],
    ])
  })

  it("a derived-from list names the observation model only when one was supplied", () => {
    const without = buildClaimsModel({ flow: model([field("user"), nd("boundary", "b")]) })
    expect(without.claims).toEqual([])
    const lone = buildClaimsModel({
      flow: model(
        [field("user"), nd("boundary", "b", { boundaryKind: "log" })],
        [ed("side-effect", fld("user"), bnd("b"), { origin: fld("user") })],
      ),
    })
    expect(lone.claims.map((c) => c.derivedFrom)).toEqual([["flow"]])
    const empty = buildClaimsModel({
      flow: model(
        [field("user"), nd("boundary", "b", { boundaryKind: "log" })],
        [ed("side-effect", fld("user"), bnd("b"), { origin: fld("user") })],
      ),
      observation: buildObservationModel([]),
    })
    expect(empty.claims.map((c) => c.derivedFrom)).toEqual([["flow", "observation"]])
  })

  it("keeps paths apart whose segments only differ in where they split", () => {
    const split = model(
      [
        field("user"),
        nd("function", "f"),
        nd("boundary", "http", { boundaryKind: "client-response" }),
      ],
      [
        ed("reads", fld("user"), fun("f"), { origin: fld("user"), path: ["a", "b"] }),
        ed("side-effect", fun("f"), bnd("http"), { origin: fld("user"), path: ["a", "b"] }),
      ],
    )
    const result = buildClaimsModel({
      flow: split,
      observation: buildObservationModel([
        event("userData.user.a.b", "http"),
        event("userData.user.ab", "http"),
      ]),
    })
    expect(result.claims.map((c) => [c.id, c.verification])).toEqual([
      ["claim:field-reaches-boundary:userData.user->client-response:http", "verified"],
      ["claim:field-reaches-boundary:userData.user.ab->client-response:http", "contradicted"],
    ])
  })

  it("distinguishes fields whose ids only differ by what the path adds", () => {
    const twin = model(
      [
        field("x"),
        field("xb"),
        nd("function", "f"),
        nd("boundary", "bx", { boundaryKind: "log" }),
        nd("boundary", "bxb", { boundaryKind: "log" }),
      ],
      [
        ed("side-effect", fld("x"), bnd("bx"), { origin: fld("x"), path: ["b"] }),
        ed("side-effect", fld("xb"), bnd("bxb"), { origin: fld("xb") }),
      ],
    )
    const result = buildClaimsModel({
      flow: twin,
      observation: buildObservationModel([
        event("userData.x.b", "bx", "s", "log"),
        event("userData.xb", "bxb", "s", "log"),
      ]),
    })
    expect(result.claims.map((c) => [c.id, c.verification])).toEqual([
      ["claim:field-reaches-boundary:userData.x->log:bx", "verified"],
      ["claim:field-reaches-boundary:userData.xb->log:bxb", "verified"],
    ])
  })
})

describe("buildClaimsModel: statuses a field reaches by", () => {
  it("does not count a boundary reached only through an unknown fact as reached", () => {
    const flow = model(
      [field("user"), nd("function", "f"), nd("boundary", "b", { boundaryKind: "log" })],
      [
        ed("reads", fld("user"), fun("f"), { origin: fld("user"), status: "unknown" }),
        ed("side-effect", fun("f"), bnd("b"), { origin: fld("user") }),
      ],
    )
    expect(buildClaimsModel({ flow }).claims).toEqual([])
  })

  it.each(["static", "declared", "inferred"] as const)("counts a %s edge as reaching", (status) => {
    const flow = model(
      [field("user"), nd("boundary", "b", { boundaryKind: "log" })],
      [ed("side-effect", fld("user"), bnd("b"), { origin: fld("user"), status })],
    )
    expect(buildClaimsModel({ flow }).claims.map((c) => [c.status, c.verification])).toEqual([
      [status, status === "inferred" ? "inferred" : "unobserved"],
    ])
  })

  it("reports an incomplete full trace on a claim the reach trace supports", () => {
    const flow = model(
      [
        field("user"),
        nd("function", "g", { status: "unknown" }),
        nd("boundary", "b", { boundaryKind: "log" }),
      ],
      [
        ed("side-effect", fld("user"), bnd("b"), { origin: fld("user") }),
        ed("reads", fld("user"), fun("g"), { origin: fld("user") }),
      ],
    )
    const [claim] = buildClaimsModel({ flow }).claims
    expect(claim?.scope).toStrictEqual({ observationScopes: [], traceComplete: false })
  })

  it("tolerates an edge that crosses from a node the model lacks", () => {
    const base = model([field("user")])
    const dangling: FlowModel = {
      ...base,
      edges: [
        { ...ed("crosses-boundary", "ghost", fld("user"), { origin: fld("user") }), id: "raw" },
      ],
    }
    expect(buildClaimsModel({ flow: dangling }).claims).toEqual([])
  })
})

describe("buildClaimsModel: policy claims", () => {
  const U = fld("user")
  const f = fun("f")
  const flow = model(
    [
      field("user", { classification: "pii" }),
      nd("function", "f"),
      nd("boundary", "http", { boundaryKind: "client-response" }),
      nd("boundary", "log", { boundaryKind: "log" }),
    ],
    [
      ed("reads", U, f, { origin: U, path: ["name"] }),
      ed("side-effect", f, bnd("http"), { origin: U, path: ["name"], status: "inferred" }),
      ed("side-effect", f, bnd("log"), { origin: U, path: ["name"], handling: "hashed" }),
    ],
  )
  const reads = eid("reads", U, f, ["name"], "static", U)
  const toHttp = eid("side-effect", f, bnd("http"), ["name"], "inferred", U)
  const toLog = eid("side-effect", f, bnd("log"), ["name"], "static", U)
  const policyOf = (...rules: FlowPolicyRule[]) => buildPolicyModel(flow, rules)
  const policyClaimsOf = (rules: FlowPolicyRule[], events?: ObservationEvent[]) =>
    buildClaimsModel({
      flow,
      policy: policyOf(...rules),
      ...(events === undefined ? {} : { observation: buildObservationModel(events) }),
    }).claims.filter((c) => c.kind === "policy-holds")
  const forbidClient: FlowPolicyRule = {
    id: "no-client",
    appliesTo: { classification: "pii" },
    forbidDestinations: ["client-response"],
  }
  const forbidLog: FlowPolicyRule = {
    id: "no-log",
    appliesTo: { classification: "pii" },
    forbidDestinations: ["log"],
    allowedHandling: ["hashed"],
  }

  it("a violated rule is a contradiction resting on the violating edges", () => {
    expect(policyClaimsOf([forbidClient])).toStrictEqual([
      {
        id: `claim:policy-holds:no-client:userData.user`,
        kind: "policy-holds",
        statement: "Rule no-client holds for userData.user",
        subject: "userData.user",
        object: "no-client",
        status: "inferred",
        verification: "contradicted",
        scope: { observationScopes: [], traceComplete: true },
        supporting: [{ model: "policy", id: `no-client#${U}` }],
        contradicting: [
          { model: "policy", id: `no-client#${U}` },
          { model: "flow", id: reads },
          { model: "flow", id: toHttp },
        ],
        derivedFrom: ["flow", "policy"],
      },
    ])
  })

  it("a satisfied rule that nothing observed is unobserved, and rests on its edges", () => {
    expect(policyClaimsOf([forbidLog])).toStrictEqual([
      {
        id: `claim:policy-holds:no-log:userData.user`,
        kind: "policy-holds",
        statement: "Rule no-log holds for userData.user",
        subject: "userData.user",
        object: "no-log",
        status: "static",
        verification: "unobserved",
        scope: { observationScopes: [], traceComplete: true },
        supporting: [
          { model: "policy", id: `no-log#${U}` },
          { model: "flow", id: reads },
          { model: "flow", id: toLog },
        ],
        contradicting: [],
        derivedFrom: ["flow", "policy"],
      },
    ])
  })

  it("an observation of the governed data verifies it, and is cited as support", () => {
    const e = event("userData.user.name", "log", "t1", "log", "hashed")
    const [claim] = policyClaimsOf([forbidLog], [e])
    expect(claim).toMatchObject({
      verification: "verified",
      scope: { observationScopes: ["t1"], traceComplete: true },
      supporting: [
        { model: "policy", id: `no-log#${U}` },
        { model: "flow", id: reads },
        { model: "flow", id: toLog },
        { model: "observation", id: obsId(e) },
      ],
      contradicting: [],
      derivedFrom: ["flow", "policy", "observation"],
    })
  })

  it("an observation that violates a satisfied rule contradicts it, and is cited against it only", () => {
    const bad = event("userData.user.name", "log", "t1", "log", "plaintext")
    const good = event("userData.user.name", "log", "t2", "log", "hashed")
    const [claim] = policyClaimsOf([forbidLog], [bad, good])
    expect(claim).toMatchObject({
      verification: "contradicted",
      status: "static",
      scope: { observationScopes: ["t1", "t2"] },
      supporting: [
        { model: "policy", id: `no-log#${U}` },
        { model: "flow", id: reads },
        { model: "flow", id: toLog },
        { model: "observation", id: obsId(good) },
      ],
      contradicting: [{ model: "observation", id: obsId(bad) }],
    })
  })

  it("an undecided rule is indeterminate, with the status of its weakest ground", () => {
    const rule: FlowPolicyRule = {
      id: "needs-handling",
      appliesTo: { classification: "pii" },
      requireHandling: ["hashed"],
    }
    const only = model(
      [
        field("user", { classification: "pii" }),
        nd("boundary", "http", { boundaryKind: "client-response" }),
      ],
      [ed("side-effect", U, bnd("http"), { origin: U })],
    )
    const [claim] = buildClaimsModel({
      flow: only,
      policy: buildPolicyModel(only, [rule]),
    }).claims.filter((c) => c.kind === "policy-holds")
    expect(claim).toMatchObject({
      verification: "indeterminate",
      status: "unknown",
      contradicting: [],
      supporting: [{ model: "policy", id: `needs-handling#${U}` }],
    })
  })

  it("violation outranks satisfaction and indeterminacy for the status; satisfaction outranks indeterminacy", () => {
    const rule: FlowPolicyRule = {
      id: "mixed",
      appliesTo: { classification: "pii" },
      forbidDestinations: ["client-response"],
      requireHandling: ["hashed"],
    }
    // http: violated (inferred); log: satisfied (static); requireHandling on http: undeclared
    const [mixed] = policyClaimsOf([rule])
    expect(mixed).toMatchObject({ verification: "contradicted", status: "inferred" })
    const satisfiedAndUndecided: FlowPolicyRule = {
      id: "ok-and-undecided",
      appliesTo: { classification: "pii" },
      forbidDestinations: ["log"],
      allowedHandling: ["hashed"],
      requireHandling: ["hashed"],
    }
    const [other] = policyClaimsOf([satisfiedAndUndecided])
    expect(other).toMatchObject({ verification: "indeterminate", status: "static" })
  })

  it("narrows the observations to the rule's path", () => {
    const rule: FlowPolicyRule = {
      ...forbidLog,
      appliesTo: { classification: "pii", path: ["name"] },
    }
    const inside = event("userData.user.name.first", "log", "t1", "log", "hashed")
    const whole = event("userData.user", "log", "t2", "log", "hashed")
    const outside = event("userData.user.email", "log", "t3", "log", "plaintext")
    const other = event("userData.userExtra.name", "log", "t4", "log", "plaintext")
    const [claim] = policyClaimsOf([rule], [inside, whole, outside, other])
    expect(claim).toMatchObject({
      verification: "verified",
      scope: { observationScopes: ["t1", "t2"] },
      contradicting: [],
    })
  })

  it("without a path on the rule every observation of the field counts", () => {
    const outside = event("userData.user.email", "log", "t3", "log", "plaintext")
    const [claim] = policyClaimsOf([forbidLog], [outside])
    expect(claim?.verification).toBe("contradicted")
    expect(claim?.scope.observationScopes).toEqual(["t3"])
  })

  it("is not complete when the policy found the trace incomplete", () => {
    const partial = model(
      [field("user", { classification: "pii" }), nd("function", "g", { status: "unknown" })],
      [ed("reads", fld("user"), fun("g"), { origin: fld("user") })],
    )
    const claims = buildClaimsModel({
      flow: partial,
      policy: buildPolicyModel(partial, [forbidLog]),
    }).claims
    expect(claims.map((c) => [c.id, c.verification, c.scope.traceComplete])).toEqual([
      ["claim:policy-holds:no-log:userData.user", "indeterminate", false],
    ])
  })

  it("is incomplete when any one result found the trace incomplete, even beside a decided one", () => {
    const partial = model(
      [
        field("user", { classification: "pii" }),
        nd("function", "f"),
        nd("function", "g", { status: "unknown" }),
        nd("boundary", "http", { boundaryKind: "client-response" }),
      ],
      [
        ed("reads", U, f, { origin: U }),
        ed("side-effect", f, bnd("http"), { origin: U }),
        ed("reads", U, fun("g"), { origin: U }),
      ],
    )
    const claims = buildClaimsModel({
      flow: partial,
      policy: buildPolicyModel(partial, [forbidClient]),
    }).claims.filter((c) => c.kind === "policy-holds")
    expect(claims.map((c) => [c.verification, c.scope.traceComplete])).toEqual([
      ["contradicted", false],
    ])
  })

  it("makes no claim for a rule that matched nothing, or whose rule or subject is missing", () => {
    const nothing = buildPolicyModel(flow, [
      { id: "none", appliesTo: { field: "nope" }, forbidDestinations: ["log"] },
    ])
    expect(
      buildClaimsModel({ flow, policy: nothing }).claims.filter((c) => c.kind === "policy-holds"),
    ).toEqual([])
    const base = policyOf(forbidClient)
    const orphan = (patch: Partial<PolicyModel>): PolicyModel => ({ ...base, ...patch })
    const result = (subject: string): PolicyResult => ({
      ruleId: "no-client",
      subject,
      outcome: "satisfied",
      basis: "static",
      edges: [],
    })
    const kinds = (policy: PolicyModel) =>
      buildClaimsModel({ flow, policy }).claims.filter((c) => c.kind === "policy-holds").length
    expect(kinds(orphan({ rules: [] }))).toBe(0)
    expect(kinds(orphan({ results: [result("field:gone")] }))).toBe(0)
    expect(kinds(base)).toBe(1)
  })

  it("orders policy claims after the reach claims they sort behind, by id", () => {
    const all = buildClaimsModel({ flow, policy: policyOf(forbidLog, forbidClient) }).claims
    expect(all.map((c) => c.id)).toEqual([
      "claim:field-reaches-boundary:userData.user->client-response:http",
      "claim:field-reaches-boundary:userData.user->log:log",
      "claim:policy-holds:no-client:userData.user",
      "claim:policy-holds:no-log:userData.user",
    ])
  })
})
