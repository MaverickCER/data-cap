import { describe, expect, it } from "vitest"
import { buildOpenApiSchemaArtifact } from "../../src/build/openapi-schema.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"

function field(overrides: Partial<FieldNode> = {}): FieldNode {
  return {
    path: ["email"],
    docs: undefined,
    owner: { value: undefined, declaredOn: undefined },
    sensitivity: { value: undefined, declaredOn: undefined },
    purpose: { value: undefined, declaredOn: undefined },
    legalBasis: { value: undefined, declaredOn: undefined },
    dataResidency: { value: undefined, declaredOn: undefined },
    auditRequired: { value: undefined, declaredOn: undefined },
    declarationPosition: undefined,
    writtenBy: [],
    shape: "",
    ...overrides,
  }
}

function operation(overrides: Partial<OperationNode> = {}): OperationNode {
  return {
    kind: "getter",
    name: "getUser",
    docs: undefined,
    writes: [],
    hasProcessor: false,
    hasOptimistic: false,
    endpoints: [],
    ...overrides,
  }
}

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    kind: "buildData",
    docs: undefined,
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields: [],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

function inventory(capabilities: readonly CapabilityNode[]): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
}

describe("buildOpenApiSchemaArtifact", () => {
  it("produces a valid OpenAPI 3.1 document shape", () => {
    const artifact = buildOpenApiSchemaArtifact(inventory([]), { title: "Test", version: "1.0.0" })
    expect(artifact.openapi).toBe("3.1.0")
    expect(artifact.info).toEqual({ title: "Test", version: "1.0.0" })
    expect(artifact.components.schemas).toEqual({})
  })

  it("infers a JSON-Schema-like shape from each field's literal default value", () => {
    const artifact = buildOpenApiSchemaArtifact(
      inventory([
        capability({
          fields: [
            {
              path: ["email"],
              docs: undefined,
              owner: { value: undefined, declaredOn: undefined },
              sensitivity: { value: undefined, declaredOn: undefined },
              purpose: { value: undefined, declaredOn: undefined },
              legalBasis: { value: undefined, declaredOn: undefined },
              dataResidency: { value: undefined, declaredOn: undefined },
              auditRequired: { value: undefined, declaredOn: undefined },
              declarationPosition: undefined,
              writtenBy: [],
              shape: "",
            },
            {
              path: ["age"],
              docs: undefined,
              owner: { value: undefined, declaredOn: undefined },
              sensitivity: { value: undefined, declaredOn: undefined },
              purpose: { value: undefined, declaredOn: undefined },
              legalBasis: { value: undefined, declaredOn: undefined },
              dataResidency: { value: undefined, declaredOn: undefined },
              auditRequired: { value: undefined, declaredOn: undefined },
              declarationPosition: undefined,
              writtenBy: [],
              shape: 0,
            },
            {
              path: ["tags"],
              docs: undefined,
              owner: { value: undefined, declaredOn: undefined },
              sensitivity: { value: undefined, declaredOn: undefined },
              purpose: { value: undefined, declaredOn: undefined },
              legalBasis: { value: undefined, declaredOn: undefined },
              dataResidency: { value: undefined, declaredOn: undefined },
              auditRequired: { value: undefined, declaredOn: undefined },
              declarationPosition: undefined,
              writtenBy: [],
              shape: ["a"],
            },
          ],
        }),
      ]),
      { title: "Test", version: "1.0.0" },
    )
    const schema = artifact.components.schemas.userCapability!
    expect(schema.type).toBe("object")
    expect((schema.properties as Record<string, unknown>).email).toEqual({ type: "string" })
    expect((schema.properties as Record<string, unknown>).age).toEqual({ type: "number" })
    expect((schema.properties as Record<string, unknown>).tags).toEqual({
      type: "array",
      items: { type: "string" },
    })
  })

  it("attaches operations as an x-data-cap-operations vendor extension, never a fabricated `paths` entry", () => {
    const artifact = buildOpenApiSchemaArtifact(
      inventory([
        capability({
          kind: "createData",
          getters: [
            {
              kind: "getter",
              name: "getUser",
              docs: undefined,
              writes: [["email"]],
              hasProcessor: true,
              hasOptimistic: false,
              endpoints: [],
            },
          ],
        }),
      ]),
      { title: "Test", version: "1.0.0" },
    )
    expect(artifact).not.toHaveProperty("paths")
    const schema = artifact.components.schemas.userCapability!
    expect(schema["x-data-cap-operations"]).toEqual([
      {
        name: "getUser",
        kind: "getter",
        writes: ["email"],
        hasProcessor: true,
        hasOptimistic: false,
        endpoints: [],
      },
    ])
  })

  it("degrades unrepresentable shapes (e.g. a Map) to a permissive empty schema rather than guessing", () => {
    const artifact = buildOpenApiSchemaArtifact(
      inventory([capability({ fields: [field({ path: ["cache"], shape: new Map() })] })]),
      { title: "Test", version: "1.0.0" },
    )
    const schema = artifact.components.schemas.userCapability!
    expect((schema.properties as Record<string, unknown>).cache).toEqual({})
  })

  it("renders the whole components.schemas map exactly, across every inferSchema branch", () => {
    // One fixture reaching: null / string / number / boolean / Date / non-empty
    // array (item recursion) / empty array / nested plain object (property
    // recursion) / a class instance (Set) -> `{}`; a field with an empty path
    // (skipped); a capability with a description and one without; getters +
    // mutators + subscriptions merged into the vendor extension with a
    // dotted multi-segment `writes` path; and two capabilities keyed by name.
    const artifact = buildOpenApiSchemaArtifact(
      inventory([
        capability({
          exportName: "profileCapability",
          docs: { description: "A person's profile." },
          fields: [
            field({ path: ["nickname"], shape: "sam" }),
            field({ path: ["age"], shape: 0 }),
            field({ path: ["verified"], shape: false }),
            field({ path: ["deletedAt"], shape: null }),
            field({ path: ["createdAt"], shape: new Date("2026-01-01T00:00:00.000Z") }),
            field({ path: ["tags"], shape: ["a"] }),
            field({ path: ["scores"], shape: [] }),
            field({ path: ["address"], shape: { city: "x", zip: 0 } }),
            field({ path: ["seen"], shape: new Set() }),
            // `undefined` must not reach `Object.getPrototypeOf` (which throws on it)
            field({ path: ["unknownShape"], shape: undefined }),
            field({ path: [], shape: "unreachable" }),
          ],
          getters: [operation({ name: "getProfile", writes: [["nickname"]] })],
          mutators: [
            operation({ kind: "mutator", name: "setAddress", writes: [["address", "city"]] }),
          ],
          subscriptions: [operation({ kind: "subscription", name: "watchProfile", writes: [] })],
        }),
        capability({ exportName: "auditCapability", docs: undefined, fields: [] }),
      ]),
      { title: "Service API", version: "2.3.0" },
    )
    expect(artifact).toMatchInlineSnapshot(`
      {
        "components": {
          "schemas": {
            "auditCapability": {
              "properties": {},
              "type": "object",
              "x-data-cap-operations": [],
            },
            "profileCapability": {
              "description": "A person's profile.",
              "properties": {
                "address": {
                  "properties": {
                    "city": {
                      "type": "string",
                    },
                    "zip": {
                      "type": "number",
                    },
                  },
                  "type": "object",
                },
                "age": {
                  "type": "number",
                },
                "createdAt": {
                  "format": "date-time",
                  "type": "string",
                },
                "deletedAt": {
                  "type": "null",
                },
                "nickname": {
                  "type": "string",
                },
                "scores": {
                  "items": {},
                  "type": "array",
                },
                "seen": {},
                "tags": {
                  "items": {
                    "type": "string",
                  },
                  "type": "array",
                },
                "unknownShape": {},
                "verified": {
                  "type": "boolean",
                },
              },
              "type": "object",
              "x-data-cap-operations": [
                {
                  "endpoints": [],
                  "hasOptimistic": false,
                  "hasProcessor": false,
                  "kind": "getter",
                  "name": "getProfile",
                  "writes": [
                    "nickname",
                  ],
                },
                {
                  "endpoints": [],
                  "hasOptimistic": false,
                  "hasProcessor": false,
                  "kind": "mutator",
                  "name": "setAddress",
                  "writes": [
                    "address.city",
                  ],
                },
                {
                  "endpoints": [],
                  "hasOptimistic": false,
                  "hasProcessor": false,
                  "kind": "subscription",
                  "name": "watchProfile",
                  "writes": [],
                },
              ],
            },
          },
        },
        "info": {
          "title": "Service API",
          "version": "2.3.0",
        },
        "openapi": "3.1.0",
      }
    `)
  })
})
