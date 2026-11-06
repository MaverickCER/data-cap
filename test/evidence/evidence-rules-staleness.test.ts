import { describe, expect, it } from "vitest"
import {
  evaluateEvidenceRules,
  EVIDENCE_RULE_NAMES,
  parseEvidenceRules,
} from "../../src/evidence/evidence-rules.js"
import type { EvidenceRulesInput } from "../../src/evidence/evidence-rules.js"
import type { Claim, ClaimsModel, ClaimVerification } from "../../src/flow/claims-model.js"

const GENERATED_AT = "2026-03-31T12:00:00.000Z"

function claim(name: string, verification: ClaimVerification, lastObservedAt?: string): Claim {
  return {
    id: `claim:${name}`,
    kind: "field-reaches-boundary",
    statement: `${name} reaches client-response http`,
    subject: name,
    object: "http",
    status: "static",
    verification,
    scope: { observationScopes: [], traceComplete: true },
    supporting: [{ model: "observation", id: `observation:${name}` }],
    contradicting: [],
    derivedFrom: ["flow"],
    ...(lastObservedAt === undefined ? {} : { lastObservedAt }),
  }
}

function inputOf(claims: Claim[], generatedAt: string = GENERATED_AT): EvidenceRulesInput {
  const summary = {
    verified: 0,
    inferred: 0,
    unobserved: 0,
    contradicted: 0,
    "observed-only": 0,
    indeterminate: 0,
  }
  for (const item of claims) summary[item.verification] += 1
  const model: ClaimsModel = { schemaVersion: 1, claims, summary }
  const base = { claims: model, provenance: { generatedAt, toolVersion: "1", commit: "c" } }
  return base as unknown as EvidenceRulesInput
}

describe("maxObservationAgeDays: parsing", () => {
  it("is a rule name, evaluated last", () => {
    expect(EVIDENCE_RULE_NAMES.at(-1)).toBe("maxObservationAgeDays")
  })

  it("accepts a non-negative whole number", () => {
    expect(parseEvidenceRules('{ "maxObservationAgeDays": 30 }')).toEqual({
      ok: true,
      rules: { maxObservationAgeDays: 30 },
    })
    expect(parseEvidenceRules('{ "maxObservationAgeDays": 0 }')).toMatchObject({ ok: true })
  })

  it("rejects negative, fractional and non-numeric values", () => {
    for (const bad of ["-1", "1.5", '"7"', "true"]) {
      expect(parseEvidenceRules(`{ "maxObservationAgeDays": ${bad} }`)).toMatchObject({
        ok: false,
        errors: [expect.stringContaining("maxObservationAgeDays")],
      })
    }
  })
})

describe("maxObservationAgeDays: evaluation", () => {
  const rules = { maxObservationAgeDays: 30 }

  it("passes a verified claim observed within the window", () => {
    const result = evaluateEvidenceRules(
      inputOf([claim("a", "verified", "2026-03-10T00:00:00.000Z")]),
      rules,
    )
    expect(result).toEqual({ ok: true, evaluated: ["maxObservationAgeDays"], violations: [] })
  })

  it("passes a claim observed exactly at the boundary (age equals the limit)", () => {
    const result = evaluateEvidenceRules(
      inputOf([claim("a", "verified", "2026-03-01T12:00:00.000Z")]),
      rules,
    )
    expect(result.ok).toBe(true)
  })

  it("fails a verified claim last observed more than n days before generation", () => {
    const result = evaluateEvidenceRules(
      inputOf([claim("a", "verified", "2026-03-01T11:59:59.999Z")]),
      rules,
    )
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toMatchObject({
      rule: "maxObservationAgeDays",
      evidence: [{ model: "observation", id: "observation:a" }],
    })
    expect(result.violations[0]?.message).toContain("a reaches client-response http")
    expect(result.violations[0]?.message).toContain("2026-03-01T11:59:59.999Z")
    expect(result.violations[0]?.message).toContain("30")
  })

  it("fails closed when a verified claim has no timestamp", () => {
    const result = evaluateEvidenceRules(inputOf([claim("a", "verified")]), rules)
    expect(result.ok).toBe(false)
    expect(result.violations[0]?.message).toMatch(/no observation time/)
    expect(result.violations[0]?.message).toContain("a reaches client-response http")
  })

  it("reports every stale or untimed verified claim, one violation each", () => {
    const result = evaluateEvidenceRules(
      inputOf([
        claim("old", "verified", "2025-01-01T00:00:00.000Z"),
        claim("fresh", "verified", "2026-03-30T00:00:00.000Z"),
        claim("untimed", "verified"),
      ]),
      rules,
    )
    expect(result.violations).toHaveLength(2)
    expect(result.violations[0]?.message).toContain("old reaches")
    expect(result.violations[0]?.message).toContain("2025-01-01T00:00:00.000Z")
    expect(result.violations[1]?.message).toContain("untimed reaches")
    expect(result.violations[1]?.message).toMatch(/no observation time/)
  })

  it("ignores claims that are not verified, whatever their age", () => {
    const result = evaluateEvidenceRules(
      inputOf([
        claim("a", "unobserved"),
        claim("b", "contradicted", "2000-01-01T00:00:00.000Z"),
        claim("c", "indeterminate"),
      ]),
      rules,
    )
    expect(result.ok).toBe(true)
  })

  it("passes when there are no verified claims at all (use minVerifiedClaims to require some)", () => {
    expect(evaluateEvidenceRules(inputOf([]), rules).ok).toBe(true)
  })

  it("does not judge a generation time when there is no verified claim to judge against it", () => {
    expect(evaluateEvidenceRules(inputOf([claim("a", "unobserved")], "not a time"), rules).ok).toBe(
      true,
    )
  })

  it("fails, naming the rule, when the generation time is not an instant", () => {
    const result = evaluateEvidenceRules(
      inputOf([claim("a", "verified", "2026-03-10T00:00:00.000Z")], "not a time"),
      rules,
    )
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.rule).toBe("maxObservationAgeDays")
    expect(result.violations[0]?.message).toContain('"not a time" is not a valid instant')
  })

  it("names the rule on a claim with no observation time, and treats a time that is not an instant the same", () => {
    for (const lastObservedAt of [undefined, "yesterday-ish"]) {
      const result = evaluateEvidenceRules(inputOf([claim("a", "verified", lastObservedAt)]), rules)
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0]?.rule).toBe("maxObservationAgeDays")
      expect(result.violations[0]?.message).toMatch(/no observation time/)
    }
  })

  it("0 days allows only observations at or after the generation instant", () => {
    const zero = { maxObservationAgeDays: 0 }
    expect(evaluateEvidenceRules(inputOf([claim("a", "verified", GENERATED_AT)]), zero).ok).toBe(
      true,
    )
    expect(
      evaluateEvidenceRules(inputOf([claim("a", "verified", "2026-03-31T11:59:59.999Z")]), zero).ok,
    ).toBe(false)
  })

  it("fails when the claims were not computed", () => {
    const input = { provenance: { generatedAt: GENERATED_AT } } as unknown as EvidenceRulesInput
    const result = evaluateEvidenceRules(input, rules)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.message).toContain("maxObservationAgeDays could not be evaluated")
  })

  it("fails closed when generatedAt is not a valid instant", () => {
    const result = evaluateEvidenceRules(
      inputOf([claim("a", "verified", "2026-03-10T00:00:00.000Z")], "not a date"),
      rules,
    )
    expect(result.ok).toBe(false)
    expect(result.violations[0]?.message).toMatch(/generation time/)
  })

  it("fails closed for a claim whose lastObservedAt is not a valid instant", () => {
    const result = evaluateEvidenceRules(inputOf([claim("a", "verified", "garbage")]), rules)
    expect(result.ok).toBe(false)
  })

  it("is not evaluated when unset", () => {
    expect(
      evaluateEvidenceRules(inputOf([claim("a", "verified")]), { maxContradictedClaims: 0 })
        .evaluated,
    ).toEqual(["maxContradictedClaims"])
  })
})
