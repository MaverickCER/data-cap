import { describe, expect, it } from "vitest"
import { buildOscalAssessmentResults } from "../../src/evidence/flow-oscal.js"
import type { OscalInput, OscalOptions } from "../../src/evidence/flow-oscal.js"
import type { Claim } from "../../src/flow/claims-model.js"
import type {
  PolicyIndeterminateReason,
  PolicyOutcome,
  PolicyResult,
} from "../../src/flow/policy-model.js"

const PROVENANCE = {
  generatedAt: "2026-02-03T04:05:06.000Z",
  toolVersion: "4.5.6",
  commit: "deadbeef",
}

function result(
  ruleId: string,
  outcome: PolicyOutcome,
  extra: Partial<PolicyResult> = {},
): PolicyResult {
  return { ruleId, outcome, basis: "static", edges: [], ...extra }
}

function claim(id: string, object: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    kind: "policy-holds",
    statement: `statement ${id}`,
    subject: "cap.f",
    object,
    status: "static",
    verification: "verified",
    scope: { observationScopes: [], traceComplete: true },
    supporting: [],
    contradicting: [],
    derivedFrom: ["flow", "policy"],
    ...extra,
  }
}

function input(
  ruleIds: readonly string[],
  results: readonly PolicyResult[],
  claims: readonly Claim[],
  provenance: OscalInput["provenance"] = PROVENANCE,
): OscalInput {
  return {
    provenance,
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
      rules: ruleIds.map((id) => ({ id, appliesTo: {} })),
      results,
      summary: { satisfied: 0, violated: 0, indeterminate: 0 },
    },
    claims: {
      schemaVersion: 1,
      claims,
      summary: {
        verified: 0,
        inferred: 0,
        unobserved: 0,
        contradicted: 0,
        "observed-only": 0,
        indeterminate: 0,
      },
    },
  }
}

/** The single finding's status for rule `r` mapped to control `C`. */
function statusFor(
  results: readonly PolicyResult[],
  claims: readonly Claim[] = [],
): { state: string; reason: string; remarks?: string | undefined } | undefined {
  const out = buildOscalAssessmentResults(input(["r"], results, claims), { controls: { r: ["C"] } })
  return out?.["assessment-results"].results[0]?.findings?.[0]?.target.status
}

describe("buildOscalAssessmentResults exact output", () => {
  it("returns undefined without a flow", () => {
    expect(
      buildOscalAssessmentResults({ ...input([], [], []), flow: undefined }, { controls: {} }),
    ).toBeUndefined()
  })

  it("maps a comprehensive mixture of rules exactly", () => {
    const options: OscalOptions = {
      controls: {
        violated: ["C-2", "C-1"],
        contradicted: ["C-1", "C-9"],
        undecided: ["C-3"],
        corroborated: ["C-4"],
        bare: ["C-4", "C-5"],
        empty: [],
      },
      title: "Custom title",
      assessmentPlan: "plan.json",
    }
    const out = buildOscalAssessmentResults(
      input(
        ["violated", "contradicted", "undecided", "corroborated", "bare", "empty", "absent"],
        [
          result("violated", "violated", { subject: "cap.a" }),
          result("violated", "violated", { basis: "declared" }),
          result("violated", "violated", { subject: "cap.a" }),
          result("violated", "indeterminate", { reason: "trace-incomplete" }),
          result("contradicted", "satisfied"),
          result("undecided", "indeterminate", { reason: "rule-matches-nothing" }),
          result("undecided", "indeterminate", { reason: "handling-not-declared" }),
          result("undecided", "indeterminate", { reason: "rule-matches-nothing" }),
          result("undecided", "indeterminate"),
          result("bare", "violated", { subject: "elsewhere" }),
        ],
        [
          claim("k-violated", "violated", { verification: "contradicted" }),
          claim("k-contradicted", "contradicted", {
            verification: "contradicted",
            status: "observed",
            contradicting: [{ model: "observation", id: "o-1" }],
            scope: { observationScopes: ["s1"], traceComplete: true },
          }),
          claim("k-corroborated-1", "corroborated", {
            scope: { observationScopes: ["s1", "s2"], traceComplete: true },
            supporting: [
              { model: "flow", id: "f-1" },
              { model: "observation", id: "o-2" },
            ],
          }),
          claim("k-corroborated-2", "corroborated", {
            verification: "inferred",
            status: "inferred",
            scope: { observationScopes: ["s2", "s3"], traceComplete: false },
            contradicting: [{ model: "policy", id: "p-1" }],
          }),
          claim("k-other-kind", "corroborated", { kind: "field-reaches-boundary" }),
          claim("k-other-object", "unrelated"),
        ],
      ),
      options,
    )
    expect(out).toMatchInlineSnapshot(`
      {
        "assessment-results": {
          "import-ap": {
            "href": "plan.json",
          },
          "metadata": {
            "last-modified": "2026-02-03T04:05:06.000Z",
            "oscal-version": "1.1.2",
            "title": "Custom title",
            "version": "4.5.6",
          },
          "results": [
            {
              "description": "data-cap data-flow assessment of 5 rule(s) against 6 control(s).",
              "end": "2026-02-03T04:05:06.000Z",
              "findings": [
                {
                  "description": "data-cap data-flow rule contradicted as evidence for C-1.",
                  "related-observations": [
                    {
                      "observation-uuid": "8fb77a24-c642-5b3e-99ef-41d321c137bd",
                    },
                  ],
                  "target": {
                    "status": {
                      "reason": "fail",
                      "remarks": "Holds statically but is contradicted by runtime observation.",
                      "state": "not-satisfied",
                    },
                    "target-id": "C-1",
                    "type": "objective-id",
                  },
                  "title": "contradicted -- C-1",
                  "uuid": "2d8d73e7-e7af-5fed-ab01-3a46f729b531",
                },
                {
                  "description": "data-cap data-flow rule corroborated as evidence for C-4.",
                  "related-observations": [
                    {
                      "observation-uuid": "768d93e6-00da-5153-be16-4acd975efc8b",
                    },
                    {
                      "observation-uuid": "f5a6aad2-696b-524f-9512-52b2c7e741a9",
                    },
                  ],
                  "target": {
                    "status": {
                      "reason": "pass",
                      "remarks": "Established by static analysis and corroborated by runtime observation in 3 scope(s).",
                      "state": "satisfied",
                    },
                    "target-id": "C-4",
                    "type": "objective-id",
                  },
                  "title": "corroborated -- C-4",
                  "uuid": "390e958e-91cf-50be-89cf-bbe773d46d21",
                },
                {
                  "description": "data-cap data-flow rule bare as evidence for C-4.",
                  "target": {
                    "status": {
                      "reason": "fail",
                      "remarks": "Violated for elsewhere (established by static analysis).",
                      "state": "not-satisfied",
                    },
                    "target-id": "C-4",
                    "type": "objective-id",
                  },
                  "title": "bare -- C-4",
                  "uuid": "44532a5a-9a91-5357-af28-f71d6410af1d",
                },
                {
                  "description": "data-cap data-flow rule violated as evidence for C-1.",
                  "related-observations": [
                    {
                      "observation-uuid": "5c2a91d1-a312-5ca7-93e7-c5eb0e702335",
                    },
                  ],
                  "target": {
                    "status": {
                      "reason": "fail",
                      "remarks": "Violated for cap.a, a field (established by static, declared analysis).",
                      "state": "not-satisfied",
                    },
                    "target-id": "C-1",
                    "type": "objective-id",
                  },
                  "title": "violated -- C-1",
                  "uuid": "566009dd-026d-5fc6-b630-660afa52d04d",
                },
                {
                  "description": "data-cap data-flow rule contradicted as evidence for C-9.",
                  "related-observations": [
                    {
                      "observation-uuid": "8fb77a24-c642-5b3e-99ef-41d321c137bd",
                    },
                  ],
                  "target": {
                    "status": {
                      "reason": "fail",
                      "remarks": "Holds statically but is contradicted by runtime observation.",
                      "state": "not-satisfied",
                    },
                    "target-id": "C-9",
                    "type": "objective-id",
                  },
                  "title": "contradicted -- C-9",
                  "uuid": "5c6e8e64-33ff-5f11-838f-d8456a7db79b",
                },
                {
                  "description": "data-cap data-flow rule violated as evidence for C-2.",
                  "related-observations": [
                    {
                      "observation-uuid": "5c2a91d1-a312-5ca7-93e7-c5eb0e702335",
                    },
                  ],
                  "target": {
                    "status": {
                      "reason": "fail",
                      "remarks": "Violated for cap.a, a field (established by static, declared analysis).",
                      "state": "not-satisfied",
                    },
                    "target-id": "C-2",
                    "type": "objective-id",
                  },
                  "title": "violated -- C-2",
                  "uuid": "8dd076e7-a1f1-5990-8c9b-6874484d3974",
                },
                {
                  "description": "data-cap data-flow rule bare as evidence for C-5.",
                  "target": {
                    "status": {
                      "reason": "fail",
                      "remarks": "Violated for elsewhere (established by static analysis).",
                      "state": "not-satisfied",
                    },
                    "target-id": "C-5",
                    "type": "objective-id",
                  },
                  "title": "bare -- C-5",
                  "uuid": "e7ea1bd7-a52a-5d03-a81e-95d88be526be",
                },
                {
                  "description": "data-cap data-flow rule undecided as evidence for C-3.",
                  "target": {
                    "status": {
                      "reason": "other",
                      "remarks": "Could not be decided by static analysis: the rule matches no field; a governed crossing declares no handling.",
                      "state": "not-satisfied",
                    },
                    "target-id": "C-3",
                    "type": "objective-id",
                  },
                  "title": "undecided -- C-3",
                  "uuid": "ea6e96c9-86cf-5808-91ff-2bff4e9a5c44",
                },
              ],
              "observations": [
                {
                  "collected": "2026-02-03T04:05:06.000Z",
                  "description": "statement k-violated: contradicted (static).",
                  "methods": [
                    "EXAMINE",
                  ],
                  "types": [
                    "finding",
                  ],
                  "uuid": "5c2a91d1-a312-5ca7-93e7-c5eb0e702335",
                },
                {
                  "collected": "2026-02-03T04:05:06.000Z",
                  "description": "statement k-contradicted: contradicted (observed).",
                  "methods": [
                    "EXAMINE",
                    "TEST",
                  ],
                  "relevant-evidence": [
                    {
                      "description": "contradicting: observation o-1",
                    },
                  ],
                  "types": [
                    "finding",
                  ],
                  "uuid": "8fb77a24-c642-5b3e-99ef-41d321c137bd",
                },
                {
                  "collected": "2026-02-03T04:05:06.000Z",
                  "description": "statement k-corroborated-1: verified (static).",
                  "methods": [
                    "EXAMINE",
                    "TEST",
                  ],
                  "relevant-evidence": [
                    {
                      "description": "supporting: flow f-1",
                    },
                    {
                      "description": "supporting: observation o-2",
                    },
                  ],
                  "types": [
                    "finding",
                  ],
                  "uuid": "768d93e6-00da-5153-be16-4acd975efc8b",
                },
                {
                  "collected": "2026-02-03T04:05:06.000Z",
                  "description": "statement k-corroborated-2: inferred (inferred).",
                  "methods": [
                    "EXAMINE",
                    "TEST",
                  ],
                  "relevant-evidence": [
                    {
                      "description": "contradicting: policy p-1",
                    },
                  ],
                  "types": [
                    "finding",
                  ],
                  "uuid": "f5a6aad2-696b-524f-9512-52b2c7e741a9",
                },
              ],
              "props": [
                {
                  "name": "unmapped-rule",
                  "value": "empty",
                },
                {
                  "name": "unmapped-rule",
                  "value": "absent",
                },
              ],
              "reviewed-controls": {
                "control-selections": [
                  {
                    "include-controls": [
                      {
                        "control-id": "C-1",
                      },
                      {
                        "control-id": "C-2",
                      },
                      {
                        "control-id": "C-3",
                      },
                      {
                        "control-id": "C-4",
                      },
                      {
                        "control-id": "C-5",
                      },
                      {
                        "control-id": "C-9",
                      },
                    ],
                  },
                ],
              },
              "start": "2026-02-03T04:05:06.000Z",
              "title": "Data-flow policy results",
              "uuid": "5beeba7f-d428-53a4-b791-7f937117119d",
            },
          ],
          "uuid": "eeb8b79c-b64d-5674-a126-f092e42020d8",
        },
      }
    `)
  })

  it("states plainly that no controls were mapped, and defaults title and plan", () => {
    const out = buildOscalAssessmentResults(
      input(["a", "b"], [result("a", "violated")], [claim("k", "a")]),
      { controls: { a: [] } },
    )
    expect(out).toMatchInlineSnapshot(`
      {
        "assessment-results": {
          "import-ap": {
            "href": "#data-cap-assessment-plan",
          },
          "metadata": {
            "last-modified": "2026-02-03T04:05:06.000Z",
            "oscal-version": "1.1.2",
            "title": "data-cap data-flow assessment",
            "version": "4.5.6",
          },
          "results": [
            {
              "description": "data-cap data-flow assessment. No controls were mapped to data-cap rules, so no findings are reported.",
              "end": "2026-02-03T04:05:06.000Z",
              "props": [
                {
                  "name": "unmapped-rule",
                  "value": "a",
                },
                {
                  "name": "unmapped-rule",
                  "value": "b",
                },
              ],
              "reviewed-controls": {
                "control-selections": [
                  {
                    "description": "No controls were mapped to data-cap rules.",
                  },
                ],
              },
              "start": "2026-02-03T04:05:06.000Z",
              "title": "Data-flow policy results",
              "uuid": "5beeba7f-d428-53a4-b791-7f937117119d",
            },
          ],
          "uuid": "eeb8b79c-b64d-5674-a126-f092e42020d8",
        },
      }
    `)
  })

  it("handles a missing policy and claims, and a missing commit", () => {
    const out = buildOscalAssessmentResults(
      {
        ...input([], [], [], {
          generatedAt: "2026-02-03T04:05:06.000Z",
          toolVersion: "1",
          commit: undefined,
        }),
        policy: undefined,
        claims: undefined,
      },
      { controls: { x: ["C"] } },
    )
    expect(out).toMatchInlineSnapshot(`
      {
        "assessment-results": {
          "import-ap": {
            "href": "#data-cap-assessment-plan",
          },
          "metadata": {
            "last-modified": "2026-02-03T04:05:06.000Z",
            "oscal-version": "1.1.2",
            "title": "data-cap data-flow assessment",
            "version": "1",
          },
          "results": [
            {
              "description": "data-cap data-flow assessment. No controls were mapped to data-cap rules, so no findings are reported.",
              "end": "2026-02-03T04:05:06.000Z",
              "reviewed-controls": {
                "control-selections": [
                  {
                    "description": "No controls were mapped to data-cap rules.",
                  },
                ],
              },
              "start": "2026-02-03T04:05:06.000Z",
              "title": "Data-flow policy results",
              "uuid": "1fa603a2-381f-582e-9630-fadf6cf10f98",
            },
          ],
          "uuid": "c35c483b-a787-5831-b8bf-a6f524c6995f",
        },
      }
    `)
  })

  it("reports a mapped rule as statically satisfied when no claims were computed", () => {
    const out = buildOscalAssessmentResults(
      { ...input(["r"], [result("r", "satisfied")], []), claims: undefined },
      { controls: { r: ["C"] } },
    )
    const first = out?.["assessment-results"].results[0]
    expect(first?.observations).toBeUndefined()
    expect(first?.findings?.map((finding) => finding.target.status)).toEqual([
      {
        state: "satisfied",
        reason: "pass",
        remarks: "Established by static analysis; not observed at runtime.",
      },
    ])
  })

  it("changes every identifier with the commit and the generation instant", () => {
    const base = input(["r"], [], [claim("k", "r")])
    const a = buildOscalAssessmentResults(base, { controls: { r: ["C"] } })
    const b = buildOscalAssessmentResults(
      { ...base, provenance: { ...PROVENANCE, commit: "other" } },
      { controls: { r: ["C"] } },
    )
    const c = buildOscalAssessmentResults(
      { ...base, provenance: { ...PROVENANCE, generatedAt: "2026-02-03T04:05:07.000Z" } },
      { controls: { r: ["C"] } },
    )
    const uuids = (r: typeof a): string[] => [
      r?.["assessment-results"].uuid ?? "",
      r?.["assessment-results"].results[0]?.uuid ?? "",
      r?.["assessment-results"].results[0]?.observations?.[0]?.uuid ?? "",
      r?.["assessment-results"].results[0]?.findings?.[0]?.uuid ?? "",
    ]
    expect(new Set([...uuids(a), ...uuids(b), ...uuids(c)]).size).toBe(12)
  })

  it("orders findings by uuid whatever order the rules and controls come in", () => {
    const controls: Record<string, readonly string[]> = {}
    const ids: string[] = []
    for (let index = 0; index < 12; index += 1) {
      ids.push(`rule-${index}`)
      controls[`rule-${index}`] = [`C-${11 - index}`, `D-${index}`]
    }
    const out = buildOscalAssessmentResults(input(ids, [], []), { controls })
    const uuids = (out?.["assessment-results"].results[0]?.findings ?? []).map((f) => f.uuid)
    expect(uuids).toHaveLength(24)
    expect(uuids).toEqual([...uuids].sort())
  })
})

describe("rule status precedence and wording", () => {
  it("a violation wins over a contradiction and an undecided result", () => {
    expect(
      statusFor(
        [
          result("r", "indeterminate", { reason: "trace-incomplete" }),
          result("r", "violated", { subject: "cap.x", basis: "inferred" }),
        ],
        [claim("k", "r", { verification: "contradicted" })],
      ),
    ).toEqual({
      state: "not-satisfied",
      reason: "fail",
      remarks: "Violated for cap.x (established by inferred analysis).",
    })
  })

  it("names a violation without a subject as a field, deduplicating subjects and bases", () => {
    expect(
      statusFor([
        result("r", "violated"),
        result("r", "violated", { subject: "cap.y", basis: "declared" }),
        result("r", "violated", { subject: "cap.y" }),
        result("r", "violated"),
      ]),
    ).toEqual({
      state: "not-satisfied",
      reason: "fail",
      remarks: "Violated for a field, cap.y (established by static, declared analysis).",
    })
  })

  it("ignores another rule's results and satisfied results", () => {
    expect(
      statusFor([
        result("other", "violated"),
        result("other", "indeterminate"),
        result("r", "satisfied"),
      ]),
    ).toEqual({
      state: "satisfied",
      reason: "pass",
      remarks: "Established by static analysis; not observed at runtime.",
    })
  })

  it("a contradiction wins over an undecided result", () => {
    expect(
      statusFor(
        [result("r", "indeterminate", { reason: "trace-incomplete" })],
        [claim("k", "r", { verification: "contradicted" })],
      ),
    ).toEqual({
      state: "not-satisfied",
      reason: "fail",
      remarks: "Holds statically but is contradicted by runtime observation.",
    })
  })

  it("only a contradicted claim of this rule's policy-holds counts", () => {
    const status = statusFor(
      [],
      [
        claim("a", "r", { verification: "verified" }),
        claim("b", "r", { verification: "observed-only" }),
        claim("c", "other", { verification: "contradicted" }),
        claim("d", "r", { kind: "field-reaches-boundary", verification: "contradicted" }),
      ],
    )
    expect(status?.state).toBe("satisfied")
  })

  it("states each reason a result could not be decided, once, in order of first appearance", () => {
    const reasons: PolicyIndeterminateReason[] = [
      "boundary-kind-unknown",
      "rule-matches-nothing",
      "trace-incomplete",
      "handling-not-declared",
      "rule-matches-nothing",
    ]
    expect(statusFor(reasons.map((reason) => result("r", "indeterminate", { reason })))).toEqual({
      state: "not-satisfied",
      reason: "other",
      remarks:
        "Could not be decided by static analysis: a destination the data reaches has no known kind; the rule matches no field; the flow of the governed data reaches code the analysis could not follow; a governed crossing declares no handling.",
    })
  })

  it("is still not satisfied when an undecided result states no reason", () => {
    expect(statusFor([result("r", "indeterminate")])).toEqual({
      state: "not-satisfied",
      reason: "other",
      remarks: "Could not be decided by static analysis: .",
    })
  })

  it("counts distinct corroborating scopes across claims", () => {
    const withScopes = (...scopes: string[][]): Claim[] =>
      scopes.map((observationScopes, index) =>
        claim(`k${index}`, "r", { scope: { observationScopes, traceComplete: true } }),
      )
    expect(statusFor([result("r", "satisfied")], withScopes(["a"]))?.remarks).toBe(
      "Established by static analysis and corroborated by runtime observation in 1 scope(s).",
    )
    expect(statusFor([], withScopes(["a", "b"], ["b", "c"]))?.remarks).toBe(
      "Established by static analysis and corroborated by runtime observation in 3 scope(s).",
    )
    expect(statusFor([], withScopes([], []))?.remarks).toBe(
      "Established by static analysis; not observed at runtime.",
    )
  })
})
