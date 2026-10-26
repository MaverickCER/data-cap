/**
 * The part of the flow that was actually witnessed (ADR 0070): for each
 * observation -- a field name seen at a boundary in an execution -- the routes
 * the static flow offers from that field (that path of it) to that boundary.
 * Filtering by execution is this function with a `scope`; with none it is
 * everything any execution saw.
 *
 * An observation the static flow does not explain (no route from that field to
 * that boundary, or one of them is unknown to the flow) is returned, not hidden:
 * it is exactly the kind of fact a claim reports as `contradicted` or
 * `observed-only`.
 *
 * Pure: a function of the Flow Model and the Observation Model.
 */

import { compareById } from "./flow-model.js"
import type { FlowEdge, FlowModel, FlowNode } from "./flow-model.js"
import { traceFlowBetween } from "./flow-projections.js"
import type { Observation, ObservationModel } from "./observation-model.js"
import { subpathWithin } from "./observation-model.js"

/** What was witnessed. */
export interface ObservedFlow {
  /** Every scope that contributed any observation, whichever was selected. */
  readonly scopes: readonly string[]
  /** The nodes on a witnessed route, ordered by id. */
  readonly nodes: readonly FlowNode[]
  /** The edges on a witnessed route, ordered by id. */
  readonly edges: readonly FlowEdge[]
  /** Observations (in the selected scope) the static flow carries a route for. */
  readonly explained: readonly Observation[]
  /** Observations (in the selected scope) it does not. */
  readonly unexplained: readonly Observation[]
}

/** The witnessed part of `flow`, for one execution (`scope`) or for all of them. */
export function observedFlow(
  flow: FlowModel,
  observation: ObservationModel,
  scope?: string,
): ObservedFlow {
  const nodes = new Map<string, FlowNode>()
  const edges = new Map<string, FlowEdge>()
  const explained: Observation[] = []
  const unexplained: Observation[] = []

  for (const item of observation.observations) {
    if (scope !== undefined && item.scope !== scope) continue
    const fields = flow.nodes.flatMap((node) => {
      if (node.kind !== "field") return []
      const path = subpathWithin(node.name, item.field)
      return path === undefined ? [] : [{ field: node, path }]
    })
    const boundaries = flow.nodes.filter(
      (node) =>
        node.kind === "boundary" &&
        node.name === item.boundary.name &&
        (node.boundaryKind === undefined || node.boundaryKind === item.boundary.kind),
    )
    let found = false
    for (const { field, path } of fields) {
      for (const boundary of boundaries) {
        const route = traceFlowBetween(flow, field.id, boundary.id, { path })
        if (route.nodes.length === 0) continue
        found = true
        for (const node of route.nodes) nodes.set(node.id, node)
        for (const edge of route.edges) edges.set(edge.id, edge)
      }
    }
    ;(found ? explained : unexplained).push(item)
  }

  return {
    scopes: observation.scopes,
    nodes: [...nodes.values()].sort(compareById),
    edges: [...edges.values()].sort(compareById),
    explained,
    unexplained,
  }
}
