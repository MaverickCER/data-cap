import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { profileFixture } from "./flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "./flow-evidence-fixture.js"

// Pins what the shared fixture actually contains, so a later change to the scanner that quietly
// weakens every adapter test's input fails here, loudly, instead of passing everywhere.
describe("the shared profile fixture", () => {
  let fixture: FlowEvidenceFixture
  beforeAll(async () => {
    fixture = await profileFixture()
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  it("has a flow, a policy with a violation, an unknown, and derived claims", () => {
    const { evidence } = fixture
    expect(evidence.computed).toMatchObject({ flow: true, policy: true, claims: true })
    expect(evidence.policy?.summary.violated).toBeGreaterThan(0)
    expect(evidence.flow?.unknowns.length).toBeGreaterThan(0)
    expect(evidence.claims?.claims.length).toBeGreaterThan(0)
  })

  it("judges each rule on the data it concerns: the leak is a violation, and an opaque call that saw only email does not blur the others", () => {
    const outcomes = fixture.evidence.policy?.results.map((r) => `${r.ruleId}:${r.outcome}`).sort()
    expect(outcomes).toEqual([
      "userData/no-password-to-client:violated",
      "userData/no-role-to-log:satisfied",
    ])
  })

  it("is stamped with the fixed provenance the golden tests rely on", () => {
    expect(fixture.evidence.provenance).toMatchObject({
      generatedAt: "2026-01-01T00:00:00.000Z",
      commit: "0123456789abcdef0123456789abcdef01234567",
    })
  })
})
