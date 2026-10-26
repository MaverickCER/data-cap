/**
 * W3C PROV-JSON for the Evidence Model's flow (ADR 0070): provenance and
 * transformation lineage in the standard vocabulary, as a pure projection of
 * the one evidence object.
 *
 * The mapping follows PROV's own division of labour. Data (fields,
 * parameters, return values, boundaries, claims, observations) are
 * **entities**; the functions that move and reshape it, the analysis run, and
 * each observation scope are **activities**; `data-cap` is the **agent**.
 * A function `used` what it read and `wasGeneratedBy`-produced what it
 * returned or sent; a declared source `wasDerivedFrom`-feeds its field; a call
 * `wasInformedBy` its caller. Every relation carries the path and the
 * epistemic status (ADR 0071) of the edge it came from, so lineage is never
 * stated more strongly than the evidence supports. A path a function received
 * and dropped is a `used` with the role `discarded`: PROV has no verb for
 * "dropped", and silence would lose it.
 *
 * Isomorphic and deterministic: identifiers are percent-encoded qualified
 * names derived from the evidence's own content-addressed ids.
 */

import type { EvidenceModel } from "../build/evidence-model.js"
import type { Claim } from "../flow/claims-model.js"
import type { FlowEdge, FlowNode } from "../flow/flow-model.js"

/** A PROV-JSON attribute map. */
type Attributes = Record<string, unknown>

/** A PROV-JSON document, restricted to the sections this projection populates. */
export interface ProvDocument {
  readonly prefix: Readonly<Record<string, string>>
  readonly entity: Record<string, Attributes>
  readonly activity: Record<string, Attributes>
  readonly agent: Record<string, Attributes>
  readonly used?: Record<string, Attributes>
  readonly wasGeneratedBy?: Record<string, Attributes>
  readonly wasDerivedFrom?: Record<string, Attributes>
  readonly wasAssociatedWith?: Record<string, Attributes>
  readonly wasInformedBy?: Record<string, Attributes>
}

/** What the projection reads from the Evidence Model. */
export type ProvInput = Pick<EvidenceModel, "flow" | "claims" | "observation" | "provenance">

const PREFIXES = {
  prov: "http://www.w3.org/ns/prov#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  dc: "urn:data-cap:ns:",
} as const

/** A qualified name: percent-encoded so it is valid whatever characters the evidence's ids contain. */
function qname(kind: string, id: string): string {
  const encoded = encodeURIComponent(`${kind}/${id}`).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `dc:${encoded.endsWith(".") ? `${encoded.slice(0, -1)}%2E` : encoded}`
}

function time(iso: string): { readonly $: string; readonly type: "xsd:dateTime" } {
  return { $: iso, type: "xsd:dateTime" }
}

function pathText(path: readonly string[] | undefined): string | undefined {
  return path === undefined ? undefined : path.join(".")
}

class Relations {
  private count = 0
  constructor(readonly section: Record<string, Attributes>) {}
  add(attributes: Attributes): void {
    this.count += 1
    this.section[`_:r${String(this.count).padStart(6, "0")}`] = attributes
  }
}

function edgeAttributes(edge: FlowEdge): Attributes {
  const path = pathText(edge.path)
  return {
    "dc:edge": edge.id,
    "dc:kind": edge.kind,
    "dc:status": edge.status,
    ...(path === undefined ? {} : { "dc:path": path }),
    ...(edge.handling === undefined ? {} : { "dc:handling": edge.handling }),
  }
}

/** The PROV sections and relation counters one projection fills. */
interface Sections {
  readonly entity: Record<string, Attributes>
  readonly activity: Record<string, Attributes>
  readonly agent: Record<string, Attributes>
  readonly used: Relations
  readonly generated: Relations
  readonly derived: Relations
  readonly associated: Relations
  readonly informed: Relations
}

/** Where each flow node, field name, boundary name and observation landed in the document. */
interface Lookups {
  readonly known: Map<string, { readonly item: FlowNode; readonly id: string }>
  readonly fieldByName: Map<string, string>
  readonly boundaryByName: Map<string, string>
  readonly observationEntity: Map<string, string>
}

/** The PROV entity type of a non-function flow node. */
function entityType(kind: string): string {
  return kind === "field"
    ? "dc:Field"
    : kind === "parameter"
      ? "dc:Parameter"
      : kind === "return"
        ? "dc:ReturnValue"
        : "dc:Boundary"
}

function addAgentAndAnalysis(evidence: ProvInput, sections: Sections): void {
  sections.agent["dc:tool"] = {
    "prov:type": "prov:SoftwareAgent",
    "dc:name": "data-cap",
    "dc:version": evidence.provenance.toolVersion,
  }
  sections.activity["dc:analysis"] = {
    "prov:type": "dc:Analysis",
    "prov:startTime": time(evidence.provenance.generatedAt),
    "prov:endTime": time(evidence.provenance.generatedAt),
    ...(evidence.provenance.commit === undefined
      ? {}
      : { "dc:commit": evidence.provenance.commit }),
  }
  sections.associated.add({ "prov:activity": "dc:analysis", "prov:agent": "dc:tool" })
}

function addNodes(nodes: readonly FlowNode[], sections: Sections, lookups: Lookups): void {
  for (const node of nodes) {
    if (node.kind === "function") {
      const id = qname("function", node.id)
      lookups.known.set(node.id, { item: node, id })
      sections.activity[id] = {
        "prov:type": "dc:Function",
        "dc:name": node.name,
        "dc:scope": node.scope,
        "dc:status": node.status,
      }
      continue
    }
    const id = qname(node.kind, node.id)
    lookups.known.set(node.id, { item: node, id })
    if (node.kind === "field") lookups.fieldByName.set(node.name, id)
    if (node.kind === "boundary") lookups.boundaryByName.set(node.name, id)
    sections.entity[id] = {
      "prov:type": entityType(node.kind),
      "dc:name": node.name,
      "dc:scope": node.scope,
      "dc:status": node.status,
      ...(node.classification === undefined ? {} : { "dc:classification": node.classification }),
      ...(node.boundaryKind === undefined ? {} : { "dc:boundaryKind": node.boundaryKind }),
    }
  }
}

/** Files one resolved edge under the PROV relation its endpoints call for. */
function addRelation(
  edge: FlowEdge,
  source: { readonly item: FlowNode; readonly id: string },
  target: { readonly item: FlowNode; readonly id: string },
  sections: Sections,
): void {
  const { item: from, id: fromId } = source
  const { item: to, id: toId } = target
  const attributes = edgeAttributes(edge)

  if (edge.kind === "calls") {
    sections.informed.add({ "prov:informed": toId, "prov:informant": fromId, ...attributes })
  } else if (edge.kind === "discards") {
    sections.used.add({
      "prov:activity": fromId,
      "prov:entity": toId,
      "dc:role": "discarded",
      ...attributes,
    })
  } else if (from.kind !== "function" && to.kind === "function") {
    sections.used.add({ "prov:activity": toId, "prov:entity": fromId, ...attributes })
  } else if (from.kind === "function" && to.kind !== "function") {
    sections.generated.add({ "prov:entity": toId, "prov:activity": fromId, ...attributes })
  } else if (from.kind !== "function") {
    sections.derived.add({
      "prov:generatedEntity": toId,
      "prov:usedEntity": fromId,
      ...attributes,
    })
  }
}

function addEdges(edges: readonly FlowEdge[], sections: Sections, lookups: Lookups): void {
  for (const edge of edges) {
    const source = lookups.known.get(edge.from)
    const target = lookups.known.get(edge.to)
    if (source === undefined || target === undefined) continue
    addRelation(edge, source, target, sections)
  }
}

function addObservations(evidence: ProvInput, sections: Sections, lookups: Lookups): void {
  for (const scope of evidence.observation?.scopes ?? []) {
    sections.activity[qname("scope", scope)] = {
      "prov:type": "dc:ObservationScope",
      "dc:name": scope,
    }
  }
  for (const observation of evidence.observation?.observations ?? []) {
    const id = qname("observation", observation.id)
    lookups.observationEntity.set(observation.id, id)
    sections.entity[id] = {
      "prov:type": "dc:Observation",
      "dc:field": observation.field,
      "dc:boundary": `${observation.boundary.kind}:${observation.boundary.name}`,
      "dc:count": observation.count,
      "dc:status": "observed",
      ...(observation.handling === undefined ? {} : { "dc:handling": observation.handling }),
    }
    sections.generated.add({
      "prov:entity": id,
      "prov:activity": qname("scope", observation.scope),
    })
  }
}

function addClaim(claim: Claim, sections: Sections, lookups: Lookups): void {
  const id = qname("claim", claim.id)
  sections.entity[id] = {
    "prov:type": "dc:Claim",
    "dc:kind": claim.kind,
    "dc:statement": claim.statement,
    "dc:status": claim.status,
    "dc:verification": claim.verification,
    "dc:traceComplete": claim.scope.traceComplete,
  }
  sections.generated.add({ "prov:entity": id, "prov:activity": "dc:analysis" })
  const subject =
    lookups.fieldByName.get(claim.subject) ??
    lookups.fieldByName.get(claim.subject.split(".").slice(0, 2).join("."))
  if (subject !== undefined)
    sections.derived.add({
      "prov:generatedEntity": id,
      "prov:usedEntity": subject,
      "dc:role": "subject",
    })
  const object =
    claim.kind === "field-reaches-boundary" ? lookups.boundaryByName.get(claim.object) : undefined
  if (object !== undefined)
    sections.derived.add({
      "prov:generatedEntity": id,
      "prov:usedEntity": object,
      "dc:role": "object",
    })
  for (const [refs, role] of [
    [claim.supporting, "supporting"],
    [claim.contradicting, "contradicting"],
  ] as const) {
    for (const ref of refs) {
      const target = ref.model === "observation" ? lookups.observationEntity.get(ref.id) : undefined
      if (target !== undefined)
        sections.derived.add({
          "prov:generatedEntity": id,
          "prov:usedEntity": target,
          "dc:role": role,
        })
    }
  }
}

function addClaims(claims: readonly Claim[], sections: Sections, lookups: Lookups): void {
  for (const claim of claims) addClaim(claim, sections, lookups)
}

/** Projects the flow, claims and observations into a PROV-JSON document, or `undefined` when no flow was computed. */
export function buildProvDocument(evidence: ProvInput): ProvDocument | undefined {
  const { flow } = evidence
  if (flow === undefined) return undefined

  const sections: Sections = {
    entity: {},
    activity: {},
    agent: {},
    used: new Relations({}),
    generated: new Relations({}),
    derived: new Relations({}),
    associated: new Relations({}),
    informed: new Relations({}),
  }
  const lookups: Lookups = {
    known: new Map(),
    fieldByName: new Map(),
    boundaryByName: new Map(),
    observationEntity: new Map(),
  }

  addAgentAndAnalysis(evidence, sections)
  addNodes(flow.nodes, sections, lookups)
  addEdges(flow.edges, sections, lookups)
  addObservations(evidence, sections, lookups)
  addClaims(evidence.claims?.claims ?? [], sections, lookups)

  const { used, generated, derived, associated, informed } = sections
  return {
    prefix: PREFIXES,
    entity: sections.entity,
    activity: sections.activity,
    agent: sections.agent,
    ...(Object.keys(used.section).length === 0 ? {} : { used: used.section }),
    ...(Object.keys(generated.section).length === 0 ? {} : { wasGeneratedBy: generated.section }),
    ...(Object.keys(derived.section).length === 0 ? {} : { wasDerivedFrom: derived.section }),
    wasAssociatedWith: associated.section,
    ...(Object.keys(informed.section).length === 0 ? {} : { wasInformedBy: informed.section }),
  }
}
