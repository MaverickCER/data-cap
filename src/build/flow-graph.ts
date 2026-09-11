/**
 * Pure data assembly for the Data Flow & Lineage report (C10) -- combines
 * declared endpoints (author-asserted, from `documentData()`'s `endpoints`)
 * with proven `reads-field` edges (from C6's usage scan) into one
 * per-field flow record, and derives the one finding this combination
 * makes possible: a sensitive field with a declared endpoint crossing an
 * external/api/queue boundary. No filesystem access.
 *
 * Every field on `FieldFlow` is clearly either declared or proven -- never
 * blended, per AGENTS.md's declared-vs-proven invariant. This module
 * cannot trace *through* a third-party system (once data reaches an
 * `external-service`/`api` endpoint, what that system does next is
 * unknowable to a static scan of one repository), and does not assign a
 * regulatory classification (jurisdiction-specific; see ADR 0049's
 * `metadata` convention).
 */

import type { DataFlowEndpoint } from "../core/document.js"
import type { CapabilityInventory, CapabilityNode, FieldNode, OperationNode } from "./inventory.js"
import type { DependencyEdge } from "./dependency-types.js"
import type { ReportFinding } from "./findings.js"

/** Exported so `flow-diagram.ts` highlights exactly the edges that produce `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` -- one source of truth for which endpoint kinds count as a boundary crossing. */
export function isBoundaryCrossingKind(kind: DataFlowEndpoint["kind"]): boolean {
  return kind === "external-service" || kind === "api" || kind === "queue"
}

/** Which operation declared one `FieldFlowEndpoint` -- kept alongside the endpoint itself (rather than flattened away) so a consumer like `flow-diagram.ts` can draw a real endpoint -> operation -> field chain, not just endpoint -> field. */
export interface FieldFlowEndpoint {
  /** The getter/mutator/subscription that declares this endpoint. */
  readonly operation: {
    readonly kind: "getter" | "mutator" | "subscription"
    readonly name: string
  }
  /** The declared endpoint itself. */
  readonly endpoint: DataFlowEndpoint
}

/** One field's declared origins/destinations and proven in-repo consumers -- the data-flow-diagram/security-review model's atomic unit. */
export interface FieldFlow {
  /** Which capability owns this field. */
  readonly capability: {
    /** Absolute path of the file declaring the capability. */
    readonly file: string
    /** The binding name the capability is exported as. */
    readonly exportName: string
  }
  /** The field's path within its capability. */
  readonly field: readonly string[]
  /** Resolved: the field's own declared sensitivity, else the capability's -- mirrors `owner`'s inheritance (ADR 0049). */
  readonly sensitivity: string | undefined
  /** `direction: "input"` endpoints declared on the operation(s) that write this field, each tagged with its declaring operation. */
  readonly declaredOrigins: readonly FieldFlowEndpoint[]
  /** `reads-field` edges statically proven to target this field. */
  readonly provenConsumers: readonly DependencyEdge[]
  /** `direction: "output"` endpoints declared on the operation(s) that write this field, each tagged with its declaring operation. */
  readonly declaredDestinations: readonly FieldFlowEndpoint[]
}

/** Every field's flow, plus any `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` findings derived from it. */
export interface FlowGraph {
  /** Every field's declared origins/destinations and proven consumers. */
  readonly fields: readonly FieldFlow[]
  /** `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` findings derived from `fields`. */
  readonly findings: readonly ReportFinding[]
}

/** Every getter/mutator/subscription on `capability` whose statically-extracted `writes` shape claims `fieldName` at the top level. `fieldName` is `undefined` for the (defensive) empty-path field, which no `writes` entry can match. Exported so `flow-diagram.ts` can draw the same per-operation grouping this module uses, instead of recomputing an equivalent filter of its own. */
function writersOf(
  capability: CapabilityNode,
  fieldName: string | undefined,
): readonly OperationNode[] {
  return [...capability.getters, ...capability.mutators, ...capability.subscriptions].filter((op) =>
    op.writes.some((path) => path.length === 1 && path[0] === fieldName),
  )
}

function buildFieldFlow(
  capability: CapabilityNode,
  field: FieldNode,
  capabilityEdges: readonly DependencyEdge[] | undefined,
): FieldFlow {
  const fieldName = field.path[0]
  const writers = writersOf(capability, fieldName)
  const declared: FieldFlowEndpoint[] = writers.flatMap((op) =>
    op.endpoints.map((endpoint) => ({ operation: { kind: op.kind, name: op.name }, endpoint })),
  )

  return {
    capability: { file: capability.file, exportName: capability.exportName },
    field: field.path,
    sensitivity: field.sensitivity.value,
    declaredOrigins: declared.filter((d) => d.endpoint.direction === "input"),
    provenConsumers:
      capabilityEdges === undefined
        ? []
        : capabilityEdges.filter(
            (edge) => edge.relationship === "reads-field" && edge.to.field?.[0] === fieldName,
          ),
    declaredDestinations: declared.filter((d) => d.endpoint.direction === "output"),
  }
}

function boundaryCrossingFinding(flow: FieldFlow): ReportFinding | undefined {
  if (flow.sensitivity === undefined) return undefined
  const allEndpoints = [...flow.declaredOrigins, ...flow.declaredDestinations].map(
    (d) => d.endpoint,
  )
  const crosses = allEndpoints.some((endpoint) => isBoundaryCrossingKind(endpoint.kind))
  if (!crosses) return undefined
  return {
    code: "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY",
    family: "flow",
    severity: "warning",
    message: `Field "${flow.field.join(".")}" on "${flow.capability.exportName}" is sensitivity "${flow.sensitivity}" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.`,
    capability: flow.capability,
    field: flow.field,
  }
}

/**
 * Presence-only, same discipline as every other governance finding: flags a
 * sensitive field with a declared boundary-crossing endpoint that doesn't
 * also declare `handling` (plaintext/masked/redacted/hashed/encrypted) --
 * never a claim that the field is actually mishandled, only that the
 * declaration proving otherwise is missing where it would matter most.
 */
function missingHandlingFinding(flow: FieldFlow): ReportFinding | undefined {
  if (flow.sensitivity === undefined) return undefined
  const crossingEndpoints = [...flow.declaredOrigins, ...flow.declaredDestinations]
    .map((d) => d.endpoint)
    .filter((endpoint) => isBoundaryCrossingKind(endpoint.kind))
  const undeclared = crossingEndpoints.filter((endpoint) => endpoint.handling === undefined)
  if (undeclared.length === 0) return undefined
  return {
    code: "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING",
    family: "flow",
    severity: "warning",
    message: `Field "${flow.field.join(".")}" on "${flow.capability.exportName}" is sensitivity "${flow.sensitivity}" and has ${String(undeclared.length)} declared boundary-crossing endpoint(s) with no declared "handling" -- state how this field's data is protected at each crossing (plaintext/masked/redacted/hashed/encrypted).`,
    capability: flow.capability,
    field: flow.field,
  }
}

/** Builds the per-field flow graph and the trust-boundary findings it makes derivable. */
export function buildFlowGraph(
  inventory: CapabilityInventory,
  edges: readonly DependencyEdge[],
): FlowGraph {
  const fields: FieldFlow[] = []
  const findings: ReportFinding[] = []

  // "Which edges target this capability" is indexed once (ADR 0056), so
  // buildFieldFlow filters one capability's own edges per field rather than the
  // full project-wide array. Only capabilities that something actually consumes
  // become keys -- an unconsumed one is a `.get` miss, handled in buildFieldFlow.
  const edgesByCapability = new Map<string, DependencyEdge[]>()
  for (const edge of edges) {
    const key = `${edge.to.capability.file}#${edge.to.capability.exportName}`
    const existing = edgesByCapability.get(key)
    if (existing === undefined) {
      edgesByCapability.set(key, [edge])
    } else {
      existing.push(edge)
    }
  }

  for (const capability of inventory.capabilities) {
    const capabilityEdges = edgesByCapability.get(`${capability.file}#${capability.exportName}`)
    for (const field of capability.fields) {
      const flow = buildFieldFlow(capability, field, capabilityEdges)
      fields.push(flow)
      const finding = boundaryCrossingFinding(flow)
      if (finding !== undefined) findings.push(finding)
      const handlingFinding = missingHandlingFinding(flow)
      if (handlingFinding !== undefined) findings.push(handlingFinding)
    }
  }

  return { fields, findings }
}
