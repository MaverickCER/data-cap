/**
 * What a flow diagram draws (ADR 0070): the whole graph, or one field's
 * downstream flow, together with the declared sources feeding it. Shared by
 * the DOT and Mermaid renderers so they cannot disagree about what a diagram
 * contains. Pure, isomorphic, and a projection of the one Evidence Model.
 *
 * A selection always carries its own completeness: a diagram of a trace that
 * touches something the analysis could not follow is not complete, and the
 * renderers must say so on the diagram itself (ADR 0071).
 */

import type { EvidenceModel } from "../build/evidence-model.js"
import type { FlowEdge, FlowNode, FlowUnknown } from "../flow/flow-model.js"
import { traceFlow } from "../flow/flow-projections.js"

/** Options shared by the diagram renderers. */
export interface FlowDiagramOptions {
  /** Draw only this field's flow (by name, for example `userData.user`). */
  readonly field?: string | undefined
  /** Within `field`, draw only flow of this path (and of the whole field). */
  readonly path?: readonly string[] | undefined
  /** Draw control-flow `calls` edges (default false: they obscure the data). */
  readonly includeCalls?: boolean | undefined
}

/** What to draw. */
export interface DiagramSelection {
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly FlowEdge[]
  readonly unknowns: readonly FlowUnknown[]
  /** Ids of the selected edges that belong to a violated policy result. */
  readonly violated: ReadonlySet<string>
  /** False when part of what is drawn could not be followed, or the whole graph's coverage is not complete. */
  readonly complete: boolean
  /** Set (and everything else empty) when `field` named no field. */
  readonly missingField?: string
}

export type DiagramInput = Pick<EvidenceModel, "flow" | "policy">

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : 1
}

/** The text on an edge: kind, path, handling, and status when it is not `static`. Status is text, never only colour. */
export function edgeLabel(edge: FlowEdge): string {
  const path =
    edge.path === undefined ? "" : ` ${edge.path.length === 0 ? "(whole)" : edge.path.join(".")}`
  const handling = edge.handling === undefined ? "" : ` (${edge.handling})`
  const status = edge.status === "static" ? "" : ` [${edge.status}]`
  return `${edge.kind}${path}${handling}${status}`
}

/** Chooses what to draw, or `undefined` when no flow was computed. */
export function selectDiagram(
  evidence: DiagramInput,
  options: FlowDiagramOptions = {},
): DiagramSelection | undefined {
  const { flow } = evidence
  if (flow === undefined) return undefined

  const violated = new Set(
    evidence.policy?.results
      .filter((result) => result.outcome === "violated")
      .flatMap((result) => result.edges),
  )
  const keepCalls = options.includeCalls === true
  const finish = (
    nodes: readonly FlowNode[],
    edges: readonly FlowEdge[],
    unknowns: readonly FlowUnknown[],
    complete: boolean,
  ): DiagramSelection => {
    const kept = new Set(nodes.map((node) => node.id))
    const drawn = edges.filter(
      (edge) => kept.has(edge.from) && kept.has(edge.to) && (keepCalls || edge.kind !== "calls"),
    )
    // A parameter or return value nothing connects to carries no flow; drawing every one buries the graph. A function
    // is always drawn -- an unconnected function is a fact about coverage, not clutter -- and the text equivalent lists
    // every input regardless.
    const connected = new Set(drawn.flatMap((edge) => [edge.from, edge.to]))
    const visible = nodes.filter(
      (node) => (node.kind !== "parameter" && node.kind !== "return") || connected.has(node.id),
    )
    return {
      nodes: [...visible].sort(byId),
      edges: [...drawn].sort(byId),
      unknowns: [...unknowns].sort(byId),
      violated: new Set(drawn.filter((edge) => violated.has(edge.id)).map((edge) => edge.id)),
      complete,
    }
  }

  if (options.field === undefined)
    return finish(flow.nodes, flow.edges, flow.unknowns, flow.coverage.complete)

  const field = flow.nodes.find((node) => node.kind === "field" && node.name === options.field)
  if (field === undefined) {
    return {
      nodes: [],
      edges: [],
      unknowns: [],
      violated: new Set(),
      complete: false,
      missingField: options.field,
    }
  }
  // No path and the empty path both mean "every path", so the trace needs no special case for an absent one.
  const trace = traceFlow(flow, field.id, "downstream", { path: options.path ?? [] })
  const sources = flow.edges.filter(
    (edge) => edge.kind === "crosses-boundary" && edge.to === field.id,
  )
  const nodeIds = new Set([
    ...trace.nodes.map((node) => node.id),
    ...sources.map((edge) => edge.from),
  ])
  const nodes = flow.nodes.filter((node) => nodeIds.has(node.id))
  const traced = new Map([...trace.edges, ...sources].map((edge) => [edge.id, edge]))
  // Calls are control flow, not data: the trace never follows them. `finish` keeps one only when both its ends are
  // drawn and calls were asked for.
  const calls = flow.edges.filter((edge) => edge.kind === "calls")
  return finish(nodes, [...traced.values(), ...calls], trace.unknowns, trace.complete)
}
