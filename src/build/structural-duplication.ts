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

/** The fields of `a` that share both name and structural shape with some field of `b`. */
function findDuplicatesBetween(a: CapabilityNode, b: CapabilityNode): readonly FieldNode[] {
  const matches: FieldNode[] = []
  for (const fieldA of a.fields) {
    for (const fieldB of b.fields) {
      if (fieldA.path[0] !== fieldB.path[0]) continue
      if (shapeSignature(fieldA.shape) !== shapeSignature(fieldB.shape)) continue
      matches.push(fieldA)
      break
    }
  }
  return matches
}

/**
 * Every unordered pair of *active* capabilities that are not in the same
 * `exclusiveGroup` -- the pairwise scan both structural rules in this module
 * share (see the module doc comment).
 */
function* activeCapabilityPairs(
  inventory: CapabilityInventory,
): Generator<readonly [CapabilityNode, CapabilityNode]> {
  const active = inventory.capabilities.filter((capability) => capability.active)
  for (const [i, a] of active.entries()) {
    for (const b of active.slice(i + 1)) {
      // A shared exclusive group is exclusive-group.ts's concern, not these rules'.
      if (a.exclusiveGroup !== undefined && a.exclusiveGroup === b.exclusiveGroup) continue
      yield [a, b]
    }
  }
}

/** Flags active capabilities outside a shared `exclusiveGroup` that declare a field with the same path and structural shape -- `info`, never blocking. */
export function checkStructuralDuplication(
  inventory: CapabilityInventory,
): readonly ReportFinding[] {
  const findings: ReportFinding[] = []
  for (const [a, b] of activeCapabilityPairs(inventory)) {
    for (const field of findDuplicatesBetween(a, b)) {
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
  return findings
}

/** One capability's operation, paired with one of its own declared endpoints that has a `url`. */
interface OperationEndpointRef {
  readonly operation: { readonly kind: OperationNode["kind"]; readonly name: string }
  readonly endpoint: DataFlowEndpoint
}

function endpointsWithUrl(capability: CapabilityNode): readonly OperationEndpointRef[] {
  const operations = [...capability.getters, ...capability.mutators, ...capability.subscriptions]
  return operations.flatMap((op) =>
    op.endpoints
      .filter((endpoint) => endpoint.url !== undefined)
      .map((endpoint) => ({ operation: { kind: op.kind, name: op.name }, endpoint })),
  )
}

/** Every pair of (one of `a`'s endpoints, one of `b`'s endpoints) that declare the identical `url`. */
function findDuplicateEndpointsBetween(
  a: CapabilityNode,
  b: CapabilityNode,
): readonly { readonly a: OperationEndpointRef; readonly b: OperationEndpointRef }[] {
  const endpointsA = endpointsWithUrl(a)
  const endpointsB = endpointsWithUrl(b)
  const matches: { readonly a: OperationEndpointRef; readonly b: OperationEndpointRef }[] = []
  for (const refA of endpointsA) {
    for (const refB of endpointsB) {
      if (refA.endpoint.url === refB.endpoint.url) matches.push({ a: refA, b: refB })
    }
  }
  return matches
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
  for (const [a, b] of activeCapabilityPairs(inventory)) {
    for (const { a: refA, b: refB } of findDuplicateEndpointsBetween(a, b)) {
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
  return findings
}
