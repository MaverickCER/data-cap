/**
 * CycloneDX 1.6 for the Evidence Model's flow (ADR 0070): the data flows a
 * system has, in the vocabulary software-supply-chain tooling already reads,
 * as a pure projection of the one evidence object.
 *
 * CycloneDX has no node for "a function" and none for "a field". It does have
 * `services[].data[]`, which states that a service sends or receives data of a
 * classification to or from other services. So the mapping is by what the
 * evidence is about, not by how the analysis found it:
 *
 * - each **boundary** (a database, a client response, a log, a queue ...) is a
 *   `service`;
 * - each **capability-owning component** (the file that declares fields) is a
 *   `service`;
 * - each flow of a field between the two is a `data` entry on both services,
 *   `outbound` where the evidence says the field reaches the boundary,
 *   `inbound` where it says the boundary is the field's source, and `unknown`
 *   where only a runtime observation exists (an observation says the field
 *   was seen at the boundary, not which way it went);
 * - the field's classification is the entry's `classification`, the declaring
 *   capability's owner its `governance`, and the services are linked by
 *   BOM-Link in `source`/`destination`.
 *
 * Status is never blended (ADR 0071). `data` entries have no `properties`, so
 * the status of every flow is stated in its `description` AND as a
 * `data-cap:data-flow` property of the service (JSON, machine-readable), and
 * every service carries `data-cap:status`. A declared, a static and an
 * observed record of one crossing are three entries. Coverage, policy
 * counts and claim counts are metadata properties; every unknown, violated or
 * indeterminate policy result and every claim that is not simply verified is an
 * annotation, so a consumer that reads only this BOM cannot mistake a partial
 * analysis for a complete one.
 *
 * Deterministic: `bom-ref`s and the `serialNumber` are derived from the
 * evidence's own content-addressed ids and provenance (see `uuid.ts`), never
 * random, and everything is ordered. Isomorphic: no Node modules.
 */

import type { EvidenceModel } from "../build/evidence-model.js"
import type { Claim } from "../flow/claims-model.js"
import type { FlowHandling, FlowModel, FlowNode, FlowStatus } from "../flow/flow-model.js"
import { subpathWithin } from "../flow/observation-model.js"
import type { Observation } from "../flow/observation-model.js"
import type { PolicyResult } from "../flow/policy-model.js"
import { deterministicUuid } from "./uuid.js"

/** Options for `buildCycloneDxBom`. */
export interface CycloneDxOptions {
  /** Name of the described system (`metadata.component.name`; default `data-cap data-flow`). */
  readonly name?: string | undefined
}

/** A CycloneDX name/value property. */
export interface CycloneDxProperty {
  readonly name: string
  readonly value: string
}

/** A CycloneDX `serviceData` entry. */
export interface CycloneDxData {
  readonly flow: "inbound" | "outbound" | "bi-directional" | "unknown"
  readonly classification: string
  readonly name: string
  readonly description: string
  readonly governance?: {
    readonly owners: readonly { readonly organization: { readonly name: string } }[]
  }
  readonly source?: readonly string[]
  readonly destination?: readonly string[]
}

/** A CycloneDX service, restricted to what this projection populates. */
export interface CycloneDxService {
  readonly "bom-ref": string
  readonly name: string
  readonly description: string
  readonly data?: readonly CycloneDxData[]
  readonly properties: readonly CycloneDxProperty[]
}

/** A CycloneDX annotation. */
export interface CycloneDxAnnotation {
  readonly "bom-ref": string
  readonly subjects: readonly string[]
  readonly annotator: {
    readonly component: {
      readonly type: "application"
      readonly name: string
      readonly version: string
    }
  }
  readonly timestamp: string
  readonly text: string
}

/** The CycloneDX 1.6 document, restricted to what this projection populates. */
export interface CycloneDxBom {
  readonly bomFormat: "CycloneDX"
  readonly specVersion: "1.6"
  readonly serialNumber: string
  readonly version: 1
  readonly metadata: {
    readonly timestamp: string
    readonly tools: {
      readonly components: readonly {
        readonly type: "application"
        readonly "bom-ref": string
        readonly name: string
        readonly version: string
      }[]
    }
    readonly component: {
      readonly type: "application"
      readonly "bom-ref": string
      readonly name: string
    }
    readonly properties: readonly CycloneDxProperty[]
  }
  readonly services?: readonly CycloneDxService[]
  readonly annotations?: readonly CycloneDxAnnotation[]
}

/** What the projection reads from the Evidence Model. */
export type CycloneDxInput = Pick<
  EvidenceModel,
  "flow" | "policy" | "claims" | "observation" | "provenance" | "capability"
>

type Direction = Exclude<CycloneDxData["flow"], "bi-directional">

/** A field path as shown wherever a path list is shown; a whole field (no path) is `(whole)`. */
function pathText(path: readonly string[]): string {
  return path.length === 0 ? "(whole)" : path.join(".")
}

/** One flow of one field between a component and a boundary, with the one status it rests on. */
interface FlowFact {
  readonly field: FieldInfo
  readonly boundary: Draft
  readonly direction: Direction
  readonly status: FlowStatus
  readonly handling: FlowHandling | undefined
  readonly paths: Set<string>
  edges: number
  readonly scopes: Set<string>
  count: number
}

interface FieldInfo {
  readonly name: string
  readonly classification: string
  readonly owner: string | undefined
  readonly component: Draft
}

/** A service being assembled. */
interface Draft {
  readonly ref: string
  readonly name: string
  readonly kind: "boundary" | "component"
  readonly description: string
  readonly statuses: Set<FlowStatus>
  readonly identity: readonly CycloneDxProperty[]
  readonly facts: FlowFact[]
}

interface BoundaryEntry {
  readonly name: string
  readonly kind: FlowNode["boundaryKind"]
  readonly draft: Draft
}

interface Context {
  readonly flow: FlowModel
  readonly evidence: CycloneDxInput
  readonly serial: string
  readonly seed: string
  readonly tool: string
  readonly nodes: ReadonlyMap<string, FlowNode>
  /** The static flow's boundaries, so an observation is matched to one without scanning the whole graph. */
  readonly boundaries: Map<string, BoundaryEntry>
  readonly drafts: Map<string, Draft>
  readonly fields: Map<string, FieldInfo>
  readonly facts: Map<string, FlowFact>
}

function reference(kind: string, key: string): string {
  return `data-cap-${kind}-${deterministicUuid(key)}`
}

function byText(a: string, b: string): number {
  return a.localeCompare(b, "en")
}

function link(serial: string, ref: string): string {
  return `urn:cdx:${serial}/1#${ref}`
}

function lookup<V>(map: ReadonlyMap<string, V>, key: string | undefined): V | undefined {
  // Stryker disable next-line ConditionalExpression: equivalent -- Map.get(undefined) is undefined too; the guard only satisfies the type checker.
  return key === undefined ? undefined : map.get(key)
}

function ownerOf(evidence: CycloneDxInput, field: FlowNode): string | undefined {
  const capability = evidence.capability.capabilities.find(
    (candidate) =>
      candidate.file === field.scope &&
      (field.name === candidate.exportName || field.name.startsWith(`${candidate.exportName}.`)),
  )
  return capability?.docs?.owner
}

function newDraft(
  context: Context,
  kind: Draft["kind"],
  key: string,
  name: string,
  description: string,
  identity: readonly CycloneDxProperty[],
): Draft {
  const ref = reference(kind, key)
  const existing = context.drafts.get(ref)
  if (existing !== undefined) return existing
  const draft: Draft = { ref, name, kind, description, statuses: new Set(), identity, facts: [] }
  context.drafts.set(ref, draft)
  return draft
}

/** One service per boundary node and per capability-owning file, from the static flow. */
function addFlowServices(context: Context): void {
  for (const node of context.flow.nodes) {
    if (node.kind === "boundary") {
      const draft = newDraft(
        context,
        "boundary",
        node.id,
        node.name,
        `Data boundary${node.boundaryKind === undefined ? "" : ` (${node.boundaryKind})`}.`,
        [
          { name: "data-cap:node-id", value: node.id },
          ...(node.boundaryKind === undefined
            ? []
            : [{ name: "data-cap:boundary-kind", value: node.boundaryKind }]),
        ],
      )
      draft.statuses.add(node.status)
      context.boundaries.set(draft.ref, { name: node.name, kind: node.boundaryKind, draft })
    } else if (node.kind === "field") {
      const component = newDraft(
        context,
        "component",
        node.scope,
        node.scope,
        "Capability-owning component: declares the fields listed in data-cap:field.",
        [{ name: "data-cap:node-id", value: node.scope }],
      )
      component.statuses.add(node.status)
      context.fields.set(node.id, {
        name: node.name,
        classification: node.classification ?? "unclassified",
        owner: ownerOf(context.evidence, node),
        component,
      })
    }
  }
}

function addFact(
  context: Context,
  field: FieldInfo,
  boundary: Draft,
  direction: Direction,
  status: FlowStatus,
  handling: FlowHandling | undefined,
  path: string,
): FlowFact {
  const key = JSON.stringify([
    field.component.ref,
    field.name,
    boundary.ref,
    direction,
    status,
    handling ?? null,
  ])
  const existing = context.facts.get(key)
  const fact: FlowFact = existing ?? {
    field,
    boundary,
    direction,
    status,
    handling,
    paths: new Set(),
    edges: 0,
    scopes: new Set(),
    count: 0,
  }
  if (existing === undefined) {
    context.facts.set(key, fact)
    field.component.facts.push(fact)
    boundary.facts.push(fact)
  }
  fact.paths.add(path)
  return fact
}

/** Edges that carry one field's data into or out of a boundary become static, declared or inferred facts. */
function addEdgeFacts(context: Context): void {
  const boundaryDraft = (id: string): Draft | undefined => {
    const node = context.nodes.get(id)
    return node?.kind === "boundary"
      ? context.drafts.get(reference("boundary", node.id))
      : undefined
  }
  for (const edge of context.flow.edges) {
    if (edge.kind === "calls" || edge.kind === "discards") continue
    const field = lookup(context.fields, edge.origin)
    if (field === undefined) continue
    const path = pathText(edge.path ?? [])
    const target = boundaryDraft(edge.to)
    const source = boundaryDraft(edge.from)
    const boundary = target ?? source
    if (boundary === undefined) continue
    const fact = addFact(
      context,
      field,
      boundary,
      target === undefined ? "inbound" : "outbound",
      edge.status,
      edge.handling,
      path,
    )
    fact.edges += 1
  }
}

function observedField(
  context: Context,
  observation: Observation,
): { info: FieldInfo; path: string } {
  for (const info of context.fields.values()) {
    const inside = subpathWithin(info.name, observation.field)
    if (inside !== undefined) return { info, path: pathText(inside) }
  }
  const component = newDraft(
    context,
    "component",
    `observed:${observation.field}`,
    observation.field,
    "A field seen at runtime that the static flow does not declare.",
    [{ name: "data-cap:node-id", value: `observed:${observation.field}` }],
  )
  component.statuses.add("observed")
  return {
    info: { name: observation.field, classification: "unclassified", owner: undefined, component },
    path: pathText([]),
  }
}

function observedBoundary(context: Context, observation: Observation): Draft {
  for (const entry of context.boundaries.values()) {
    if (
      entry.name === observation.boundary.name &&
      (entry.kind === undefined || entry.kind === observation.boundary.kind)
    ) {
      return entry.draft
    }
  }
  const key = `observed:${observation.boundary.kind}:${observation.boundary.name}`
  const draft = newDraft(
    context,
    "boundary",
    key,
    observation.boundary.name,
    `Data boundary (${observation.boundary.kind}) seen only at runtime.`,
    [
      { name: "data-cap:node-id", value: key },
      { name: "data-cap:boundary-kind", value: observation.boundary.kind },
    ],
  )
  draft.statuses.add("observed")
  return draft
}

/** Observations stay observed: they never merge into a static fact, and carry no direction. */
function addObservationFacts(context: Context): void {
  for (const observation of context.evidence.observation?.observations ?? []) {
    const { info, path } = observedField(context, observation)
    const boundary = observedBoundary(context, observation)
    const fact = addFact(context, info, boundary, "unknown", "observed", observation.handling, path)
    fact.scopes.add(observation.scope)
    fact.count += observation.count
  }
}

function factPaths(fact: FlowFact): string[] {
  return [...fact.paths].sort(byText)
}

function describeFact(fact: FlowFact): string {
  const parts = [
    `status: ${fact.status}`,
    `paths: ${factPaths(fact).join(", ")}`,
    ...(fact.handling === undefined ? [] : [`handling: ${fact.handling}`]),
    fact.status === "observed"
      ? `observed ${fact.count} time(s) in ${[...fact.scopes].sort(byText).join(", ")}`
      : `${fact.edges} edge(s)`,
  ]
  return parts.join("; ")
}

function mirror(direction: Direction): Direction {
  if (direction === "inbound") return "outbound"
  return direction === "outbound" ? "inbound" : direction
}

function directionRank(direction: Direction): number {
  if (direction === "inbound") return 0
  return direction === "outbound" ? 1 : 2
}

/** Entries are ordered by direction, then by what is left of the rank, each part compared as text. */
type EntryRank = readonly [number, string, string, string, string]

function compareRanks(a: EntryRank, b: EntryRank): number {
  return (
    a[0] - b[0] ||
    byText(a[1], b[1]) ||
    byText(a[2], b[2]) ||
    byText(a[3], b[3]) ||
    byText(a[4], b[4])
  )
}

/** The entry for `service`'s side of a fact, and the machine-readable property that restates it with its status. */
function entryFor(
  context: Context,
  service: Draft,
  fact: FlowFact,
): { entry: CycloneDxData; property: CycloneDxProperty; rank: EntryRank } {
  const own = service.kind === "component"
  const direction = own ? fact.direction : mirror(fact.direction)
  const peer = own ? fact.boundary : fact.field.component
  const reachable = [link(context.serial, peer.ref)]
  const observed = fact.status === "observed"
  const detail = {
    field: fact.field.name,
    flow: direction,
    peer: peer.name,
    status: fact.status,
    paths: factPaths(fact),
    handling: fact.handling === undefined ? [] : [fact.handling],
    ...(observed
      ? { scopes: [...fact.scopes].sort(byText), count: fact.count }
      : { edges: fact.edges }),
  }
  return {
    entry: {
      flow: direction,
      classification: fact.field.classification,
      name: fact.field.name,
      description: describeFact(fact),
      ...(fact.field.owner === undefined
        ? {}
        : { governance: { owners: [{ organization: { name: fact.field.owner } }] } }),
      ...(direction === "inbound" ? { source: reachable } : { destination: reachable }),
    },
    property: { name: "data-cap:data-flow", value: JSON.stringify(detail) },
    rank: [directionRank(direction), peer.name, fact.status, fact.handling ?? "", fact.field.name],
  }
}

function toService(context: Context, draft: Draft): CycloneDxService {
  const entries = draft.facts
    .map((fact) => entryFor(context, draft, fact))
    .sort((a, b) => compareRanks(a.rank, b.rank))
  const declared = Array.from(context.fields.values())
    .filter((info) => info.component === draft)
    .map((info) => info.name)
  const fields = [...new Set([...declared, ...draft.facts.map((fact) => fact.field.name)])].sort(
    byText,
  )
  return {
    "bom-ref": draft.ref,
    name: draft.name,
    description: draft.description,
    ...(entries.length === 0 ? {} : { data: entries.map((item) => item.entry) }),
    properties: [
      { name: "data-cap:node-kind", value: draft.kind },
      ...[...draft.statuses].sort(byText).map((value) => ({ name: "data-cap:status", value })),
      ...draft.identity,
      ...(draft.kind === "component" ? fields : []).map((value) => ({
        name: "data-cap:field",
        value,
      })),
      ...entries.map((item) => item.property),
    ],
  }
}

function dataText(
  unknownData: readonly { origin: string; path: readonly string[] }[],
  context: Context,
): string {
  return unknownData
    .map((item) => {
      const name = lookup(context.fields, item.origin)?.name ?? item.origin
      return `${name}: ${pathText(item.path)}`
    })
    .join("; ")
}

interface Note {
  readonly text: string
  readonly subjects: readonly string[]
}

function unknownNotes(context: Context): Note[] {
  return context.flow.unknowns.map((unknown) => {
    const owners =
      unknown.data?.flatMap((item) => {
        const field = context.fields.get(item.origin)
        return field === undefined ? [] : [field.component.ref]
      }) ?? []
    const where = `${unknown.source.file}:${unknown.source.line}:${unknown.source.column}`
    const detail = unknown.detail === undefined ? "" : ` -- ${unknown.detail}`
    const data =
      unknown.data === undefined || unknown.data.length === 0
        ? " Which data entered it is not known."
        : ` Data that entered it: ${dataText(unknown.data, context)}.`
    return {
      text: `unknown: ${unknown.reason} at ${where} (data-cap:status=unknown)${detail}.${data}`,
      subjects: owners.length === 0 ? [context.tool] : owners,
    }
  })
}

function policyNote(context: Context, result: PolicyResult): Note | undefined {
  if (result.outcome === "satisfied") return undefined
  const field = lookup(context.fields, result.subject)
  const boundaryNode = lookup(context.nodes, result.boundary)
  const boundary =
    boundaryNode === undefined
      ? undefined
      : context.drafts.get(reference("boundary", boundaryNode.id))
  const reason = result.reason === undefined ? "" : ` -- ${result.reason}`
  const reaching = boundaryNode === undefined ? "" : ` reaching ${boundaryNode.name}`
  const subjects = [field?.component.ref, boundary?.ref].flatMap((ref) =>
    ref === undefined ? [] : [ref],
  )
  return {
    text: `policy ${result.outcome}: ${result.ruleId} for ${field?.name ?? "no field"}${reaching} (data-cap:status=${result.basis})${reason}`,
    subjects: subjects.length === 0 ? [context.tool] : subjects,
  }
}

function claimNote(context: Context, claim: Claim): Note | undefined {
  if (claim.verification === "verified") return undefined
  const field = [...context.fields.values()].find((info) => info.name === claim.subject)
  const trace = claim.scope.traceComplete ? "trace complete" : "trace not complete"
  return {
    text: `claim ${claim.verification}: ${claim.statement} (data-cap:status=${claim.status}; ${trace})`,
    subjects: field === undefined ? [context.tool] : [field.component.ref],
  }
}

function annotationsOf(context: Context): CycloneDxAnnotation[] {
  const { evidence } = context
  const notes: Note[] = [
    ...unknownNotes(context),
    ...(evidence.policy?.results ?? []).flatMap((result) => policyNote(context, result) ?? []),
    ...(evidence.claims?.claims ?? []).flatMap((claim) => claimNote(context, claim) ?? []),
  ]
  const seen = new Map<string, number>()
  return notes
    .sort((a, b) => byText(a.text, b.text))
    .map((note) => {
      const occurrence = seen.get(note.text) ?? 0
      seen.set(note.text, occurrence + 1)
      return {
        "bom-ref": reference("annotation", `${context.seed}|${note.text}|${occurrence}`),
        subjects: [...new Set(note.subjects)].sort(byText),
        annotator: {
          component: {
            type: "application",
            name: "data-cap",
            version: evidence.provenance.toolVersion,
          },
        },
        timestamp: evidence.provenance.generatedAt,
        text: note.text,
      }
    })
}

function metadataProperties(evidence: CycloneDxInput, flow: FlowModel): CycloneDxProperty[] {
  const { coverage } = flow
  const entries: [string, string][] = [
    ["data-cap:coverage.complete", String(coverage.complete)],
    ["data-cap:coverage.functionsAnalyzed", String(coverage.functionsAnalyzed)],
    ["data-cap:coverage.functionsUnanalyzed", String(coverage.functionsUnanalyzed)],
    ["data-cap:coverage.edgesUnresolved", String(coverage.edgesUnresolved)],
    ["data-cap:coverage.unknowns", String(coverage.unknowns)],
  ]
  if (evidence.provenance.commit !== undefined)
    entries.push(["data-cap:commit", evidence.provenance.commit])
  for (const [outcome, count] of Object.entries(evidence.policy?.summary ?? {})) {
    entries.push([`data-cap:policy.${outcome}`, String(count)])
  }
  for (const [verification, count] of Object.entries(evidence.claims?.summary ?? {})) {
    entries.push([`data-cap:claims.${verification}`, String(count)])
  }
  if (evidence.observation !== undefined) {
    entries.push(["data-cap:observation.scopes", String(evidence.observation.scopes.length)])
    entries.push(["data-cap:observation.skipped", String(evidence.observation.skipped)])
  }
  return entries.map(([name, value]) => ({ name, value }))
}

/** Projects the flow, policy, claims and observations into CycloneDX 1.6, or `undefined` when no flow was computed. */
export function buildCycloneDxBom(
  evidence: CycloneDxInput,
  options: CycloneDxOptions = {},
): CycloneDxBom | undefined {
  const { flow } = evidence
  if (flow === undefined) return undefined
  const seed = `${evidence.provenance.generatedAt}|${evidence.provenance.commit ?? ""}`
  const serial = deterministicUuid(`${seed}|cyclonedx`)
  const context: Context = {
    flow,
    evidence,
    serial,
    seed,
    tool: reference("tool", "data-cap"),
    nodes: new Map(flow.nodes.map((node) => [node.id, node])),
    boundaries: new Map(),
    drafts: new Map(),
    fields: new Map(),
    facts: new Map(),
  }
  addFlowServices(context)
  addEdgeFacts(context)
  addObservationFacts(context)

  const services = [...context.drafts.values()]
    .sort((a, b) => byText(a.kind, b.kind) || byText(a.name, b.name) || byText(a.ref, b.ref))
    .map((draft) => toService(context, draft))
  const annotations = annotationsOf(context)

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${serial}`,
    version: 1,
    metadata: {
      timestamp: evidence.provenance.generatedAt,
      tools: {
        components: [
          {
            type: "application",
            "bom-ref": context.tool,
            name: "data-cap",
            version: evidence.provenance.toolVersion,
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": reference("subject", seed),
        name: options.name ?? "data-cap data-flow",
      },
      properties: metadataProperties(evidence, flow),
    },
    ...(services.length === 0 ? {} : { services }),
    ...(annotations.length === 0 ? {} : { annotations }),
  }
}

/** `buildCycloneDxBom` serialized as stable, indented JSON with a trailing newline, or `undefined` when no flow was computed. */
export function renderFlowCycloneDx(
  evidence: CycloneDxInput,
  options: CycloneDxOptions = {},
): string | undefined {
  const bom = buildCycloneDxBom(evidence, options)
  return bom === undefined ? undefined : `${JSON.stringify(bom, null, 2)}\n`
}
