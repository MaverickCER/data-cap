import { describe, expect, expectTypeOf, it } from "vitest"
import { buildData } from "../../src/core/build.js"
import { documentData } from "../../src/core/document.js"
import type {
  CapabilityDocs,
  DataFlowEndpoint,
  FieldDocs,
  OperationDocs,
} from "../../src/core/document.js"

describe("documentData", () => {
  it("is inert -- never throws, for a bare call or a fully-populated docs object", () => {
    const config = { fields: { id: "" } }
    expect(() => {
      documentData(config, {})
    }).not.toThrow()
    expect(() => {
      documentData(config, {
        name: "user",
        description: "A user capability.",
        fields: { id: { description: "The user's unique identifier." } },
      })
    }).not.toThrow()
  })

  it("never throws, even given a config/docs pair that describes mismatched shapes", () => {
    // documentData is never itself evidence that an executable buildData/
    // createData capability exists, and never validates its input at
    // runtime -- that is static-analysis/build tooling's job.
    expect(() => {
      documentData(
        { fields: { id: "" } },
        // @ts-expect-error -- intentionally malformed docs, proving the runtime never validates this
        { fields: { nonExistentField: { description: "..." } } },
      )
    }).not.toThrow()
  })

  it("has no effect on a buildData call over the same config object", () => {
    const config = { fields: { id: "" } }
    documentData(config, { name: "user" })
    const capability = buildData(config)
    expect(capability.fields.id).toBe("")
    expect(capability.info).toEqual({})
  })

  it("accepts the full governance metadata vocabulary (owner/category/exclusiveGroup/active/sensitivity/protections/retention/purpose/legalBasis/dataResidency/auditRequired/metadata) without throwing", () => {
    const config = { fields: { email: "" } }
    expect(() => {
      documentData(config, {
        owner: "identity-team",
        category: "identity",
        exclusiveGroup: "user-backend",
        active: true,
        sensitivity: "restricted",
        protections: "encrypted at rest",
        retention: "account lifetime",
        purpose: "account management",
        legalBasis: "contract",
        dataResidency: ["us", "eu"],
        auditRequired: true,
        // `metadata` is a genuinely arbitrary-shaped bag (Record<string, unknown>)
        // -- a non-string value here proves the widened type, not just presence.
        metadata: { regulatory: "GDPR,PCI-DSS", retentionYears: 7, tags: ["pii"] },
        fields: {
          email: {
            description: "The user's email.",
            owner: "identity-team",
            sensitivity: "confidential",
            protections: "redacted in logs",
            retention: "account lifetime",
            purpose: "delivery notifications",
            legalBasis: "consent",
            dataResidency: "eu",
            auditRequired: true,
            metadata: { internalClassification: "matter-data" },
          },
        },
      })
    }).not.toThrow()
  })

  it("accepts a declared DataFlowEndpoint list on an operation without throwing", () => {
    const config = {
      fields: { email: "" },
      getters: {
        getUser: {
          execute: async () => ({ email: "" }),
          processor: (raw: { email: string }) => raw,
          writes: { email: true } as const,
        },
      },
    }
    expect(() => {
      documentData(config, {
        getters: {
          getUser: {
            description: "Fetches the user.",
            source: "identity-service",
            credentials: "service-to-service token",
            endpoints: [{ direction: "input", kind: "api", name: "identity-service" }],
          },
        },
      })
    }).not.toThrow()
  })

  it("passing the SAME schema object to createData and documentData -- the real name-checking this API is for -- compiles cleanly", () => {
    // Not a throw-behavior test -- see the type-level describe block below
    // for the compile-time proof (a nonexistent getter name is flagged
    // there). This just proves the ergonomic shape works end to end against
    // the same schema object at runtime.
    const userSchema = {
      fields: { email: "" },
      getters: {
        getUser: {
          execute: async () => ({ email: "" }),
          processor: (raw: { email: string }) => raw,
          writes: { email: true } as const,
        },
      },
    }
    expect(() => {
      documentData(userSchema, {
        owner: "identity-team",
        fields: { email: { sensitivity: "restricted" } },
        getters: { getUser: { description: "Fetches the user." } },
      })
    }).not.toThrow()
  })
})

describe("CapabilityDocs / FieldDocs / OperationDocs -- type-level", () => {
  it("every governance field is optional at the capability level, correctly typed", () => {
    type Docs = CapabilityDocs<{ fields: { id: string } }>
    expectTypeOf<Docs["owner"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Docs["category"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Docs["exclusiveGroup"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Docs["active"]>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf<Docs["sensitivity"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Docs["protections"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Docs["retention"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Docs["purpose"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Docs["legalBasis"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Docs["dataResidency"]>().toEqualTypeOf<string | readonly string[] | undefined>()
    expectTypeOf<Docs["auditRequired"]>().toEqualTypeOf<boolean | undefined>()
    // Widened from Record<string, string> -- metadata is a genuinely opaque,
    // arbitrary-shaped extension bag (ADR 0051), not a string-only vocabulary.
    expectTypeOf<Docs["metadata"]>().toEqualTypeOf<Readonly<Record<string, unknown>> | undefined>()
  })

  it("FieldDocs accepts owner/sensitivity/protections/retention/purpose/legalBasis/dataResidency/auditRequired/metadata alongside description", () => {
    expectTypeOf<FieldDocs["description"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<FieldDocs["owner"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<FieldDocs["sensitivity"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<FieldDocs["protections"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<FieldDocs["retention"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<FieldDocs["purpose"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<FieldDocs["legalBasis"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<FieldDocs["dataResidency"]>().toEqualTypeOf<
      string | readonly string[] | undefined
    >()
    expectTypeOf<FieldDocs["auditRequired"]>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf<FieldDocs["metadata"]>().toEqualTypeOf<
      Readonly<Record<string, unknown>> | undefined
    >()
  })

  it("FieldDocs no longer accepts an arbitrary extra property -- metadata is the only extension point", () => {
    // @ts-expect-error -- FieldDocs' old index signature is gone; an
    // unrecognized concept belongs in `metadata`, not as an ad hoc key.
    const invalid: FieldDocs = { notARealFieldDocsKey: "x" }
    // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- satisfies noUnusedLocals for this type-only assertion.
    void invalid
  })

  it("OperationDocs accepts an optional readonly DataFlowEndpoint array and a metadata bag", () => {
    expectTypeOf<OperationDocs["endpoints"]>().toEqualTypeOf<
      readonly DataFlowEndpoint[] | undefined
    >()
    expectTypeOf<OperationDocs["metadata"]>().toEqualTypeOf<
      Readonly<Record<string, unknown>> | undefined
    >()
  })

  it("DataFlowEndpoint's direction/kind are closed string unions, not bare string", () => {
    expectTypeOf<DataFlowEndpoint["direction"]>().toEqualTypeOf<"input" | "output">()
    // @ts-expect-error -- direction is not an arbitrary string
    const invalid: DataFlowEndpoint["direction"] = "sideways"
    // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- satisfies noUnusedLocals for this type-only assertion.
    void invalid
  })

  it("documenting a getter/mutator/subscription name is checked against the real schema when the SAME schema object is passed to createData and documentData", () => {
    const userSchema = {
      fields: { email: "" },
      getters: {
        getUser: {
          execute: async () => ({ email: "" }),
          processor: (raw: { email: string }) => raw,
          writes: { email: true } as const,
        },
      },
      mutators: {
        updateEmail: {
          execute: async () => ({ email: "" }),
          processor: (raw: { email: string }) => raw,
          writes: { email: true } as const,
        },
      },
    }
    // A real getter/mutator name is accepted.
    documentData(userSchema, {
      getters: { getUser: { description: "Fetches the user." } },
      mutators: { updateEmail: { description: "Updates the email." } },
    })
    documentData(userSchema, {
      // @ts-expect-error -- "getPost" doesn't exist on userSchema's own getters
      getters: { getPost: { description: "Not a real getter on this schema." } },
    })
    documentData(userSchema, {
      // @ts-expect-error -- "deleteUser" doesn't exist on userSchema's own mutators
      mutators: { deleteUser: { description: "Not a real mutator on this schema." } },
    })
  })

  it("a fields-only config (no operations declared) can't document any getter/mutator/subscription name -- there's nothing to check it against", () => {
    const fieldsOnly = { fields: { email: "" } }
    documentData(fieldsOnly, {}) // no operations section at all -- fine
    documentData(fieldsOnly, {
      // @ts-expect-error -- fieldsOnly declares no getters, so no getter name can be documented
      getters: { getUser: { description: "..." } },
    })
  })
})
