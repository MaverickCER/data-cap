/**
 * The one sentence every data-flow artifact carries, whatever its format: the same disclaimer the
 * generated documents open with (`evidenceDisclaimer()` in the build entry), plus what the flow
 * analysis adds to it. Kept here, as a function like the build entry's, so the isomorphic evidence entry does
 * not import the build entry; `test/evidence/flow-disclaimer.test.ts` holds the two texts together.
 *
 * A reader of an OSCAL result, a CycloneDX BOM or a PROV document may never see the Markdown report, so
 * the sentence travels inside each artifact (a comment, a property, a remark), never only beside it.
 */
export function flowEvidenceDisclaimer(): string {
  return "Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow."
}
