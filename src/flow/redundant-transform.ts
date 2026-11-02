/**
 * Redundant transformations (ADR 0075): data that is handled more than it needs to be. A pure projection over the Flow
 * Model, like `analyzeLeastData`; it reads the model and nothing else and persists nothing.
 *
 * Three kinds, no more:
 *
 * - `round-trip`: the data is taken apart and put back together, or copied again although it is already a fresh copy,
 *   with nothing added, dropped or renamed. The scanner says where (`edgeTags`: `serialize-roundtrip`, or `copy` with
 *   `fresh`); this analysis decides whether the tag counts.
 * - `forwarding-hop`: a chain of at least three functions, each of which does nothing with a path of a field except hand
 *   it, unchanged, to exactly one callee (and hand the callee's answer back). Found from the edges alone: a function that
 *   also logs the path, transforms it, returns something else or hands it to a second callee is not a hop.
 * - `dead-derivation`: a value computed from a field and bound to a name nothing reads (`derive` tag with `unused`).
 *
 * Nothing is concluded from an incomplete picture (ADR 0071): data an `unknown` of the same function concerns is never
 * reported, because the code the analysis could not follow may be what uses the copy or the derived value.
 *
 * Isomorphic: no Node or compiler dependency.
 */

import type { ReportFinding } from "../build/findings.js"
import type { SourceLocation } from "../build/source-position.js"
import { flowNodeId } from "./flow-model.js"
import type { FlowEdge, FlowEdgeTag, FlowModel, FlowNode } from "./flow-model.js"
import type { LeastDataCapability } from "./least-data.js"

/** The kinds of redundant transformation. */
export type RedundantTransformKind = "round-trip" | "forwarding-hop" | "dead-derivation"

/** One redundant transformation of the data of one field. */
export interface RedundantTransform {
  readonly kind: RedundantTransformKind
  /** The capability the field belongs to. */
  readonly capability: LeastDataCapability
  /** The field's top-level name. */
  readonly field: string
  /** Id of the field's node in the Flow Model. */
  readonly fieldNode: string
  /** The paths inside the field that are handled redundantly (`[]` is the whole field), sorted. */
  readonly paths: readonly (readonly string[])[]
  /** Where it happens: the copy, the derivation, or the call that starts a forwarding chain. */
  readonly source?: SourceLocation
  /** For `forwarding-hop`: the ids of the function nodes that only hand the data on, in order, then the function that finally does something with it. Empty otherwise. */
  readonly hops: readonly string[]
  /** Ids of the flow edges this rests on, sorted. */
  readonly edges: readonly string[]
  /** For `round-trip`: how the data was taken apart and put back, `serialized` or `copied`. */
  readonly via?: "serialized" | "copied"
}

/** The fewest functions in a chain for it to be a `forwarding-hop`. */
export const MIN_FORWARDING_HOPS = 3

/** The names of a field node (`exportName.field.path`) and the file it is in. */
function fieldParts(
  node: FlowNode | undefined,
): { readonly capability: LeastDataCapability; readonly field: string } | undefined {
  if (node?.kind !== "field") return undefined
  const [exportName = node.name, ...rest] = node.name.split(".")
  return { capability: { file: node.scope, exportName }, field: rest.join(".") }
}

function pathKey(path: readonly string[] | undefined): string {
  return JSON.stringify(path ?? [])
}

function comparable(a: readonly string[], b: readonly string[]): boolean {
  const shorter = Math.min(a.length, b.length)
  return a.slice(0, shorter).every((segment, index) => segment === b[index])
}

/** Whether an unknown of `subject` may concern the data at `path` of `origin`: it names that data, or does not say which data. */
function blockedBy(
  flow: FlowModel,
  subject: string,
  origin: string,
  path: readonly string[],
): boolean {
  return flow.unknowns.some(
    (unknown) =>
      unknown.subject === subject &&
      (unknown.data === undefined ||
        unknown.data.some((item) => item.origin === origin && comparable(item.path, path))),
  )
}

/** Code-unit order. Only ever called on distinct strings: the callers compare de-duplicated keys, ids and paths. */
function compareText(a: string, b: string): number {
  // Stryker disable next-line EqualityOperator: equivalent -- the strings are never equal, so `<` and `<=` order them the same.
  return a < b ? -1 : 1
}

/** What a report is ordered by: the place (numbers padded so they sort as numbers), then the kind, the field and the chain. */
function sortKey(item: RedundantTransform): string[] {
  return [
    item.source?.file ?? "",
    String(item.source?.line ?? 0).padStart(9, "0"),
    String(item.source?.column ?? 0).padStart(9, "0"),
    item.kind,
    item.fieldNode,
    item.hops.join(">"),
  ]
}

function compareTransforms(a: RedundantTransform, b: RedundantTransform): number {
  return compareText(sortKey(a).join("\u0000"), sortKey(b).join("\u0000"))
}

// ----- tagged transformations ------------------------------------------------------------------------------------

/** What kind a tag makes its place, or `undefined` when it makes it nothing (a single copy of something that was not a copy). */
function kindOfTag(tag: FlowEdgeTag): RedundantTransformKind | undefined {
  if (tag.via === "serialize-roundtrip") return "round-trip"
  if (tag.via === "copy" && tag.fresh === true) return "round-trip"
  if (tag.via === "derive" && tag.unused === true) return "dead-derivation"
  return undefined
}

/** The tags that count for one place and one field, with what they make it. */
interface TagGroup {
  readonly kind: RedundantTransformKind
  readonly tag: FlowEdgeTag
  readonly origin: string
  readonly edges: FlowEdge[]
}

/** The tags that count, grouped by the place and the field they are about. */
function groupTags(flow: FlowModel, edgesById: ReadonlyMap<string, FlowEdge>): TagGroup[] {
  const groups = new Map<string, TagGroup>()
  // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder tag names no edge, so it is skipped.
  for (const tag of flow.edgeTags ?? []) {
    const edge = edgesById.get(tag.edge)
    const kind = kindOfTag(tag)
    if (kind === undefined || edge?.origin === undefined) continue
    if (blockedBy(flow, edge.to, edge.origin, edge.path ?? [])) continue
    const key = JSON.stringify([kind, tag.via, tag.source, edge.origin])
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { kind, tag, origin: edge.origin, edges: [edge] })
    else group.edges.push(edge)
  }
  return [...groups.values()]
}

function taggedTransforms(
  flow: FlowModel,
  nodesById: ReadonlyMap<string, FlowNode>,
  edgesById: ReadonlyMap<string, FlowEdge>,
): RedundantTransform[] {
  const found: RedundantTransform[] = []
  for (const { kind, tag, origin, edges } of groupTags(flow, edgesById)) {
    const parts = fieldParts(nodesById.get(origin))
    if (parts === undefined) continue
    found.push({
      kind,
      ...parts,
      fieldNode: origin,
      paths: uniquePaths(edges.map((edge) => edge.path ?? [])),
      source: tag.source,
      hops: [],
      edges: [...new Set(edges.map((edge) => edge.id))].sort(compareText),
      ...(kind === "round-trip"
        ? { via: tag.via === "serialize-roundtrip" ? ("serialized" as const) : ("copied" as const) }
        : {}),
    })
  }
  return found
}

function uniquePaths(paths: readonly (readonly string[])[]): (readonly string[])[] {
  const unique = new Map(paths.map((path) => [pathKey(path), path]))
  return [...unique.entries()].sort(([a], [b]) => compareText(a, b)).map(([, path]) => path)
}

// ----- forwarding chains ------------------------------------------------------------------------------------------

/** The edges that carry one path of one field. */
interface Carriers {
  readonly origin: string
  readonly path: readonly string[]
  readonly edges: readonly FlowEdge[]
}

/** Every data-carrying edge, grouped by the field and the path it carries. */
function carriersOf(flow: FlowModel): Carriers[] {
  const groups = new Map<string, { origin: string; path: readonly string[]; edges: FlowEdge[] }>()
  for (const edge of flow.edges) {
    if (edge.kind === "calls") continue
    const { origin } = edge
    // Stryker disable next-line ConditionalExpression,BlockStatement: equivalent -- carriers without an origin form chains of no field, which `forwardingTransforms` drops.
    if (origin === undefined) continue
    const key = `${origin}\u0000${pathKey(edge.path)}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { origin, path: edge.path ?? [], edges: [edge] })
    else group.edges.push(edge)
  }
  return [...groups.values()]
}

/** The function a parameter belongs to: a parameter node is named `function.parameter`. */
function ownerOfParameter(
  nodesById: ReadonlyMap<string, FlowNode>,
  parameter: FlowNode | undefined,
): string | undefined {
  if (parameter?.kind !== "parameter") return undefined
  const owner = flowNodeId(
    "function",
    parameter.scope,
    parameter.name.slice(0, parameter.name.lastIndexOf(".")),
  )
  return nodesById.has(owner) ? owner : undefined
}

/** A function that only hands one path of one field to one callee: the callee, and the edge that does it. */
interface Forwarder {
  readonly fn: string
  readonly next: string
  readonly pass: FlowEdge
}

/**
 * The function `fn` as a forwarder of what `carriers` carry, or `undefined` when it does anything else with it: reads it
 * without receiving it, hands it to anyone but one callee, sends, transforms, drops or returns anything but what the
 * callee returned, hands it on as anything but `static` (a transformed copy), or is not sure (an `unknown` edge).
 */
function forwarderOf(
  fn: string,
  carriers: Carriers,
  nodesById: ReadonlyMap<string, FlowNode>,
): Forwarder | undefined {
  const mine = carriers.edges.filter((edge) => edge.from === fn || edge.to === fn)
  if (mine.some((edge) => edge.status === "unknown")) return undefined
  // A parameter is never `fn` itself, so an edge it reads into is one that comes to `fn`.
  const received = mine.filter(
    (edge) => edge.kind === "reads" && nodesById.get(edge.from)?.kind === "parameter",
  )
  const passes = mine.filter((edge) => edge.from === fn && edge.kind === "passes")
  const [pass] = passes
  if (pass === undefined) return undefined
  const next = ownerOfParameter(nodesById, nodesById.get(pass.to))
  if (received.length === 0 || next === undefined) return undefined
  // It hands the data on as it got it: a transformed copy would be an `inferred` edge. What comes back may be, if the callee changed it.
  if (passes.some((edge) => edge.to !== pass.to || edge.status !== "static")) return undefined
  if (!onlyHandsOn(fn, next, mine, nodesById)) return undefined
  return { fn, next, pass }
}

/** Everything `fn` does with the data besides receiving it and passing it on: at most return what `next` returned. */
function onlyHandsOn(
  fn: string,
  next: string,
  mine: readonly FlowEdge[],
  nodesById: ReadonlyMap<string, FlowNode>,
): boolean {
  const others = mine.filter(
    (edge) =>
      !(edge.to === fn && edge.kind === "reads") && !(edge.from === fn && edge.kind === "passes"),
  )
  // Whatever comes to `fn` besides what it reads is from a return node, or is not an answer at all; an answer is `next`'s return.
  const answered = others.some((edge) => returnOwner(nodesById, edge.from) === next)
  return others.every((edge) =>
    edge.kind === "passes" ? answered : edge.kind === "returns" && edge.from === fn && answered,
  )
}

/** The function a return node belongs to: a return node is named `function#return`. */
function returnOwner(nodesById: ReadonlyMap<string, FlowNode>, id: string): string | undefined {
  const node = nodesById.get(id)
  if (node?.kind !== "return") return undefined
  const owner = flowNodeId("function", node.scope, node.name.slice(0, node.name.lastIndexOf("#")))
  return nodesById.has(owner) ? owner : undefined
}

/** The functions that are forwarders of what `carriers` carry, with a function that reads the data and an unknown that concerns it left out. */
function forwardersOf(
  flow: FlowModel,
  carriers: Carriers,
  nodesById: ReadonlyMap<string, FlowNode>,
): Map<string, Forwarder> {
  const forwarders = new Map<string, Forwarder>()
  const candidates = new Set(carriers.edges.map((edge) => edge.from))
  for (const fn of candidates) {
    if (nodesById.get(fn)?.kind !== "function") continue
    if (blockedBy(flow, fn, carriers.origin, carriers.path)) continue
    const forwarder = forwarderOf(fn, carriers, nodesById)
    if (forwarder !== undefined) forwarders.set(fn, forwarder)
  }
  return forwarders
}

/** A run of forwarders, each handing the data to the next: the first, the last, and all of them in order. */
interface Chain {
  readonly first: Forwarder
  readonly last: Forwarder
  readonly steps: readonly Forwarder[]
}

/** The chains of forwarders, each from a function no forwarder hands the data to, to the last forwarder; with the function after it. */
function chainsOf(forwarders: ReadonlyMap<string, Forwarder>): Chain[] {
  const handedTo = new Set([...forwarders.values()].map((forwarder) => forwarder.next))
  const chains: Chain[] = []
  for (const head of forwarders.values()) {
    if (handedTo.has(head.fn)) continue
    const steps: Forwarder[] = []
    let last = head
    const seen = new Set<string>()
    for (
      let step: Forwarder | undefined = head;
      step !== undefined && !seen.has(step.fn);
      step = forwarders.get(step.next)
    ) {
      seen.add(step.fn)
      // Stryker disable all: unreachable -- `seen` keeps every step distinct, so a chain is never longer than the forwarders; the bound only turns a walk that lost its cycle check into a failure instead of a hang.
      /* v8 ignore next 3 */
      if (steps.length >= forwarders.size) {
        throw new Error("a forwarding chain is longer than the forwarders it is made of")
      }
      // Stryker restore all
      steps.push(step)
      last = step
    }
    chains.push({ first: head, last, steps })
  }
  return chains
}

function forwardingTransforms(
  flow: FlowModel,
  nodesById: ReadonlyMap<string, FlowNode>,
): RedundantTransform[] {
  const byChain = new Map<
    string,
    {
      readonly chain: Chain
      readonly origin: string
      readonly paths: (readonly string[])[]
      readonly edges: string[]
    }
  >()
  for (const carriers of carriersOf(flow)) {
    for (const chain of chainsOf(forwardersOf(flow, carriers, nodesById))) {
      if (chain.steps.length < MIN_FORWARDING_HOPS) continue
      const key = JSON.stringify([carriers.origin, chain.steps.map((step) => step.fn)])
      const passes = chain.steps.map((step) => step.pass.id)
      const known = byChain.get(key)
      if (known === undefined)
        byChain.set(key, { chain, origin: carriers.origin, paths: [carriers.path], edges: passes })
      else {
        known.paths.push(carriers.path)
        known.edges.push(...passes)
      }
    }
  }
  const found: RedundantTransform[] = []
  for (const { chain, origin, paths, edges } of byChain.values()) {
    const parts = fieldParts(nodesById.get(origin))
    if (parts === undefined) continue
    const { first, last } = chain
    found.push({
      kind: "forwarding-hop",
      ...parts,
      fieldNode: origin,
      paths: uniquePaths(paths),
      ...(first.pass.source === undefined ? {} : { source: first.pass.source }),
      hops: [...chain.steps.map((step) => step.fn), last.next],
      edges: [...new Set(edges)].sort(compareText),
    })
  }
  return found
}

// ----- the analysis -----------------------------------------------------------------------------------------------

/**
 * Finds the redundant transformations in a Flow Model, in a fixed order (by place, then kind). A model without
 * `edgeTags` has no round trips or dead derivations to report; forwarding chains come from its edges.
 */
export function analyzeRedundantTransforms(flow: FlowModel): RedundantTransform[] {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]))
  const edgesById = new Map(flow.edges.map((edge) => [edge.id, edge]))
  return [
    ...taggedTransforms(flow, nodesById, edgesById),
    ...forwardingTransforms(flow, nodesById),
  ].sort(compareTransforms)
}

// ----- findings ---------------------------------------------------------------------------------------------------

function pathsText(paths: readonly (readonly string[])[]): string {
  return paths.map((path) => (path.length === 0 ? "(whole)" : path.join("."))).join(", ")
}

function messageOf(item: RedundantTransform, nodesById: ReadonlyMap<string, FlowNode>): string {
  const where = `field "${item.field}" on "${item.capability.exportName}" (${pathsText(item.paths)})`
  const at =
    item.source === undefined
      ? ""
      : ` at ${item.source.file}:${item.source.line}:${item.source.column}`
  if (item.kind === "forwarding-hop") {
    const names = item.hops.map((id) => nodesById.get(id)?.name ?? id)
    const hopped = names.slice(0, -1)
    return `Redundant transformation (forwarding-hop): ${where} passes unchanged through ${hopped.length} functions that only hand it on (${hopped.join(" -> ")}) before it reaches "${names.at(-1)}"${at}; call the function that uses it directly.`
  }
  if (item.kind === "dead-derivation")
    return `Redundant transformation (dead-derivation): a value derived from ${where} is computed${at} and never used.`
  return item.via === "serialized"
    ? `Redundant transformation (round-trip): ${where} is serialized and deserialized again${at} with nothing changed; the copy has the same shape as the original.`
    : `Redundant transformation (round-trip): ${where} is copied again${at} although it is already a fresh copy and nothing is changed.`
}

/** Turns redundant transformations into report findings (family `flow`, always `info`: this analysis alone never fails a build). */
export function redundantTransformFindings(
  items: readonly RedundantTransform[],
  flow: FlowModel,
): ReportFinding[] {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]))
  return items.map((item) => ({
    code: "LEAST_DATA_REDUNDANT_TRANSFORM" as const,
    family: "flow" as const,
    severity: "info" as const,
    message: messageOf(item, nodesById),
    capability: item.capability,
    field: [item.field],
    ...(item.source === undefined
      ? {}
      : {
          source: item.source.file,
          position: { line: item.source.line, column: item.source.column },
        }),
    evidence: [
      { model: "flow" as const, id: item.fieldNode },
      ...item.edges.map((id) => ({ model: "flow" as const, id })),
    ],
  }))
}
