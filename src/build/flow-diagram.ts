/**
 * Renders `flow-graph.ts`'s output as Mermaid `flowchart` diagrams, using
 * OWASP's data-flow-diagram vocabulary mapped onto data-cap's own types:
 *
 * - **External entities** (OWASP) -> declared endpoints with kind
 *   `"external-service" | "api" | "user-input"`, drawn as subroutine-shaped
 *   nodes (`[[ ]]`) outside the trust boundary.
 * - **Data stores** (OWASP) -> declared endpoints with kind
 *   `"database" | "cache" | "storage" | "queue"`, drawn as cylinder nodes
 *   (`[( )]`) outside the trust boundary.
 * - **Processes** (OWASP) -> one node per getter/mutator/subscription (not
 *   one node per capability -- see below), drawn as stadium nodes (`([ ])`)
 *   inside the trust boundary.
 * - **Data** -> one node per field, drawn as a parallelogram (`[/ /]`)
 *   inside the trust boundary, sitting between an operation and its proven
 *   consumers.
 * - **Trust boundary** (OWASP) -> a `subgraph` wrapping everything provable
 *   from in-repo AST analysis (operations, fields, proven consumer edges);
 *   declared external endpoints sit outside it.
 *
 * The chain for one field is real, not a single flattened hop: a declared
 * origin endpoint connects to the SPECIFIC getter/subscription that
 * declares it, which connects to the field, which connects to each proven
 * consumer site (labeled with its exact `file:line:column` when known) --
 * and symmetrically for a mutator's declared destination endpoint. Every
 * edge is labeled by its epistemic status ("declared" or "proven"), never
 * left ambiguous; a "declared" edge touching the endpoint itself also
 * carries the endpoint's own declared `handling` state when present (e.g.
 * `"declared: email (encrypted)"`). A `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY`
 * finding's edge is styled distinctly (`linkStyle`) so a reviewer's eye
 * goes straight to it -- only the endpoint-touching edge, never the purely
 * internal operation<->field hop, since the finding is about the boundary
 * crossing specifically. No SVG rasterization: fenced ` ```mermaid ` blocks
 * already render natively on GitHub/GitHub Pages/most docs tooling, so a
 * headless-browser rendering dependency would be a disproportionate
 * addition to a Node-only build tool for a static image `.mmd` source
 * already provides.
 */

import type { DataFlowEndpoint } from "../core/document.js"
import { displayPath } from "./display-path.js"
import type { CapabilityNode } from "./inventory.js"
import { isBoundaryCrossingKind } from "./flow-graph.js"
import type { FieldFlow, FieldFlowEndpoint } from "./flow-graph.js"
import { NodeIdAllocator } from "./node-id-allocator.js"

/** OWASP data-flow "external entity" endpoint kinds. */
function isEntityKind(kind: DataFlowEndpoint["kind"]): boolean {
  return kind === "external-service" || kind === "api" || kind === "user-input"
}
/** OWASP data-flow "data store" endpoint kinds. */
function isStoreKind(kind: DataFlowEndpoint["kind"]): boolean {
  return kind === "database" || kind === "cache" || kind === "storage" || kind === "queue"
}

class DiagramBuilder {
  private readonly ids = new NodeIdAllocator()
  private readonly nodeLines = new Map<string, string>()
  readonly boundaryNodeIds: string[] = []
  private readonly edgeLines: string[] = []
  private readonly sensitiveEdgeIndexes: number[] = []

  constructor(private readonly root: string) {}

  private idFor(key: string): string {
    return this.ids.idFor(key)
  }

  /** Registers a node that sits inside the Trust Boundary subgraph, first time only. */
  private boundaryNode(id: string, line: string): string {
    if (!this.nodeLines.has(id)) {
      this.nodeLines.set(id, line)
      this.boundaryNodeIds.push(id)
    }
    return id
  }

  // Node-id keys. Most kinds are already shaped so they cannot collide:
  //   capability   `file#export`
  //   operation    `file#export#kind:name`   (a `#kind:name` suffix on the above)
  //   endpoint     `endpointKind:name`       (endpoint kinds are disjoint from op kinds)
  // Two need an explicit tag:
  //   field        `field:file#export#path`  -- else a `path` of `"kind:name"`
  //                                             would collide with an operation
  //   consumer     `consumer:from`           -- else a `from` of `"file#export"`
  //                                             would collide with a capability

  processNode(capability: { readonly file: string; readonly exportName: string }): string {
    const id = this.idFor(`${capability.file}#${capability.exportName}`)
    return this.boundaryNode(id, `${id}(["${capability.exportName}"])`)
  }

  /** One node per getter/mutator/subscription -- the specific operation an endpoint/field chain actually runs through, not the whole capability. */
  operationNode(
    capability: { readonly file: string; readonly exportName: string },
    operation: { readonly kind: "getter" | "mutator" | "subscription"; readonly name: string },
  ): string {
    const id = this.idFor(
      `${capability.file}#${capability.exportName}#${operation.kind}:${operation.name}`,
    )
    return this.boundaryNode(id, `${id}(["${operation.kind}: ${operation.name}"])`)
  }

  /** One node per field -- sits between the operation(s) that write it and its proven consumers, drawn as a parallelogram (the conventional flowchart shape for data, distinct from a process). */
  fieldNode(
    capability: { readonly file: string; readonly exportName: string },
    field: readonly string[],
  ): string {
    const id = this.idFor(`field:${capability.file}#${capability.exportName}#${field.join(".")}`)
    return this.boundaryNode(id, `${id}[/"${field.join(".")}"/]`)
  }

  endpointNode(endpoint: DataFlowEndpoint): string {
    const key = `${endpoint.kind}:${endpoint.name}`
    const id = this.idFor(key)
    const label = `${endpoint.name}<br/><em>${endpoint.kind}</em>`
    const shape = isEntityKind(endpoint.kind)
      ? `${id}[["${label}"]]` // external entity (OWASP)
      : isStoreKind(endpoint.kind)
        ? `${id}[("${label}")]` // data store (OWASP)
        : `${id}["${label}"]` // "internal"/"computed" -- neither a store nor an external entity
    // Endpoint nodes carry no per-reference state, so re-`set`ting the same id is
    // idempotent (a `Map` keeps the original insertion position).
    this.nodeLines.set(id, shape)
    return id
  }

  consumerNode(file: string): string {
    const key = `consumer:${file}`
    const id = this.idFor(key)
    this.nodeLines.set(id, `${id}["${displayPath(this.root, file)}"]`)
    return id
  }

  fieldLabel(field: readonly string[]): string {
    return field.join(".")
  }

  edge(from: string, to: string, label: string, sensitive = false): void {
    if (sensitive) this.sensitiveEdgeIndexes.push(this.edgeLines.length)
    this.edgeLines.push(`${from} -.->|"${label}"| ${to}`)
  }

  provenEdge(from: string, to: string, label: string): void {
    this.edgeLines.push(`${from} -->|"${label}"| ${to}`)
  }

  render(title: string): string {
    const lines = ["flowchart TB"]
    if (this.boundaryNodeIds.length > 0) {
      lines.push(`  subgraph boundary["Trust Boundary (proven, in-repo)"]`)
      for (const id of this.boundaryNodeIds) lines.push(`    ${this.nodeLines.get(id)}`)
      lines.push("  end")
    }
    for (const [id, line] of this.nodeLines) {
      if (this.boundaryNodeIds.includes(id)) continue
      lines.push(`  ${line}`)
    }
    for (const line of this.edgeLines) lines.push(`  ${line}`)
    for (const index of this.sensitiveEdgeIndexes) {
      lines.push(`  linkStyle ${index} stroke:#e63946,stroke-width:3px`)
    }
    return [`%% ${title}`, lines.join("\n")].join("\n")
  }
}

/** Matches `flow-graph.ts`'s own `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` condition exactly -- the diagram must never highlight an edge as a boundary crossing that the findings don't also flag, or vice versa. */
function isSensitiveCrossing(flow: FieldFlow, endpoint: DataFlowEndpoint): boolean {
  return flow.sensitivity !== undefined && isBoundaryCrossingKind(endpoint.kind)
}

/** `"declared: <field>"`, plus the endpoint's own declared `handling` state when present (e.g. `"declared: email (encrypted)"`) -- never implying handling is verified, only stating what's declared, same as everything else this diagram draws from `documentData()`. */
function declaredLabel(fieldLabel: string, endpoint: DataFlowEndpoint): string {
  return endpoint.handling !== undefined
    ? `declared: ${fieldLabel} (${endpoint.handling})`
    : `declared: ${fieldLabel}`
}

/** `"proven: <file>:<line>:<column>"` when the consuming edge's exact position is known, falling back to the bare field label otherwise (an edge whose position wasn't statically resolvable). */
function provenLabel(
  fieldLabel: string,
  consumer: FieldFlow["provenConsumers"][number],
  root: string,
): string {
  return consumer.position !== undefined
    ? `proven: ${displayPath(root, consumer.from)}:${String(consumer.position.line)}:${String(consumer.position.column)}`
    : `proven: ${fieldLabel}`
}

function addOriginChain(
  builder: DiagramBuilder,
  capability: { readonly file: string; readonly exportName: string },
  fieldId: string,
  fieldLabel: string,
  flow: FieldFlow,
  origin: FieldFlowEndpoint,
): void {
  const endpointId = builder.endpointNode(origin.endpoint)
  const opId = builder.operationNode(capability, origin.operation)
  builder.edge(
    endpointId,
    opId,
    declaredLabel(fieldLabel, origin.endpoint),
    isSensitiveCrossing(flow, origin.endpoint),
  )
  builder.edge(opId, fieldId, "writes")
}

function addDestinationChain(
  builder: DiagramBuilder,
  capability: { readonly file: string; readonly exportName: string },
  fieldId: string,
  fieldLabel: string,
  flow: FieldFlow,
  destination: FieldFlowEndpoint,
): void {
  const endpointId = builder.endpointNode(destination.endpoint)
  const opId = builder.operationNode(capability, destination.operation)
  builder.edge(fieldId, opId, "declared")
  builder.edge(
    opId,
    endpointId,
    declaredLabel(fieldLabel, destination.endpoint),
    isSensitiveCrossing(flow, destination.endpoint),
  )
}

function addFieldFlow(
  builder: DiagramBuilder,
  capability: { readonly file: string; readonly exportName: string },
  flow: FieldFlow,
  root: string,
): void {
  if (
    flow.declaredOrigins.length === 0 &&
    flow.declaredDestinations.length === 0 &&
    flow.provenConsumers.length === 0
  ) {
    return // nothing to draw for this field -- no dangling, unconnected field node
  }
  const fieldId = builder.fieldNode(capability, flow.field)
  const fieldLabel = builder.fieldLabel(flow.field)
  for (const origin of flow.declaredOrigins) {
    addOriginChain(builder, capability, fieldId, fieldLabel, flow, origin)
  }
  for (const destination of flow.declaredDestinations) {
    addDestinationChain(builder, capability, fieldId, fieldLabel, flow, destination)
  }
  for (const consumer of flow.provenConsumers) {
    const consumerId = builder.consumerNode(consumer.from)
    builder.provenEdge(fieldId, consumerId, provenLabel(fieldLabel, consumer, root))
  }
}

/** Renders the whole-system overview diagram: every active capability, its declared endpoints, and its proven consumers. `root` is the discovery root every rendered path (consumer node labels, proven-edge labels) displays relative to. */
export function renderOverviewDiagram(
  capabilities: readonly CapabilityNode[],
  flows: readonly FieldFlow[],
  root: string,
): string {
  const builder = new DiagramBuilder(root)
  const flowsByCapability = new Map<string, FieldFlow[]>()
  for (const flow of flows) {
    const key = `${flow.capability.file}#${flow.capability.exportName}`
    const list = flowsByCapability.get(key) ?? []
    list.push(flow)
    flowsByCapability.set(key, list)
  }

  for (const capability of capabilities) {
    if (!capability.active) continue
    builder.processNode(capability)
    const ownFlows = flowsByCapability.get(`${capability.file}#${capability.exportName}`) ?? []
    for (const flow of ownFlows) addFieldFlow(builder, capability, flow, root)
  }

  return builder.render("System overview -- declared endpoints and proven consumers per capability")
}

/** Renders a diagram scoped to one capability's own fields. `root` is the discovery root every rendered path displays relative to. */
export function renderCapabilityDiagram(
  capability: CapabilityNode,
  flows: readonly FieldFlow[],
  root: string,
): string {
  const builder = new DiagramBuilder(root)
  builder.processNode(capability)
  const ownFlows = flows.filter(
    (flow) =>
      flow.capability.file === capability.file &&
      flow.capability.exportName === capability.exportName,
  )
  for (const flow of ownFlows) addFieldFlow(builder, capability, flow, root)
  return builder.render(`Capability: ${capability.exportName}`)
}

/** Renders a diagram scoped to every field at a given sensitivity level, across every capability. `root` is the discovery root every rendered path displays relative to. */
export function renderSensitivityDiagram(
  level: string,
  capabilities: readonly CapabilityNode[],
  flows: readonly FieldFlow[],
  root: string,
): string {
  const builder = new DiagramBuilder(root)
  const capabilityByKey = new Map(
    capabilities.map((c) => [`${c.file}#${c.exportName}`, c] as const),
  )
  for (const flow of flows) {
    if (flow.sensitivity !== level) continue
    const capability = capabilityByKey.get(`${flow.capability.file}#${flow.capability.exportName}`)
    if (capability === undefined) continue
    builder.processNode(capability)
    addFieldFlow(builder, capability, flow, root)
  }
  return builder.render(`Sensitivity level: ${level}`)
}
