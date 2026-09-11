import { describe, expect, it } from "vitest"
import {
  buildOwnershipMatrix,
  buildOwnershipModel,
  OWNERSHIP_MODEL_SCHEMA_VERSION,
  UNOWNED,
} from "../../src/build/ownership-model.js"
import type { CapabilityInventory, CapabilityNode, FieldNode } from "../../src/build/inventory.js"
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

/** Shorthand for a resolved, own-declared-on-the-field governance value (ADR 0057). */
function ownedBy(owner: string): FieldNode["owner"] {
  return { value: owner, declaredOn: "field" }
}

describe("buildOwnershipMatrix", () => {
  it("groups a capability under its owner", () => {
    const matrix = buildOwnershipMatrix(
      inventory([capability({ docs: { owner: "identity-team" } })]),
    )
    expect(matrix).toEqual([
      {
        owner: "identity-team",
        capabilities: [{ file: "/project/user.ts", exportName: "userCapability" }],
        fields: [],
      },
    ])
  })

  it("groups a field under its own resolved owner (already inheritance-resolved by inventory.ts)", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({
          docs: { owner: "identity-team" },
          fields: [field({ path: ["email"], owner: ownedBy("security-team") })],
        }),
      ]),
    )
    const security = matrix.find((e) => e.owner === "security-team")
    expect(security?.fields).toEqual([
      { capability: { file: "/project/user.ts", exportName: "userCapability" }, field: ["email"] },
    ])
    const identity = matrix.find((e) => e.owner === "identity-team")
    expect(identity?.capabilities).toEqual([
      { file: "/project/user.ts", exportName: "userCapability" },
    ])
    expect(identity?.fields).toEqual([]) // email belongs to security-team, not identity-team
  })

  it("buckets an unowned capability/field under the UNOWNED sentinel", () => {
    const matrix = buildOwnershipMatrix(inventory([capability({ fields: [field()] })]))
    const unowned = matrix.find((e) => e.owner === UNOWNED)
    expect(unowned?.capabilities).toHaveLength(1)
    expect(unowned?.fields).toHaveLength(1)
  })

  it("sorts the UNOWNED bucket last regardless of alphabetical position", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({ exportName: "a" }),
        capability({
          exportName: "b",
          file: "/project/b.ts",
          docs: { owner: "zzz-team" },
        }),
      ]),
    )
    expect(matrix.map((e) => e.owner)).toEqual(["zzz-team", UNOWNED])
  })

  it("sorts named owners alphabetically", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({ exportName: "a", file: "/project/a.ts", docs: { owner: "z-team" } }),
        capability({ exportName: "b", file: "/project/b.ts", docs: { owner: "a-team" } }),
      ]),
    )
    expect(matrix.map((e) => e.owner)).toEqual(["a-team", "z-team"])
  })

  it("merges multiple capabilities under the same owner, deduplicated and sorted", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({ exportName: "z", file: "/project/z.ts", docs: { owner: "identity-team" } }),
        capability({ exportName: "a", file: "/project/a.ts", docs: { owner: "identity-team" } }),
      ]),
    )
    expect(matrix).toHaveLength(1)
    expect(matrix[0]!.capabilities.map((c) => c.exportName)).toEqual(["a", "z"])
  })

  it("sorts a bucket's fields by capability then field path", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({
          exportName: "user",
          docs: { owner: "identity-team" },
          fields: [
            field({ path: ["zField"], owner: ownedBy("identity-team") }),
            field({ path: ["aField"], owner: ownedBy("identity-team") }),
          ],
        }),
      ]),
    )
    const identity = matrix.find((e) => e.owner === "identity-team")
    expect(identity?.fields.map((f) => f.field[0])).toEqual(["aField", "zField"])
  })

  it("returns an empty matrix for an empty inventory", () => {
    expect(buildOwnershipMatrix(inventory([]))).toEqual([])
  })

  it("labels the unowned bucket with the literal string '(unowned)'", () => {
    expect(UNOWNED).toBe("(unowned)")
    const matrix = buildOwnershipMatrix(inventory([capability({ docs: undefined })]))
    expect(matrix.map((e) => e.owner)).toEqual(["(unowned)"])
  })

  it("breaks a field tie on the dotted path, not the concatenation", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({
          exportName: "user",
          file: "src/user.ts",
          docs: { owner: "team" },
          fields: [
            field({ path: ["ab"], owner: ownedBy("team") }),
            field({ path: ["a", "b"], owner: ownedBy("team") }),
          ],
        }),
      ]),
    )
    expect(matrix[0]!.fields.map((f) => f.field.join("."))).toEqual(["a.b", "ab"])
  })

  it("orders a bucket's fields by capability file, then export name, then path -- with file/name order disagreeing", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        // file order (a.ts < z.ts) and export order (zzz > aaa) disagree
        capability({
          exportName: "zzz",
          file: "src/a.ts",
          docs: { owner: "team" },
          fields: [
            field({ path: ["f2"], owner: ownedBy("team") }),
            field({ path: ["f1"], owner: ownedBy("team") }),
          ],
        }),
        capability({
          exportName: "aaa",
          file: "src/z.ts",
          docs: { owner: "team" },
          fields: [field({ path: ["f1"], owner: ownedBy("team") })],
        }),
      ]),
    )
    expect(
      matrix[0]!.fields.map(
        (f) => `${f.capability.file}#${f.capability.exportName}.${f.field.join(".")}`,
      ),
    ).toEqual(["src/a.ts#zzz.f1", "src/a.ts#zzz.f2", "src/z.ts#aaa.f1"])
  })

  it("orders a bucket's capability refs by file then export name -- input order ignored", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({ exportName: "z", file: "src/z.ts", docs: { owner: "team" } }),
        capability({ exportName: "mid", file: "src/a.ts", docs: { owner: "team" } }),
        capability({ exportName: "aaa", file: "src/a.ts", docs: { owner: "team" } }),
      ]),
    )
    expect(matrix[0]!.capabilities.map((c) => `${c.file}#${c.exportName}`)).toEqual([
      "src/a.ts#aaa",
      "src/a.ts#mid",
      "src/z.ts#z",
    ])
  })

  it("orders named owners alphabetically with UNOWNED always last, whatever the input order", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({ exportName: "u", file: "src/u.ts", docs: undefined }),
        capability({ exportName: "z", file: "src/z.ts", docs: { owner: "zeta-team" } }),
        capability({ exportName: "a", file: "src/a.ts", docs: { owner: "alpha-team" } }),
      ]),
    )
    expect(matrix.map((e) => e.owner)).toEqual(["alpha-team", "zeta-team", "(unowned)"])
  })

  it("breaks a capability sort tie on export name when two capabilities share a file", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({
          exportName: "zCapability",
          file: "/project/shared.ts",
          docs: { owner: "team" },
        }),
        capability({
          exportName: "aCapability",
          file: "/project/shared.ts",
          docs: { owner: "team" },
        }),
      ]),
    )
    expect(matrix[0]!.capabilities.map((c) => c.exportName)).toEqual(["aCapability", "zCapability"])
  })

  it("sorts a bucket's fields by capability first, across two different capabilities", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({
          exportName: "z",
          file: "/project/z.ts",
          docs: { owner: "team" },
          fields: [field({ path: ["email"], owner: ownedBy("team") })],
        }),
        capability({
          exportName: "a",
          file: "/project/a.ts",
          docs: { owner: "team" },
          fields: [field({ path: ["email"], owner: ownedBy("team") })],
        }),
      ]),
    )
    expect(matrix[0]!.fields.map((f) => f.capability.exportName)).toEqual(["a", "z"])
  })

  it("sorts every owner correctly, including UNOWNED, across more than two buckets", () => {
    const matrix = buildOwnershipMatrix(
      inventory([
        capability({ exportName: "a", file: "/project/a.ts", docs: { owner: "z-team" } }),
        capability({ exportName: "b", file: "/project/b.ts" }),
        capability({ exportName: "c", file: "/project/c.ts", docs: { owner: "a-team" } }),
      ]),
    )
    expect(matrix.map((e) => e.owner)).toEqual(["a-team", "z-team", UNOWNED])
  })
})

describe("buildOwnershipModel", () => {
  it("stamps schemaVersion and wraps buildOwnershipMatrix's output as entries, unchanged", () => {
    const model = buildOwnershipModel(inventory([capability({ docs: { owner: "identity-team" } })]))
    expect(model.schemaVersion).toBe(OWNERSHIP_MODEL_SCHEMA_VERSION)
    expect(model.entries).toEqual([
      {
        owner: "identity-team",
        capabilities: [{ file: "/project/user.ts", exportName: "userCapability" }],
        fields: [],
      },
    ])
  })

  it("buckets an unowned capability under the UNOWNED sentinel, sorted last", () => {
    const model = buildOwnershipModel(
      inventory([capability(), capability({ docs: { owner: "identity-team" } })]),
    )
    expect(model.entries.at(-1)!.owner).toBe(UNOWNED)
  })
})
