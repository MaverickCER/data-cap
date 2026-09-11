import { describe, expect, it } from "vitest"
import {
  projectAuditEvidence,
  projectClassificationEvidence,
  projectComplianceEvidence,
  projectPrivacyEvidence,
  projectRetentionEvidence,
} from "../../src/build/reference-projections.js"
import { buildEvidenceModel } from "../../src/build/evidence-model.js"
import { buildLifecycleModel } from "../../src/build/lifecycle-model.js"
import { buildOwnershipModel } from "../../src/build/ownership-model.js"
import { buildFindingModel } from "../../src/build/finding-model.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import type { EvidenceProvenance } from "../../src/build/evidence-model.js"
import type { LifecycleModel } from "../../src/build/lifecycle-model.js"

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

function field(
  overrides: Partial<CapabilityNode["fields"][number]> = {},
): CapabilityNode["fields"][number] {
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

/** Provenance is required (OUT-06) -- a fixed, deterministic stamp every test below shares. */
function provenance(overrides: Partial<EvidenceProvenance> = {}): EvidenceProvenance {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    toolVersion: "0.1.0",
    commit: undefined,
    ...overrides,
  }
}

/** Lifecycle Model is a required input (EVD-05) -- a pure projection over whatever inventory the test built. */
function lifecycleOf(capabilityInventory: CapabilityInventory): LifecycleModel {
  return buildLifecycleModel(capabilityInventory, 30, new Date("2026-01-01T00:00:00.000Z"))
}

describe("evidence-family projections", () => {
  it("projectClassificationEvidence lists a capability's declared sensitivity, with the disclaimer", () => {
    const evidence = buildEvidenceModel(
      {
        capability: inventory([capability({ docs: { sensitivity: "restricted" } })]),
        lifecycle: lifecycleOf(inventory([])),
      },
      provenance(),
    )
    const result = projectClassificationEvidence(evidence)
    expect(result.disclaimer).toContain("does not itself establish compliance")
    expect(result.entries).toEqual([
      {
        capability: { file: "/project/user.ts", exportName: "userCapability" },
        field: undefined,
        sensitivity: "restricted",
      },
    ])
  })

  it("projectPrivacyEvidence reports protectionsDocumented false when nothing is documented", () => {
    const evidence = buildEvidenceModel(
      {
        capability: inventory([capability({ docs: { sensitivity: "restricted" } })]),
        lifecycle: lifecycleOf(inventory([])),
      },
      provenance(),
    )
    const result = projectPrivacyEvidence(evidence)
    expect(result.entries[0]!.protectionsDocumented).toBe(false)
  })

  it("projectPrivacyEvidence reports protectionsDocumented true when protections are documented", () => {
    const evidence = buildEvidenceModel(
      {
        capability: inventory([
          capability({ docs: { sensitivity: "restricted", protections: "encrypted at rest" } }),
        ]),
        lifecycle: lifecycleOf(inventory([])),
      },
      provenance(),
    )
    const result = projectPrivacyEvidence(evidence)
    expect(result.entries[0]!.protectionsDocumented).toBe(true)
  })

  it("projectRetentionEvidence lists only capabilities/fields with a declared retention policy", () => {
    const evidence = buildEvidenceModel(
      {
        capability: inventory([
          capability({ docs: { retention: "account lifetime" } }),
          capability({ exportName: "other", docs: undefined }),
        ]),
        lifecycle: lifecycleOf(inventory([])),
      },
      provenance(),
    )
    const result = projectRetentionEvidence(evidence)
    expect(result.entries).toEqual([
      {
        capability: { file: "/project/user.ts", exportName: "userCapability" },
        field: undefined,
        retention: "account lifetime",
      },
    ])
  })

  it("projectClassificationEvidence includes field-level sensitivity and skips capabilities/fields with none", () => {
    const capInv = inventory([
      capability({
        exportName: "a",
        docs: undefined,
        fields: [
          field({ path: ["ssn"], sensitivity: { value: "restricted", declaredOn: "field" } }),
          field({ path: ["nickname"] }),
        ],
      }),
      capability({ exportName: "plain", file: "/project/plain.ts", docs: undefined, fields: [] }),
    ])
    const evidence = buildEvidenceModel(
      { capability: capInv, lifecycle: lifecycleOf(inventory([])) },
      provenance(),
    )
    expect(projectClassificationEvidence(evidence).entries).toEqual([
      {
        capability: { file: "/project/user.ts", exportName: "a" },
        field: ["ssn"],
        sensitivity: "restricted",
      },
    ])
  })

  it("projectPrivacyEvidence reports a field's own protections documentation state", () => {
    const capInv = inventory([
      capability({
        docs: undefined,
        fields: [
          field({
            path: ["ssn"],
            sensitivity: { value: "restricted", declaredOn: "field" },
            docs: { protections: "tokenized" },
          }),
          field({
            path: ["dob"],
            sensitivity: { value: "confidential", declaredOn: "field" },
            docs: undefined,
          }),
        ],
      }),
    ])
    const evidence = buildEvidenceModel(
      { capability: capInv, lifecycle: lifecycleOf(inventory([])) },
      provenance(),
    )
    expect(
      projectPrivacyEvidence(evidence).entries.map((e) => [e.field, e.protectionsDocumented]),
    ).toEqual([
      [["ssn"], true],
      [["dob"], false],
    ])
  })

  it("projectRetentionEvidence includes a field-level retention policy", () => {
    const capInv = inventory([
      capability({
        docs: undefined,
        fields: [
          field({ path: ["ssn"], docs: { retention: "7 years" } }),
          field({ path: ["nickname"], docs: undefined }),
        ],
      }),
    ])
    const evidence = buildEvidenceModel(
      { capability: capInv, lifecycle: lifecycleOf(inventory([])) },
      provenance(),
    )
    expect(projectRetentionEvidence(evidence).entries).toEqual([
      {
        capability: { file: "/project/user.ts", exportName: "userCapability" },
        field: ["ssn"],
        retention: "7 years",
      },
    ])
  })

  it("projectComplianceEvidence surfaces the declared metadata bag, unvalidated", () => {
    const evidence = buildEvidenceModel(
      {
        capability: inventory([
          capability({ docs: { metadata: { regulatory: "GDPR,PCI-DSS" } } }),
          capability({ exportName: "noMeta", file: "/project/n.ts", docs: undefined }),
          capability({ exportName: "emptyDocs", file: "/project/e.ts", docs: {} }),
        ]),
        lifecycle: lifecycleOf(inventory([])),
      },
      provenance(),
    )
    const result = projectComplianceEvidence(evidence)
    expect(result.entries).toEqual([
      {
        capability: { file: "/project/user.ts", exportName: "userCapability" },
        metadata: { regulatory: "GDPR,PCI-DSS" },
      },
    ])
  })

  it("projectAuditEvidence rolls up capability/ownership/finding counts and carries provenance through", () => {
    // team-a owns two, team-b owns one, one is unowned -> owned=3, unowned=1,
    // and neither count equals the other or the number of owner buckets.
    const capInventory = inventory([
      capability({ exportName: "a1", file: "/p/a1.ts", docs: { owner: "team-a" } }),
      capability({ exportName: "a2", file: "/p/a2.ts", docs: { owner: "team-a" } }),
      capability({ exportName: "b1", file: "/p/b1.ts", docs: { owner: "team-b" } }),
      capability({ exportName: "orphan", file: "/p/orphan.ts", docs: undefined }),
    ])
    const evidence = buildEvidenceModel(
      {
        capability: capInventory,
        lifecycle: lifecycleOf(capInventory),
        ownership: buildOwnershipModel(capInventory),
        finding: buildFindingModel([
          {
            code: "CAPABILITY_MISSING_OWNER",
            family: "governance",
            severity: "warning",
            message: "x",
          },
          {
            code: "NONSTANDARD_SENSITIVITY_LEVEL",
            family: "governance",
            severity: "info",
            message: "y",
          },
          {
            code: "CAPABILITY_MISSING_OWNER",
            family: "governance",
            severity: "warning",
            message: "z",
          },
        ]),
      },
      provenance({ commit: "abc123" }),
    )
    const result = projectAuditEvidence(evidence)
    expect(result.capabilityCount).toBe(4)
    expect(result.ownedCapabilities).toBe(3)
    expect(result.unownedCapabilities).toBe(1)
    expect(result.findingsBySeverity).toEqual({ warning: 2, info: 1 })
    expect(result.provenance).toEqual(provenance({ commit: "abc123" }))
  })

  it("every reference projection is a real EvidenceProjection, not a plain function", () => {
    for (const projection of [
      projectClassificationEvidence,
      projectPrivacyEvidence,
      projectRetentionEvidence,
      projectComplianceEvidence,
      projectAuditEvidence,
    ]) {
      expect(projection.project).toBeTypeOf("function")
    }
  })

  it("reports per-output-field provenance -- the point of the schema-object signature (NAM-07)", () => {
    const capInventory = inventory([capability({ docs: { owner: "identity-team" } })])
    const evidence = buildEvidenceModel(
      {
        capability: capInventory,
        lifecycle: lifecycleOf(capInventory),
        ownership: buildOwnershipModel(capInventory),
      },
      provenance(),
    )
    const { value, sources } = projectAuditEvidence.project(evidence)
    expect(value.capabilityCount).toBe(1)
    // A constant field reads nothing; a provenance field reads only
    // provenance; an ownership rollup reads only the Ownership Model. A
    // single monolithic projector could only ever have reported the union.
    expect(sources.disclaimer).toEqual([])
    expect(sources.provenance).toEqual(["provenance"])
    expect(sources.capabilityCount).toEqual(["capability", "capability.capabilities"])
    expect(sources.ownedCapabilities.every((p) => p.startsWith("ownership"))).toBe(true)
  })

  it("projectAuditEvidence leaves ownership/finding counts undefined when those models weren't supplied", () => {
    const evidence = buildEvidenceModel(
      { capability: inventory([capability()]), lifecycle: lifecycleOf(inventory([])) },
      provenance(),
    )
    const result = projectAuditEvidence(evidence)
    expect(result.ownedCapabilities).toBeUndefined()
    expect(result.unownedCapabilities).toBeUndefined()
    expect(result.findingsBySeverity).toBeUndefined()
  })
})
