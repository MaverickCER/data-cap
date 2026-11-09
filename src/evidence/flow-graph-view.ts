/**
 * The graph view (ADR 0070): the stable, documented, library-independent
 * shape a renderer reads. It is a pure projection of the one Evidence Model
 * -- computed on demand, never persisted, never a second source of truth --
 * and it says nothing about how it will be drawn: DOT, Mermaid, an SVG
 * layout or an accessible table all start here.
 *
 * Per function it exposes inputs, output, field-level reads, forwards,
 * side effects, discards, callers, callees, security classifications and the
 * confidence of the evidence behind it. Per field it exposes where the data
 * is declared to come from, which boundaries it reaches (and by which
 * paths), who drops which paths, and whether the picture is complete.
 *
 * Isomorphic: no Node, no compiler. A flow that was not computed yields
 * `undefined`, never an empty view that could be read as "no flows exist".
 */

import type { EvidenceModel } from "../build/evidence-model.js"
import type { ClaimsModel } from "../flow/claims-model.js"
import type {
  FlowBoundaryKind,
  FlowCoverage,
  FlowEdgeKind,
  FlowHandling,
  FlowNode,
  FlowNodeKind,
  FlowStatus,
  FlowUnknown,
} from "../flow/flow-model.js"
import { flowNodeId } from "../flow/flow-model.js"
import { traceFlow, weakestStatus } from "../flow/flow-projections.js"

/** Bump only when a renderer written for the previous shape could misread the new one. */
export const FLOW_GRAPH_VIEW_VERSION = 1

/** A node, with a display label. */
export interface ViewNode {
  readonly id: string
  readonly kind: FlowNodeKind
  /** Short text for a diagram: the parameter name, `return`, `kind: name` for a boundary, the name otherwise. */
  readonly label: string
  readonly name: string
  readonly scope: string
  readonly status: FlowStatus
  readonly classification?: string
  readonly boundaryKind?: FlowBoundaryKind
  readonly source?: { readonly line: number; readonly column: number }
}

/** An edge, as the Flow Model records it. */
export interface ViewEdge {
  readonly id: string
  readonly kind: FlowEdgeKind
  readonly from: string
  readonly to: string
  readonly status: FlowStatus
  readonly path?: readonly string[]
  readonly origin?: string
  readonly handling?: FlowHandling
  readonly source?: { readonly file: string; readonly line: number; readonly column: number }
}

/** A reference to a node by id and name. */
export interface NodeRef {
  readonly id: string
  readonly name: string
}

/** Data a function takes in. */
export interface FunctionRead {
  /** The field the data comes from. */
  readonly origin: string
  readonly field: string
  /** Path inside the field. */
  readonly path: readonly string[]
  /** How it arrived: read from the field itself, through a parameter, or as another function's return value. */
  readonly via: "field" | "parameter" | "return"
  /** Id of the node it arrived from. */
  readonly from: string
  readonly status: FlowStatus
}

/** Data a function hands on: to a parameter, as its return value, or transformed. */
export interface FunctionForward {
  readonly kind: "passes" | "returns" | "transforms"
  readonly to: string
  readonly toName: string
  readonly origin: string
  readonly field: string
  readonly path: readonly string[]
  readonly status: FlowStatus
}

/** Data a function sends across a boundary. */
export interface FunctionEffect {
  readonly boundary: string
  readonly boundaryName: string
  readonly boundaryKind?: FlowBoundaryKind
  readonly origin: string
  readonly field: string
  readonly path: readonly string[]
  readonly handling?: FlowHandling
  readonly status: FlowStatus
}

/** A path of a field the function received and neither used nor forwarded. */
export interface FunctionDiscard {
  readonly origin: string
  readonly field: string
  readonly path: readonly string[]
}

/** Everything the evidence says about one function. */
export interface FunctionView {
  readonly id: string
  readonly name: string
  readonly scope: string
  readonly status: FlowStatus
  readonly source?: { readonly line: number; readonly column: number }
  readonly inputs: readonly NodeRef[]
  readonly output?: string
  readonly reads: readonly FunctionRead[]
  readonly forwards: readonly FunctionForward[]
  readonly sideEffects: readonly FunctionEffect[]
  readonly discards: readonly FunctionDiscard[]
  readonly callers: readonly NodeRef[]
  readonly callees: readonly NodeRef[]
  /** Distinct classifications of the fields whose data this function touches. */
  readonly classifications: readonly string[]
  /** The weakest status of the evidence behind this function; `inferred` when part of it could not be followed. */
  readonly confidence: FlowStatus
  /** Ids of the explicit unknowns attached to this function. */
  readonly unknowns: readonly string[]
}

/** A boundary a field's data reaches. */
export interface FieldDestination {
  readonly boundary: string
  readonly boundaryName: string
  readonly boundaryKind?: FlowBoundaryKind
  /** Every path of the field that reaches it; `[]` is the whole field. */
  readonly paths: readonly (readonly string[])[]
  /** The weakest status among the edges that carry it there. */
  readonly status: FlowStatus
  readonly handling: readonly FlowHandling[]
}

/** Everything the evidence says about one field. */
export interface FieldView {
  readonly id: string
  readonly name: string
  readonly scope: string
  readonly classification?: string
  /** Declared sources of the field's data. */
  readonly sources: readonly {
    readonly boundary: string
    readonly boundaryName: string
    readonly boundaryKind?: FlowBoundaryKind
    readonly handling?: FlowHandling
    readonly status: FlowStatus
  }[]
  readonly destinations: readonly FieldDestination[]
  readonly discardedBy: readonly {
    readonly function: string
    readonly functionName: string
    readonly path: readonly string[]
  }[]
  readonly readers: readonly { readonly function: string; readonly functionName: string }[]
  /** Ids of the claims about this field or a path inside it. */
  readonly claims: readonly string[]
  /** False when the field's trace touches something the analysis could not follow. */
  readonly complete: boolean
}

/** The meaning of each epistemic status (ADR 0071), for a legend. */
export interface StatusLegendEntry {
  readonly status: FlowStatus
  readonly meaning: string
}

/** The graph view. */
export interface FlowGraphView {
  readonly schemaVersion: typeof FLOW_GRAPH_VIEW_VERSION
  readonly coverage: FlowCoverage
  readonly nodes: readonly ViewNode[]
  readonly edges: readonly ViewEdge[]
  readonly unknowns: readonly FlowUnknown[]
  readonly functions: readonly FunctionView[]
  readonly fields: readonly FieldView[]
  /** Counts of claims by verification status, when claims were derived. */
  readonly claims?: ClaimsModel["summary"]
  readonly statusLegend: readonly StatusLegendEntry[]
}

/** What the view reads from the Evidence Model. */
export type FlowGraphViewInput = Pick<EvidenceModel, "flow" | "claims">

/** Short text for a diagram: the parameter name, `return`, `kind: name` for a boundary, the name otherwise. */
export function nodeLabel(node: FlowNode): string {
  switch (node.kind) {
    case "boundary":
      return `${node.boundaryKind ?? "boundary"}: ${node.name}`
    case "parameter":
      return node.name.slice(node.name.lastIndexOf(".") + 1)
    case "return":
      return "return"
    default:
      return node.name
  }
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/** Builds the graph view, or `undefined` when no flow was computed. */
export function buildFlowGraphView(evidence: FlowGraphViewInput): FlowGraphView | undefined {
  const { flow } = evidence
  if (flow === undefined) return undefined

  // Keyed by `string | undefined` so an edge without an origin looks itself up like any other id: it finds no node.
  const nodesById = new Map<string | undefined, FlowNode>(flow.nodes.map((node) => [node.id, node]))
  const dataKinds: ReadonlySet<FlowEdgeKind> = new Set([
    "reads",
    "passes",
    "returns",
    "transforms",
    "side-effect",
    "discards",
  ])
  const nameOf = (id: string): string => nodesById.get(id)?.name ?? id
  const ref = (id: string): NodeRef => ({ id, name: nameOf(id) })

  const nodes: ViewNode[] = flow.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    label: nodeLabel(node),
    name: node.name,
    scope: node.scope,
    status: node.status,
    ...(node.classification === undefined ? {} : { classification: node.classification }),
    ...(node.boundaryKind === undefined ? {} : { boundaryKind: node.boundaryKind }),
    ...(node.source === undefined ? {} : { source: node.source }),
  }))

  const edges: ViewEdge[] = flow.edges.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    from: edge.from,
    to: edge.to,
    status: edge.status,
    ...(edge.path === undefined ? {} : { path: edge.path }),
    ...(edge.origin === undefined ? {} : { origin: edge.origin }),
    ...(edge.handling === undefined ? {} : { handling: edge.handling }),
    ...(edge.source === undefined ? {} : { source: edge.source }),
  }))

  const functions: FunctionView[] = flow.nodes
    .filter((node) => node.kind === "function")
    .map((node) => {
      const outgoing = flow.edges.filter((edge) => edge.from === node.id)
      const incoming = flow.edges.filter((edge) => edge.to === node.id)
      const attached = flow.unknowns.filter((unknown) => unknown.subject === node.id)
      const dataEdges = [...outgoing, ...incoming].filter((edge) => dataKinds.has(edge.kind))
      const origins = distinct(dataEdges.map((edge) => edge.origin))

      const reads: FunctionRead[] = incoming
        .filter((edge) => edge.kind === "reads" || edge.kind === "passes")
        .flatMap((edge) => {
          const from = nodesById.get(edge.from)
          const via =
            from?.kind === "field"
              ? "field"
              : from?.kind === "parameter"
                ? "parameter"
                : from?.kind === "return"
                  ? "return"
                  : undefined
          if (via === undefined || edge.origin === undefined) return []
          return [
            {
              origin: edge.origin,
              field: nameOf(edge.origin),
              path: edge.path ?? [],
              via,
              from: edge.from,
              status: edge.status,
            },
          ]
        })

      const forwards: FunctionForward[] = outgoing.flatMap((edge) =>
        (edge.kind === "passes" || edge.kind === "returns" || edge.kind === "transforms") &&
        edge.origin !== undefined
          ? [
              {
                kind: edge.kind,
                to: edge.to,
                toName: nameOf(edge.to),
                origin: edge.origin,
                field: nameOf(edge.origin),
                path: edge.path ?? [],
                status: edge.status,
              },
            ]
          : [],
      )

      const sideEffects: FunctionEffect[] = outgoing.flatMap((edge) => {
        if (edge.kind !== "side-effect" || edge.origin === undefined) return []
        const boundary = nodesById.get(edge.to)
        return [
          {
            boundary: edge.to,
            boundaryName: nameOf(edge.to),
            ...(boundary?.boundaryKind === undefined
              ? {}
              : { boundaryKind: boundary.boundaryKind }),
            origin: edge.origin,
            field: nameOf(edge.origin),
            path: edge.path ?? [],
            ...(edge.handling === undefined ? {} : { handling: edge.handling }),
            status: edge.status,
          },
        ]
      })

      const discards: FunctionDiscard[] = outgoing.flatMap((edge) =>
        edge.kind === "discards" && edge.origin !== undefined
          ? [{ origin: edge.origin, field: nameOf(edge.origin), path: edge.path ?? [] }]
          : [],
      )

      const classifications = distinct(
        origins.flatMap((id) => {
          const classification = nodesById.get(id)?.classification
          return classification === undefined ? [] : [classification]
        }),
      ).sort()

      const statuses: FlowStatus[] = dataEdges.map((edge) => edge.status)
      if (attached.length > 0) statuses.push("inferred")

      return {
        id: node.id,
        name: node.name,
        scope: node.scope,
        status: node.status,
        ...(node.source === undefined ? {} : { source: node.source }),
        inputs: flow.nodes
          .filter(
            (candidate) =>
              candidate.kind === "parameter" &&
              candidate.scope === node.scope &&
              candidate.name.startsWith(`${node.name}.`),
          )
          .map((candidate) => ref(candidate.id)),
        ...(flow.nodes.some(
          (candidate) =>
            candidate.kind === "return" &&
            candidate.scope === node.scope &&
            candidate.name === `${node.name}#return`,
        )
          ? { output: flowNodeId("return", node.scope, `${node.name}#return`) }
          : {}),
        reads,
        forwards,
        sideEffects,
        discards,
        callers: distinct(
          incoming.filter((edge) => edge.kind === "calls").map((edge) => edge.from),
        ).map(ref),
        callees: distinct(
          outgoing.filter((edge) => edge.kind === "calls").map((edge) => edge.to),
        ).map(ref),
        classifications,
        confidence: statuses.length === 0 ? node.status : weakestStatus(statuses),
        unknowns: attached.map((unknown) => unknown.id),
      }
    })

  const claims = evidence.claims?.claims ?? []
  const fields: FieldView[] = flow.nodes
    .filter((node) => node.kind === "field")
    .map((node) => {
      const trace = traceFlow(flow, node.id, "downstream")
      const destinations: FieldDestination[] = trace.nodes
        .filter((candidate) => candidate.kind === "boundary")
        .map((boundary) => {
          const carrying = trace.edges.filter(
            (edge) =>
              edge.to === boundary.id &&
              (edge.kind === "side-effect" || edge.kind === "crosses-boundary"),
          )
          // Sorted by dotted path before the duplicates collapse, so which path stands for a key is fixed by the
          // edge order alone.
          const keyed: [string, readonly string[]][] = carrying.map((edge) => [
            (edge.path ?? []).join("."),
            edge.path ?? [],
          ])
          keyed.sort(([a], [b]) => (a < b ? -1 : 1))
          const paths = [...new Map(keyed).values()]
          return {
            boundary: boundary.id,
            boundaryName: boundary.name,
            ...(boundary.boundaryKind === undefined ? {} : { boundaryKind: boundary.boundaryKind }),
            paths,
            status: weakestStatus(carrying.map((edge) => edge.status)),
            handling: distinct(
              carrying.flatMap((edge) => (edge.handling === undefined ? [] : [edge.handling])),
            ).sort(),
          }
        })

      const own = flow.edges.filter((edge) => edge.origin === node.id)
      return {
        id: node.id,
        name: node.name,
        scope: node.scope,
        ...(node.classification === undefined ? {} : { classification: node.classification }),
        sources: flow.edges
          .filter((edge) => edge.kind === "crosses-boundary" && edge.to === node.id)
          .map((edge) => {
            const boundary = nodesById.get(edge.from)
            return {
              boundary: edge.from,
              boundaryName: nameOf(edge.from),
              ...(boundary?.boundaryKind === undefined
                ? {}
                : { boundaryKind: boundary.boundaryKind }),
              ...(edge.handling === undefined ? {} : { handling: edge.handling }),
              status: edge.status,
            }
          }),
        destinations,
        discardedBy: own
          .filter((edge) => edge.kind === "discards")
          .map((edge) => ({
            function: edge.from,
            functionName: nameOf(edge.from),
            path: edge.path ?? [],
          })),
        readers: distinct(
          own
            .filter((edge) => edge.kind === "reads" && edge.from === node.id)
            .map((edge) => edge.to),
        ).map((id) => ({
          function: id,
          functionName: nameOf(id),
        })),
        claims: claims
          .filter(
            (claim) => claim.subject === node.name || claim.subject.startsWith(`${node.name}.`),
          )
          .map((claim) => claim.id),
        complete: trace.complete,
      }
    })

  return {
    schemaVersion: FLOW_GRAPH_VIEW_VERSION,
    coverage: flow.coverage,
    nodes,
    edges,
    unknowns: flow.unknowns,
    functions,
    fields,
    ...(evidence.claims === undefined ? {} : { claims: evidence.claims.summary }),
    statusLegend: [
      {
        status: "declared",
        meaning: "Asserted by an author in documentData(); not checked against code.",
      },
      {
        status: "static",
        meaning: "Established by the analyzed code under the analysis's stated assumptions.",
      },
      { status: "observed", meaning: "Witnessed in a specific execution or test." },
      {
        status: "inferred",
        meaning:
          "Plausible but not established: data assumed to pass through code the analysis could not follow.",
      },
      {
        status: "unknown",
        meaning:
          "Not analyzable: dynamic behavior, missing source, an unsupported construct, or incomplete coverage.",
      },
    ],
  }
}
