/**
 * `data-cap`'s Dependency Model (ADR 0050, ADR 0056) -- a fact-shaped,
 * versioned projection over the usage-scan engine's `DependencyEdge[]`
 * output, never exporting the scanning engine's own internals
 * (`dependency-graph.ts`/`scan-dependencies.ts` stay exactly as
 * private/public as they already were). `edges` is the model's own only
 * stored fact; the capability-indexed grouping and its inverse (file ->
 * what it consumes) that three independent call sites once each re-derived
 * by hand now live as on-demand projections in `dependency-projections.ts`
 * (ADR 0056) -- computed when needed, never stored redundantly inside the
 * model itself.
 */

import type { DependencyEdge } from "./dependency-types.js"

/**
 * Bump only when a reader could misinterpret the shape -- same discipline
 * `CAPABILITY_MODEL_SCHEMA_VERSION`/`MANIFEST_SNAPSHOT_SCHEMA_VERSION` already
 * document. Bumped 1 -> 2 by ADR 0056: `byCapability`/`consumers` removed from
 * this model's own stored shape (see `dependency-projections.ts`). Bumped
 * 2 -> 3 by OUT-01: every edge's `from`/`to.capability.file` is now
 * root-relative, not absolute.
 */
export const DEPENDENCY_MODEL_SCHEMA_VERSION = 3

/** `data-cap`'s Dependency Model: every proven `DependencyEdge`, unindexed. See `dependency-projections.ts` for on-demand capability/consumer groupings. */
export interface DependencyModel {
  /** Always `DEPENDENCY_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof DEPENDENCY_MODEL_SCHEMA_VERSION
  /** Every proven edge, unindexed -- same array `scanDependencies` produced. */
  readonly edges: readonly DependencyEdge[]
}

/**
 * Projects already-scanned `edges` into `data-cap`'s Dependency Model. Pure
 * -- takes already-computed edges as input, no filesystem access, same
 * contract `buildFlowGraph`/`deriveUsageFindings` already follow.
 */
export function buildDependencyModel(edges: readonly DependencyEdge[]): DependencyModel {
  return { schemaVersion: DEPENDENCY_MODEL_SCHEMA_VERSION, edges }
}
