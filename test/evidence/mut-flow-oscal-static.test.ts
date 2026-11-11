import { describe, expect, it } from "vitest"
import type { OscalInput } from "../../src/evidence/flow-oscal.js"

/**
 * A module-level constant (the control part-id regex) is evaluated when the module loads, so a test
 * file that imports it at its top never "covers" its mutants: the load happened before any test ran.
 * These tests import the modules inside the test body, so the load is attributed to them and the
 * mutants are run against the exact expectations below.
 */

function bare(): OscalInput {
  return {
    provenance: { generatedAt: "2026-02-03T04:05:06.000Z", toolVersion: "4.5.6", commit: "abc" },
    flow: {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      unknowns: [],
      coverage: {
        functionsAnalyzed: 0,
        functionsUnanalyzed: 0,
        edgesUnresolved: 0,
        unknowns: 0,
        complete: true,
      },
    },
    policy: {
      schemaVersion: 1,
      rules: [{ id: "r", appliesTo: {} }],
      results: [],
      summary: { satisfied: 0, violated: 0, indeterminate: 0 },
    },
    claims: undefined,
  }
}

describe("the control part-id pattern", () => {
  it("names the control and the part for every form NIST's catalogs use, and nothing looser", async () => {
    const { buildOscalAssessmentResults } = await import("../../src/evidence/flow-oscal.js")
    const ids = [
      "ac-4",
      "ac-4_obj",
      "ac-4_smt",
      "ac-4_smt.a",
      "ac-4_smt.ab",
      "a_b_obj",
      "ac-4_objx",
    ]
    const out = buildOscalAssessmentResults(bare(), { controls: { r: ids } })!
    const result = out["assessment-results"].results[0]!
    const findings = (result.findings ?? []).map((f) => [
      f.title,
      f.target.type,
      f.target["target-id"],
    ])
    expect(findings.sort()).toEqual([
      ["r -- a_b_obj", "objective-id", "a_b_obj_obj"],
      ["r -- ac-4", "objective-id", "ac-4_obj"],
      ["r -- ac-4_obj", "objective-id", "ac-4_obj"],
      ["r -- ac-4_objx", "objective-id", "ac-4_objx_obj"],
      ["r -- ac-4_smt", "statement-id", "ac-4_smt"],
      ["r -- ac-4_smt.a", "statement-id", "ac-4_smt.a"],
      ["r -- ac-4_smt.ab", "statement-id", "ac-4_smt.ab"],
    ])
    const reviewed = result["reviewed-controls"]["control-selections"][0]?.[
      "include-controls"
    ]?.map((c) => c["control-id"])
    expect(reviewed).toEqual(["a_b_obj", "ac-4", "ac-4_objx"])
  })
})

describe("the disclaimer sentence", () => {
  it("is exactly the build entry's disclaimer followed by what the flow analysis adds", async () => {
    const { flowEvidenceDisclaimer } = await import("../../src/evidence/flow-disclaimer.js")
    const { evidenceDisclaimer } = await import("../../src/build/generated-banner.js")
    expect(flowEvidenceDisclaimer()).toBe(
      `${evidenceDisclaimer()} Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.`,
    )
  })
})
