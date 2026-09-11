import { describe, expect, it } from "vitest"
import { buildInventory } from "../../src/build/inventory.js"
import type { DiscoveredCapability, LinkResult } from "../../src/build/link.js"

/** `root` is what `buildInventory` relativizes each capability's `file` against (OUT-01) -- every fixture below declares its files under `/project`. */
function linkResult(capabilities: readonly DiscoveredCapability[]): LinkResult {
  return { root: "/project", capabilities, warnings: [] }
}

function discovered(overrides: Partial<DiscoveredCapability> = {}): DiscoveredCapability {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    kind: "buildData",
    fieldsShape: undefined,
    operationNames: undefined,
    operationWrites: undefined,
    operationPresence: undefined,
    declarationPosition: { line: 1, column: 1 },
    fieldPositions: undefined,
    documentedBy: undefined,
    docs: undefined,
    ...overrides,
  }
}

describe("buildInventory", () => {
  it("returns an empty inventory for an empty LinkResult, carrying warnings through unchanged", () => {
    const warnings = [{ file: "/project/user.ts", message: "something" }]
    const inventory = buildInventory({ root: "/project", capabilities: [], warnings })
    expect(inventory.capabilities).toEqual([])
    // Carried through with only the one documented conversion applied: a
    // warning's `file` is published root-relative like every other path in
    // this model (OUT-01); its message is untouched.
    expect(inventory.warnings).toEqual([{ file: "user.ts", message: "something" }])
  })

  it("builds a bare capability node with no docs, defaulting active to true", () => {
    const inventory = buildInventory(linkResult([discovered({ fieldsShape: { id: "" } })]))
    const node = inventory.capabilities[0]!
    // Root-relative, not the absolute discovery path (OUT-01).
    expect(node.file).toBe("user.ts")
    expect(node.exportName).toBe("userCapability")
    expect(node.kind).toBe("buildData")
    expect(node.docs?.owner).toBeUndefined()
    expect(node.active).toBe(true)
    expect(node.exclusiveGroup).toBeUndefined()
    expect(node.docs?.sensitivity).toBeUndefined()
    expect(node.fields).toEqual([
      {
        path: ["id"],
        docs: undefined,
        owner: { value: undefined, declaredOn: undefined },
        sensitivity: { value: undefined, declaredOn: undefined },
        purpose: { value: undefined, declaredOn: undefined },
        legalBasis: { value: undefined, declaredOn: undefined },
        dataResidency: { value: undefined, declaredOn: undefined },
        auditRequired: { value: undefined, declaredOn: undefined },
        writtenBy: [],
        shape: "",
      },
    ])
    expect(node.getters).toEqual([])
    expect(node.mutators).toEqual([])
    expect(node.subscriptions).toEqual([])
    // A fully-unresolved governance value is a real { value, declaredOn } object
    // -- both keys present -- never a bare {}.
    expect(Object.keys(node.fields[0]!.owner).sort()).toEqual(["declaredOn", "value"])
  })

  it("classifies a subscription operation node with kind 'subscription'", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          kind: "createData",
          fieldsShape: { user: {} },
          operationNames: { getters: [], mutators: [], subscriptions: ["watchUser"] },
        }),
      ]),
    )
    expect(inventory.capabilities[0]!.subscriptions).toEqual([
      {
        kind: "subscription",
        name: "watchUser",
        docs: undefined,
        writes: [],
        hasProcessor: false,
        hasOptimistic: false,
        endpoints: [],
      },
    ])
  })

  it("threads declarationPosition through onto the capability node, and each field's own position onto its field node (ADR 0052)", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { id: "", email: "" },
          declarationPosition: { line: 3, column: 30 },
          fieldPositions: { id: { line: 3, column: 45 }, email: { line: 3, column: 55 } },
        }),
      ]),
    )
    const node = inventory.capabilities[0]!
    expect(node.declarationPosition).toEqual({ line: 3, column: 30 })
    expect(node.fields.find((f) => f.path[0] === "id")?.declarationPosition).toEqual({
      line: 3,
      column: 45,
    })
    expect(node.fields.find((f) => f.path[0] === "email")?.declarationPosition).toEqual({
      line: 3,
      column: 55,
    })
  })

  it("leaves each field's declarationPosition undefined when fieldPositions is undefined (identifier-resolved fields) -- never guessed at", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { id: "" },
          declarationPosition: { line: 1, column: 1 },
          fieldPositions: undefined,
        }),
      ]),
    )
    expect(inventory.capabilities[0]!.fields[0]!.declarationPosition).toBeUndefined()
  })

  it("resolves capability-level governance metadata from docs", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { id: "" },
          docs: {
            owner: "identity-team",
            active: false,
            exclusiveGroup: "user-backend",
            sensitivity: "restricted",
          },
        }),
      ]),
    )
    const node = inventory.capabilities[0]!
    expect(node.docs?.owner).toBe("identity-team")
    expect(node.active).toBe(false)
    expect(node.exclusiveGroup).toBe("user-backend")
    expect(node.docs?.sensitivity).toBe("restricted")
  })

  it("a field's own owner overrides the capability's owner; falls back to the capability's when unset, with declaredOn recording which (ADR 0057)", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { email: "", locale: "" },
          docs: {
            owner: "identity-team",
            fields: { email: { owner: "security-team", sensitivity: "confidential" } },
          },
        }),
      ]),
    )
    const [email, locale] = inventory.capabilities[0]!.fields
    expect(email).toMatchObject({ owner: { value: "security-team", declaredOn: "field" } })
    expect(locale).toMatchObject({ owner: { value: "identity-team", declaredOn: "capability" } })
  })

  it("a field's own sensitivity overrides the capability's; falls back to the capability's when unset, with declaredOn recording which (ADR 0057)", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { email: "", locale: "" },
          docs: {
            sensitivity: "restricted",
            fields: { email: { sensitivity: "confidential" } },
          },
        }),
      ]),
    )
    const [email, locale] = inventory.capabilities[0]!.fields
    expect(email).toMatchObject({ sensitivity: { value: "confidential", declaredOn: "field" } })
    expect(locale).toMatchObject({
      sensitivity: { value: "restricted", declaredOn: "capability" },
    })
  })

  it("resolves capability-level purpose/legalBasis/dataResidency/auditRequired from docs (ADR 0051)", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { id: "" },
          docs: {
            purpose: "case management",
            legalBasis: "contract",
            dataResidency: ["us", "eu"],
            auditRequired: true,
          },
        }),
      ]),
    )
    const node = inventory.capabilities[0]!
    expect(node.docs?.purpose).toBe("case management")
    expect(node.docs?.legalBasis).toBe("contract")
    expect(node.docs?.dataResidency).toEqual(["us", "eu"])
    expect(node.docs?.auditRequired).toBe(true)
  })

  it("a field's own purpose/legalBasis/dataResidency/auditRequired override the capability's; fall back to the capability's when unset, with declaredOn recording which (ADR 0057)", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { email: "", locale: "" },
          docs: {
            purpose: "account management",
            legalBasis: "contract",
            dataResidency: "us",
            auditRequired: false,
            fields: {
              email: {
                purpose: "delivery notifications",
                legalBasis: "consent",
                dataResidency: "eu",
                auditRequired: true,
              },
            },
          },
        }),
      ]),
    )
    const [email, locale] = inventory.capabilities[0]!.fields
    expect(email).toMatchObject({
      purpose: { value: "delivery notifications", declaredOn: "field" },
      legalBasis: { value: "consent", declaredOn: "field" },
      dataResidency: { value: "eu", declaredOn: "field" },
      auditRequired: { value: true, declaredOn: "field" },
    })
    expect(locale).toMatchObject({
      purpose: { value: "account management", declaredOn: "capability" },
      legalBasis: { value: "contract", declaredOn: "capability" },
      dataResidency: { value: "us", declaredOn: "capability" },
      auditRequired: { value: false, declaredOn: "capability" },
    })
  })

  describe("operation writes resolution", () => {
    it("a getter with writes: true covers every top-level field", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { user: {}, post: {} },
            operationNames: { getters: ["getAll"], mutators: [], subscriptions: [] },
            operationWrites: {
              getters: [{ name: "getAll", writes: true }],
              mutators: [],
              subscriptions: [],
            },
          }),
        ]),
      )
      const node = inventory.capabilities[0]!
      expect(node.getters[0]!.writes).toEqual([["user"], ["post"]])
      expect(node.fields.map((f) => f.writtenBy)).toEqual([
        [{ kind: "getter", name: "getAll" }],
        [{ kind: "getter", name: "getAll" }],
      ])
    })

    it("a mutator writes only the top-level field its nested writes shape claims", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { user: {}, post: {} },
            operationNames: { getters: [], mutators: ["updateEmail"], subscriptions: [] },
            operationWrites: {
              getters: [],
              mutators: [{ name: "updateEmail", writes: { user: { email: true } } }],
              subscriptions: [],
            },
          }),
        ]),
      )
      const node = inventory.capabilities[0]!
      expect(node.mutators[0]!.writes).toEqual([["user"]])
      expect(node.fields.find((f) => f.path[0] === "user")?.writtenBy).toEqual([
        { kind: "mutator", name: "updateEmail" },
      ])
      expect(node.fields.find((f) => f.path[0] === "post")?.writtenBy).toEqual([])
    })

    it("an operation with unresolvable/absent (non-mutator) writes claims no fields", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { user: {} },
            operationNames: { getters: ["getUser"], mutators: [], subscriptions: [] },
            operationWrites: {
              getters: [{ name: "getUser", writes: undefined }],
              mutators: [],
              subscriptions: [],
            },
          }),
        ]),
      )
      expect(inventory.capabilities[0]!.getters[0]!.writes).toEqual([])
    })

    it("an operation with no writes declared claims no fields, even on a capability that has fields", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { user: {}, post: {} },
            operationNames: { getters: ["getUser"], mutators: [], subscriptions: [] },
            // operationWrites entirely absent -> writesEntries is undefined
          }),
        ]),
      )
      const node = inventory.capabilities[0]!
      expect(node.getters[0]!.writes).toEqual([])
      expect(node.fields.map((f) => f.writtenBy)).toEqual([[], []])
    })

    it("a writes shape only ever claims the capability's own declared fields, never an inherited Object.prototype key", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { email: {}, toString: {} },
            operationNames: { getters: [], mutators: ["updateEmail"], subscriptions: [] },
            operationWrites: {
              getters: [],
              mutators: [{ name: "updateEmail", writes: { email: true } }],
              subscriptions: [],
            },
          }),
        ]),
      )
      const node = inventory.capabilities[0]!
      expect(node.mutators[0]!.writes).toEqual([["email"]])
      expect(node.fields.find((f) => f.path[0] === "toString")?.writtenBy).toEqual([])
    })

    it("an operation whose writes shape is the literal null claims no fields, without throwing", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { user: {} },
            operationNames: { getters: [], mutators: ["updateUser"], subscriptions: [] },
            operationWrites: {
              getters: [],
              mutators: [{ name: "updateUser", writes: null }],
              subscriptions: [],
            },
          }),
        ]),
      )
      expect(inventory.capabilities[0]!.mutators[0]!.writes).toEqual([])
      expect(inventory.capabilities[0]!.fields[0]!.writtenBy).toEqual([])
    })

    it("a writes shape claiming a field explicitly set to a falsy value does not count as a write", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { user: {} },
            operationNames: { getters: [], mutators: ["noop"], subscriptions: [] },
            operationWrites: {
              getters: [],
              mutators: [{ name: "noop", writes: { user: false } }],
              subscriptions: [],
            },
          }),
        ]),
      )
      expect(inventory.capabilities[0]!.mutators[0]!.writes).toEqual([])
      expect(inventory.capabilities[0]!.fields[0]!.writtenBy).toEqual([])
    })

    it("resolves writes against only the field named, not every field, when a capability has several", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { a: {}, b: {} },
            operationNames: { getters: [], mutators: ["writeA"], subscriptions: [] },
            operationWrites: {
              getters: [],
              mutators: [{ name: "writeA", writes: { a: true } }],
              subscriptions: [],
            },
          }),
        ]),
      )
      const node = inventory.capabilities[0]!
      expect(node.fields.find((f) => f.path[0] === "a")?.writtenBy).toEqual([
        { kind: "mutator", name: "writeA" },
      ])
      expect(node.fields.find((f) => f.path[0] === "b")?.writtenBy).toEqual([])
    })

    it("a fields-less capability with a full-tree writes: true operation still resolves to no write paths", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: undefined,
            operationNames: { getters: [], mutators: ["wipe"], subscriptions: [] },
            operationWrites: {
              getters: [],
              mutators: [{ name: "wipe", writes: true }],
              subscriptions: [],
            },
          }),
        ]),
      )
      expect(inventory.capabilities[0]!.mutators[0]!.writes).toEqual([])
    })

    it("multiple operations writing the same field are all recorded in writtenBy, in declared order", () => {
      const inventory = buildInventory(
        linkResult([
          discovered({
            kind: "createData",
            fieldsShape: { user: {} },
            operationNames: { getters: ["getUser"], mutators: ["updateUser"], subscriptions: [] },
            operationWrites: {
              getters: [{ name: "getUser", writes: true }],
              mutators: [{ name: "updateUser", writes: true }],
              subscriptions: [],
            },
          }),
        ]),
      )
      expect(inventory.capabilities[0]!.fields[0]!.writtenBy).toEqual([
        { kind: "getter", name: "getUser" },
        { kind: "mutator", name: "updateUser" },
      ])
    })
  })

  it("resolves an operation's hasProcessor/hasOptimistic from the discovered presence facts, defaulting to false", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          kind: "createData",
          fieldsShape: { user: {} },
          operationNames: { getters: ["getUser"], mutators: ["updateUser"], subscriptions: [] },
          operationPresence: {
            getters: [{ name: "getUser", hasProcessor: true, hasOptimistic: false }],
            mutators: [{ name: "updateUser", hasProcessor: false, hasOptimistic: true }],
            subscriptions: [],
          },
        }),
      ]),
    )
    const node = inventory.capabilities[0]!
    expect(node.getters[0]).toMatchObject({ hasProcessor: true, hasOptimistic: false })
    expect(node.mutators[0]).toMatchObject({ hasProcessor: false, hasOptimistic: true })
  })

  it("defaults hasProcessor/hasOptimistic to false when operationPresence is entirely absent", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          kind: "createData",
          fieldsShape: { user: {} },
          operationNames: { getters: ["getUser"], mutators: [], subscriptions: [] },
        }),
      ]),
    )
    expect(inventory.capabilities[0]!.getters[0]).toMatchObject({
      hasProcessor: false,
      hasOptimistic: false,
    })
  })

  it("hoists an operation's declared endpoints from its docs", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          kind: "createData",
          fieldsShape: { user: {} },
          operationNames: { getters: ["getUser"], mutators: [], subscriptions: [] },
          operationWrites: {
            getters: [{ name: "getUser", writes: true }],
            mutators: [],
            subscriptions: [],
          },
          docs: {
            getters: {
              getUser: {
                description: "Fetches a user.",
                endpoints: [{ direction: "input", kind: "api", name: "identity-service" }],
              },
            },
          },
        }),
      ]),
    )
    expect(inventory.capabilities[0]!.getters[0]!.endpoints).toEqual([
      { direction: "input", kind: "api", name: "identity-service" },
    ])
  })

  it("an operation with no docs at all gets an empty endpoints list, not undefined", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          kind: "createData",
          fieldsShape: { user: {} },
          operationNames: { getters: ["getUser"], mutators: [], subscriptions: [] },
          operationWrites: {
            getters: [{ name: "getUser", writes: true }],
            mutators: [],
            subscriptions: [],
          },
        }),
      ]),
    )
    expect(inventory.capabilities[0]!.getters[0]!.endpoints).toEqual([])
  })

  it("a capability with no fieldsShape at all produces no field nodes", () => {
    const inventory = buildInventory(linkResult([discovered({ fieldsShape: undefined })]))
    expect(inventory.capabilities[0]!.fields).toEqual([])
  })

  it("builds field/operation nodes for multiple independent capabilities", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          file: "/project/user.ts",
          exportName: "userCapability",
          fieldsShape: { id: "" },
        }),
        discovered({
          file: "/project/post.ts",
          exportName: "postCapability",
          fieldsShape: { title: "" },
        }),
      ]),
    )
    expect(inventory.capabilities).toHaveLength(2)
    expect(inventory.capabilities[0]!.exportName).toBe("userCapability")
    expect(inventory.capabilities[1]!.exportName).toBe("postCapability")
  })
})
