/**
 * Type-level tests only -- checked by `tsc` (via `npm run typecheck`), not exercised at runtime. They hold the
 * names `data-cap/build` exports for what its reference projections return, and the literal type of `UNOWNED`.
 */
import { describe, expectTypeOf, it } from "vitest"
import {
  UNOWNED,
  projectAuditEvidence,
  projectClassificationEvidence,
  projectComplianceEvidence,
  projectPrivacyEvidence,
  projectRetentionEvidence,
  type ProjectAuditEvidenceOutput,
  type ProjectClassificationEvidenceOutput,
  type ProjectComplianceEvidenceOutput,
  type ProjectPrivacyEvidenceOutput,
  type ProjectRetentionEvidenceOutput,
} from "../../src/build/index.js"

describe("data-cap/build public types", () => {
  it("names what each reference projection returns", () => {
    expectTypeOf(projectAuditEvidence).returns.toEqualTypeOf<ProjectAuditEvidenceOutput>()
    expectTypeOf(
      projectClassificationEvidence,
    ).returns.toEqualTypeOf<ProjectClassificationEvidenceOutput>()
    expectTypeOf(projectComplianceEvidence).returns.toEqualTypeOf<ProjectComplianceEvidenceOutput>()
    expectTypeOf(projectPrivacyEvidence).returns.toEqualTypeOf<ProjectPrivacyEvidenceOutput>()
    expectTypeOf(projectRetentionEvidence).returns.toEqualTypeOf<ProjectRetentionEvidenceOutput>()
  })

  it("types UNOWNED as its literal, so an owner can be narrowed against it", () => {
    expectTypeOf(UNOWNED).toEqualTypeOf<"(unowned)">()
    // @ts-expect-error -- any other string is not UNOWNED
    expectTypeOf(UNOWNED).toEqualTypeOf<"nobody">()
  })
})
