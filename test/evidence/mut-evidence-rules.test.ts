import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as RulesModule from "../../src/evidence/evidence-rules.js"

const leastData = vi.hoisted(() => ({
  report: { unusedPaths: [] as unknown[], wholeFieldToClient: [] as unknown[] },
  calls: [] as unknown[],
}))

vi.mock("../../src/flow/least-data.js", () => ({
  analyzeLeastData: (input: unknown) => {
    leastData.calls.push(input)
    return leastData.report
  },
}))

import {
  evaluateEvidenceRules,
  EVIDENCE_RULE_NAMES,
  parseEvidenceRules,
} from "../../src/evidence/evidence-rules.js"
import type { EvidenceRules, EvidenceRulesInput } from "../../src/evidence/evidence-rules.js"

const NAMES = EVIDENCE_RULE_NAMES.join(", ")
const NOT_COMPUTED = "the flow analysis was not computed; run with --flow-evidence"

function errorsOf(text: string): readonly string[] {
  const parsed = parseEvidenceRules(text)
  if (parsed.ok) throw new Error("expected a parse failure")
  return parsed.errors
}

describe("parseEvidenceRules: exact outputs", () => {
  it("names the exact error for invalid JSON and for non-objects", () => {
    expect(parseEvidenceRules("{nope")).toEqual({
      ok: false,
      errors: ["The rules are not valid JSON."],
    })
    for (const text of ["[]", "null", "5", '"x"', "true"]) {
      expect(parseEvidenceRules(text)).toEqual({
        ok: false,
        errors: ["The rules must be a JSON object."],
      })
    }
    expect(parseEvidenceRules('{"maxUnknowns": 1}')).toMatchObject({ ok: true })
    expect(parseEvidenceRules("[1]")).toEqual({
      ok: false,
      errors: ["The rules must be a JSON object."],
    })
  })

  it("reports an empty rule set with the full rule list", () => {
    expect(errorsOf("{}")).toEqual([
      `The rules set no rules; a gate with no rules passes everything. Set at least one of: ${NAMES}.`,
    ])
  })

  it("accepts true and false for every boolean rule", () => {
    for (const name of [
      "noPolicyViolations",
      "noIndeterminatePolicies",
      "requireComplete",
      "requireObservations",
    ]) {
      expect(parseEvidenceRules(JSON.stringify({ [name]: true }))).toEqual({
        ok: true,
        rules: { [name]: true },
      })
      expect(parseEvidenceRules(JSON.stringify({ [name]: false }))).toEqual({
        ok: true,
        rules: { [name]: false },
      })
      expect(errorsOf(JSON.stringify({ [name]: 1 }))).toEqual([`"${name}" must be true or false.`])
      expect(errorsOf(JSON.stringify({ [name]: "true" }))).toEqual([
        `"${name}" must be true or false.`,
      ])
    }
  })

  it("accepts a non-negative whole number for every count rule and nothing else", () => {
    for (const name of [
      "maxContradictedClaims",
      "maxUnknowns",
      "maxUnusedSensitivePaths",
      "maxWholeFieldToClient",
      "minVerifiedClaims",
    ]) {
      const message = `"${name}" must be a non-negative whole number.`
      expect(parseEvidenceRules(JSON.stringify({ [name]: 0 }))).toEqual({
        ok: true,
        rules: { [name]: 0 },
      })
      expect(parseEvidenceRules(JSON.stringify({ [name]: 7 }))).toEqual({
        ok: true,
        rules: { [name]: 7 },
      })
      for (const bad of ["-1", "1.5", '"3"', "true", "null", "[]"]) {
        expect(errorsOf(`{"${name}": ${bad}}`)).toEqual([message])
      }
      expect(errorsOf(JSON.stringify({ [name]: true }))).toEqual([message])
    }
  })

  it("accepts a non-empty array of non-empty strings for requireVerified and nothing else", () => {
    const message = `"requireVerified" must be a non-empty array of policy rule ids.`
    expect(parseEvidenceRules('{"requireVerified": ["a/b", "c/d"]}')).toEqual({
      ok: true,
      rules: { requireVerified: ["a/b", "c/d"] },
    })
    expect(parseEvidenceRules('{"requireVerified": ["x"]}')).toMatchObject({ ok: true })
    for (const bad of ["[]", '[""]', '["a", ""]', '["a", 1]', "[1]", '"a/b"', "true", "{}"]) {
      expect(errorsOf(`{"requireVerified": ${bad}}`)).toEqual([message])
    }
  })

  it("names an unknown key with the rule list", () => {
    expect(errorsOf('{"bogus": true}')).toEqual([`"bogus" is not a rule. Rules are: ${NAMES}.`])
  })

  it("collects one error per problem and never returns partial rules", () => {
    expect(errorsOf('{"maxUnknowns": 1, "bogus": 1, "requireComplete": 2}')).toEqual([
      `"bogus" is not a rule. Rules are: ${NAMES}.`,
      `"requireComplete" must be true or false.`,
    ])
  })

  it("does not add the empty-rules error when other errors exist", () => {
    expect(errorsOf('{"bogus": 1}')).toHaveLength(1)
  })

  it("rejects an object whose only key is invalid without the empty-rules message", () => {
    const errors = errorsOf('{"maxUnknowns": "x"}')
    expect(errors).toEqual([`"maxUnknowns" must be a non-negative whole number.`])
  })
})

interface Claim {
  kind: string
  object: string
  subject: string
  statement: string
  verification: string
  supporting: unknown[]
  contradicting: unknown[]
}

function claim(partial: Partial<Claim>): Claim {
  return {
    kind: "policy-holds",
    object: "r/x",
    subject: "s",
    statement: "st",
    verification: "verified",
    supporting: [],
    contradicting: [],
    ...partial,
  }
}

function evidence(parts: Record<string, unknown>): EvidenceRulesInput {
  return {
    capability: { id: "cap" },
    computed: {},
    ...parts,
  } as unknown as EvidenceRulesInput
}

function flow(parts: Record<string, unknown> = {}): unknown {
  return {
    unknowns: [],
    coverage: { complete: true, unknowns: 0, functionsUnanalyzed: 0, edgesUnresolved: 0 },
    ...parts,
  }
}

function claims(list: Claim[], verified = 0): unknown {
  return { claims: list, summary: { verified } }
}

function run(ev: EvidenceRulesInput, rules: EvidenceRules) {
  return evaluateEvidenceRules(ev, rules)
}

beforeEach(() => {
  leastData.report = { unusedPaths: [], wholeFieldToClient: [] }
  leastData.calls = []
})

describe("evaluateEvidenceRules: policy rules", () => {
  const policy = {
    results: [
      { ruleId: "r/a", outcome: "violated", subject: "u.p", reason: "leaks", edges: ["e1", "e2"] },
      { ruleId: "r/b", outcome: "violated", subject: undefined, reason: undefined, edges: ["e9"] },
      { ruleId: "r/c", outcome: "indeterminate", subject: "u.q", reason: undefined, edges: ["e3"] },
      { ruleId: "r/d", outcome: "indeterminate", subject: undefined, reason: "why", edges: [] },
      { ruleId: "r/e", outcome: "satisfied", subject: "u.z", reason: undefined, edges: [] },
    ],
  }

  it("reports each violated result with exact message and evidence", () => {
    const result = run(evidence({ flow: flow(), policy }), { noPolicyViolations: true })
    expect(result).toEqual({
      ok: false,
      evaluated: ["noPolicyViolations"],
      violations: [
        {
          rule: "noPolicyViolations",
          message: "Rule r/a is violated for u.p (leaks).",
          evidence: [
            { model: "policy", id: "r/a#u.p" },
            { model: "flow", id: "e1" },
            { model: "flow", id: "e2" },
          ],
        },
        { rule: "noPolicyViolations", message: "Rule r/b is violated.", evidence: [] },
      ],
    })
  })

  it("reports each indeterminate result with exact message and evidence", () => {
    const result = run(evidence({ flow: flow(), policy }), { noIndeterminatePolicies: true })
    expect(result).toEqual({
      ok: false,
      evaluated: ["noIndeterminatePolicies"],
      violations: [
        {
          rule: "noIndeterminatePolicies",
          message: "Rule r/c is indeterminate for u.q.",
          evidence: [
            { model: "policy", id: "r/c#u.q" },
            { model: "flow", id: "e3" },
          ],
        },
        {
          rule: "noIndeterminatePolicies",
          message: "Rule r/d is indeterminate (why).",
          evidence: [],
        },
      ],
    })
  })

  it("a rule set to false is evaluated but never violates, with or without analysis", () => {
    for (const ev of [evidence({ flow: flow(), policy }), evidence({})]) {
      expect(run(ev, { noPolicyViolations: false, noIndeterminatePolicies: false })).toEqual({
        ok: true,
        evaluated: ["noPolicyViolations", "noIndeterminatePolicies"],
        violations: [],
      })
    }
  })

  it("fails closed when either the policy or the flow is missing", () => {
    for (const ev of [evidence({}), evidence({ flow: flow() }), evidence({ policy })]) {
      expect(run(ev, { noPolicyViolations: true }).violations).toEqual([
        {
          rule: "noPolicyViolations",
          message: `noPolicyViolations could not be evaluated: ${NOT_COMPUTED}.`,
          evidence: [],
        },
      ])
      expect(run(ev, { noIndeterminatePolicies: true }).violations).toEqual([
        {
          rule: "noIndeterminatePolicies",
          message: `noIndeterminatePolicies could not be evaluated: ${NOT_COMPUTED}.`,
          evidence: [],
        },
      ])
    }
  })

  it("passes when no result has the wanted outcome", () => {
    const ev = evidence({
      flow: flow(),
      policy: { results: [{ ruleId: "r", outcome: "satisfied", edges: [] }] },
    })
    expect(run(ev, { noPolicyViolations: true, noIndeterminatePolicies: true })).toEqual({
      ok: true,
      evaluated: ["noPolicyViolations", "noIndeterminatePolicies"],
      violations: [],
    })
  })
})

describe("evaluateEvidenceRules: claim rules", () => {
  it("maxContradictedClaims: exact message and evidence, at the ceiling passes", () => {
    const c1 = claim({
      statement: "one",
      verification: "contradicted",
      contradicting: [{ model: "flow", id: "x" }],
    })
    const c2 = claim({
      statement: "two",
      verification: "contradicted",
      contradicting: [
        { model: "observation", id: "y" },
        { model: "flow", id: "z" },
      ],
    })
    const c3 = claim({ statement: "three", verification: "verified" })
    const ev = evidence({ claims: claims([c1, c2, c3]) })
    expect(run(ev, { maxContradictedClaims: 2 })).toEqual({
      ok: true,
      evaluated: ["maxContradictedClaims"],
      violations: [],
    })
    expect(run(ev, { maxContradictedClaims: 1 }).violations).toEqual([
      {
        rule: "maxContradictedClaims",
        message: "2 claim(s) are contradicted by evidence; at most 1 allowed: one; two.",
        evidence: [
          { model: "flow", id: "x" },
          { model: "observation", id: "y" },
          { model: "flow", id: "z" },
        ],
      },
    ])
    expect(run(ev, { maxContradictedClaims: 0 }).violations[0]?.message).toBe(
      "2 claim(s) are contradicted by evidence; at most 0 allowed: one; two.",
    )
  })

  it("minVerifiedClaims: exact message; exactly the floor passes; zero floor passes", () => {
    const ev = (verified: number) => evidence({ claims: claims([], verified) })
    expect(run(ev(2), { minVerifiedClaims: 3 })).toEqual({
      ok: false,
      evaluated: ["minVerifiedClaims"],
      violations: [
        {
          rule: "minVerifiedClaims",
          message: "2 claim(s) are verified; at least 3 required.",
          evidence: [],
        },
      ],
    })
    expect(run(ev(3), { minVerifiedClaims: 3 }).ok).toBe(true)
    expect(run(ev(4), { minVerifiedClaims: 3 }).ok).toBe(true)
    expect(run(ev(0), { minVerifiedClaims: 0 }).ok).toBe(true)
  })

  it("the claim rules fail closed without claims, naming the rule", () => {
    for (const rule of ["maxContradictedClaims", "minVerifiedClaims", "requireVerified"] as const) {
      const rules = rule === "requireVerified" ? { requireVerified: ["a"] } : { [rule]: 0 }
      expect(run(evidence({}), rules).violations).toEqual([
        { rule, message: `${rule} could not be evaluated: ${NOT_COMPUTED}.`, evidence: [] },
      ])
    }
  })

  it("requireVerified: exact messages for unverified and undeclared rules", () => {
    const ev = evidence({
      claims: claims([
        claim({ object: "r/a", subject: "u.a", verification: "verified" }),
        claim({
          object: "r/b",
          subject: "u.b",
          verification: "unobserved",
          supporting: [{ model: "flow", id: "s1" }],
          contradicting: [{ model: "observation", id: "c1" }],
        }),
        claim({ object: "r/b", subject: "u.c", verification: "contradicted" }),
        claim({ kind: "other", object: "r/d", subject: "u.d", verification: "unobserved" }),
      ]),
    })
    expect(run(ev, { requireVerified: ["r/a"] })).toEqual({
      ok: true,
      evaluated: ["requireVerified"],
      violations: [],
    })
    expect(run(ev, { requireVerified: ["r/b", "r/d", "r/zz"] }).violations).toEqual([
      {
        rule: "requireVerified",
        message: "Rule r/b is unobserved for u.b, not verified.",
        evidence: [
          { model: "flow", id: "s1" },
          { model: "observation", id: "c1" },
        ],
      },
      {
        rule: "requireVerified",
        message: "Rule r/b is contradicted for u.c, not verified.",
        evidence: [],
      },
      {
        rule: "requireVerified",
        message: "Rule r/d has no claim to verify: it is not declared, or it matched no field.",
        evidence: [],
      },
      {
        rule: "requireVerified",
        message: "Rule r/zz has no claim to verify: it is not declared, or it matched no field.",
        evidence: [],
      },
    ])
  })
})

describe("evaluateEvidenceRules: flow rules", () => {
  const unknowns = [{ id: "u1" }, { id: "u2" }]

  it("maxUnknowns: exact message and evidence; at the ceiling passes", () => {
    const ev = evidence({ flow: flow({ unknowns }) })
    expect(run(ev, { maxUnknowns: 2 }).ok).toBe(true)
    expect(run(ev, { maxUnknowns: 1 })).toEqual({
      ok: false,
      evaluated: ["maxUnknowns"],
      violations: [
        {
          rule: "maxUnknowns",
          message: "The analysis could not follow 2 place(s); at most 1 allowed.",
          evidence: [
            { model: "flow", id: "u1" },
            { model: "flow", id: "u2" },
          ],
        },
      ],
    })
  })

  it("requireComplete: exact message; false or complete never violates; other rules do not trigger it", () => {
    const incomplete = evidence({
      flow: flow({
        unknowns,
        coverage: { complete: false, unknowns: 2, functionsUnanalyzed: 3, edgesUnresolved: 4 },
      }),
    })
    expect(run(incomplete, { requireComplete: true }).violations).toEqual([
      {
        rule: "requireComplete",
        message:
          "The flow analysis is not complete: 2 unknown(s), 3 function(s) not fully analyzed, 4 unresolved edge(s).",
        evidence: [
          { model: "flow", id: "u1" },
          { model: "flow", id: "u2" },
        ],
      },
    ])
    expect(run(incomplete, { requireComplete: false })).toEqual({
      ok: true,
      evaluated: ["requireComplete"],
      violations: [],
    })
    expect(run(incomplete, { maxUnknowns: 5 }).violations).toEqual([])
    expect(run(evidence({ flow: flow() }), { requireComplete: true }).ok).toBe(true)
  })

  it("maxUnknowns does not fire when only requireComplete is set and vice versa", () => {
    const ev = evidence({
      flow: flow({
        unknowns,
        coverage: { complete: false, unknowns: 2, functionsUnanalyzed: 0, edgesUnresolved: 0 },
      }),
    })
    const both = run(ev, { maxUnknowns: 0, requireComplete: true })
    expect(both.violations.map((v) => v.rule)).toEqual(["maxUnknowns", "requireComplete"])
  })

  it("the flow rules fail closed without flow", () => {
    for (const rules of [
      { maxUnknowns: 0 },
      { requireComplete: true },
      { maxUnusedSensitivePaths: 0 },
      { maxWholeFieldToClient: 0 },
    ] as const) {
      const rule = Object.keys(rules)[0]
      expect(run(evidence({}), rules).violations).toEqual([
        { rule, message: `${rule} could not be evaluated: ${NOT_COMPUTED}.`, evidence: [] },
      ])
    }
    expect(leastData.calls).toEqual([])
  })
})

describe("evaluateEvidenceRules: least-data rules", () => {
  const unused = (field: string, key: string, sensitivity: string | undefined) => ({
    field,
    path: [key],
    fieldNode: `node:${field}`,
    sensitivity,
  })

  it("passes the capability and flow to the analysis", () => {
    const ev = evidence({ flow: flow() })
    run(ev, { maxUnusedSensitivePaths: 0 })
    expect(leastData.calls).toEqual([{ capability: { id: "cap" }, flow: flow() }])
  })

  it("maxUnusedSensitivePaths counts only sensitive paths; exact message and evidence", () => {
    leastData.report = {
      unusedPaths: [
        unused("user", "hash", "confidential"),
        unused("user", "nick", undefined),
        unused("acct", "pin", "secret"),
      ],
      wholeFieldToClient: [],
    }
    const ev = evidence({ flow: flow() })
    expect(run(ev, { maxUnusedSensitivePaths: 2 })).toEqual({
      ok: true,
      evaluated: ["maxUnusedSensitivePaths"],
      violations: [],
    })
    expect(run(ev, { maxUnusedSensitivePaths: 1 }).violations).toEqual([
      {
        rule: "maxUnusedSensitivePaths",
        message:
          "2 path(s) of sensitive fields are never used (user.hash, acct.pin); at most 1 allowed.",
        evidence: [
          { model: "flow", id: "node:user" },
          { model: "flow", id: "node:acct" },
        ],
      },
    ])
  })

  it("maxWholeFieldToClient: exact message and evidence; at the ceiling passes", () => {
    leastData.report = {
      unusedPaths: [unused("user", "hash", "confidential")],
      wholeFieldToClient: [
        { fieldNode: "n1", edges: ["a", "b"] },
        { fieldNode: "n2", edges: [] },
      ],
    }
    const ev = evidence({ flow: flow() })
    expect(run(ev, { maxWholeFieldToClient: 2 }).ok).toBe(true)
    expect(run(ev, { maxWholeFieldToClient: 1 }).violations).toEqual([
      {
        rule: "maxWholeFieldToClient",
        message: "2 field(s) are sent whole to a client response; at most 1 allowed.",
        evidence: [
          { model: "flow", id: "n1" },
          { model: "flow", id: "a" },
          { model: "flow", id: "b" },
          { model: "flow", id: "n2" },
        ],
      },
    ])
  })

  it("the two least-data rules are independent", () => {
    leastData.report = {
      unusedPaths: [unused("user", "hash", "confidential")],
      wholeFieldToClient: [{ fieldNode: "n1", edges: [] }],
    }
    const ev = evidence({ flow: flow() })
    expect(run(ev, { maxWholeFieldToClient: 5 }).violations).toEqual([])
    expect(run(ev, { maxUnusedSensitivePaths: 5 }).violations).toEqual([])
  })
})

describe("evaluateEvidenceRules: requireObservations", () => {
  it("exact messages for missing and empty observations; false and present pass", () => {
    expect(run(evidence({}), { requireObservations: true })).toEqual({
      ok: false,
      evaluated: ["requireObservations"],
      violations: [
        {
          rule: "requireObservations",
          message: "No runtime observations were ingested; run with --observations.",
          evidence: [],
        },
      ],
    })
    expect(
      run(evidence({ observation: { observations: [] } }), { requireObservations: true })
        .violations,
    ).toEqual([
      {
        rule: "requireObservations",
        message: "Runtime observations were ingested but none were recorded.",
        evidence: [],
      },
    ])
    expect(run(evidence({}), { requireObservations: false })).toEqual({
      ok: true,
      evaluated: ["requireObservations"],
      violations: [],
    })
    expect(
      run(evidence({ observation: { observations: [{}] } }), { requireObservations: true }).ok,
    ).toBe(true)
  })
})

describe("evaluateEvidenceRules: ordering", () => {
  it("evaluates in canonical order regardless of key order and skips unset rules", () => {
    const result = run(evidence({ flow: flow(), claims: claims([], 9) }), {
      minVerifiedClaims: 1,
      maxUnknowns: 0,
    })
    expect(result.evaluated).toEqual(["maxUnknowns", "minVerifiedClaims"])
  })
})

describe("evidence-rules loaded fresh inside the test (module-level constants)", () => {
  async function fresh(): Promise<typeof RulesModule> {
    vi.resetModules()
    return import("../../src/evidence/evidence-rules.js")
  }

  it("classifies every rule name as boolean, count or list", async () => {
    const { parseEvidenceRules: parse } = await fresh()
    for (const name of [
      "noPolicyViolations",
      "noIndeterminatePolicies",
      "requireComplete",
      "requireObservations",
    ]) {
      expect(parse(JSON.stringify({ [name]: true }))).toEqual({ ok: true, rules: { [name]: true } })
      expect(parse(JSON.stringify({ [name]: 3 }))).toEqual({
        ok: false,
        errors: [`"${name}" must be true or false.`],
      })
    }
    for (const name of [
      "maxContradictedClaims",
      "maxUnknowns",
      "maxUnusedSensitivePaths",
      "maxWholeFieldToClient",
      "minVerifiedClaims",
    ]) {
      expect(parse(JSON.stringify({ [name]: 3 }))).toEqual({ ok: true, rules: { [name]: 3 } })
      expect(parse(JSON.stringify({ [name]: true }))).toEqual({
        ok: false,
        errors: [`"${name}" must be a non-negative whole number.`],
      })
    }
    expect(parse('{"requireVerified": ["a"]}')).toEqual({
      ok: true,
      rules: { requireVerified: ["a"] },
    })
    expect(parse('{"": true}')).toEqual({
      ok: false,
      errors: [`"" is not a rule. Rules are: ${NAMES}.`],
    })
  })

  it("names the missing analysis in the exact fail-closed message", async () => {
    const { evaluateEvidenceRules: evaluate } = await fresh()
    expect(evaluate(evidence({}), { maxUnknowns: 0 }).violations[0]?.message).toBe(
      `maxUnknowns could not be evaluated: ${NOT_COMPUTED}.`,
    )
  })
})

describe("evaluateEvidenceRules: further adversarial inputs", () => {
  it("joins multi-segment unused paths with dots and several paths with comma-space", () => {
    leastData.report = {
      unusedPaths: [
        { field: "user", path: ["a", "b"], fieldNode: "n1", sensitivity: "x" },
        { field: "acct", path: ["c"], fieldNode: "n2", sensitivity: "y" },
      ],
      wholeFieldToClient: [],
    }
    expect(
      run(evidence({ flow: flow() }), { maxUnusedSensitivePaths: 0 }).violations[0]?.message,
    ).toBe("2 path(s) of sensitive fields are never used (user.a.b, acct.c); at most 0 allowed.")
  })

  it("rejects non-string members of requireVerified that have a length", () => {
    expect(errorsOf('{"requireVerified": [["a"]]}')).toEqual([
      `"requireVerified" must be a non-empty array of policy rule ids.`,
    ])
    expect(errorsOf('{"requireVerified": [{"length": 3}]}')).toEqual([
      `"requireVerified" must be a non-empty array of policy rule ids.`,
    ])
  })

  it("rejects a count given as a non-number that coerces to a whole number", () => {
    for (const bad of ['"3"', '"0"', "true", "[]", "[3]", "null"]) {
      expect(errorsOf(`{"maxUnknowns": ${bad}}`)).toEqual([
        `"maxUnknowns" must be a non-negative whole number.`,
      ])
    }
  })

  it("reports a repeated rule id once per unverified claim, not once per repetition", () => {
    const ev = evidence({
      claims: claims([claim({ object: "r/b", subject: "u.b", verification: "unobserved" })]),
    })
    expect(run(ev, { requireVerified: ["r/b", "r/b"] }).violations).toHaveLength(1)
  })
})
