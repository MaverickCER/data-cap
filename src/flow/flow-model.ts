/**
 * `data-cap`'s Flow Model (ADR 0070, ADR 0071) -- the function-level,
 * field-sensitive data-flow facts of the Evidence Model: functions,
 * parameters, returns, fields and boundaries as nodes, and what moves
 * between them (reads, writes, transforms, discards, passes, returns, calls,
 * boundary crossings, side effects) as edges.
 *
 * Every node and edge carries exactly one epistemic `status` (ADR 0071) and
 * is never blended with another: a fact asserted by an author and the same
 * fact proven by a scan are two edges. Incomplete analysis is recorded as
 * data -- `unknown` statuses and explicit `FlowUnknown` records, summarized
 * in `coverage` -- never silently omitted, so no projection can present a
 * partial graph as a complete one.
 *
 * Pure: takes already-computed facts, assigns content-addressed ids, orders
 * everything deterministically, and checks referential integrity. No
 * filesystem access, no scanning (`flow-scan.ts` produces the input).
 */

import type { FlowBoundaryKind, FlowHandling } from "../core/document.js"
import { DataCapError } from "../core/errors.js"
import type { SourceLocation, SourcePosition } from "../build/source-position.js"

/**
 * Bump only when a reader could misinterpret the shape -- same discipline
 * every other model's schema-version constant already documents.
 */
export const FLOW_MODEL_SCHEMA_VERSION = 1

/** ADR 0071: the five epistemic statuses, shared by every flow fact, claim and finding. */
export type FlowStatus = "declared" | "static" | "observed" | "inferred" | "unknown"

export type { FlowBoundaryKind, FlowHandling }

/** Every boundary kind. A `Record` keyed by the type, so adding a kind without listing it here is a compile error. */
export function flowBoundaryKinds(): readonly FlowBoundaryKind[] {
  const kinds: Readonly<Record<FlowBoundaryKind, FlowBoundaryKind>> = {
    database: "database",
    cache: "cache",
    storage: "storage",
    queue: "queue",
    api: "api",
    "external-service": "external-service",
    "user-input": "user-input",
    computed: "computed",
    internal: "internal",
    "client-response": "client-response",
    log: "log",
  }
  return Object.values(kinds)
}

/** What a flow node is. */
export type FlowNodeKind = "function" | "parameter" | "return" | "field" | "boundary"

/**
 * What an edge means. Data moves `from` -> `to` along `reads`, `writes`,
 * `transforms`, `passes`, `returns` and `crosses-boundary`; `calls` is
 * control flow and `discards` records that a function received a field and
 * deliberately did not forward it -- neither carries data, so tracing does
 * not follow them. `side-effect` links a function to the boundary it acts on.
 */
export type FlowEdgeKind =
  | "reads"
  | "writes"
  | "transforms"
  | "discards"
  | "passes"
  | "returns"
  | "calls"
  | "crosses-boundary"
  | "side-effect"

/** Why a part of the program could not be analyzed (ADR 0053 citations apply to each). */
export type FlowUnknownReason =
  | "dynamic-access"
  | "unresolved-call"
  | "unresolved-import"
  | "unsupported-construct"
  | "missing-source"
  | "unanalyzed-function"

/** One node as a producer supplies it -- the id is derived, never supplied. */
export interface FlowNodeInput {
  readonly kind: FlowNodeKind
  /** Root-relative POSIX path of the file that declares this node, or a stable namespace for a node with no file (a boundary). */
  readonly scope: string
  /** Name unique within `scope` and `kind` (`buildUserProfile`, `buildUserProfile.user`, `User.email`). */
  readonly name: string
  readonly status: FlowStatus
  /** Declaration position within `scope`, when there is one. */
  readonly source?: SourcePosition
  /** Declared or inherited sensitivity classification, when known -- carried verbatim, never inferred here. */
  readonly classification?: string
  /** What kind of boundary this is; only meaningful (and required by policy evaluation) on a `boundary` node. */
  readonly boundaryKind?: FlowBoundaryKind
}

/** One node of the Flow Model. */
export interface FlowNode extends FlowNodeInput {
  /** Content-addressed: `kind:scope#name`. */
  readonly id: string
}

/** One edge as a producer supplies it -- the id is derived, never supplied. */
export interface FlowEdgeInput {
  readonly kind: FlowEdgeKind
  /** Id of the source node. */
  readonly from: string
  /** Id of the target node. */
  readonly to: string
  readonly status: FlowStatus
  /** The field path this edge carries, for a field-sensitive edge; absent for an edge about the whole value or about control. */
  readonly path?: readonly string[]
  /** Where in source this edge arises (a call site, a read), when known. */
  readonly source?: SourceLocation
  /** The data-safety state of the value at this hop, when declared or established -- policy evaluation reads it at boundary crossings. */
  readonly handling?: FlowHandling
  /**
   * Id of the `field` node whose data this edge carries. Present on every
   * data-carrying edge the flow pass derives, so a helper shared by several
   * fields does not make each field appear to reach every other field's
   * destinations. Absent on edges that are not about one field's data (a
   * `calls` edge). `path` is expressed in the origin field's frame.
   */
  readonly origin?: string
}

/** One edge of the Flow Model. */
export interface FlowEdge extends FlowEdgeInput {
  /** Content-addressed: `kind:from->to[:path]@status[^origin]`. */
  readonly id: string
}

/** A piece of capability-field data an unknown concerns: the field node and the path inside it. */
interface FlowUnknownData {
  /** Id of the `field` node the data comes from. */
  readonly origin: string
  /** Path inside the field; `[]` is the whole field. */
  readonly path: readonly string[]
}

/** One unknown as a producer supplies it. */
export interface FlowUnknownInput {
  readonly reason: FlowUnknownReason
  /** Where the unanalyzable construct is. */
  readonly source: SourceLocation
  /** The node this unknown prevents us from fully describing, when there is one. */
  readonly subject?: string
  /** Human-readable detail (never parsed). */
  readonly detail?: string
  /**
   * The tracked data that entered the part of the program that could not be
   * followed. Absent means "unknown which data" -- every trace that reaches
   * the subject must treat itself as incomplete. Present, it lets a trace of
   * a different field or an unrelated path stay complete: an opaque call that
   * only ever saw `email` says nothing about where `passwordHash` went.
   */
  readonly data?: readonly FlowUnknownData[]
}

/** An explicit record that part of the program could not be analyzed. */
export interface FlowUnknown extends FlowUnknownInput {
  /** Content-addressed: `unknown:reason:file:line:column`. */
  readonly id: string
}

/** What was and was not analyzed -- a projection must not call a graph complete unless `complete`. */
export interface FlowCoverage {
  /** Function nodes whose status is not `unknown`. */
  readonly functionsAnalyzed: number
  /** Function nodes whose status is `unknown`. */
  readonly functionsUnanalyzed: number
  /** Edges whose status is `unknown`. */
  readonly edgesUnresolved: number
  /** Number of `FlowUnknown` records. */
  readonly unknowns: number
  /** True only when nothing above is non-zero apart from `functionsAnalyzed`. */
  readonly complete: boolean
}

/**
 * What the scanner saw happen to the data of an edge at one place, beyond what the edge says (ADR 0075).
 *
 * - `serialize-roundtrip`: the data was taken apart and put back together with nothing in between that reads it
 *   (`JSON.parse(JSON.stringify(x))`, `Object.fromEntries(Object.entries(x))`).
 * - `copy`: the data was copied and nothing was added, dropped or renamed (`structuredClone(x)`, `{ ...x }`,
 *   `[...x]`, `Array.from(x)`). `fresh` says the copied value was itself a copy made by one of these.
 * - `derive`: a value computed from the data was bound to a name that is never read (`unused`).
 * - `forward`: reserved for a producer that knows a function only hands the data on. The scanner does not emit it;
 *   forwarding chains are found from the edges alone, so no reader depends on this tag.
 */
export type FlowVia = "copy" | "serialize-roundtrip" | "forward" | "derive"

/** One tag as a producer supplies it -- the id is derived, never supplied. */
export interface FlowEdgeTagInput {
  readonly via: FlowVia
  /** Id of the existing edge that carries the data at this place (an edge id as `flowEdgeId` derives it). */
  readonly edge: string
  /** Where the copy, the derivation or the hand-over is. */
  readonly source: SourceLocation
  /** With `copy`: the value copied was already a fresh copy. */
  readonly fresh?: true
  /** With `derive`: nothing ever reads the derived value. */
  readonly unused?: true
}

/** One tag of the Flow Model. */
export interface FlowEdgeTag extends FlowEdgeTagInput {
  /** Content-addressed: `tag:via:edgeId@file:line:column`. */
  readonly id: string
}

/** Everything a producer hands to `buildFlowModel`. */
export interface FlowModelInput {
  readonly nodes: readonly FlowNodeInput[]
  readonly edges: readonly FlowEdgeInput[]
  readonly unknowns: readonly FlowUnknownInput[]
  /** What the scanner saw happen to the data of some edges. Optional and additive: edge ids do not depend on it. */
  readonly edgeTags?: readonly FlowEdgeTagInput[]
}

/** `data-cap`'s Flow Model. */
export interface FlowModel {
  /** Always `FLOW_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof FLOW_MODEL_SCHEMA_VERSION
  /** Every node, ordered by id. */
  readonly nodes: readonly FlowNode[]
  /** Every edge, ordered by id. */
  readonly edges: readonly FlowEdge[]
  /** Every explicit unknown, ordered by id. */
  readonly unknowns: readonly FlowUnknown[]
  /** What was and was not analyzed. */
  readonly coverage: FlowCoverage
  /** What the scanner saw happen to the data of some edges, ordered by id. Absent when it saw nothing worth noting (ADR 0075). */
  readonly edgeTags?: readonly FlowEdgeTag[]
}

/** Thrown when the input to `buildFlowModel` is internally inconsistent. */
export class FlowModelError extends DataCapError {
  readonly code = "DATA_CAP_FLOW_MODEL_INVALID"

  constructor(message: string) {
    super(message)
    this.name = "FlowModelError"
  }
}

/** The one place a node id is derived. */
export function flowNodeId(kind: FlowNodeKind, scope: string, name: string): string {
  return `${kind}:${scope}#${name}`
}

/** The one place an edge id is derived. Status is part of the id so a declared and a static record of one edge stay two records (ADR 0071). */
export function flowEdgeId(
  kind: FlowEdgeKind,
  from: string,
  to: string,
  path: readonly string[] | undefined,
  status: FlowStatus,
  origin?: string,
): string {
  const pathSegment = path === undefined ? "" : `:${path.join(".")}`
  const originSegment = origin === undefined ? "" : `^${origin}`
  return `${kind}:${from}->${to}${pathSegment}@${status}${originSegment}`
}

/** The one place a tag id is derived. */
export function flowEdgeTagId(via: FlowVia, edge: string, source: SourceLocation): string {
  return `tag:${via}:${edge}@${source.file}:${source.line}:${source.column}`
}

function flowUnknownId(reason: FlowUnknownReason, source: SourceLocation): string {
  return `unknown:${reason}:${source.file}:${source.line}:${source.column}`
}

function normalizeData(data: readonly FlowUnknownData[]): FlowUnknownData[] {
  const unique = new Map<string, FlowUnknownData>()
  for (const item of data)
    unique.set(`${item.origin}\u0000${item.path.join(".")}`, {
      origin: item.origin,
      path: [...item.path],
    })
  return [...unique.entries()]
    .map(([id, item]) => ({ id, item }))
    .sort(compareById)
    .map(({ item }) => item)
}

/**
 * Orders two records of one model by id. Ids are unique within a model, so two records are never equal:
 * whichever id sorts first (by UTF-16 code unit, as `Array#sort` does) goes first.
 */
export function compareById(a: { readonly id: string }, b: { readonly id: string }): number {
  return [a.id, b.id].sort()[0] === a.id ? -1 : 1
}

function assertNotObserved(status: FlowStatus, what: string): void {
  if (status === "observed") {
    throw new FlowModelError(
      `${what} has status "observed"; observations belong to the Observation Model, not the Flow Model (ADR 0072).`,
    )
  }
}

function sameFact(a: object, b: object): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function addNode(nodes: Map<string, FlowNode>, raw: FlowNodeInput): void {
  assertNotObserved(raw.status, `Node ${raw.kind}:${raw.scope}#${raw.name}`)
  const node: FlowNode = { id: flowNodeId(raw.kind, raw.scope, raw.name), ...raw }
  const existing = nodes.get(node.id)
  if (existing !== undefined && !sameFact(existing, node)) {
    throw new FlowModelError(
      `Node ${node.id} is described twice with different content; epistemic statuses are never blended (ADR 0071).`,
    )
  }
  nodes.set(node.id, node)
}

function assertEdgeEndpoints(nodes: ReadonlyMap<string, FlowNode>, raw: FlowEdgeInput): void {
  for (const endpoint of [raw.from, raw.to]) {
    if (!nodes.has(endpoint)) {
      throw new FlowModelError(`Edge ${raw.kind} refers to ${endpoint}, which is not a node.`)
    }
  }
  if (raw.origin !== undefined) {
    const origin = nodes.get(raw.origin)
    if (origin === undefined) {
      throw new FlowModelError(`Edge ${raw.kind} has origin ${raw.origin}, which is not a node.`)
    }
    if (origin.kind !== "field") {
      throw new FlowModelError(
        `Edge ${raw.kind} has origin ${raw.origin}, which is not a field node.`,
      )
    }
  }
}

function addEdge(
  nodes: ReadonlyMap<string, FlowNode>,
  edges: Map<string, FlowEdge>,
  raw: FlowEdgeInput,
): void {
  assertNotObserved(raw.status, `Edge ${raw.kind} ${raw.from} -> ${raw.to}`)
  assertEdgeEndpoints(nodes, raw)
  const edge: FlowEdge = {
    id: flowEdgeId(raw.kind, raw.from, raw.to, raw.path, raw.status, raw.origin),
    ...raw,
  }
  edges.set(edge.id, edge)
}

function assertUnknownRefs(nodes: ReadonlyMap<string, FlowNode>, raw: FlowUnknownInput): void {
  if (raw.subject !== undefined && !nodes.has(raw.subject)) {
    throw new FlowModelError(`Unknown refers to ${raw.subject}, which is not a node.`)
  }
  for (const item of raw.data ?? []) {
    if (nodes.get(item.origin)?.kind !== "field") {
      throw new FlowModelError(`Unknown data refers to ${item.origin}, which is not a field node.`)
    }
  }
}

/**
 * The same site reached twice describes everything either visit saw; a visit that did not say which data
 * concerns everything, so the merged record does not narrow it either.
 */
function mergedUnknownData(
  existing: FlowUnknown | undefined,
  raw: FlowUnknownInput,
): FlowUnknownData[] | undefined {
  const merged =
    existing === undefined
      ? raw.data
      : existing.data === undefined || raw.data === undefined
        ? undefined
        : [...existing.data, ...raw.data]
  return merged === undefined ? undefined : normalizeData(merged)
}

function addUnknown(
  nodes: ReadonlyMap<string, FlowNode>,
  unknowns: Map<string, FlowUnknown>,
  raw: FlowUnknownInput,
): void {
  assertUnknownRefs(nodes, raw)
  const id = flowUnknownId(raw.reason, raw.source)
  const data = mergedUnknownData(unknowns.get(id), raw)
  unknowns.set(id, {
    id,
    reason: raw.reason,
    source: raw.source,
    ...(raw.subject === undefined ? {} : { subject: raw.subject }),
    ...(raw.detail === undefined ? {} : { detail: raw.detail }),
    ...(data === undefined ? {} : { data }),
  })
}

/** A tag names an edge that is in the model; the same place tagged twice is one tag that holds what either said. */
function addTag(
  edges: ReadonlyMap<string, FlowEdge>,
  tags: Map<string, FlowEdgeTag>,
  raw: FlowEdgeTagInput,
): void {
  if (!edges.has(raw.edge)) {
    throw new FlowModelError(`Tag ${raw.via} refers to ${raw.edge}, which is not an edge.`)
  }
  const id = flowEdgeTagId(raw.via, raw.edge, raw.source)
  const existing = tags.get(id)
  tags.set(id, {
    id,
    via: raw.via,
    edge: raw.edge,
    source: raw.source,
    ...(raw.fresh === true || existing?.fresh === true ? { fresh: true as const } : {}),
    ...(raw.unused === true || existing?.unused === true ? { unused: true as const } : {}),
  })
}

function buildCoverage(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  unknowns: readonly FlowUnknown[],
): FlowCoverage {
  const functions = nodes.filter((node) => node.kind === "function")
  const functionsUnanalyzed = functions.filter((node) => node.status === "unknown").length
  const edgesUnresolved = edges.filter((edge) => edge.status === "unknown").length
  return {
    functionsAnalyzed: functions.length - functionsUnanalyzed,
    functionsUnanalyzed,
    edgesUnresolved,
    unknowns: unknowns.length,
    complete: functionsUnanalyzed === 0 && edgesUnresolved === 0 && unknowns.length === 0,
  }
}

/** Assigns ids, orders deterministically, checks referential integrity, and summarizes coverage. */
export function buildFlowModel(input: FlowModelInput): FlowModel {
  const nodes = new Map<string, FlowNode>()
  for (const raw of input.nodes) addNode(nodes, raw)
  const edges = new Map<string, FlowEdge>()
  for (const raw of input.edges) addEdge(nodes, edges, raw)
  const unknowns = new Map<string, FlowUnknown>()
  for (const raw of input.unknowns) addUnknown(nodes, unknowns, raw)

  const tags = new Map<string, FlowEdgeTag>()
  for (const raw of input.edgeTags ?? []) addTag(edges, tags, raw)

  const orderedNodes = [...nodes.values()].sort(compareById)
  const orderedEdges = [...edges.values()].sort(compareById)
  const orderedUnknowns = [...unknowns.values()].sort(compareById)
  const orderedTags = [...tags.values()].sort(compareById)

  return {
    schemaVersion: FLOW_MODEL_SCHEMA_VERSION,
    nodes: orderedNodes,
    edges: orderedEdges,
    unknowns: orderedUnknowns,
    coverage: buildCoverage(orderedNodes, orderedEdges, orderedUnknowns),
    ...(orderedTags.length === 0 ? {} : { edgeTags: orderedTags }),
  }
}
