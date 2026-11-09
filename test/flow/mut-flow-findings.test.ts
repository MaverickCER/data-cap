import { describe, expect, it } from "vitest"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowNodeInput, FlowUnknownReason } from "../../src/flow/flow-model.js"
import { flowAnalysisFindings, policyFindings, unknownText } from "../../src/flow/flow-findings.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"
import type { PolicyModel, PolicyResult } from "../../src/flow/policy-model.js"

const FILE = "features/user.ts"
const nodes: FlowNodeInput[] = [
  { kind: "field", scope: FILE, name: "userData.user", status: "static", classification: "pii" },
  {
    kind: "field",
    scope: FILE,
    name: "userData.user.email",
    status: "static",
    classification: "pii",
  },
  { kind: "function", scope: FILE, name: "h", status: "static" },
  { kind: "boundary", scope: "b", name: "http", status: "static", boundaryKind: "client-response" },
  { kind: "boundary", scope: "b", name: "mystery", status: "static" },
]
const id = (kind: FlowNodeInput["kind"], scope: string, name: string) =>
  flowNodeId(kind, scope, name)
const USER = id("field", FILE, "userData.user")
const EMAIL = id("field", FILE, "userData.user.email")
const H = id("function", FILE, "h")
const HTTP = id("boundary", "b", "http")
const MYSTERY = id("boundary", "b", "mystery")
const flow = buildFlowModel({ nodes, edges: [], unknowns: [] })

const result = (
  extra: Partial<PolicyResult> & { outcome: PolicyResult["outcome"] },
): PolicyResult => ({
  ruleId: "r",
  basis: "static",
  edges: [],
  ...extra,
})
const policyOf = (...results: PolicyResult[]): PolicyModel => ({
  schemaVersion: 1,
  rules: [],
  results,
  summary: { satisfied: 0, violated: 0, indeterminate: 0 },
})
const findingsOf = (...results: PolicyResult[]) => policyFindings(policyOf(...results), flow)

describe("policyFindings: violated", () => {
  it("states a violation with its location and evidence", () => {
    expect(
      findingsOf(
        result({ outcome: "violated", subject: USER, boundary: HTTP, edges: ["e1", "e2"] }),
      ),
    ).toStrictEqual([
      {
        code: "FLOW_POLICY_VIOLATED",
        family: "flow",
        severity: "error",
        message:
          'Rule "r" is violated: field "userData.user" reaches client-response "http" (established as static).',
        capability: { file: FILE, exportName: "userData" },
        field: ["user"],
        evidence: [
          { model: "policy", id: `r#${USER}` },
          { model: "flow", id: "e1" },
          { model: "flow", id: "e2" },
        ],
      },
    ])
  })

  it("keeps the whole remainder of a dotted field name", () => {
    const [finding] = findingsOf(result({ outcome: "violated", subject: EMAIL, boundary: HTTP }))
    expect(finding?.field).toEqual(["user.email"])
    expect(finding?.capability).toEqual({ file: FILE, exportName: "userData" })
  })

  it("only an inferred basis softens the severity", () => {
    const severity = (basis: PolicyResult["basis"]) =>
      findingsOf(result({ outcome: "violated", subject: USER, boundary: HTTP, basis }))[0]?.severity
    expect(severity("inferred")).toBe("warning")
    expect(severity("static")).toBe("error")
    expect(severity("declared")).toBe("error")
    expect(severity("unknown")).toBe("error")
  })

  it("names a boundary with no kind plainly", () => {
    const [finding] = findingsOf(
      result({ outcome: "violated", subject: USER, boundary: MYSTERY, basis: "declared" }),
    )
    expect(finding?.message).toBe(
      'Rule "r" is violated: field "userData.user" reaches boundary "mystery" (established as declared).',
    )
  })

  it("says only what it knows when the subject or boundary is not in the flow", () => {
    const [noSubject] = findingsOf(result({ outcome: "violated", subject: "gone", boundary: HTTP }))
    expect(noSubject).toStrictEqual({
      code: "FLOW_POLICY_VIOLATED",
      family: "flow",
      severity: "error",
      message:
        'Rule "r" is violated: a field reaches client-response "http" (established as static).',
      evidence: [{ model: "policy", id: "r#gone" }],
    })
    const [noBoundary] = findingsOf(
      result({ outcome: "violated", subject: USER, boundary: "gone" }),
    )
    expect(noBoundary?.message).toBe(
      'Rule "r" is violated: field "userData.user" (established as static).',
    )
  })

  it("gives no capability or field for a subject that is not a field", () => {
    const [finding] = findingsOf(result({ outcome: "violated", subject: H, boundary: HTTP }))
    expect(finding).toStrictEqual({
      code: "FLOW_POLICY_VIOLATED",
      family: "flow",
      severity: "error",
      message:
        'Rule "r" is violated: field "h" reaches client-response "http" (established as static).',
      evidence: [{ model: "policy", id: `r#${H}` }],
    })
  })

  it("produces nothing for a satisfied result", () => {
    expect(findingsOf(result({ outcome: "satisfied", subject: USER }))).toEqual([])
  })
})

describe("policyFindings: indeterminate", () => {
  it.each([
    ["rule-matches-nothing", "the rule matches no field, so nothing was checked"],
    [
      "trace-incomplete",
      "the flow of the governed data reaches code the analysis could not follow, so the rule could not be proven to hold",
    ],
    ["handling-not-declared", "a crossing the rule governs declares no handling"],
    ["boundary-kind-unknown", "a destination the data reaches has no known kind"],
  ] as const)("explains %s", (reason, text) => {
    const [finding] = findingsOf(
      result({ outcome: "indeterminate", reason, subject: USER, boundary: HTTP, basis: "unknown" }),
    )
    expect(finding).toStrictEqual({
      code: "FLOW_POLICY_INDETERMINATE",
      family: "flow",
      severity: "warning",
      message: `Rule "r" could not be decided for field "userData.user" reaches client-response "http": ${text}.`,
      capability: { file: FILE, exportName: "userData" },
      field: ["user"],
      evidence: [{ model: "policy", id: `r#${USER}` }],
    })
  })

  it("a rule that matched nothing carries no location at all", () => {
    expect(
      findingsOf(
        result({ outcome: "indeterminate", reason: "rule-matches-nothing", basis: "unknown" }),
      ),
    ).toStrictEqual([
      {
        code: "FLOW_POLICY_INDETERMINATE",
        family: "flow",
        severity: "warning",
        message:
          'Rule "r" could not be decided: the rule matches no field, so nothing was checked.',
      },
    ])
  })

  it("a trace-level result names the field but no boundary", () => {
    const [finding] = findingsOf(
      result({
        outcome: "indeterminate",
        reason: "trace-incomplete",
        subject: USER,
        basis: "unknown",
      }),
    )
    expect(finding?.message).toBe(
      'Rule "r" could not be decided for field "userData.user": the flow of the governed data reaches code the analysis could not follow, so the rule could not be proven to hold.',
    )
  })

  it("falls back to a plain reason when none was recorded", () => {
    const [finding] = findingsOf(result({ outcome: "indeterminate", subject: USER }))
    expect(finding?.message).toBe(
      'Rule "r" could not be decided for field "userData.user": the analysis could not decide.',
    )
  })

  it("an unknown subject is still described", () => {
    const [finding] = findingsOf(
      result({ outcome: "indeterminate", reason: "handling-not-declared", subject: "gone" }),
    )
    expect(finding?.message).toBe(
      'Rule "r" could not be decided for a field: a crossing the rule governs declares no handling.',
    )
  })

  it("through the real policy model", () => {
    const real = buildFlowModel({
      nodes,
      edges: [
        {
          kind: "side-effect",
          from: H,
          to: HTTP,
          status: "inferred",
          origin: USER,
        },
        { kind: "reads", from: USER, to: H, status: "static", origin: USER },
      ],
      unknowns: [],
    })
    const policy = buildPolicyModel(real, [
      {
        id: "no-client",
        appliesTo: { field: "userData.user" },
        forbidDestinations: ["client-response"],
      },
    ])
    expect(policyFindings(policy, real)).toStrictEqual([
      {
        code: "FLOW_POLICY_VIOLATED",
        family: "flow",
        severity: "warning",
        message:
          'Rule "no-client" is violated: field "userData.user" reaches client-response "http" (established as inferred).',
        capability: { file: FILE, exportName: "userData" },
        field: ["user"],
        evidence: [
          { model: "policy", id: `no-client#${USER}` },
          { model: "flow", id: `reads:${USER}->${H}@static^${USER}` },
          { model: "flow", id: `side-effect:${H}->${HTTP}@inferred^${USER}` },
        ],
      },
    ])
  })
})

describe("unknownText and flowAnalysisFindings", () => {
  it.each([
    ["dynamic-access", "a computed property key on tracked data"],
    ["unresolved-call", "an unresolved call that receives tracked data"],
    ["unresolved-import", "an import that could not be resolved"],
    ["unsupported-construct", "an unsupported construct"],
    ["missing-source", "source that is not available"],
    ["unanalyzed-function", "a function the analysis did not complete"],
  ] as const satisfies readonly (readonly [FlowUnknownReason, string])[])(
    "describes %s",
    (reason, text) => {
      expect(unknownText(reason)).toBe(text)
    },
  )

  it("reports each unknown with its position and evidence", () => {
    const model = buildFlowModel({
      nodes,
      edges: [],
      unknowns: [
        {
          reason: "unresolved-call",
          source: { file: "a.ts", line: 3, column: 7 },
          detail: "foo()",
        },
        { reason: "dynamic-access", source: { file: "b.ts", line: 1, column: 2 } },
      ],
    })
    expect(flowAnalysisFindings(model)).toStrictEqual([
      {
        code: "FLOW_ANALYSIS_INCOMPLETE",
        family: "flow",
        severity: "info",
        message:
          "The flow analysis could not follow a computed property key on tracked data at b.ts:1:2; data flows through it are shown as inferred.",
        source: "b.ts",
        position: { line: 1, column: 2 },
        evidence: [{ model: "flow", id: "unknown:dynamic-access:b.ts:1:2" }],
      },
      {
        code: "FLOW_ANALYSIS_INCOMPLETE",
        family: "flow",
        severity: "info",
        message:
          "The flow analysis could not follow an unresolved call that receives tracked data at a.ts:3:7 (foo()); data flows through it are shown as inferred.",
        source: "a.ts",
        position: { line: 3, column: 7 },
        evidence: [{ model: "flow", id: "unknown:unresolved-call:a.ts:3:7" }],
      },
    ])
  })

  it("reports nothing for a model with no unknowns", () => {
    expect(flowAnalysisFindings(flow)).toEqual([])
  })
})
