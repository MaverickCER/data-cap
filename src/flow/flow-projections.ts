/**
 * Pure queries over the Flow Model (ADR 0070): trace a field upstream to its
 * sources or downstream to its destinations, filter by field/function/
 * classification/status, and diff two revisions' models. Every result states
 * whether it is complete (ADR 0071) -- a trace crossing an `unknown` fact, or
 * a filtered view, is never presented as the whole story.
 *
 * Operates on `EvidenceModel["flow"]`; wrap in `defineEvidenceProjection` to
 * get automatic per-key provenance.
 */

import { compareById, FlowModelError } from "./flow-model.js"
import type {
  FlowEdge,
  FlowEdgeKind,
  FlowModel,
  FlowNode,
  FlowNodeKind,
  FlowStatus,
  FlowUnknown,
} from "./flow-model.js"

/** Edge kinds that move data. `calls` is control flow and `discards` records data deliberately not forwarded -- neither is followed. */
function isDataEdgeKind(kind: FlowEdgeKind): boolean {
  const dataEdgeKinds: readonly FlowEdgeKind[] = [
    "reads",
    "writes",
    "transforms",
    "passes",
    "returns",
    "crosses-boundary",
    "side-effect",
  ]
  return dataEdgeKinds.includes(kind)
}

/** Which way to follow data edges from the start node. */
export type FlowTraceDirection = "upstream" | "downstream"

/** Options narrowing a trace. */
export interface FlowTraceOptions {
  /** Follow only hops whose edge path is related (equal, prefix, or extension) to this path; an edge with no path applies to every path. */
  readonly path?: readonly string[] | undefined
  /** Follow only edges, and visit only nodes, with one of these statuses. */
  readonly statuses?: readonly FlowStatus[]
}

/** The result of `traceFlow`. */
export interface FlowTrace {
  /** Id of the node the trace started from. */
  readonly start: string
  /** Which way data edges were followed. */
  readonly direction: FlowTraceDirection
  /** Every visited node, ordered by id. */
  readonly nodes: readonly FlowNode[]
  /** Every traversed edge, ordered by id. */
  readonly edges: readonly FlowEdge[]
  /** Every explicit unknown attached to a visited node. */
  readonly unknowns: readonly FlowUnknown[]
  /** False when the trace crossed or touched any `unknown` fact: the real flow may reach further than shown. */
  readonly complete: boolean
}

/** Whether one path is equal to, a prefix of, or an extension of the other. */
export function pathsRelated(a: readonly string[], b: readonly string[]): boolean {
  return a.slice(0, b.length).every((segment, index) => segment === b[index])
}

interface Walk {
  readonly visited: ReadonlySet<string>
  readonly edges: ReadonlyMap<string, FlowEdge>
}

/**
 * Breadth-first walk of data edges downstream from `start`. When `origin` is
 * given only edges carrying that field's data (or no origin at all) are
 * followed -- a helper shared by two fields must not make each reach the
 * other's destinations. `visited` is iterated while it grows, so every node is
 * expanded once and the walk ends on any graph, cycles included.
 */
function walk(
  model: FlowModel,
  nodesById: ReadonlyMap<string, FlowNode>,
  start: string,
  options: FlowTraceOptions,
  origin: string | undefined,
): Walk {
  const allowed = options.statuses === undefined ? undefined : new Set(options.statuses)
  const { path } = options
  const visited = new Set<string>([start])
  const traversed = new Map<string, FlowEdge>()

  for (const current of visited) {
    for (const edge of model.edges) {
      if (!isDataEdgeKind(edge.kind) || edge.from !== current) continue
      if (origin !== undefined && edge.origin !== undefined && edge.origin !== origin) continue
      if (allowed !== undefined && !allowed.has(edge.status)) continue
      if (path !== undefined && edge.path !== undefined && !pathsRelated(edge.path, path)) continue
      const nextNode = nodesById.get(edge.to)
      if (nextNode === undefined) continue
      if (allowed !== undefined && !allowed.has(nextNode.status)) continue
      traversed.set(edge.id, edge)
      visited.add(edge.to)
    }
  }
  return { visited, edges: traversed }
}

/** Ids from which `target` is reachable using only `edges`; `reach` is iterated while it grows, so this ends on any graph. */
function canReach(edges: readonly FlowEdge[], target: string): Set<string> {
  const reach = new Set<string>([target])
  for (const id of reach) {
    for (const edge of edges) {
      if (edge.to === id) reach.add(edge.from)
    }
  }
  return reach
}

/**
 * Follows data edges from `start` in `direction`, breadth-first, terminating
 * on cycles. Downstream from a `field` node follows only that field's own
 * data (edge `origin`, ADR 0070). Upstream collects, for every field whose
 * downstream flow reaches `start`, the edges of that flow that lead to
 * `start`, plus any declared source feeding that field.
 */
export function traceFlow(
  model: FlowModel,
  start: string,
  direction: FlowTraceDirection,
  options: FlowTraceOptions = {},
): FlowTrace {
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]))
  const startNode = nodesById.get(start)
  if (startNode === undefined) {
    throw new FlowModelError(`Cannot trace from ${start}: it is not a node of this model.`)
  }

  let visited: Set<string>
  let traversed: Map<string, FlowEdge>

  if (direction === "downstream") {
    const result = walk(
      model,
      nodesById,
      start,
      options,
      startNode.kind === "field" ? start : undefined,
    )
    visited = new Set(result.visited)
    traversed = new Map(result.edges)
  } else {
    visited = new Set([start])
    traversed = new Map()
    for (const field of model.nodes.filter((node) => node.kind === "field")) {
      const forward = walk(model, nodesById, field.id, options, field.id)
      if (!forward.visited.has(start)) continue
      const leadsToStart = canReach([...forward.edges.values()], start)
      for (const edge of forward.edges.values()) {
        if (!leadsToStart.has(edge.to)) continue
        traversed.set(edge.id, edge)
        visited.add(edge.from)
      }
      for (const edge of model.edges) {
        if (edge.to === field.id && edge.origin === field.id && isDataEdgeKind(edge.kind)) {
          traversed.set(edge.id, edge)
          visited.add(edge.from)
        }
      }
    }
  }

  const nodes = model.nodes.filter((node) => visited.has(node.id)).sort(compareById)
  const edges = [...traversed.values()].sort(compareById)
  // Whose data this trace is about. A trace from a field is about that field; an upstream trace is about every
  // field that reached the start; a trace from any other node cannot tell, and treats every unknown as relevant.
  const concerned: ReadonlySet<string | undefined> | undefined =
    direction === "downstream"
      ? startNode.kind === "field"
        ? new Set([start])
        : undefined
      : new Set([start, ...[...traversed.values()].map((edge) => edge.origin)])
  // An unknown with no subject is attached to no node, so it is never in this set.
  const visitedSubjects: ReadonlySet<string | undefined> = visited
  const unknowns = model.unknowns.filter((unknown) => {
    if (!visitedSubjects.has(unknown.subject)) return false
    if (unknown.data === undefined || concerned === undefined) return true
    return unknown.data.some(
      (item) =>
        concerned.has(item.origin) &&
        (options.path === undefined || pathsRelated(item.path, options.path)),
    )
  })
  const complete =
    unknowns.length === 0 &&
    nodes.every((node) => node.status !== "unknown") &&
    edges.every((edge) => edge.status !== "unknown")

  return { start, direction, nodes, edges, unknowns, complete }
}

/**
 * The part of a downstream flow from `start` that lies on some route to `target`: the nodes reachable from `start`
 * that can also reach `target`, and the edges between them. Empty when `target` is not reached. Follows the same
 * rules as `traceFlow` downstream (a field start carries only its own data; `options.path` narrows it).
 */
export function traceFlowBetween(
  model: FlowModel,
  start: string,
  target: string,
  options: FlowTraceOptions = {},
): FlowTrace {
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]))
  const startNode = nodesById.get(start)
  if (startNode === undefined || !nodesById.has(target)) {
    throw new FlowModelError(
      `Cannot trace from ${start} to ${target}: both must be nodes of this model.`,
    )
  }
  const forward = walk(
    model,
    nodesById,
    start,
    options,
    startNode.kind === "field" ? start : undefined,
  )
  const leadsToTarget = canReach([...forward.edges.values()], target)
  const reached = forward.visited.has(target)
  const keep = new Set([...forward.visited].filter((id) => reached && leadsToTarget.has(id)))
  const edges = [...forward.edges.values()]
    .filter((edge) => keep.has(edge.from) && keep.has(edge.to))
    .sort(compareById)
  const nodes = model.nodes.filter((node) => keep.has(node.id)).sort(compareById)
  // An unknown with no subject is attached to no node, so it is never in this set.
  const keptSubjects: ReadonlySet<string | undefined> = keep
  const unknowns = model.unknowns.filter((unknown) => {
    if (!keptSubjects.has(unknown.subject)) return false
    if (unknown.data === undefined || startNode.kind !== "field") return true
    return unknown.data.some(
      (item) =>
        item.origin === start &&
        (options.path === undefined || pathsRelated(item.path, options.path)),
    )
  })
  const complete =
    unknowns.length === 0 &&
    nodes.every((node) => node.status !== "unknown") &&
    edges.every((edge) => edge.status !== "unknown")
  return { start, direction: "downstream", nodes, edges, unknowns, complete }
}

/** Criteria for `filterFlow`; every supplied criterion must match. */
export interface FlowFilter {
  readonly kinds?: readonly FlowNodeKind[]
  readonly statuses?: readonly FlowStatus[]
  /** Exact `classification` match. */
  readonly classification?: string
  /** Exact `scope` match (a root-relative file path, or a boundary namespace). */
  readonly scope?: string
  /** Case-insensitive substring of the node name. */
  readonly nameIncludes?: string
  /** Keep only edges with a path segment equal to this value (applied to edges, not nodes). */
  readonly edgePathIncludes?: string
}

/** A filtered view: never mistakable for the whole graph. */
export interface FlowView {
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly FlowEdge[]
  readonly unknowns: readonly FlowUnknown[]
  /** Nodes removed by the filter. */
  readonly hiddenNodes: number
  /** Edges removed by the filter. */
  readonly hiddenEdges: number
  /** True only when nothing was hidden and the source model was itself complete. */
  readonly complete: boolean
}

function nodeMatches(node: FlowNode, filter: FlowFilter): boolean {
  if (filter.kinds !== undefined && !filter.kinds.includes(node.kind)) return false
  if (filter.statuses !== undefined && !filter.statuses.includes(node.status)) return false
  if (filter.classification !== undefined && node.classification !== filter.classification) {
    return false
  }
  if (filter.scope !== undefined && node.scope !== filter.scope) return false
  if (
    filter.nameIncludes !== undefined &&
    !node.name.toLowerCase().includes(filter.nameIncludes.toLowerCase())
  ) {
    return false
  }
  return true
}

/** Keeps matching nodes, the edges between them, and the unknowns that still apply. */
export function filterFlow(model: FlowModel, filter: FlowFilter): FlowView {
  const nodes = model.nodes.filter((node) => nodeMatches(node, filter))
  const kept = new Set(nodes.map((node) => node.id))
  const edges = model.edges.filter(
    (edge) =>
      kept.has(edge.from) &&
      kept.has(edge.to) &&
      (filter.edgePathIncludes === undefined ||
        edge.path?.includes(filter.edgePathIncludes) === true),
  )
  const unknowns = model.unknowns.filter(
    (unknown) => unknown.subject === undefined || kept.has(unknown.subject),
  )
  const hiddenNodes = model.nodes.length - nodes.length
  const hiddenEdges = model.edges.length - edges.length
  return {
    nodes,
    edges,
    unknowns,
    hiddenNodes,
    hiddenEdges,
    complete: hiddenNodes === 0 && hiddenEdges === 0 && model.coverage.complete,
  }
}

/** A node whose content differs between two revisions under the same id. */
export interface FlowNodeChange {
  readonly before: FlowNode
  readonly after: FlowNode
}

/** What changed between two Flow Models, by content-addressed id. */
export interface FlowDiff {
  readonly addedNodes: readonly FlowNode[]
  readonly removedNodes: readonly FlowNode[]
  readonly changedNodes: readonly FlowNodeChange[]
  readonly addedEdges: readonly FlowEdge[]
  readonly removedEdges: readonly FlowEdge[]
  readonly addedUnknowns: readonly FlowUnknown[]
  readonly removedUnknowns: readonly FlowUnknown[]
  /** True when nothing was added, removed or changed. */
  readonly unchanged: boolean
}

function indexById<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function missingFrom<T extends { readonly id: string }>(
  items: readonly T[],
  other: Map<string, T>,
): T[] {
  return items.filter((item) => !other.has(item.id))
}

/** Compares `before` to `after` by content-addressed id (ADR 0070). */
export function diffFlow(before: FlowModel, after: FlowModel): FlowDiff {
  const beforeNodes = indexById(before.nodes)
  const afterNodes = indexById(after.nodes)
  const beforeEdges = indexById(before.edges)
  const afterEdges = indexById(after.edges)
  const beforeUnknowns = indexById(before.unknowns)
  const afterUnknowns = indexById(after.unknowns)

  const changedNodes: FlowNodeChange[] = []
  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id)
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(node)) {
      changedNodes.push({ before: previous, after: node })
    }
  }

  const addedNodes = missingFrom(after.nodes, beforeNodes)
  const removedNodes = missingFrom(before.nodes, afterNodes)
  const addedEdges = missingFrom(after.edges, beforeEdges)
  const removedEdges = missingFrom(before.edges, afterEdges)
  const addedUnknowns = missingFrom(after.unknowns, beforeUnknowns)
  const removedUnknowns = missingFrom(before.unknowns, afterUnknowns)

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    addedUnknowns,
    removedUnknowns,
    unchanged:
      addedNodes.length +
        removedNodes.length +
        changedNodes.length +
        addedEdges.length +
        removedEdges.length +
        addedUnknowns.length +
        removedUnknowns.length ===
      0,
  }
}

function statusStrength(status: FlowStatus): number {
  const strength: Readonly<Record<FlowStatus, number>> = {
    static: 0,
    observed: 0,
    declared: 1,
    inferred: 2,
    unknown: 3,
  }
  return strength[status]
}

/** The least certain of `statuses` (static/observed strongest, then declared, inferred, unknown); `static` for an empty list. */
export function weakestStatus(statuses: readonly FlowStatus[]): FlowStatus {
  let result: FlowStatus = "static"
  for (const status of statuses) {
    if (statusStrength(status) > statusStrength(result)) result = status
  }
  return result
}

/**
 * Shortest path of `trace` edges from `start` to `target`, in order; empty when `target` is `start` or unreachable.
 * Breadth-first: `paths` is iterated while it grows, so each node is expanded once and the search ends on any graph.
 */
export function flowPathTo(trace: FlowTrace, start: string, target: string): readonly FlowEdge[] {
  const paths = new Map<string, readonly FlowEdge[]>([[start, []]])
  for (const [current, here] of paths) {
    for (const edge of trace.edges) {
      if (edge.from === current && !paths.has(edge.to)) paths.set(edge.to, [...here, edge])
    }
  }
  return paths.get(target) ?? []
}
