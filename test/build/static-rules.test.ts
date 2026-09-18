import { describe, expect, it } from "vitest"
import { checkOwnershipAndSensitivity } from "../../src/build/static-rules.js"
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

/** A resolved governance value declared directly on the field itself (ADR 0057). */
function ownField<T>(value: T): { value: T; declaredOn: "field" } {
  return { value, declaredOn: "field" }
}

/** A resolved governance value inherited from the capability, with no per-field override (ADR 0057). */
function inheritedFromCapability<T>(value: T): { value: T; declaredOn: "capability" } {
  return { value, declaredOn: "capability" }
}

describe("checkOwnershipAndSensitivity -- capability-level", () => {
  it("flags a capability with no owner", () => {
    const findings = checkOwnershipAndSensitivity(inventory([capability()]))
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "CAPABILITY_MISSING_OWNER", severity: "warning" }),
    )
  })

  it("does not flag a capability with a declared owner", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ docs: { owner: "identity-team" } })]),
    )
    expect(findings.some((f) => f.code === "CAPABILITY_MISSING_OWNER")).toBe(false)
  })

  it("does not raise a sensitivity finding when sensitivity is undeclared", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ docs: { owner: "identity-team" } })]),
    )
    expect(findings).toEqual([])
  })

  it("flags a sensitive capability with no documented protections", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ docs: { owner: "identity-team", sensitivity: "restricted" } })]),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS",
        family: "governance",
        severity: "warning",
      }),
    )
  })

  it("does not flag a sensitive capability with documented protections", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: {
            owner: "identity-team",
            sensitivity: "restricted",
            protections: "encrypted at rest",
          },
        }),
      ]),
    )
    expect(findings.some((f) => f.code === "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS")).toBe(false)
  })

  it("flags a non-standard sensitivity level as info, alongside (not instead of) the protections check", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ docs: { owner: "identity-team", sensitivity: "top-secret" } })]),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "NONSTANDARD_SENSITIVITY_LEVEL", severity: "info" }),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS" }),
    )
  })

  it.each(["public", "internal", "confidential", "restricted"])(
    "does not flag the standard sensitivity level %s as non-standard",
    (level) => {
      const findings = checkOwnershipAndSensitivity(
        inventory([
          capability({
            docs: { owner: "identity-team", sensitivity: level, protections: "x" },
          }),
        ]),
      )
      expect(findings.some((f) => f.code === "NONSTANDARD_SENSITIVITY_LEVEL")).toBe(false)
    },
  )
})

describe("checkOwnershipAndSensitivity -- field-level", () => {
  it("ignores a field with no declared sensitivity", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ docs: { owner: "x" }, fields: [field({ docs: undefined })] })]),
    )
    expect(findings).toEqual([])
  })

  it("flags a sensitive field with no documented protections", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "x" },
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "confidential" },
              sensitivity: ownField("confidential"),
            }),
          ],
        }),
      ]),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "SENSITIVE_FIELD_MISSING_PROTECTIONS",
        family: "governance",
        severity: "warning",
        field: ["email"],
      }),
    )
  })

  it("does not flag a sensitive field with documented protections", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "x" },
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "confidential", protections: "redacted in logs" },
              sensitivity: ownField("confidential"),
            }),
          ],
        }),
      ]),
    )
    expect(findings.some((f) => f.code === "SENSITIVE_FIELD_MISSING_PROTECTIONS")).toBe(false)
  })

  it("flags a non-standard field-level sensitivity as info", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "x" },
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "super-secret" },
              sensitivity: ownField("super-secret"),
            }),
          ],
        }),
      ]),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "NONSTANDARD_SENSITIVITY_LEVEL", field: ["email"] }),
    )
  })

  it("evaluates every field independently across multiple capabilities", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          exportName: "a",
          docs: { owner: "x" },
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "confidential" },
              sensitivity: ownField("confidential"),
            }),
          ],
        }),
        capability({
          exportName: "b",
          docs: { owner: "x" },
          fields: [
            field({
              path: ["ssn"],
              docs: { sensitivity: "restricted" },
              sensitivity: ownField("restricted"),
            }),
          ],
        }),
      ]),
    )
    expect(findings.filter((f) => f.code === "SENSITIVE_FIELD_MISSING_PROTECTIONS")).toHaveLength(2)
  })
})

describe("checkOwnershipAndSensitivity -- purpose/legalBasis/auditRequired (ADR 0051)", () => {
  it("flags a sensitive field with no declared purpose or legal basis (own or inherited)", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "x" },
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "confidential" },
              sensitivity: ownField("confidential"),
            }),
          ],
        }),
      ]),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "SENSITIVE_FIELD_MISSING_PURPOSE", field: ["email"] }),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "SENSITIVE_FIELD_MISSING_LEGAL_BASIS", field: ["email"] }),
    )
  })

  it("does not flag a sensitive field whose purpose/legalBasis resolve from the capability level", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "x", purpose: "case management", legalBasis: "contract" },
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "confidential" },
              sensitivity: ownField("confidential"),
              purpose: inheritedFromCapability("case management"),
              legalBasis: inheritedFromCapability("contract"),
            }),
          ],
        }),
      ]),
    )
    expect(findings.some((f) => f.code === "SENSITIVE_FIELD_MISSING_PURPOSE")).toBe(false)
    expect(findings.some((f) => f.code === "SENSITIVE_FIELD_MISSING_LEGAL_BASIS")).toBe(false)
  })

  it("does not flag purpose/legalBasis for a non-sensitive field (own declared sensitivity absent)", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ docs: { owner: "x" }, fields: [field({ path: ["email"] })] })]),
    )
    expect(findings).toEqual([])
  })

  it("flags a field with auditRequired but no resolvable owner", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          fields: [field({ path: ["email"], auditRequired: ownField(true) })],
        }),
      ]),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "AUDIT_REQUIRED_WITHOUT_OWNER", field: ["email"] }),
    )
  })

  it("does not flag auditRequired when an owner resolves (own or inherited)", () => {
    // `field.owner` here is already the RESOLVED value (as inventory.ts's
    // own fallback would produce it) -- checkFieldGovernance reads the
    // resolved field, it doesn't re-derive the fallback itself.
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "x" },
          fields: [
            field({
              path: ["email"],
              owner: inheritedFromCapability("x"),
              auditRequired: ownField(true),
            }),
          ],
        }),
      ]),
    )
    expect(findings.some((f) => f.code === "AUDIT_REQUIRED_WITHOUT_OWNER")).toBe(false)
  })

  it("flags a capability with auditRequired but no owner", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ docs: { auditRequired: true } })]),
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "AUDIT_REQUIRED_WITHOUT_OWNER" }),
    )
    // The capability-level finding has no `field` ref -- confirms it's the
    // capability check firing, not a field-level one leaking through.
    const auditFinding = findings.find((f) => f.code === "AUDIT_REQUIRED_WITHOUT_OWNER")
    expect(auditFinding?.field).toBeUndefined()
  })

  it("does not flag a capability with auditRequired when it has an owner", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ docs: { owner: "x", auditRequired: true } })]),
    )
    expect(findings.some((f) => f.code === "AUDIT_REQUIRED_WITHOUT_OWNER")).toBe(false)
  })

  it("populates position from the capability's own declaration position for a capability-level finding (ADR 0052)", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([capability({ declarationPosition: { line: 7, column: 1 } })]),
    )
    expect(findings.find((f) => f.code === "CAPABILITY_MISSING_OWNER")?.position).toEqual({
      line: 7,
      column: 1,
    })
  })

  it("never attaches a position key to a field-level sensitivity finding when the field has none", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "x" },
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "confidential" },
              sensitivity: ownField("confidential"),
              declarationPosition: undefined,
            }),
          ],
        }),
      ]),
    )
    const finding = findings.find((f) => f.code === "SENSITIVE_FIELD_MISSING_PROTECTIONS")
    expect(finding).toBeDefined()
    expect("position" in (finding ?? {})).toBe(false)
  })

  it("never attaches a position key to a field-level governance finding when the field has none", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              sensitivity: ownField("confidential"),
              declarationPosition: undefined,
            }),
          ],
        }),
      ]),
    )
    const finding = findings.find((f) => f.code === "SENSITIVE_FIELD_MISSING_PURPOSE")
    expect(finding).toBeDefined()
    expect("position" in (finding ?? {})).toBe(false)
  })

  it("populates position from the field's own declaration position for a field-level finding", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "x" },
          fields: [
            field({
              path: ["email"],
              docs: { sensitivity: "confidential" },
              sensitivity: ownField("confidential"),
              declarationPosition: { line: 12, column: 5 },
            }),
          ],
        }),
      ]),
    )
    expect(
      findings.find((f) => f.code === "SENSITIVE_FIELD_MISSING_PROTECTIONS")?.position,
    ).toEqual({ line: 12, column: 5 })
  })
})

describe("checkOwnershipAndSensitivity -- finding family (NAM-12)", () => {
  it('labels every finding this pass emits family "governance", never another pass\'s family', () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { sensitivity: "made-up-level", auditRequired: true },
          fields: [field({ sensitivity: { value: "restricted", declaredOn: "field" } })],
        }),
      ]),
    )
    expect(findings.length).toBeGreaterThan(0)
    expect([...new Set(findings.map((f) => f.family))]).toEqual(["governance"])
  })
})

describe("checkOwnershipAndSensitivity -- every finding, verbatim", () => {
  it("emits the capability-level findings exactly", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          file: "/p/user.ts",
          exportName: "userCapability",
          declarationPosition: { line: 4, column: 2 },
          docs: { sensitivity: "top-secret", auditRequired: true },
        }),
      ]),
    )
    const ref = {
      capability: { file: "/p/user.ts", exportName: "userCapability" },
      position: { line: 4, column: 2 },
    }
    expect(findings).toEqual([
      {
        code: "CAPABILITY_MISSING_OWNER",
        family: "governance",
        severity: "warning",
        message: '"userCapability" has no documented owner.',
        ...ref,
      },
      {
        code: "NONSTANDARD_SENSITIVITY_LEVEL",
        family: "governance",
        severity: "info",
        message:
          '"userCapability" declares sensitivity "top-secret", which isn\'t one of the standard levels (public/internal/confidential/restricted) -- still honored, just flagged for vocabulary drift.',
        ...ref,
      },
      {
        code: "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS",
        family: "governance",
        severity: "warning",
        message:
          '"userCapability" declares sensitivity "top-secret" but no documented protections.',
        ...ref,
      },
      {
        code: "AUDIT_REQUIRED_WITHOUT_OWNER",
        family: "governance",
        severity: "warning",
        message:
          '"userCapability" declares auditRequired but has no documented owner to hold accountable for that audit trail.',
        ...ref,
      },
    ])
  })

  it("emits the field-level findings exactly, using the dotted field path", () => {
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          file: "/p/user.ts",
          exportName: "userCapability",
          docs: { owner: "team" },
          fields: [
            field({
              path: ["contact", "email"],
              declarationPosition: { line: 9, column: 3 },
              sensitivity: ownField("hush-hush"),
              auditRequired: { value: true, declaredOn: "field" },
            }),
          ],
        }),
      ]),
    )
    const ref = {
      capability: { file: "/p/user.ts", exportName: "userCapability" },
      field: ["contact", "email"],
      position: { line: 9, column: 3 },
    }
    expect(findings).toEqual([
      {
        code: "NONSTANDARD_SENSITIVITY_LEVEL",
        family: "governance",
        severity: "info",
        message:
          'Field "contact.email" on "userCapability" declares sensitivity "hush-hush", which isn\'t one of the standard levels (public/internal/confidential/restricted) -- still honored, just flagged for vocabulary drift.',
        ...ref,
      },
      {
        code: "SENSITIVE_FIELD_MISSING_PROTECTIONS",
        family: "governance",
        severity: "warning",
        message:
          'Field "contact.email" on "userCapability" declares sensitivity "hush-hush" but no documented protections.',
        ...ref,
      },
      {
        code: "SENSITIVE_FIELD_MISSING_PURPOSE",
        family: "governance",
        severity: "warning",
        message:
          'Field "contact.email" on "userCapability" declares sensitivity "hush-hush" but no declared purpose (own or inherited).',
        ...ref,
      },
      {
        code: "SENSITIVE_FIELD_MISSING_LEGAL_BASIS",
        family: "governance",
        severity: "warning",
        message:
          'Field "contact.email" on "userCapability" declares sensitivity "hush-hush" but no declared legal basis (own or inherited).',
        ...ref,
      },
      {
        code: "AUDIT_REQUIRED_WITHOUT_OWNER",
        family: "governance",
        severity: "warning",
        message:
          'Field "contact.email" on "userCapability" declares auditRequired but has no documented owner (own or inherited) to hold accountable for that audit trail.',
        ...ref,
      },
    ])
  })

  it.each(["public", "internal", "confidential", "restricted"])(
    "treats %s as a standard sensitivity level (no NONSTANDARD finding)",
    (level) => {
      const findings = checkOwnershipAndSensitivity(
        inventory([capability({ docs: { owner: "t", sensitivity: level, protections: "p" } })]),
      )
      expect(findings).toEqual([])
    },
  )

  it.each(["public", "internal", "confidential", "restricted"])(
    "treats %s as a standard sensitivity level at the FIELD level too",
    (level) => {
      const findings = checkOwnershipAndSensitivity(
        inventory([
          capability({
            docs: { owner: "t" },
            fields: [
              field({
                docs: { protections: "p", purpose: "p", legalBasis: "l" },
                sensitivity: ownField(level),
                purpose: ownField("p"),
                legalBasis: ownField("l"),
              }),
            ],
          }),
        ]),
      )
      expect(findings.some((f) => f.code === "NONSTANDARD_SENSITIVITY_LEVEL")).toBe(false)
    },
  )

  it("does not fire field-level sensitivity findings for a value only inherited from the capability", () => {
    // `checkCapabilitySensitivity` already covers the capability once; firing
    // per-field on the inherited value would duplicate it for every field.
    const findings = checkOwnershipAndSensitivity(
      inventory([
        capability({
          docs: { owner: "t", sensitivity: "made-up", protections: "p" },
          fields: [
            field({
              path: ["email"],
              sensitivity: inheritedFromCapability("made-up"),
            }),
          ],
        }),
      ]),
    )
    expect(findings.filter((f) => f.field !== undefined)).toEqual([])
  })
})
