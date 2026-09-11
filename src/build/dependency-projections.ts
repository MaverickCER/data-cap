/**
 * Reference projections (ADR 0050, ADR 0056) over Dependency Model's own
 * `edges` -- plain, on-demand exported functions, matching
 * `inventory-projections.ts`'s established pattern: one canonical fact
 * (`DependencyModel.edges`), several named views over it, none of them
 * stored redundantly inside the model itself. See ADR 0056 for why
 * `byCapability`/`consumers` moved here from `DependencyModel`'s own stored
 * shape, and why exactly these two (and no others) are the sanctioned
 * groupings: ADR 0050's own report-mapping table names both (row 15,
 * Operation-to-Field Impact Report; row 16, Field-to-Operation Impact
 * Report) -- a grouping by `relationship`/`resolution`/`field`/`operation`
 * is easy to imagine and deliberately not built until something equally
 * concrete justifies it.
 */

import type { DependencyEdge } from "./dependency-types.js"

/** Every proven edge targeting one capability. */
export interface DependencyModelCapabilityEdges {
  /** The capability every edge in `edges` targets. */
  readonly capability: {
    /** Absolute path of the file declaring the capability. */
    readonly file: string
    /** The binding name the capability is exported as. */
    readonly exportName: string
  }
  /** Every proven edge targeting this capability, in scan order. */
  readonly edges: readonly DependencyEdge[]
}

/** Every proven edge originating from one consuming file. */
export interface DependencyModelConsumer {
  /** The consuming file. */
  readonly file: string
  /** Every proven edge originating from this file, in scan order. */
  readonly edges: readonly DependencyEdge[]
}

function capabilityKey(ref: { readonly file: string; readonly exportName: string }): string {
  return `${ref.file}#${ref.exportName}`
}

/**
 * Groups `edges` by the capability each targets -- every capability in
 * `capabilities`, including one with zero edges (an `ABANDONED_CAPABILITY`
 * candidate, per `usage-report.ts`), sorted by file then exportName. Takes
 * `capabilities` as well as `edges`, unlike `groupEdgesByConsumer`: a
 * capability with no edges at all can never be discovered by iterating
 * `edges` alone.
 */
export function groupEdgesByCapability(
  capabilities: readonly { readonly file: string; readonly exportName: string }[],
  edges: readonly DependencyEdge[],
): readonly DependencyModelCapabilityEdges[] {
  const byCapabilityMap = new Map<string, DependencyEdge[]>()
  for (const edge of edges) {
    const list = byCapabilityMap.get(capabilityKey(edge.to.capability)) ?? []
    list.push(edge)
    byCapabilityMap.set(capabilityKey(edge.to.capability), list)
  }

  const grouped: DependencyModelCapabilityEdges[] = capabilities.map((capability) => ({
    capability: { file: capability.file, exportName: capability.exportName },
    edges: byCapabilityMap.get(capabilityKey(capability)) ?? [],
  }))
  grouped.sort(
    (a, b) =>
      a.capability.file.localeCompare(b.capability.file) ||
      a.capability.exportName.localeCompare(b.capability.exportName),
  )
  return grouped
}

/**
 * Groups `edges` by the consuming file each originates from -- the inverse
 * of `groupEdgesByCapability`. Only files with at least one edge appear,
 * sorted by file. Takes `edges` alone: unlike a capability, a file is only
 * ever known to this projection because it produced at least one edge.
 */
export function groupEdgesByConsumer(
  edges: readonly DependencyEdge[],
): readonly DependencyModelConsumer[] {
  const byConsumerMap = new Map<string, DependencyEdge[]>()
  for (const edge of edges) {
    const list = byConsumerMap.get(edge.from) ?? []
    list.push(edge)
    byConsumerMap.set(edge.from, list)
  }
  return [...byConsumerMap.entries()]
    .map(([file, consumerEdges]) => ({ file, edges: consumerEdges }))
    .sort((a, b) => a.file.localeCompare(b.file))
}
