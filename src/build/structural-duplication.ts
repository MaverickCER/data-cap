/**
 * Two cross-capability duplication nudges, both `info`-severity, never
 * blocking -- flagging something worth a human look, not a defect:
 *
 * - `checkStructuralDuplication`: two *active* capabilities, outside any
 *   shared `exclusiveGroup`, declaring a top-level field with the same name
 *   and the same structural shape. Replaces env-cap's `compatibility.ts`
 *   (which treats "two contracts define the same variable name" as
 *   inherently suspect, because `process.env` is one flat namespace -- a
 *   real collision there). data-cap capabilities are independent state
 *   trees: two unrelated capabilities both having a `user.email` field is
 *   normal, not a collision -- see ADR 0049.
 * - `checkDuplicateEndpoints`: two *active* capabilities, outside any
 *   shared `exclusiveGroup`, declaring an operation endpoint with the same
 *   `url` -- a likely-duplicate network fetch that a reader might otherwise
 *   miss, since each capability's own file only shows its own declaration,
 *   never the other one making the same call.
 *
 * Both share the same "iterate every active-capability pair once, skip a
 * shared exclusive group" scan, so they live together rather than each
 * re-deriving it.
 */

import type { CapabilityInventory, CapabilityNode, FieldNode, OperationNode } from "./inventory.js"
import type { DataFlowEndpoint } from "../core/document.js"
import type { ReportFinding } from "./findings.js"

/** A structural (type/key-shape) signature of a literal-evaluated field default -- ignores the actual literal value, so `""` and `"a"` are the same shape but `""` and `0` are not. Deliberately coarse: this feeds an `info`-only nudge, not a correctness check. Exported for direct testing (a signature scheme is only meaningful for what exact strings it produces). */
export function shapeSignature(value: unknown, depth = 0): string {
  // A literal-evaluated default is shallow in practice; this bound only stops a
  // pathological (or self-referential) structure from recursing without end.
  if (depth >= 20) return "…"
  if (value === null) return "null"
  if (Array.isArray(value)) {
    return value.length > 0 ? `array<${shapeSignature(value[0], depth + 1)}>` : "array"
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((key) => `${key}:${shapeSignature(record[key], depth + 1)}`).join(",")}}`
  }
  return typeof value
}

/**
 * The most pair findings either rule lists. Every pair of similar capabilities is a finding, so N alike capabilities
 * are N(N-1)/2 of them -- millions at a few thousand -- and a report that size cannot even be serialized. Past this
 * many, the rest are counted in one closing finding instead of listed.
 */
export const MAX_LISTED_PAIR_FINDINGS = 1000

/** One closing finding standing in for the pair findings that were counted but not listed. */
function omittedFinding(code: ReportFinding["code"], what: string, omitted: number): ReportFinding {
  return {
    code,
    family: "structural",
    severity: "info",
    message: `${String(omitted)} more ${what} pair(s) are not listed: only the first ${String(MAX_LISTED_PAIR_FINDINGS)} are, because every pair of alike capabilities is a finding and the number grows with the square of how many there are.`,
  }
}

/** A field of one capability, with the name-and-shape key two capabilities share when they declare it alike. */
interface KeyedField {
  readonly field: FieldNode
  readonly key: string
}

/** Each capability's top-level fields keyed by name and structural shape, worked out once rather than once per pair. */
function keyedFields(capability: CapabilityNode): readonly KeyedField[] {
  return capability.fields.map((field) => ({
    field,
    key: JSON.stringify([field.path[0], shapeSignature(field.shape)]),
  }))
}

/**
 * Every unordered pair of *active* capabilities that are not in the same
 * `exclusiveGroup` -- the pairwise scan both structural rules in this module
 * share (see the module doc comment). What a rule needs to know about a
 * capability is worked out once for it by `derive`, not once per pair.
 */
function* activeCapabilityPairs<T>(
  inventory: CapabilityInventory,
  derive: (capability: CapabilityNode) => T,
): Generator<readonly [readonly [CapabilityNode, T], readonly [CapabilityNode, T]]> {
  const active = inventory.capabilities
    .filter((capability) => capability.active)
    .map((capability) => [capability, derive(capability)] as const)
  for (const [i, a] of active.entries()) {
    for (const b of active.slice(i + 1)) {
      // A shared exclusive group is exclusive-group.ts's concern, not these rules'.
      if (a[0].exclusiveGroup !== undefined && a[0].exclusiveGroup === b[0].exclusiveGroup) continue
      yield [a, b]
    }
  }
}

/** Flags active capabilities outside a shared `exclusiveGroup` that declare a field with the same path and structural shape -- `info`, never blocking. */
export function checkStructuralDuplication(
  inventory: CapabilityInventory,
): readonly ReportFinding[] {
  const findings: ReportFinding[] = []
  let omitted = 0
  const derive = (capability: CapabilityNode) => {
    const keyed = keyedFields(capability)
    return { keyed, keys: new Set(keyed.map(({ key }) => key)) }
  }
  for (const [[a, ofA], [b, ofB]] of activeCapabilityPairs(inventory, derive)) {
    for (const { field, key } of ofA.keyed) {
      if (!ofB.keys.has(key)) continue
      if (findings.length >= MAX_LISTED_PAIR_FINDINGS) {
        omitted += 1
        continue
      }
      findings.push({
        code: "DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES",
        family: "structural",
        severity: "info",
        message: `"${field.path[0]}" is declared with the same shape in both "${a.exportName}" and "${b.exportName}" -- independent capabilities can legitimately duplicate a field; worth a look if that wasn't intentional.`,
        capability: { file: a.file, exportName: a.exportName },
        field: field.path,
      })
    }
  }
  return omitted === 0
    ? findings
    : [...findings, omittedFinding("DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES", "field", omitted)]
}

/** One capability's operation, paired with one of its own declared endpoints that has a `url`. */
interface OperationEndpointRef {
  readonly operation: { readonly kind: OperationNode["kind"]; readonly name: string }
  readonly endpoint: DataFlowEndpoint
  readonly url: string
}

function endpointsWithUrl(capability: CapabilityNode): readonly OperationEndpointRef[] {
  const operations = [...capability.getters, ...capability.mutators, ...capability.subscriptions]
  return operations.flatMap((op) =>
    op.endpoints.flatMap((endpoint) =>
      endpoint.url === undefined
        ? []
        : [{ operation: { kind: op.kind, name: op.name }, endpoint, url: endpoint.url }],
    ),
  )
}

/** Endpoints grouped by their url, in declaration order within each. */
type UrlIndex = ReadonlyMap<string, readonly OperationEndpointRef[]>
function groupedByUrl(refs: readonly OperationEndpointRef[]): UrlIndex {
  const byUrl = new Map<string, OperationEndpointRef[]>()
  for (const ref of refs) {
    byUrl.set(ref.url, [...(byUrl.get(ref.url) ?? []), ref])
  }
  return byUrl
}

/**
 * Flags active capabilities outside a shared `exclusiveGroup` that declare
 * an operation endpoint with the same `url` -- `info`, never blocking.
 * Presence-only in the same sense as the rest of this vocabulary: this
 * never proves two capabilities actually fetch the same data at runtime
 * (that would require tracing `execute`/`subscribe` bodies, which this
 * package never does -- ADR 0002), only that both DECLARE the same URL,
 * which is itself a strong, actionable enough signal to surface.
 */
export function checkDuplicateEndpoints(inventory: CapabilityInventory): readonly ReportFinding[] {
  const findings: ReportFinding[] = []
  let omitted = 0
  const derive = (capability: CapabilityNode) => {
    const refs = endpointsWithUrl(capability)
    return { refs, byUrl: groupedByUrl(refs) }
  }
  for (const [[a, ofA], [b, ofB]] of activeCapabilityPairs(inventory, derive)) {
    for (const refA of ofA.refs) {
      for (const refB of ofB.byUrl.get(refA.url) ?? []) {
        if (findings.length >= MAX_LISTED_PAIR_FINDINGS) {
          omitted += 1
          continue
        }
        findings.push({
          code: "DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES",
          family: "structural",
          severity: "info",
          message: `Endpoint "${refA.endpoint.url}" is declared by both "${a.exportName}"'s ${refA.operation.kind} "${refA.operation.name}" and "${b.exportName}"'s ${refB.operation.kind} "${refB.operation.name}" -- possibly a duplicate network fetch across independently-declared capabilities; worth a look if that wasn't intentional.`,
          capability: { file: a.file, exportName: a.exportName },
          operation: refA.operation.name,
        })
      }
    }
  }
  return omitted === 0
    ? findings
    : [...findings, omittedFinding("DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES", "endpoint", omitted)]
}
