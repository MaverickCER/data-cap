/**
 * Least-data analysis (ADR 0070): a pure projection over the Capability and
 * Flow Models that finds data a field holds or fetches but nothing in the
 * analyzed code uses, and data sent to a client wholesale.
 *
 * A path of a field's declared shape counts as *used* only by evidence
 * specific to it: an edge reading, passing, returning or sending that path,
 * or the whole value reaching a boundary (which sends every key). Handing
 * the whole value to another function is deliberately not a use of every
 * key -- whether any key is used is decided by what that function does with
 * it, and a function that drops a key is exactly what this analysis exists to
 * notice.
 *
 * It never concludes anything from an incomplete picture: a key whose
 * downstream flow touches an `unknown` fact that concerns it (an unresolved
 * call that received it, a computed key applied to it) is reported
 * `indeterminate`, not as unused (ADR 0071). Each key is judged on its own: an
 * opaque call that only ever received `email` blocks the verdict on `email`,
 * not on `passwordHash`.
 */

import type { ReportFinding } from "../build/findings.js"
import { flowNodeId } from "./flow-model.js"
import type { FlowEdge, FlowModel } from "./flow-model.js"
import { flowIndex, traceFlow } from "./flow-projections.js"
import type { CapabilityInventory } from "../build/inventory.js"

/** Identifies a capability in a report. */
export interface LeastDataCapability {
  readonly file: string
  readonly exportName: string
}

/** A top-level shape key of a field that nothing uses. */
export interface UnusedPath {
  readonly capability: LeastDataCapability
  /** The field's top-level key. */
  readonly field: string
  /** Id of the field's node in the Flow Model. */
  readonly fieldNode: string
  /** Always a single-key path: the unused key. */
  readonly path: readonly string[]
  /** The field's resolved sensitivity, when declared. */
  readonly sensitivity: string | undefined
  /** Names of the declared input endpoints of the operations that write this field -- where a tighter projection could be applied. */
  readonly fetchedFrom: readonly string[]
}

/** A whole multi-key field sent to a client response. */
export interface WholeFieldToClient {
  readonly capability: LeastDataCapability
  readonly field: string
  readonly fieldNode: string
  /** Id of the boundary node. */
  readonly boundary: string
  readonly boundaryName: string
  /** Every top-level key of the field's declared shape, all of which go to the client. */
  readonly keys: readonly string[]
  /** Ids of the edges that send the whole value. */
  readonly edges: readonly string[]
}

/** A field (or some of its paths) this analysis could not assess, and why. */
export interface LeastDataIndeterminate {
  readonly capability: LeastDataCapability
  readonly field: string
  readonly fieldNode: string
  readonly reason: "flow-incomplete" | "not-analyzed"
  /** The single-key paths that could not be assessed; every other key of the field was. */
  readonly paths: readonly (readonly string[])[]
}

/** The result of `analyzeLeastData`. */
export interface LeastDataReport {
  readonly unusedPaths: readonly UnusedPath[]
  readonly wholeFieldToClient: readonly WholeFieldToClient[]
  readonly indeterminate: readonly LeastDataIndeterminate[]
}

/** What `analyzeLeastData` reads -- the same fields of the Evidence Model a projection over it would. */
export interface LeastDataInput {
  readonly capability: CapabilityInventory
  readonly flow: FlowModel
}

/** Whether an edge of this kind is evidence that the data it carries is used. */
function isUseKind(kind: FlowEdge["kind"]): boolean {
  const useKinds: readonly FlowEdge["kind"][] = [
    "reads",
    "passes",
    "returns",
    "transforms",
    "side-effect",
    "crosses-boundary",
  ]
  return useKinds.includes(kind)
}

function objectKeys(shape: unknown): readonly string[] {
  return typeof shape === "object" && shape !== null && !Array.isArray(shape)
    ? Object.keys(shape)
    : []
}

/** Finds unused paths and whole-field client exposure. */
export function analyzeLeastData(input: LeastDataInput): LeastDataReport {
  const { flow } = input
  const { nodesById, byOrigin } = flowIndex(flow)
  const unusedPaths: UnusedPath[] = []
  const wholeFieldToClient: WholeFieldToClient[] = []
  const indeterminate: LeastDataIndeterminate[] = []

  for (const capability of input.capability.capabilities) {
    if (!capability.active) continue
    const identity = { file: capability.file, exportName: capability.exportName }
    for (const field of capability.fields) {
      const keys = objectKeys(field.shape)
      if (keys.length === 0) continue
      const fieldName = field.path[0]
      if (fieldName === undefined) continue
      const fieldNode = flowNodeId(
        "field",
        capability.file,
        `${capability.exportName}.${field.path.join(".")}`,
      )

      if (!nodesById.has(fieldNode)) {
        indeterminate.push({
          capability: identity,
          field: fieldName,
          fieldNode,
          reason: "not-analyzed",
          paths: keys.map((key) => [key]),
        })
        continue
      }

      const edges = byOrigin.get(fieldNode)

      if (keys.length >= 2 && edges !== undefined) {
        const bySink = new Map<string, FlowEdge[]>()
        for (const edge of edges) {
          const target = nodesById.get(edge.to)
          const wholeValue = edge.path === undefined || edge.path.length === 0
          if (
            edge.kind === "side-effect" &&
            target?.kind === "boundary" &&
            target.boundaryKind === "client-response" &&
            wholeValue
          ) {
            bySink.set(edge.to, [...(bySink.get(edge.to) ?? []), edge])
          }
        }
        for (const [boundary, sending] of bySink) {
          wholeFieldToClient.push({
            capability: identity,
            field: fieldName,
            fieldNode,
            boundary,
            boundaryName: (nodesById.get(boundary) as { readonly name: string }).name,
            keys,
            edges: sending.map((edge) => edge.id).sort(),
          })
        }
      }

      // An unknown that does not say which data it concerns could concern any key of this field, so it blocks them all.
      const undescribed = traceFlow(flow, fieldNode, "downstream").unknowns.some(
        (unknown) => unknown.data === undefined,
      )
      const blocked = undescribed
        ? keys
        : keys.filter((key) => !traceFlow(flow, fieldNode, "downstream", { path: [key] }).complete)
      if (blocked.length > 0) {
        indeterminate.push({
          capability: identity,
          field: fieldName,
          fieldNode,
          reason: "flow-incomplete",
          paths: blocked.map((key) => [key]),
        })
      }

      const fetchedFrom = [
        ...new Set(
          [...capability.getters, ...capability.mutators, ...capability.subscriptions]
            .filter((operation) => operation.writes.some((written) => written[0] === fieldName))
            .flatMap((operation) =>
              operation.endpoints
                .filter((endpoint) => endpoint.direction === "input")
                .map((endpoint) => endpoint.name),
            ),
        ),
      ].sort()

      for (const key of keys.filter((candidate) => !blocked.includes(candidate))) {
        const used = edges?.some((edge) => {
          if (!isUseKind(edge.kind)) return false
          const from = nodesById.get(edge.from)
          const to = nodesById.get(edge.to)
          if (from?.kind === "boundary") return false
          if (edge.path?.[0] === key) return true
          const wholeValue = edge.path === undefined || edge.path.length === 0
          return (
            wholeValue &&
            to?.kind === "boundary" &&
            (edge.kind === "side-effect" || edge.kind === "crosses-boundary")
          )
        })
        if (!used) {
          unusedPaths.push({
            capability: identity,
            field: fieldName,
            fieldNode,
            path: [key],
            sensitivity: field.sensitivity.value,
            fetchedFrom,
          })
        }
      }
    }
  }

  return { unusedPaths, wholeFieldToClient, indeterminate }
}

/** Turns a `LeastDataReport` into report findings (family `flow`). */
export function leastDataFindings(report: LeastDataReport): ReportFinding[] {
  const findings: ReportFinding[] = []
  for (const unused of report.unusedPaths) {
    const sensitive = unused.sensitivity !== undefined
    const source =
      unused.fetchedFrom.length === 0
        ? ""
        : ` It is declared as fetched from ${unused.fetchedFrom.map((name) => `"${name}"`).join(", ")}; consider projecting it out of that source.`
    findings.push({
      code: sensitive ? "LEAST_DATA_UNUSED_SENSITIVE_PATH" : "LEAST_DATA_UNUSED_PATH",
      family: "flow",
      severity: sensitive ? "warning" : "info",
      message: `Path "${unused.path.join(".")}" of field "${unused.field}" on "${unused.capability.exportName}"${sensitive ? ` (sensitivity "${unused.sensitivity}")` : ""} is never read, forwarded or sent anywhere in the analyzed code.${source}`,
      capability: unused.capability,
      field: [unused.field, ...unused.path],
      evidence: [{ model: "flow", id: unused.fieldNode }],
    })
  }
  for (const whole of report.wholeFieldToClient) {
    findings.push({
      code: "LEAST_DATA_WHOLE_FIELD_TO_CLIENT",
      family: "flow",
      severity: "warning",
      message: `Field "${whole.field}" on "${whole.capability.exportName}" is sent whole to the client response "${whole.boundaryName}" (keys: ${whole.keys.join(", ")}) -- send only the keys the client needs.`,
      capability: whole.capability,
      field: [whole.field],
      evidence: [
        { model: "flow", id: whole.fieldNode },
        ...whole.edges.map((id) => ({ model: "flow" as const, id })),
      ],
    })
  }
  for (const skipped of report.indeterminate) {
    const which = skipped.paths.map((path) => path.join(".")).join(", ")
    findings.push({
      code: "LEAST_DATA_ANALYSIS_INDETERMINATE",
      family: "flow",
      severity: "info",
      message:
        skipped.reason === "flow-incomplete"
          ? `Field "${skipped.field}" on "${skipped.capability.exportName}" could not be assessed for unused data at ${which}: that data reaches code the analysis could not follow.`
          : `Field "${skipped.field}" on "${skipped.capability.exportName}" could not be assessed for unused data: it was not part of the flow analysis.`,
      capability: skipped.capability,
      field: [skipped.field],
      evidence: [{ model: "flow", id: skipped.fieldNode }],
    })
  }
  return findings
}
