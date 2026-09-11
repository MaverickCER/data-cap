/**
 * `data-cap`'s Evidence Model entry point (`data-cap/evidence`).
 *
 * `defineEvidenceProjection()` is the extensibility mechanism the seven
 * canonical fact models (ADR 0050) exist to serve. A projection is a pure
 * transform from the `EvidenceModel` -- assembled at build time by
 * `generateDataArtifacts()`/`buildEvidenceModel()`
 * (`data-cap/build`, Node-only) -- to any consumer-defined
 * output shape, with read-only enforcement and per-field provenance.
 *
 * This module is deliberately isomorphic: no `node:fs`, no `typescript`, no
 * knowledge of how an `EvidenceModel` gets built -- it only imports that
 * shape as a type (fully erased at compile time under
 * `verbatimModuleSyntax`, mirroring `helpers`' one sanctioned cross-folder
 * edge onto `runtime`). A dashboard backend, an edge function, or a CI step
 * can run a projection over a previously-generated, JSON-deserialized
 * `EvidenceModel` with zero Node dependency, and without pulling in the
 * TypeScript compiler API that `/build` necessarily carries.
 *
 * `data-cap/build` continues to re-export everything here, so
 * existing `/build` imports keep working unchanged -- this directory is the
 * canonical source, `/build` is the compatibility surface.
 */
export { defineEvidenceProjection } from "./define-evidence-projection.js"
export type {
  EvidenceProjection,
  EvidenceProjectionResult,
  EvidenceProjectionSchema,
  EvidenceProjector,
} from "./define-evidence-projection.js"
export type { EvidenceModel, EvidenceProvenance } from "../build/evidence-model.js"
