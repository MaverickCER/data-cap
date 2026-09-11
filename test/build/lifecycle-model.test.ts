import { describe, expect, it } from "vitest"
import {
  buildLifecycleModel,
  computeExpiringEntries,
  LIFECYCLE_MODEL_SCHEMA_VERSION,
} from "../../src/build/lifecycle-model.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { CapabilityInventory, CapabilityNode, FieldNode } from "../../src/build/inventory.js"
import type { FieldDocs } from "../../src/core/document.js"

const NOW = new Date("2026-01-01T00:00:00.000Z")

function field(path: string, docs?: FieldDocs): FieldNode {
  return {
    path: [path],
    docs,
    owner: { value: undefined, declaredOn: undefined },
    sensitivity: { value: undefined, declaredOn: undefined },
    purpose: { value: undefined, declaredOn: undefined },
    legalBasis: { value: undefined, declaredOn: undefined },
    dataResidency: { value: undefined, declaredOn: undefined },
    auditRequired: { value: undefined, declaredOn: undefined },
    declarationPosition: undefined,
    writtenBy: [],
    shape: "",
  }
}

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "src/user.ts",
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

describe("buildLifecycleModel", () => {
  it("stamps schemaVersion and returns nothing for an inventory with no lifecycle data at all", () => {
    const model = buildLifecycleModel(inventory([capability()]), 30, NOW)
    expect(model.schemaVersion).toBe(LIFECYCLE_MODEL_SCHEMA_VERSION)
    expect(model.capabilities).toEqual([])
    expect(model.expiring).toEqual([])
  })

  it("includes a field whose ONLY lifecycle property is expiresAt -- each OR clause independently gates inclusion", () => {
    const model = buildLifecycleModel(
      inventory([capability({ fields: [field("soleExpiresAt", { expiresAt: "2026-06-01" })] })]),
      30,
      NOW,
    )
    expect(model.capabilities[0]?.fields).toEqual([
      expect.objectContaining({ path: ["soleExpiresAt"], expiresAt: "2026-06-01" }),
    ])
  })

  it("includes a capability declaring only capability-level lifecycle data", () => {
    const model = buildLifecycleModel(
      inventory([
        capability({ docs: { deprecated: true, deprecatedReason: "superseded by profileData" } }),
      ]),
      30,
      NOW,
    )
    expect(model.capabilities).toEqual([
      {
        file: "src/user.ts",
        exportName: "userCapability",
        expiresAt: undefined,
        deprecated: true,
        deprecatedReason: "superseded by profileData",
        retention: undefined,
        fields: [],
      },
    ])
  })

  it("includes only fields that actually declare lifecycle data, sorted by dotted path", () => {
    const model = buildLifecycleModel(
      inventory([
        capability({
          fields: [
            // "a.b" vs "ab" -- ordering only holds when joined with "."
            { ...field("x", { removeBy: "2026-06-01" }), path: ["ab"] },
            field("plain"),
            { ...field("y", { deprecated: true }), path: ["a", "b"] },
          ],
        }),
      ]),
      30,
      NOW,
    )
    expect(model.capabilities[0]!.fields.map((f) => f.path.join("."))).toEqual(["a.b", "ab"])
  })

  it.each<[string, FieldDocs]>([
    ["only a field-level deprecatedReason", { deprecatedReason: "gone" }],
    ["only a field-level retention", { retention: "90 days" }],
    ["only a field-level renamedFrom", { renamedFrom: "oldName" }],
    ["only a field-level removeBy", { removeBy: "2026-06-01" }],
    ["only a field-level deprecated flag", { deprecated: true }],
  ])("keeps a field declaring %s", (_label, docs) => {
    const model = buildLifecycleModel(
      inventory([capability({ fields: [field("target", docs)] })]),
      30,
      NOW,
    )
    expect(model.capabilities[0]!.fields.map((f) => f.path[0])).toEqual(["target"])
  })

  it.each([
    ["only a deprecatedReason", { deprecatedReason: "gone" }],
    ["only a retention", { retention: "90 days" }],
  ])("includes a capability declaring %s", (_label, docs) => {
    const model = buildLifecycleModel(inventory([capability({ docs })]), 30, NOW)
    expect(model.capabilities).toHaveLength(1)
  })

  it("carries every declared field-level lifecycle property through verbatim", () => {
    const model = buildLifecycleModel(
      inventory([
        capability({
          fields: [
            field("email", {
              expiresAt: "2026-01-15",
              deprecated: true,
              deprecatedReason: "use contactEmail",
              removeBy: "2026-06-01",
              renamedFrom: "emailAddress",
              retention: "delete after 90 days",
            }),
          ],
        }),
      ]),
      30,
      NOW,
    )
    expect(model.capabilities[0]!.fields[0]).toEqual({
      path: ["email"],
      expiresAt: "2026-01-15",
      deprecated: true,
      deprecatedReason: "use contactEmail",
      removeBy: "2026-06-01",
      renamedFrom: "emailAddress",
      retention: "delete after 90 days",
    })
  })

  it("sorts capabilities by file then export name", () => {
    const model = buildLifecycleModel(
      inventory([
        capability({ file: "src/z.ts", exportName: "z", docs: { deprecated: true } }),
        capability({ file: "src/a.ts", exportName: "b", docs: { deprecated: true } }),
        capability({ file: "src/a.ts", exportName: "a", docs: { deprecated: true } }),
      ]),
      30,
      NOW,
    )
    expect(model.capabilities.map((c) => `${c.file}#${c.exportName}`)).toEqual([
      "src/a.ts#a",
      "src/a.ts#b",
      "src/z.ts#z",
    ])
  })

  it("publishes the capability's root-relative file verbatim, never re-deriving a path", () => {
    const model = buildLifecycleModel(
      inventory([capability({ file: "src/nested/user.ts", docs: { deprecated: true } })]),
      30,
      NOW,
    )
    expect(model.capabilities[0]!.file).toBe("src/nested/user.ts")
  })
})

describe("computeExpiringEntries", () => {
  it("includes a capability-level expiry inside the window, with days remaining", () => {
    const entries = computeExpiringEntries(
      inventory([capability({ docs: { expiresAt: "2026-01-15" } })]),
      30,
      NOW,
    )
    expect(entries).toEqual([
      {
        file: "src/user.ts",
        exportName: "userCapability",
        field: undefined,
        expiresAt: "2026-01-15",
        daysRemaining: 14,
      },
    ])
  })

  it("excludes an expiry beyond the window", () => {
    expect(
      computeExpiringEntries(
        inventory([capability({ docs: { expiresAt: "2027-01-01" } })]),
        30,
        NOW,
      ),
    ).toEqual([])
  })

  it("includes an expiry landing exactly on the window boundary (<=, not <)", () => {
    // 2026-01-31 is exactly 30 days after NOW (2026-01-01).
    const entries = computeExpiringEntries(
      inventory([capability({ docs: { expiresAt: "2026-01-31" } })]),
      30,
      NOW,
    )
    expect(entries.map((e) => e.daysRemaining)).toEqual([30])
  })

  it("applies the window and the unparseable-date skip to field-level expiries too", () => {
    const entries = computeExpiringEntries(
      inventory([
        capability({
          fields: [
            field("inWindow", { expiresAt: "2026-01-10" }),
            field("beyondWindow", { expiresAt: "2030-01-01" }),
            field("notADate", { expiresAt: "eventually" }),
          ],
        }),
      ]),
      30,
      NOW,
    )
    expect(entries.map((e) => e.field)).toEqual([["inWindow"]])
  })

  it("breaks ties in order: daysRemaining, then file, then exportName, then capability-before-field, then field path", () => {
    const entries = computeExpiringEntries(
      inventory([
        capability({
          file: "src/b.ts",
          exportName: "cap",
          // capability itself + two fields, all the same day: the cap entry must
          // sort first, then the fields by their "."-joined path ("a.b" < "ab")
          docs: { expiresAt: "2026-01-10" },
          fields: [
            { ...field("_", { expiresAt: "2026-01-10" }), path: ["ab"] },
            { ...field("_", { expiresAt: "2026-01-10" }), path: ["a", "b"] },
          ],
        }),
        capability({ file: "src/a.ts", exportName: "zeta", docs: { expiresAt: "2026-01-10" } }),
        capability({ file: "src/a.ts", exportName: "alpha", docs: { expiresAt: "2026-01-10" } }),
        // strictly sooner -> first regardless of file/name
        capability({ file: "src/z.ts", exportName: "zzz", docs: { expiresAt: "2026-01-05" } }),
      ]),
      30,
      NOW,
    )
    expect(
      entries.map((e) => `${e.file}#${e.exportName}${e.field ? `.${e.field.join(".")}` : ""}`),
    ).toEqual([
      "src/z.ts#zzz",
      "src/a.ts#alpha",
      "src/a.ts#zeta",
      "src/b.ts#cap",
      "src/b.ts#cap.a.b",
      "src/b.ts#cap.ab",
    ])
  })

  it("sorts a capability's own expiry before a same-day field expiry whose name would otherwise sort first", () => {
    const entries = computeExpiringEntries(
      inventory([
        capability({
          file: "src/user.ts",
          exportName: "userCapability",
          docs: { expiresAt: "2026-01-10" },
          fields: [{ ...field("aaa", { expiresAt: "2026-01-10" }), path: ["aaa"] }],
        }),
      ]),
      30,
      NOW,
    )
    expect(entries.map((e) => e.field)).toEqual([undefined, ["aaa"]])
  })

  it("reports an already-passed expiry with a negative daysRemaining, never dropping it", () => {
    const entries = computeExpiringEntries(
      inventory([capability({ docs: { expiresAt: "2025-12-02" } })]),
      30,
      NOW,
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.daysRemaining).toBe(-30)
  })

  it("sorts soonest-first, so already-expired entries come before upcoming ones", () => {
    const entries = computeExpiringEntries(
      inventory([
        capability({ exportName: "soon", docs: { expiresAt: "2026-01-20" } }),
        capability({ exportName: "past", docs: { expiresAt: "2025-12-01" } }),
      ]),
      30,
      NOW,
    )
    expect(entries.map((e) => e.exportName)).toEqual(["past", "soon"])
  })

  it("addresses a field-level expiry by path, never a flat key string", () => {
    const entries = computeExpiringEntries(
      inventory([capability({ fields: [field("token", { expiresAt: "2026-01-10" })] })]),
      30,
      NOW,
    )
    expect(entries[0]!.field).toEqual(["token"])
  })

  it("never inherits a capability's expiry onto its own fields (one entry, not one per field)", () => {
    // Inheriting would report every field of an expiring capability as
    // separately expiring; the capability's own entry already covers it.
    const entries = computeExpiringEntries(
      inventory([
        capability({
          docs: { expiresAt: "2026-01-10" },
          fields: [field("a"), field("b"), field("c")],
        }),
      ]),
      30,
      NOW,
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.field).toBeUndefined()
  })

  it("skips an unparseable expiresAt entirely rather than reporting it as expired", () => {
    const entries = computeExpiringEntries(
      inventory([capability({ docs: { expiresAt: "whenever we get to it" } })]),
      30,
      NOW,
    )
    expect(entries).toEqual([])
  })

  it("still surfaces an unparseable expiresAt verbatim on the model itself", () => {
    // Skipped for date math, never hidden: the declared value is still
    // visible to a reader, it just isn't counted as a date.
    const model = buildLifecycleModel(
      inventory([capability({ docs: { expiresAt: "whenever we get to it" } })]),
      30,
      NOW,
    )
    expect(model.capabilities[0]!.expiresAt).toBe("whenever we get to it")
    expect(model.expiring).toEqual([])
  })
})
