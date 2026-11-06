import { describe, expect, it } from "vitest"
import {
  evaluateEvidenceRules,
  EVIDENCE_RULE_NAMES,
  parseEvidenceRules,
} from "../../src/evidence/evidence-rules.js"
import type { EvidenceRulesInput } from "../../src/evidence/evidence-rules.js"
import { buildFlowModel, flowEdgeId, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowModel } from "../../src/flow/flow-model.js"

const FIELD = flowNodeId("field", "features/user.ts", "userData.user")
const FN = flowNodeId("function", "app/p.ts", "f")
const read: FlowEdgeInput = {
  kind: "reads",
  from: FIELD,
  to: FN,
  path: ["email"],
  status: "static",
  origin: FIELD,
}
const readId = flowEdgeId("reads", FIELD, FN, ["email"], "static", FIELD)

function flowWith(count: number): FlowModel {
  return buildFlowModel({
    nodes: [
      { kind: "field", scope: "features/user.ts", name: "userData.user", status: "static" },
      { kind: "function", scope: "app/p.ts", name: "f", status: "static" },
    ],
    edges: [read],
    unknowns: [],
    edgeTags: Array.from({ length: count }, (_, index) => ({
      via: "serialize-roundtrip" as const,
      edge: readId,
      source: { file: "app/p.ts", line: index + 1, column: 1 },
    })),
  })
}

const evidenceOf = (flow: FlowModel | undefined): EvidenceRulesInput =>
  ({ flow }) as unknown as EvidenceRulesInput

describe("maxRedundantTransforms", () => {
  it("is a count rule, evaluated before the observation-age rule", () => {
    expect(EVIDENCE_RULE_NAMES).toContain("maxRedundantTransforms")
    expect(EVIDENCE_RULE_NAMES.indexOf("maxRedundantTransforms")).toBe(
      EVIDENCE_RULE_NAMES.length - 2,
    )
    expect(parseEvidenceRules('{ "maxRedundantTransforms": 3 }')).toEqual({
      ok: true,
      rules: { maxRedundantTransforms: 3 },
    })
    for (const bad of ["-1", "1.5", '"3"', "true", "null"]) {
      expect(parseEvidenceRules(`{ "maxRedundantTransforms": ${bad} }`)).toEqual({
        ok: false,
        errors: ['"maxRedundantTransforms" must be a non-negative whole number.'],
      })
    }
  })

  it("passes at the ceiling and fails above it, naming each one and the records it rests on", () => {
    const flow = flowWith(2)
    expect(evaluateEvidenceRules(evidenceOf(flow), { maxRedundantTransforms: 2 })).toEqual({
      ok: true,
      evaluated: ["maxRedundantTransforms"],
      violations: [],
    })
    expect(evaluateEvidenceRules(evidenceOf(flow), { maxRedundantTransforms: 1 })).toEqual({
      ok: false,
      evaluated: ["maxRedundantTransforms"],
      violations: [
        {
          rule: "maxRedundantTransforms",
          message:
            "2 redundant transformation(s) (round-trip of user, round-trip of user); at most 1 allowed.",
          evidence: [
            { model: "flow", id: FIELD },
            { model: "flow", id: readId },
            { model: "flow", id: FIELD },
            { model: "flow", id: readId },
          ],
        },
      ],
    })
  })

  it("a ceiling of zero is satisfied by a flow with nothing redundant", () => {
    expect(evaluateEvidenceRules(evidenceOf(flowWith(0)), { maxRedundantTransforms: 0 }).ok).toBe(
      true,
    )
  })

  it("fails closed when the flow analysis did not run", () => {
    expect(evaluateEvidenceRules(evidenceOf(undefined), { maxRedundantTransforms: 5 })).toEqual({
      ok: false,
      evaluated: ["maxRedundantTransforms"],
      violations: [
        {
          rule: "maxRedundantTransforms",
          message:
            "maxRedundantTransforms could not be evaluated: the flow analysis was not computed; run with --flow-evidence.",
          evidence: [],
        },
      ],
    })
  })

  it("is not evaluated unless it is set", () => {
    expect(evaluateEvidenceRules(evidenceOf(flowWith(3)), { maxUnknowns: 0 }).evaluated).toEqual([
      "maxUnknowns",
    ])
  })
})
