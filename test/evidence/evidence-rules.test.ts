import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  evaluateEvidenceRules,
  EVIDENCE_RULE_NAMES,
  parseEvidenceRules,
} from "../../src/evidence/evidence-rules.js"
import {
  buildFlowEvidence,
  PROFILE_CAPABILITY,
  PROFILE_HANDLERS,
  profileFixture,
} from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

describe("parseEvidenceRules", () => {
  it("accepts a well-formed rules document", () => {
    const parsed = parseEvidenceRules(
      '{ "noPolicyViolations": true, "maxUnknowns": 3, "requireVerified": ["a/b"] }',
    )
    expect(parsed).toEqual({
      ok: true,
      rules: { noPolicyViolations: true, maxUnknowns: 3, requireVerified: ["a/b"] },
    })
  })

  it("rejects invalid JSON, a non-object, and an empty document (a gate with no rules is a mistake, not a pass)", () => {
    expect(parseEvidenceRules("{nope")).toMatchObject({ ok: false })
    expect(parseEvidenceRules("[]")).toMatchObject({ ok: false })
    expect(parseEvidenceRules("{}")).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/no rules/i)],
    })
  })

  it("rejects an unknown key by name, so a misspelled rule can never silently pass", () => {
    const parsed = parseEvidenceRules('{ "noPolicyViolation": true }')
    expect(parsed).toMatchObject({ ok: false })
    expect((parsed as { errors: readonly string[] }).errors.join("\n")).toContain(
      "noPolicyViolation",
    )
  })

  it("rejects values of the wrong type or out of range, one error per problem", () => {
    const parsed = parseEvidenceRules(
      '{ "maxUnknowns": -1, "noPolicyViolations": "yes", "requireVerified": [1], "minVerifiedClaims": 1.5 }',
    )
    expect(parsed).toMatchObject({ ok: false })
    expect((parsed as { errors: readonly string[] }).errors).toHaveLength(4)
  })

  it("lists every rule name it understands", () => {
    expect([...EVIDENCE_RULE_NAMES].sort()).toEqual(
      [
        "maxContradictedClaims",
        "maxUnknowns",
        "maxUnusedSensitivePaths",
        "maxWholeFieldToClient",
        "minVerifiedClaims",
        "noIndeterminatePolicies",
        "noPolicyViolations",
        "requireComplete",
        "requireObservations",
        "requireVerified",
      ].sort(),
    )
  })
})

describe("evaluateEvidenceRules (the profile fixture: a leak, an opaque call, nothing observed)", () => {
  let fixture: FlowEvidenceFixture
  beforeAll(async () => {
    fixture = await profileFixture()
  })
  afterAll(async () => {
    await fixture.cleanup()
  })
  const run = (rules: Parameters<typeof evaluateEvidenceRules>[1]) =>
    evaluateEvidenceRules(fixture.evidence, rules)

  it("noPolicyViolations fails on the leak and cites the rule, the field and the evidence", () => {
    const result = run({ noPolicyViolations: true })
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toMatchObject({ rule: "noPolicyViolations" })
    expect(result.violations[0]?.message).toContain("userData/no-password-to-client")
    expect(
      result.violations[0]?.evidence.some((ref: { model: string }) => ref.model === "policy"),
    ).toBe(true)
    expect(result.evaluated).toEqual(["noPolicyViolations"])
  })

  it("noIndeterminatePolicies passes when every rule could be decided", () => {
    expect(run({ noIndeterminatePolicies: true })).toMatchObject({ ok: true, violations: [] })
  })

  it("maxUnknowns and requireComplete count what the analysis could not follow", () => {
    expect(run({ maxUnknowns: 1 }).ok).toBe(true)
    const tight = run({ maxUnknowns: 0 })
    expect(tight.ok).toBe(false)
    expect(tight.violations[0]?.evidence).toEqual([
      { model: "flow", id: "unknown:unresolved-call:app/track.ts:5:3" },
    ])
    expect(run({ requireComplete: true }).ok).toBe(false)
  })

  it("maxContradictedClaims counts contradicted claims", () => {
    expect(run({ maxContradictedClaims: 1 }).ok).toBe(true)
    expect(run({ maxContradictedClaims: 0 }).ok).toBe(false)
  })

  it("maxWholeFieldToClient uses the least-data analysis: exportEverything sends the whole record", () => {
    const result = run({ maxWholeFieldToClient: 0 })
    expect(result.ok).toBe(false)
    expect(result.violations[0]?.message).toMatch(/sent whole to a client response/)
    expect(run({ maxWholeFieldToClient: 1 }).ok).toBe(true)
  })

  it("maxUnusedSensitivePaths is satisfied here, because that same whole-record send uses every key", () => {
    expect(run({ maxUnusedSensitivePaths: 0 }).ok).toBe(true)
  })

  it("requireObservations fails when nothing was observed", () => {
    expect(run({ requireObservations: true }).ok).toBe(false)
  })

  it("minVerifiedClaims and requireVerified need runtime corroboration, which this fixture lacks", () => {
    expect(run({ minVerifiedClaims: 1 }).ok).toBe(false)
    const required = run({ requireVerified: ["userData/no-role-to-log"] })
    expect(required.ok).toBe(false)
    expect(required.violations[0]?.message).toMatch(/unobserved/)
  })

  it("requireVerified names a rule that has no claim as a violation, not a pass", () => {
    const result = run({ requireVerified: ["userData/typo"] })
    expect(result.ok).toBe(false)
    expect(result.violations[0]?.message).toMatch(/no claim/i)
  })

  it("evaluates every rule given and reports each violation separately", () => {
    const result = run({ noPolicyViolations: true, maxUnknowns: 0, requireComplete: true })
    expect(result.evaluated).toEqual(["noPolicyViolations", "maxUnknowns", "requireComplete"])
    expect(result.violations.map((v: { rule: string }) => v.rule).sort()).toEqual([
      "maxUnknowns",
      "noPolicyViolations",
      "requireComplete",
    ])
  })

  it("is deterministic", () => {
    const rules = { noPolicyViolations: true, maxUnknowns: 0 }
    expect(run(rules)).toEqual(run(rules))
  })
})

describe("evaluateEvidenceRules: unused sensitive paths", () => {
  it("fails when a sensitive field's keys are read by nothing, and names them", async () => {
    const safe = await buildFlowEvidence({
      "features/user.ts": PROFILE_CAPABILITY,
      "app/profile.ts": PROFILE_HANDLERS,
    })
    try {
      const result = evaluateEvidenceRules(safe.evidence, { maxUnusedSensitivePaths: 0 })
      expect(result.ok).toBe(false)
      expect(result.violations[0]?.message).toContain("user.passwordHash")
      expect(result.violations[0]?.message).toContain("user.role")
      expect(evaluateEvidenceRules(safe.evidence, { maxUnusedSensitivePaths: 2 }).ok).toBe(true)
    } finally {
      await safe.cleanup()
    }
  })
})

describe("evaluateEvidenceRules passes when the evidence is clean and corroborated", () => {
  it("a safe handler, observed at runtime, satisfies every rule", async () => {
    const clean = await buildFlowEvidence(
      { "features/user.ts": PROFILE_CAPABILITY, "app/profile.ts": PROFILE_HANDLERS },
      {
        observations: [
          {
            scope: "e2e",
            boundary: { kind: "client-response", name: "http-response" },
            field: "userData.user.email",
          },
          {
            scope: "e2e",
            boundary: { kind: "database", name: "postgres:users" },
            field: "userData.user.passwordHash",
          },
          {
            scope: "e2e",
            boundary: { kind: "database", name: "postgres:users" },
            field: "userData.user.role",
          },
        ],
      },
    )
    try {
      const result = evaluateEvidenceRules(clean.evidence, {
        noPolicyViolations: true,
        noIndeterminatePolicies: true,
        maxContradictedClaims: 0,
        requireObservations: true,
        requireVerified: ["userData/no-password-to-client", "userData/no-role-to-log"],
        minVerifiedClaims: 3,
      })
      expect(result.violations).toEqual([])
      expect(result.ok).toBe(true)
    } finally {
      await clean.cleanup()
    }
  })
})

describe("evaluateEvidenceRules fails closed when the analysis did not run", () => {
  it("every rule that needs flow reports that it could not be evaluated, rather than passing", async () => {
    const without = await profileFixture({ flowEvidence: false })
    try {
      const result = evaluateEvidenceRules(without.evidence, {
        noPolicyViolations: true,
        noIndeterminatePolicies: true,
        maxContradictedClaims: 0,
        maxUnknowns: 0,
        requireComplete: true,
        maxUnusedSensitivePaths: 0,
        maxWholeFieldToClient: 0,
        minVerifiedClaims: 1,
        requireVerified: ["x"],
      })
      expect(result.ok).toBe(false)
      expect(result.violations).toHaveLength(9)
      for (const violation of result.violations)
        expect(violation.message).toMatch(/not computed|--flow-evidence/)
    } finally {
      await without.cleanup()
    }
  })

  it("requireObservations fails when observations were not ingested", async () => {
    const without = await profileFixture()
    try {
      const result = evaluateEvidenceRules(without.evidence, { requireObservations: true })
      expect(result.violations[0]?.message).toMatch(/--observations/)
    } finally {
      await without.cleanup()
    }
  })
})
