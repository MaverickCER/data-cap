import { describe, expect, it } from "vitest"
import {
  checkDuplicateEndpoints,
  checkStructuralDuplication,
  shapeSignature,
} from "../../src/build/structural-duplication.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

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
    name: "getThing",
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
    file: "/project/a.ts",
    exportName: "a",
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

describe("shapeSignature", () => {
  it("produces exactly these signatures across every branch", () => {
    expect(shapeSignature(null)).toBe("null")
    expect(shapeSignature("anything")).toBe("string")
    expect(shapeSignature(42)).toBe("number")
    expect(shapeSignature(true)).toBe("boolean")
    expect(shapeSignature(undefined)).toBe("undefined")
    expect(shapeSignature([])).toBe("array")
    expect(shapeSignature(["x"])).toBe("array<string>")
    expect(shapeSignature([[1]])).toBe("array<array<number>>")
    // object keys are sorted, so declaration order does not change the signature
    expect(shapeSignature({ b: "", a: 0 })).toBe("{a:number,b:string}")
    expect(shapeSignature({ nested: { z: true } })).toBe("{nested:{z:boolean}}")
  })

  it("stops descending at depth 20 for a pathologically-nested array", () => {
    let deep: unknown = 1
    for (let i = 0; i < 25; i += 1) deep = [deep]
    expect(shapeSignature(deep)).toBe(`${"array<".repeat(20)}…${">".repeat(20)}`)
  })

  it("stops descending at depth 20 for a pathologically-nested object", () => {
    let deep: unknown = 1
    for (let i = 0; i < 25; i += 1) deep = { n: deep }
    expect(shapeSignature(deep)).toBe(`${"{n:".repeat(20)}…${"}".repeat(20)}`)
  })
})

describe("checkStructuralDuplication", () => {
  it("flags two active capabilities declaring the same field name with the same shape", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", fields: [field({ path: ["email"], shape: "" })] }),
        capability({ exportName: "b", fields: [field({ path: ["email"], shape: "" })] }),
      ]),
    )
    expect(findings).toEqual([
      {
        code: "DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES",
        family: "structural",
        severity: "info",
        message:
          '"email" is declared with the same shape in both "a" and "b" -- independent capabilities can legitimately duplicate a field; worth a look if that wasn\'t intentional.',
        capability: { file: "/project/a.ts", exportName: "a" },
        field: ["email"],
      },
    ])
  })

  it("does not flag the same field name with a different shape", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", fields: [field({ path: ["count"], shape: "" })] }),
        capability({ exportName: "b", fields: [field({ path: ["count"], shape: 0 })] }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("does not flag different field names", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", fields: [field({ path: ["email"] })] }),
        capability({ exportName: "b", fields: [field({ path: ["locale"] })] }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("does not flag capabilities sharing an exclusiveGroup -- that's exclusive-group.ts's concern", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({
          exportName: "a",
          exclusiveGroup: "user-backend",
          fields: [field({ path: ["email"] })],
        }),
        capability({
          exportName: "b",
          exclusiveGroup: "user-backend",
          fields: [field({ path: ["email"] })],
        }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("still flags two capabilities that are each in a DIFFERENT exclusiveGroup", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({
          exportName: "a",
          exclusiveGroup: "group-1",
          fields: [field({ path: ["email"] })],
        }),
        capability({
          exportName: "b",
          exclusiveGroup: "group-2",
          fields: [field({ path: ["email"] })],
        }),
      ]),
    )
    expect(findings).toHaveLength(1)
  })

  it("does not flag an inactive capability", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", active: true, fields: [field({ path: ["email"] })] }),
        capability({ exportName: "b", active: false, fields: [field({ path: ["email"] })] }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("compares nested object shapes structurally, ignoring literal values", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({
          exportName: "a",
          fields: [field({ path: ["user"], shape: { name: "Ada", email: "" } })],
        }),
        capability({
          exportName: "b",
          fields: [field({ path: ["user"], shape: { name: "", email: "unused@example.com" } })],
        }),
      ]),
    )
    expect(findings).toHaveLength(1)
  })

  it("does not flag structurally different nested shapes", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", fields: [field({ path: ["user"], shape: { name: "" } })] }),
        capability({
          exportName: "b",
          fields: [field({ path: ["user"], shape: { name: "", email: "" } })],
        }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("distinguishes array shapes from scalars, and compares by first element", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", fields: [field({ path: ["tags"], shape: ["x"] })] }),
        capability({ exportName: "b", fields: [field({ path: ["tags"], shape: ["y"] })] }),
      ]),
    )
    expect(findings).toHaveLength(1)
  })

  it("treats an empty array and a populated array of the same field name as different shapes", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", fields: [field({ path: ["tags"], shape: [] })] }),
        capability({ exportName: "b", fields: [field({ path: ["tags"], shape: ["x"] })] }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("treats null as its own distinct shape", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", fields: [field({ path: ["role"], shape: null })] }),
        capability({ exportName: "b", fields: [field({ path: ["role"], shape: null })] }),
      ]),
    )
    expect(findings).toHaveLength(1)
  })

  it("scales to more than two capabilities, comparing every pair", () => {
    const findings = checkStructuralDuplication(
      inventory([
        capability({ exportName: "a", fields: [field({ path: ["email"] })] }),
        capability({ exportName: "b", fields: [field({ path: ["email"] })] }),
        capability({ exportName: "c", fields: [field({ path: ["email"] })] }),
      ]),
    )
    // a-b, a-c, b-c
    expect(findings).toHaveLength(3)
  })
})

describe("checkDuplicateEndpoints", () => {
  it("flags two active capabilities declaring an endpoint with the same url", () => {
    const findings = checkDuplicateEndpoints(
      inventory([
        capability({
          exportName: "a",
          getters: [
            operation({
              name: "getUser",
              endpoints: [
                {
                  direction: "input",
                  kind: "api",
                  name: "svc",
                  url: "https://api.example.com/user",
                },
              ],
            }),
          ],
        }),
        capability({
          exportName: "b",
          getters: [
            operation({
              name: "getProfile",
              endpoints: [
                {
                  direction: "input",
                  kind: "api",
                  name: "svc",
                  url: "https://api.example.com/user",
                },
              ],
            }),
          ],
        }),
      ]),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]!.code).toBe("DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES")
    expect(findings[0]!.severity).toBe("info")
    expect(findings[0]!.message).toContain("https://api.example.com/user")
    expect(findings[0]!.message).toContain("a")
    expect(findings[0]!.message).toContain("getUser")
    expect(findings[0]!.message).toContain("b")
    expect(findings[0]!.message).toContain("getProfile")
  })

  it("emits the endpoint finding verbatim", () => {
    const findings = checkDuplicateEndpoints(
      inventory([
        capability({
          file: "/p/a.ts",
          exportName: "a",
          getters: [
            operation({
              name: "getUser",
              endpoints: [{ direction: "input", kind: "api", name: "svc", url: "https://x/u" }],
            }),
          ],
        }),
        capability({
          file: "/p/b.ts",
          exportName: "b",
          mutators: [
            operation({
              kind: "mutator",
              name: "syncUser",
              endpoints: [{ direction: "output", kind: "api", name: "svc", url: "https://x/u" }],
            }),
          ],
        }),
      ]),
    )
    expect(findings).toEqual([
      {
        code: "DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES",
        family: "structural",
        severity: "info",
        message:
          'Endpoint "https://x/u" is declared by both "a"\'s getter "getUser" and "b"\'s mutator "syncUser" -- possibly a duplicate network fetch across independently-declared capabilities; worth a look if that wasn\'t intentional.',
        capability: { file: "/p/a.ts", exportName: "a" },
        operation: "getUser",
      },
    ])
  })

  it("does not flag endpoints with different urls", () => {
    const findings = checkDuplicateEndpoints(
      inventory([
        capability({
          exportName: "a",
          getters: [
            operation({
              endpoints: [
                { direction: "input", kind: "api", name: "svc", url: "https://a.example.com" },
              ],
            }),
          ],
        }),
        capability({
          exportName: "b",
          getters: [
            operation({
              endpoints: [
                { direction: "input", kind: "api", name: "svc", url: "https://b.example.com" },
              ],
            }),
          ],
        }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("never flags an endpoint with no declared url at all -- nothing to compare", () => {
    const findings = checkDuplicateEndpoints(
      inventory([
        capability({
          exportName: "a",
          getters: [operation({ endpoints: [{ direction: "input", kind: "api", name: "svc" }] })],
        }),
        capability({
          exportName: "b",
          getters: [operation({ endpoints: [{ direction: "input", kind: "api", name: "svc" }] })],
        }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("does not flag capabilities sharing an exclusiveGroup -- alternative implementations legitimately share a url", () => {
    const findings = checkDuplicateEndpoints(
      inventory([
        capability({
          exportName: "a",
          exclusiveGroup: "user-backend",
          getters: [
            operation({
              endpoints: [{ direction: "input", kind: "api", name: "svc", url: "https://x" }],
            }),
          ],
        }),
        capability({
          exportName: "b",
          exclusiveGroup: "user-backend",
          getters: [
            operation({
              endpoints: [{ direction: "input", kind: "api", name: "svc", url: "https://x" }],
            }),
          ],
        }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("does not flag an inactive capability", () => {
    const findings = checkDuplicateEndpoints(
      inventory([
        capability({
          exportName: "a",
          active: true,
          getters: [
            operation({
              endpoints: [{ direction: "input", kind: "api", name: "svc", url: "https://x" }],
            }),
          ],
        }),
        capability({
          exportName: "b",
          active: false,
          getters: [
            operation({
              endpoints: [{ direction: "input", kind: "api", name: "svc", url: "https://x" }],
            }),
          ],
        }),
      ]),
    )
    expect(findings).toEqual([])
  })

  it("finds a match regardless of which operation kind (getter/mutator/subscription) declares it", () => {
    const findings = checkDuplicateEndpoints(
      inventory([
        capability({
          exportName: "a",
          mutators: [
            operation({
              kind: "mutator",
              name: "updateUser",
              endpoints: [{ direction: "output", kind: "api", name: "svc", url: "https://x" }],
            }),
          ],
        }),
        capability({
          exportName: "b",
          subscriptions: [
            operation({
              kind: "subscription",
              name: "subscribeToUser",
              endpoints: [{ direction: "input", kind: "api", name: "svc", url: "https://x" }],
            }),
          ],
        }),
      ]),
    )
    expect(findings).toHaveLength(1)
  })
})
