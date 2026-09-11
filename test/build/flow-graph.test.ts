import { describe, expect, it } from "vitest"
import { buildFlowGraph } from "../../src/build/flow-graph.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"

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

function readEdge(overrides: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    relationship: "reads-field",
    from: "/project/consumer.ts",
    to: {
      capability: { file: "/project/user.ts", exportName: "userCapability" },
      field: ["email"],
    },
    resolution: "resolved",
    position: undefined,
    ...overrides,
  }
}

describe("buildFlowGraph -- field flow assembly", () => {
  it("produces one FieldFlow per field, across every capability", () => {
    const graph = buildFlowGraph(
      inventory([capability({ fields: [field({ path: ["email"] }), field({ path: ["name"] })] })]),
      [],
    )
    expect(graph.fields.map((f) => f.field[0])).toEqual(["email", "name"])
  })

  it("collects declared input endpoints from the getter that writes the field", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          getters: [
            operation({
              name: "getUser",
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "api", name: "identity-service" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.fields[0]!.declaredOrigins).toEqual([
      {
        operation: { kind: "getter", name: "getUser" },
        endpoint: { direction: "input", kind: "api", name: "identity-service" },
      },
    ])
    expect(graph.fields[0]!.declaredDestinations).toEqual([])
  })

  it("collects declared output endpoints from the mutator that writes the field", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [field({ path: ["email"] })],
          mutators: [
            operation({
              kind: "mutator",
              name: "updateEmail",
              writes: [["email"]],
              endpoints: [{ direction: "output", kind: "database", name: "postgres:users" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.fields[0]!.declaredDestinations).toEqual([
      {
        operation: { kind: "mutator", name: "updateEmail" },
        endpoint: { direction: "output", kind: "database", name: "postgres:users" },
      },
    ])
    expect(graph.fields[0]!.declaredOrigins).toEqual([])
  })

  it("collects proven reads-field edges targeting the field, and only that field", () => {
    const graph = buildFlowGraph(
      inventory([capability({ fields: [field({ path: ["email"] }), field({ path: ["name"] })] })]),
      [
        readEdge({
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            field: ["email"],
          },
        }),
      ],
    )
    const email = graph.fields.find((f) => f.field[0] === "email")!
    const name = graph.fields.find((f) => f.field[0] === "name")!
    expect(email.provenConsumers).toHaveLength(1)
    expect(name.provenConsumers).toHaveLength(0)
  })

  it("keeps every proven consumer of one field, not just the first", () => {
    const graph = buildFlowGraph(
      inventory([capability({ fields: [field({ path: ["email"] })] })]),
      [
        readEdge({ from: "/project/a.ts" }),
        readEdge({ from: "/project/b.ts" }),
        readEdge({ from: "/project/c.ts" }),
      ],
    )
    expect(graph.fields[0]!.provenConsumers.map((e) => e.from)).toEqual([
      "/project/a.ts",
      "/project/b.ts",
      "/project/c.ts",
    ])
  })

  it("ignores edges targeting a different capability entirely", () => {
    const graph = buildFlowGraph(
      inventory([capability({ fields: [field({ path: ["email"] })] })]),
      [
        readEdge({
          to: { capability: { file: "/project/other.ts", exportName: "other" }, field: ["email"] },
        }),
      ],
    )
    expect(graph.fields[0]!.provenConsumers).toEqual([])
  })

  it("reads the field's already-resolved sensitivity (fallback itself lives in inventory.ts, not here)", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          docs: { sensitivity: "internal" },
          fields: [
            field({ path: ["ssn"], sensitivity: { value: "restricted", declaredOn: "field" } }),
            field({ path: ["locale"], sensitivity: { value: "internal", declaredOn: "field" } }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.fields.find((f) => f.field[0] === "ssn")?.sensitivity).toBe("restricted")
    expect(graph.fields.find((f) => f.field[0] === "locale")?.sensitivity).toBe("internal")
  })

  it("leaves sensitivity undefined when neither the field nor the capability declares it", () => {
    const graph = buildFlowGraph(inventory([capability({ fields: [field()] })]), [])
    expect(graph.fields[0]!.sensitivity).toBeUndefined()
  })

  it("finds no writers for a field with an empty path (defensive: never produced by inventory.ts in practice)", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [field({ path: [] })],
          // A getter that writes top-level `email` -- it must NOT be picked up
          // for the empty-path field, so the `fieldName !== undefined` guard is
          // load-bearing.
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "api", name: "x" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.fields[0]!.declaredOrigins).toEqual([])
    expect(graph.fields[0]!.declaredDestinations).toEqual([])
  })

  it("carries the exact capability ref (file + exportName) onto every FieldFlow", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({ file: "/p/user.ts", exportName: "userCapability", fields: [field()] }),
      ]),
      [],
    )
    expect(graph.fields[0]!.capability).toEqual({
      file: "/p/user.ts",
      exportName: "userCapability",
    })
  })

  it("treats a field as written only by an operation whose `writes` names it as an exact top-level path", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [field({ path: ["email"] })],
          getters: [
            // exact top-level match -> a writer
            operation({
              name: "getEmail",
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "api", name: "a" }],
            }),
            // nested path under `email` -> NOT a top-level writer
            operation({
              name: "getEmailMeta",
              writes: [["email", "verified"]],
              endpoints: [{ direction: "input", kind: "queue", name: "b" }],
            }),
            // different top-level field -> NOT a writer
            operation({
              name: "getName",
              writes: [["name"]],
              endpoints: [{ direction: "input", kind: "external-service", name: "c" }],
            }),
            // writes `email` AND `settings` -> a writer under `.some`, but not
            // under `.every` (so the `.some` call is load-bearing).
            operation({
              name: "getBundle",
              writes: [["email"], ["settings"]],
              endpoints: [{ direction: "input", kind: "api", name: "d" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.fields[0]!.declaredOrigins.map((d) => d.endpoint.name)).toEqual(["a", "d"])
  })

  it("keeps a proven consumer only for a `reads-field` edge that names this exact field", () => {
    const graph = buildFlowGraph(
      inventory([capability({ fields: [field({ path: ["email"] })] })]),
      [
        readEdge({
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            field: ["email"],
          },
        }),
        // right capability + right field, wrong relationship -> excluded (so
        // the `relationship === "reads-field"` clause is load-bearing on its own)
        readEdge({
          relationship: "calls-getter",
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            field: ["email"],
            operation: "getUser",
          },
        }),
        // right capability + relationship, no field at all -> excluded (the `?.`)
        readEdge({
          to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
        }),
      ],
    )
    expect(graph.fields[0]!.provenConsumers).toHaveLength(1)
  })

  it("returns an empty proven-consumer list for a capability that no edge targets", () => {
    const graph = buildFlowGraph(
      inventory([capability({ fields: [field({ path: ["email"] })] })]),
      [
        readEdge({
          to: { capability: { file: "/project/other.ts", exportName: "other" }, field: ["email"] },
        }),
      ],
    )
    expect(graph.fields[0]!.provenConsumers).toEqual([])
  })
})

describe("buildFlowGraph -- trust-boundary finding", () => {
  it("does not fire when the field has no declared sensitivity", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [field({ path: ["email"] })],
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "api", name: "x" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.findings).toEqual([])
  })

  it("does not fire when sensitive but no endpoint crosses an external boundary", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "internal", name: "cache" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.findings).toEqual([])
  })

  it.each(["external-service", "api", "queue"] as const)(
    "fires when sensitive and an endpoint kind is %s",
    (kind) => {
      const graph = buildFlowGraph(
        inventory([
          capability({
            fields: [
              field({
                path: ["email"],
                docs: { sensitivity: "confidential" },
                sensitivity: { value: "confidential", declaredOn: "field" },
              }),
            ],
            getters: [
              operation({
                writes: [["email"]],
                endpoints: [{ direction: "input", kind, name: "x", handling: "encrypted" }],
              }),
            ],
          }),
        ]),
        [],
      )
      expect(graph.findings).toHaveLength(1)
      expect(graph.findings[0]!.code).toBe("SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY")
      expect(graph.findings[0]!.severity).toBe("warning")
    },
  )

  it("does not fire for database/cache/storage/user-input/computed/internal endpoint kinds", () => {
    const kinds = ["database", "cache", "storage", "user-input", "computed", "internal"] as const
    for (const kind of kinds) {
      const graph = buildFlowGraph(
        inventory([
          capability({
            fields: [
              field({
                path: ["email"],
                docs: { sensitivity: "restricted" },
                sensitivity: { value: "restricted", declaredOn: "field" },
              }),
            ],
            getters: [
              operation({
                writes: [["email"]],
                endpoints: [{ direction: "input", kind, name: "x" }],
              }),
            ],
          }),
        ]),
        [],
      )
      expect(graph.findings).toEqual([])
    }
  })

  it("fires on a custom, non-standard sensitivity value too -- never assumed safe", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "top-secret" },
              sensitivity: { value: "top-secret", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "api", name: "x", handling: "encrypted" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.findings).toHaveLength(1)
  })

  it("fires when only one of several declared endpoints crosses a boundary", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [
                { direction: "input", kind: "internal", name: "memo" },
                { direction: "input", kind: "api", name: "x", handling: "encrypted" },
              ],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(
      graph.findings.filter((f) => f.code === "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY"),
    ).toHaveLength(1)
  })

  it("fires from a declared output endpoint just as it does for an input endpoint", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
          mutators: [
            operation({
              kind: "mutator",
              name: "sendEmail",
              writes: [["email"]],
              endpoints: [
                {
                  direction: "output",
                  kind: "external-service",
                  name: "email-provider",
                  handling: "encrypted",
                },
              ],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.findings).toHaveLength(1)
  })
})

describe("buildFlowGraph -- SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING", () => {
  it("fires when a sensitive field's boundary-crossing endpoint declares no handling", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "api", name: "identity-service" }],
            }),
          ],
        }),
      ]),
      [],
    )
    const finding = graph.findings.find(
      (f) => f.code === "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING",
    )
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe("warning")
    expect(finding?.message).not.toMatch(/\b(mishandled|unsafe|noncompliant)\b/i)
  })

  it("does not fire once every boundary-crossing endpoint declares a handling state", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [
                { direction: "input", kind: "api", name: "identity-service", handling: "masked" },
              ],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.findings.some((f) => f.code === "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING")).toBe(
      false,
    )
  })

  it("never fires for an endpoint kind that isn't a boundary crossing, even without handling declared", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "internal", name: "cache" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.findings.some((f) => f.code === "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING")).toBe(
      false,
    )
  })

  it("never fires when the field has no declared sensitivity", () => {
    const graph = buildFlowGraph(
      inventory([
        capability({
          fields: [field({ path: ["email"] })],
          getters: [
            operation({
              writes: [["email"]],
              endpoints: [{ direction: "input", kind: "api", name: "identity-service" }],
            }),
          ],
        }),
      ]),
      [],
    )
    expect(graph.findings.some((f) => f.code === "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING")).toBe(
      false,
    )
  })
})

describe("buildFlowGraph -- exact finding messages", () => {
  // A field with a nested path and two un-handled boundary-crossing endpoints,
  // so `field.join(".")`, the `String(undeclared.length)` count, and every
  // literal fragment of both message templates (and `family`) are pinned. The
  // graph is built inside each test on purpose -- a describe-scoped fixture
  // runs before any test and mutation coverage can't then attribute it.
  function boundaryGraph() {
    return buildFlowGraph(
      inventory([
        capability({
          file: "/p/user.ts",
          exportName: "userCapability",
          fields: [
            field({
              path: ["contact", "email"],
              docs: { sensitivity: "confidential" },
              sensitivity: { value: "confidential", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              name: "getContact",
              writes: [["contact"]],
              endpoints: [
                { direction: "input", kind: "api", name: "identity-service" },
                { direction: "input", kind: "queue", name: "contact-events" },
              ],
            }),
          ],
        }),
      ]),
      [],
    )
  }

  it("renders SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY verbatim", () => {
    const finding = boundaryGraph().findings.find(
      (f) => f.code === "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY",
    )
    expect(finding?.family).toBe("flow")
    expect(finding?.message).toBe(
      'Field "contact.email" on "userCapability" is sensitivity "confidential" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.',
    )
  })

  it("renders SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING verbatim, with the endpoint count", () => {
    const finding = boundaryGraph().findings.find(
      (f) => f.code === "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING",
    )
    expect(finding?.family).toBe("flow")
    expect(finding?.message).toBe(
      'Field "contact.email" on "userCapability" is sensitivity "confidential" and has 2 declared boundary-crossing endpoint(s) with no declared "handling" -- state how this field\'s data is protected at each crossing (plaintext/masked/redacted/hashed/encrypted).',
    )
  })
})
