import { describe, expect, it } from "vitest"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import {
  buildPolicyModel,
  collectFlowPolicyRules,
  POLICY_MODEL_SCHEMA_VERSION,
} from "../../src/flow/policy-model.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { FlowPolicyRule } from "../../src/flow/policy-model.js"

const FILE = "src/profile.ts"
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
const boundary = (name: string, boundaryKind: FlowNodeInput["boundaryKind"]): FlowNodeInput => ({
  kind: "boundary",
  scope: "boundary",
  name,
  status: "declared",
  ...(boundaryKind === undefined ? {} : { boundaryKind }),
})
const fid = (name: string): string => flowNodeId("field", FILE, name)
const bid = (name: string): string => flowNodeId("boundary", "boundary", name)
const edge = (
  kind: FlowEdgeInput["kind"],
  from: string,
  to: string,
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput => ({ kind, from, to, status: "static", ...extra })

/** email (pii) --side-effect--> client response; passwordHash (secret) goes nowhere. */
function model(extra: { edges?: FlowEdgeInput[]; nodes?: FlowNodeInput[] } = {}) {
  return buildFlowModel({
    nodes: [
      field("User.email", "pii"),
      field("User.passwordHash", "secret"),
      fn("sendProfile"),
      boundary("http-response", "client-response"),
      boundary("stripe", "external-service"),
      ...(extra.nodes ?? []),
    ],
    edges: [
      edge("passes", fid("User.email"), flowNodeId("function", FILE, "sendProfile")),
      edge("side-effect", flowNodeId("function", FILE, "sendProfile"), bid("http-response")),
      ...(extra.edges ?? []),
    ],
    unknowns: [],
  })
}

const rule = (overrides: Partial<FlowPolicyRule> = {}): FlowPolicyRule => ({
  id: "pii-not-to-client",
  appliesTo: { classification: "pii" },
  forbidDestinations: ["client-response"],
  ...overrides,
})

describe("buildPolicyModel", () => {
  it("stamps the schema version and carries the rules through ordered by id", () => {
    const result = buildPolicyModel(model(), [rule({ id: "b" }), rule({ id: "a" })])
    expect(result.schemaVersion).toBe(POLICY_MODEL_SCHEMA_VERSION)
    expect(result.rules.map((r) => r.id)).toEqual(["a", "b"])
  })

  it("reports a violation when a matching field reaches a forbidden destination", () => {
    const result = buildPolicyModel(model(), [rule()])
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      ruleId: "pii-not-to-client",
      subject: fid("User.email"),
      boundary: bid("http-response"),
      outcome: "violated",
      basis: "static",
    })
    expect(result.summary).toEqual({ satisfied: 0, violated: 1, indeterminate: 0 })
  })

  it("is satisfied when a matching field never reaches a forbidden destination", () => {
    const result = buildPolicyModel(model(), [
      rule({ appliesTo: { classification: "secret" }, id: "secret-not-to-client" }),
    ])
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      outcome: "satisfied",
      subject: fid("User.passwordHash"),
    })
    expect(result.results[0]?.boundary).toBeUndefined()
  })

  it("matches a single field by exact node name", () => {
    const result = buildPolicyModel(model(), [
      rule({ id: "r", appliesTo: { field: "User.email" } }),
    ])
    expect(result.results.map((r) => r.subject)).toEqual([fid("User.email")])
  })

  it("requires every criterion of appliesTo to match", () => {
    const result = buildPolicyModel(model(), [
      rule({ id: "r", appliesTo: { classification: "pii", field: "User.passwordHash" } }),
    ])
    expect(result.results[0]).toMatchObject({
      outcome: "indeterminate",
      reason: "rule-matches-nothing",
    })
  })

  it("reports a rule that matches no field as indeterminate, never silently satisfied", () => {
    const result = buildPolicyModel(model(), [
      rule({ id: "typo", appliesTo: { classification: "pi" } }),
    ])
    expect(result.results).toEqual([
      expect.objectContaining({
        ruleId: "typo",
        outcome: "indeterminate",
        reason: "rule-matches-nothing",
      }),
    ])
  })

  it("forbids a destination kind but exempts an allowed handling at the crossing", () => {
    const flow = model({
      edges: [edge("crosses-boundary", fid("User.email"), bid("stripe"), { handling: "hashed" })],
    })
    const result = buildPolicyModel(flow, [
      rule({
        id: "no-external",
        forbidDestinations: ["external-service"],
        allowedHandling: ["hashed"],
      }),
    ])
    expect(result.results[0]).toMatchObject({ outcome: "satisfied" })
  })

  it("still violates when the handling at the crossing is not allowed", () => {
    const flow = model({
      edges: [
        edge("crosses-boundary", fid("User.email"), bid("stripe"), { handling: "plaintext" }),
      ],
    })
    const result = buildPolicyModel(flow, [
      rule({
        id: "no-external",
        forbidDestinations: ["external-service"],
        allowedHandling: ["hashed"],
      }),
    ])
    expect(result.results[0]).toMatchObject({ outcome: "violated", boundary: bid("stripe") })
  })

  it("violates a forbidden destination whose crossing declares no handling", () => {
    const flow = model({ edges: [edge("crosses-boundary", fid("User.email"), bid("stripe"))] })
    const result = buildPolicyModel(flow, [
      rule({
        id: "no-external",
        forbidDestinations: ["external-service"],
        allowedHandling: ["hashed"],
      }),
    ])
    expect(result.results[0]).toMatchObject({ outcome: "violated" })
  })

  it("enforces allowedDestinations as an allow-list of boundary kinds", () => {
    const result = buildPolicyModel(model(), [
      rule({ id: "only-db", forbidDestinations: undefined, allowedDestinations: ["database"] }),
    ])
    expect(result.results[0]).toMatchObject({
      outcome: "violated",
      boundary: bid("http-response"),
    })
  })

  it("requireHandling: a crossing with a different declared handling is a violation", () => {
    const flow = model({
      edges: [edge("side-effect", fid("User.email"), bid("stripe"), { handling: "plaintext" })],
    })
    const result = buildPolicyModel(flow, [
      rule({
        id: "must-mask",
        forbidDestinations: undefined,
        requireHandling: ["masked", "redacted"],
      }),
    ])
    const stripe = result.results.find((r) => r.boundary === bid("stripe"))
    expect(stripe).toMatchObject({ outcome: "violated" })
  })

  it("requireHandling: a crossing with no declared handling is indeterminate, not violated", () => {
    const result = buildPolicyModel(model(), [
      rule({ id: "must-mask", forbidDestinations: undefined, requireHandling: ["masked"] }),
    ])
    expect(result.results[0]).toMatchObject({
      outcome: "indeterminate",
      reason: "handling-not-declared",
    })
  })

  it("requireHandling: a crossing with an accepted handling is satisfied", () => {
    const flow = model({
      edges: [edge("side-effect", fid("User.email"), bid("stripe"), { handling: "masked" })],
    })
    const result = buildPolicyModel(flow, [
      rule({ id: "must-mask", forbidDestinations: undefined, requireHandling: ["masked"] }),
    ])
    expect(result.results.find((r) => r.boundary === bid("stripe"))).toMatchObject({
      outcome: "satisfied",
    })
  })

  it("adds an indeterminate result when the trace crosses an unknown, even if nothing was violated", () => {
    const flow = buildFlowModel({
      nodes: [
        field("User.email", "pii"),
        fn("mystery", "unknown"),
        boundary("http-response", "client-response"),
      ],
      edges: [edge("passes", fid("User.email"), flowNodeId("function", FILE, "mystery"))],
      unknowns: [],
    })
    const result = buildPolicyModel(flow, [rule()])
    expect(result.results.map((r) => r.outcome)).toEqual(["indeterminate"])
    expect(result.results[0]?.reason).toBe("trace-incomplete")
  })

  it("keeps a violation and adds the incompleteness when both apply", () => {
    const flow = buildFlowModel({
      nodes: [
        field("User.email", "pii"),
        fn("sendProfile"),
        fn("mystery", "unknown"),
        boundary("http-response", "client-response"),
      ],
      edges: [
        edge("passes", fid("User.email"), flowNodeId("function", FILE, "sendProfile")),
        edge("side-effect", flowNodeId("function", FILE, "sendProfile"), bid("http-response")),
        edge("passes", fid("User.email"), flowNodeId("function", FILE, "mystery")),
      ],
      unknowns: [],
    })
    const outcomes = buildPolicyModel(flow, [rule()])
      .results.map((r) => r.outcome)
      .sort()
    expect(outcomes).toEqual(["indeterminate", "violated"])
  })

  it("reports the weakest status along the path as the basis of a violation", () => {
    const flow = buildFlowModel({
      nodes: [field("User.email", "pii"), boundary("http-response", "client-response")],
      edges: [edge("side-effect", fid("User.email"), bid("http-response"), { status: "inferred" })],
      unknowns: [],
    })
    expect(buildPolicyModel(flow, [rule()]).results[0]).toMatchObject({
      outcome: "violated",
      basis: "inferred",
    })
  })

  it("records the edge ids that justify a result", () => {
    const result = buildPolicyModel(model(), [rule()])
    expect(result.results[0]?.edges.length).toBe(2)
  })

  it("rejects duplicate rule ids", () => {
    expect(() => buildPolicyModel(model(), [rule(), rule()])).toThrow(/duplicate/i)
  })

  it("rejects a rule with an empty appliesTo", () => {
    expect(() => buildPolicyModel(model(), [rule({ appliesTo: {} })])).toThrow(/appliesTo/)
  })

  it("rejects a rule that constrains nothing", () => {
    expect(() => buildPolicyModel(model(), [rule({ forbidDestinations: undefined })])).toThrow(
      /constrain/i,
    )
  })

  it("ignores a boundary node without a boundaryKind for kind-based rules and reports it indeterminate", () => {
    const flow = buildFlowModel({
      nodes: [field("User.email", "pii"), boundary("mystery-sink", undefined)],
      edges: [edge("side-effect", fid("User.email"), bid("mystery-sink"))],
      unknowns: [],
    })
    expect(buildPolicyModel(flow, [rule()]).results[0]).toMatchObject({
      outcome: "indeterminate",
      reason: "boundary-kind-unknown",
    })
  })

  it("is deterministic regardless of rule order", () => {
    const a = rule({ id: "a" })
    const b = rule({ id: "b", appliesTo: { classification: "secret" } })
    expect(buildPolicyModel(model(), [a, b])).toEqual(buildPolicyModel(model(), [b, a]))
  })
})

describe("buildPolicyModel: appliesTo.path and appliesTo.scope", () => {
  // One field "User" with sub-paths flowing to the client at different granularity.
  function pathModel(paths: (string[] | undefined)[]) {
    return buildFlowModel({
      nodes: [field("User", "secret"), boundary("http-response", "client-response")],
      edges: paths.map((path) =>
        edge(
          "side-effect",
          fid("User"),
          bid("http-response"),
          path === undefined ? {} : { path, origin: fid("User") },
        ),
      ),
      unknowns: [],
    })
  }
  const secretRule = (path: string[]): FlowPolicyRule => ({
    id: "no-secret-path",
    appliesTo: { field: "User", path },
    forbidDestinations: ["client-response"],
  })

  it("is satisfied when only other paths of the field reach the destination", () => {
    const result = buildPolicyModel(pathModel([["email"], ["name"]]), [
      secretRule(["passwordHash"]),
    ])
    expect(result.results.map((r) => r.outcome)).toEqual(["satisfied"])
  })

  it("is violated when exactly that path reaches the destination", () => {
    const result = buildPolicyModel(pathModel([["passwordHash"]]), [secretRule(["passwordHash"])])
    expect(result.results[0]).toMatchObject({ outcome: "violated" })
  })

  it("is violated when the whole field reaches the destination (a path-less edge covers every path)", () => {
    const result = buildPolicyModel(pathModel([[]]), [secretRule(["passwordHash"])])
    expect(result.results[0]).toMatchObject({ outcome: "violated" })
  })

  it("is violated when a deeper path under the governed path reaches the destination", () => {
    const result = buildPolicyModel(pathModel([["passwordHash", "salt"]]), [
      secretRule(["passwordHash"]),
    ])
    expect(result.results[0]).toMatchObject({ outcome: "violated" })
  })

  it("is violated for an edge with no path at all", () => {
    const result = buildPolicyModel(pathModel([undefined]), [secretRule(["passwordHash"])])
    expect(result.results[0]).toMatchObject({ outcome: "violated" })
  })

  it("scope restricts a rule to fields declared in that file", () => {
    const flow = buildFlowModel({
      nodes: [
        { kind: "field", scope: "a.ts", name: "a.user", status: "static", classification: "pii" },
        { kind: "field", scope: "b.ts", name: "b.user", status: "static", classification: "pii" },
        boundary("http-response", "client-response"),
      ],
      edges: [],
      unknowns: [],
    })
    const result = buildPolicyModel(flow, [
      {
        id: "scoped",
        appliesTo: { classification: "pii", scope: "a.ts" },
        forbidDestinations: ["client-response"],
      },
    ])
    expect(result.results.map((r) => r.subject)).toEqual([flowNodeId("field", "a.ts", "a.user")])
  })

  it("a rule about one path is not made indeterminate by an unknown about another path", () => {
    const flow = buildFlowModel({
      nodes: [field("User", "secret"), boundary("http-response", "client-response"), fn("audit")],
      edges: [
        edge("reads", fid("User"), flowNodeId("function", FILE, "audit"), {
          path: [],
          origin: fid("User"),
        }),
      ],
      unknowns: [
        {
          reason: "unresolved-call",
          subject: flowNodeId("function", FILE, "audit"),
          source: { file: FILE, line: 1, column: 1 },
          data: [{ origin: fid("User"), path: ["email"] }],
        },
      ],
    })
    const secret = buildPolicyModel(flow, [secretRule(["passwordHash"])])
    expect(secret.results.map((r) => r.outcome)).toEqual(["satisfied"])
    const email = buildPolicyModel(flow, [{ ...secretRule(["email"]), id: "email-rule" }])
    expect(email.results.map((r) => r.reason)).toContain("trace-incomplete")
  })

  it("rejects an empty path", () => {
    expect(() => buildPolicyModel(model(), [secretRule([])])).toThrow(/path/)
  })

  it("a scope alone is not enough to apply a rule", () => {
    expect(() =>
      buildPolicyModel(model(), [rule({ appliesTo: { scope: "src/profile.ts" } })]),
    ).toThrow(/appliesTo/)
  })
})

describe("collectFlowPolicyRules", () => {
  function cap(exportName: string, file: string, flowPolicy: unknown): CapabilityNode {
    return {
      file,
      exportName,
      kind: "createData",
      docs: flowPolicy === undefined ? undefined : ({ flowPolicy } as never),
      active: true,
      exclusiveGroup: undefined,
      declarationPosition: { line: 1, column: 1 },
      fields: [],
      getters: [],
      mutators: [],
      subscriptions: [],
    }
  }
  const inv = (...capabilities: CapabilityNode[]): CapabilityInventory => ({
    schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
    capabilities,
    warnings: [],
  })

  it("is empty when no capability declares a flowPolicy", () => {
    expect(collectFlowPolicyRules(inv(cap("a", "a.ts", undefined)))).toEqual([])
  })

  it("namespaces each id by its capability and scopes the rule to the capability's file", () => {
    const rules = collectFlowPolicyRules(
      inv(
        cap("userData", "features/user.ts", [
          { id: "no-log", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
        ]),
      ),
    )
    expect(rules).toEqual([
      {
        id: "userData/no-log",
        appliesTo: { classification: "pii", scope: "features/user.ts" },
        forbidDestinations: ["log"],
      },
    ])
  })

  it("qualifies appliesTo.field with the capability's export name, and keeps path and constraints", () => {
    const [rule] = collectFlowPolicyRules(
      inv(
        cap("userData", "u.ts", [
          {
            id: "r",
            description: "why",
            appliesTo: { field: "user", path: ["passwordHash"] },
            forbidDestinations: ["client-response"],
            allowedDestinations: ["database"],
            allowedHandling: ["hashed"],
            requireHandling: ["masked"],
          },
        ]),
      ),
    )
    expect(rule).toEqual({
      id: "userData/r",
      description: "why",
      appliesTo: { field: "userData.user", path: ["passwordHash"], scope: "u.ts" },
      forbidDestinations: ["client-response"],
      allowedDestinations: ["database"],
      allowedHandling: ["hashed"],
      requireHandling: ["masked"],
    })
  })

  it("lets two capabilities reuse a rule id without colliding", () => {
    const rules = collectFlowPolicyRules(
      inv(
        cap("a", "a.ts", [
          { id: "r", appliesTo: { classification: "x" }, forbidDestinations: ["log"] },
        ]),
        cap("b", "b.ts", [
          { id: "r", appliesTo: { classification: "x" }, forbidDestinations: ["log"] },
        ]),
      ),
    )
    expect(rules.map((rule) => rule.id)).toEqual(["a/r", "b/r"])
  })

  it("skips an inactive capability's rules", () => {
    const inactive = {
      ...cap("a", "a.ts", [
        { id: "r", appliesTo: { classification: "x" }, forbidDestinations: ["log"] },
      ]),
      active: false,
    }
    expect(collectFlowPolicyRules(inv(inactive))).toEqual([])
  })

  it("produces rules buildPolicyModel accepts", () => {
    const rules = collectFlowPolicyRules(
      inv(
        cap("u", "src/profile.ts", [
          {
            id: "pii-not-to-client",
            appliesTo: { classification: "pii" },
            forbidDestinations: ["client-response"],
          },
        ]),
      ),
    )
    const result = buildPolicyModel(model(), rules)
    expect(result.results[0]).toMatchObject({ ruleId: "u/pii-not-to-client", outcome: "violated" })
  })
})
