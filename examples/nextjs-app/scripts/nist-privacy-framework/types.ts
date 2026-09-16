/**
 * One Category's evidence status -- the unit this generator assembles and
 * renders. Every `"evidence-found"` entry's `summary` must trace to a
 * specific source: one of data-cap's own five published reference evidence
 * projections (`data-cap/build`), applied to this example's own generated
 * `docs/data.evidence.json`. No claim without a traceable evidence source.
 */
export interface CategoryEvidence {
  readonly functionId: string
  readonly categoryId: string
  readonly status: "evidence-found" | "no-evidence"
  /** For `"evidence-found"`: what the evidence shows, citing its source projection and a real count/fact. For `"no-evidence"`: why this app's evidence has nothing to say about this Category. */
  readonly summary: string
}
