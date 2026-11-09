import { describe, expect, it } from "vitest"
import { flowAnalysisFindings, policyFindings } from "../../src/flow/flow-findings.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"
import type { FlowPolicyRule } from "../../src/flow/policy-model.js"

const CAP_FILE = "features/user.ts"
const field: FlowNodeInput = {
  kind: "field",
  scope: CAP_FILE,
  name: "userData.user",
  status: "static",
  classification: "pii",
}
const http: FlowNodeInput = {
  kind: "boundary",
  scope: "boundary:code",
  name: "http-response",
  status: "static",
  boundaryKind: "client-response",
}
const fid = flowNodeId("field", CAP_FILE, "userData.user")
const hid = flowNodeId("boundary", "boundary:code", "http-response")
const rule: FlowPolicyRule = {
  id: "userData/pii-not-to-client",
  appliesTo: { classification: "pii" },
  forbidDestinations: ["client-response"],
}
const sideEffect = (status: FlowEdgeInput["status"], path?: string[]): FlowEdgeInput => ({
  kind: "side-effect",
  from: fid,
  to: hid,
  status,
  origin: fid,
  ...(path === undefined ? {} : { path }),
})

function flowWith(edge: FlowEdgeInput | undefined) {
  return buildFlowModel({
    nodes: [field, http],
    edges: edge === undefined ? [] : [edge],
    unknowns: [],
  })
}

describe("policyFindings", () => {
  it("a violation proven by static analysis is an error", () => {
    const flow = flowWith(sideEffect("static", ["email"]))
    const [finding] = policyFindings(buildPolicyModel(flow, [rule]), flow)
    expect(finding).toMatchObject({
      code: "FLOW_POLICY_VIOLATED",
      family: "flow",
      severity: "error",
      capability: { file: CAP_FILE, exportName: "userData" },
      field: ["user"],
    })
    expect(finding?.message).toContain("userData/pii-not-to-client")
    expect(finding?.message).toContain("http-response")
  })

  it("a violation links to the policy result and to the flow edges that justify it", () => {
    const flow = flowWith(sideEffect("static", ["email"]))
    const policy = buildPolicyModel(flow, [rule])
    const [finding] = policyFindings(policy, flow)
    const result = policy.results[0]!
    expect(finding?.evidence).toEqual([
      { model: "policy", id: `${rule.id}#${fid}` },
      ...result.edges.map((edgeId) => ({ model: "flow", id: edgeId })),
    ])
    expect(result.edges.length).toBeGreaterThan(0)
  })

  it("an indeterminate result links to its policy result only", () => {
    const flow = flowWith(undefined)
    const [finding] = policyFindings(
      buildPolicyModel(flow, [{ ...rule, appliesTo: { classification: "nothing" } }]),
      flow,
    )
    expect(finding?.evidence).toBeUndefined()
  })

  it("a violation resting on an inferred edge is only a warning", () => {
    const flow = flowWith(sideEffect("inferred"))
    expect(policyFindings(buildPolicyModel(flow, [rule]), flow)[0]).toMatchObject({
      code: "FLOW_POLICY_VIOLATED",
      severity: "warning",
    })
  })

  it("an indeterminate result is a warning that names the reason", () => {
    const flow = buildFlowModel({
      nodes: [field, { kind: "function", scope: "app.ts", name: "f", status: "unknown" }],
      edges: [
        {
          kind: "passes",
          from: fid,
          to: flowNodeId("function", "app.ts", "f"),
          status: "static",
          origin: fid,
        },
      ],
      unknowns: [],
    })
    const [finding] = policyFindings(buildPolicyModel(flow, [rule]), flow)
    expect(finding).toMatchObject({ code: "FLOW_POLICY_INDETERMINATE", severity: "warning" })
    expect(finding?.message).toMatch(/could not follow|incomplete/i)
  })

  it("a rule that matches nothing is reported, with no capability", () => {
    const flow = flowWith(undefined)
    const [finding] = policyFindings(
      buildPolicyModel(flow, [{ ...rule, appliesTo: { classification: "nothing" } }]),
      flow,
    )
    expect(finding).toMatchObject({ code: "FLOW_POLICY_INDETERMINATE", severity: "warning" })
    expect(finding?.capability).toBeUndefined()
    expect(finding?.message).toMatch(/matches no field/)
  })

  it("names each indeterminate reason distinctly", () => {
    const reasons = new Set<string>()
    const flow = buildFlowModel({
      nodes: [
        field,
        { kind: "boundary", scope: "boundary:code", name: "mystery", status: "static" },
      ],
      edges: [
        {
          kind: "side-effect",
          from: fid,
          to: flowNodeId("boundary", "boundary:code", "mystery"),
          status: "static",
          origin: fid,
        },
      ],
      unknowns: [],
    })
    for (const r of [
      rule,
      {
        ...rule,
        id: "needs-handling",
        forbidDestinations: undefined,
        requireHandling: ["masked" as const],
      },
    ]) {
      for (const finding of policyFindings(buildPolicyModel(flow, [r]), flow))
        reasons.add(finding.message)
    }
    expect(reasons.size).toBe(2)
  })

  it("a satisfied rule produces no finding", () => {
    const flow = flowWith(undefined)
    expect(policyFindings(buildPolicyModel(flow, [rule]), flow)).toEqual([])
  })

  it("is deterministic", () => {
    const flow = flowWith(sideEffect("static"))
    const policy = buildPolicyModel(flow, [rule])
    expect(policyFindings(policy, flow)).toEqual(policyFindings(policy, flow))
  })
})

describe("flowAnalysisFindings", () => {
  it("emits one info finding per unknown, citing the location", () => {
    const flow = buildFlowModel({
      nodes: [{ kind: "function", scope: "app.ts", name: "h", status: "static" }],
      edges: [],
      unknowns: [
        {
          reason: "unresolved-call",
          subject: flowNodeId("function", "app.ts", "h"),
          source: { file: "app.ts", line: 4, column: 3 },
          detail: "call target is not a project function",
        },
        { reason: "dynamic-access", source: { file: "app.ts", line: 9, column: 1 } },
      ],
    })
    const findings = flowAnalysisFindings(flow)
    expect(findings).toHaveLength(2)
    // Unknowns are ordered by content-addressed id, not insertion order.
    const unresolved = findings.find((finding) => finding.message.includes("unresolved call"))
    expect(unresolved).toMatchObject({
      code: "FLOW_ANALYSIS_INCOMPLETE",
      family: "flow",
      severity: "info",
      source: "app.ts",
      position: { line: 4, column: 3 },
    })
    expect(unresolved?.message).toContain("app.ts:4:3")
    expect(findings.some((finding) => finding.message.includes("computed property key"))).toBe(true)
  })

  it("links each finding to the unknown it reports", () => {
    const flow = buildFlowModel({
      nodes: [],
      edges: [],
      unknowns: [{ reason: "dynamic-access", source: { file: "app.ts", line: 9, column: 1 } }],
    })
    expect(flowAnalysisFindings(flow)[0]?.evidence).toEqual([
      { model: "flow", id: "unknown:dynamic-access:app.ts:9:1" },
    ])
  })

  it("emits nothing for a complete model", () => {
    expect(flowAnalysisFindings(buildFlowModel({ nodes: [], edges: [], unknowns: [] }))).toEqual([])
  })
})
