/**
 * OpenAPI-Compatible Schema Artifacts (ADR 0050) -- a reference projection
 * over Capability Model's fields/operations, rendered as OpenAPI 3.1
 * `components.schemas` (OpenAPI 3.1 schemas *are* JSON Schema, so this is
 * genuinely OpenAPI-compatible, not merely OpenAPI-flavored).
 *
 * Deliberately does not fabricate a `paths` section: `data-cap` operations
 * are not HTTP endpoints, and inventing verb/path pairs for them would
 * misrepresent a proven fact (a `writes` shape) as something it isn't (an
 * HTTP contract) -- the same declared-vs-proven discipline this whole
 * codebase already applies everywhere else. Each capability's operations
 * are instead attached as an `x-data-cap-operations` vendor extension
 * (OpenAPI's own sanctioned `x-*` mechanism for exactly this situation),
 * clearly out-of-band from the standard schema vocabulary.
 */

import type { CapabilityInventory, CapabilityNode, OperationNode } from "./inventory.js"

/** A minimal JSON-Schema-ish type descriptor -- only what can be honestly inferred from a literal default value. `{}` (no `type`) means "unrepresentable/unknown," never a guess. */
export type JsonSchemaLike = Record<string, unknown>

function inferSchema(value: unknown): JsonSchemaLike {
  if (value === null) return { type: "null" }
  if (typeof value === "string") return { type: "string" }
  if (typeof value === "number") return { type: "number" }
  if (typeof value === "boolean") return { type: "boolean" }
  if (value instanceof Date) return { type: "string", format: "date-time" }
  if (Array.isArray(value)) {
    // An empty array has no `value[0]`; `inferSchema(undefined)` then naturally
    // falls through to the permissive `{}`, so no length branch is needed.
    return { type: "array", items: inferSchema(value[0]) }
  }
  // A plain object literal only -- `typeof` alone can't distinguish one from
  // a Map/Set/RegExp/other class instance, none of which are meaningfully
  // representable as a JSON Schema primitive; those fall through to the
  // permissive `{}` below, same as undefined/a function.
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const properties: Record<string, JsonSchemaLike> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = inferSchema(entry)
    }
    return { type: "object", properties }
  }
  return {}
}

function operationExtension(operation: OperationNode): Record<string, unknown> {
  return {
    name: operation.name,
    kind: operation.kind,
    writes: operation.writes.map((path) => path.join(".")),
    hasProcessor: operation.hasProcessor,
    hasOptimistic: operation.hasOptimistic,
    endpoints: operation.endpoints,
  }
}

function capabilitySchema(capability: CapabilityNode): JsonSchemaLike {
  const properties: Record<string, JsonSchemaLike> = {}
  for (const field of capability.fields) {
    const key = field.path[0]
    if (key !== undefined) properties[key] = inferSchema(field.shape)
  }
  const operations = [...capability.getters, ...capability.mutators, ...capability.subscriptions]
  return {
    type: "object",
    properties,
    ...(capability.docs?.description !== undefined
      ? { description: capability.docs.description }
      : {}),
    "x-data-cap-operations": operations.map(operationExtension),
  }
}

/** An OpenAPI 3.1 document's `components.schemas` shape -- see this module's own doc comment for what's deliberately not included. */
export interface OpenApiSchemaArtifact {
  readonly openapi: "3.1.0"
  readonly info: { readonly title: string; readonly version: string }
  readonly components: { readonly schemas: Readonly<Record<string, JsonSchemaLike>> }
}

/** Projects every capability's field shape (plus its operations, as a vendor extension) into an OpenAPI-compatible schema document. */
export function buildOpenApiSchemaArtifact(
  inventory: CapabilityInventory,
  info: { readonly title: string; readonly version: string },
): OpenApiSchemaArtifact {
  const schemas: Record<string, JsonSchemaLike> = {}
  for (const capability of inventory.capabilities) {
    schemas[capability.exportName] = capabilitySchema(capability)
  }
  return { openapi: "3.1.0", info, components: { schemas } }
}
