import { describe, expect, it } from "vitest"
import {
  buildEvidenceModel,
  EVIDENCE_MODEL_SCHEMA_VERSION,
} from "../../src/build/evidence-model.js"
import { buildLifecycleModel } from "../../src/build/lifecycle-model.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import { buildOwnershipModel } from "../../src/build/ownership-model.js"
import { buildDependencyModel } from "../../src/build/dependency-model.js"
import { buildFindingModel } from "../../src/build/finding-model.js"
import { buildChangeModel } from "../../src/build/change-model.js"
import type { CapabilityInventory } from "../../src/build/inventory.js"
import type { EvidenceProvenance } from "../../src/build/evidence-model.js"
import type { LifecycleModel } from "../../src/build/lifecycle-model.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"

function inventory(): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities: [], warnings: [] }
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

describe("buildEvidenceModel", () => {
  it("stamps schemaVersion, carries capability through, and always auto-populates runtimeContract", () => {
    const model = buildEvidenceModel(
      { capability: inventory(), lifecycle: lifecycleOf(inventory()) },
      provenance(),
    )
    expect(model.schemaVersion).toBe(EVIDENCE_MODEL_SCHEMA_VERSION)
    expect(model.capability).toEqual(inventory())
    expect(model.runtimeContract.policies.length).toBeGreaterThan(0)
  })

  it("leaves every optional project-varying model undefined when not supplied", () => {
    const model = buildEvidenceModel(
      { capability: inventory(), lifecycle: lifecycleOf(inventory()) },
      provenance(),
    )
    expect(model.dependency).toBeUndefined()
    expect(model.ownership).toBeUndefined()
    expect(model.finding).toBeUndefined()
    expect(model.change).toBeUndefined()
  })

  it("carries every supplied optional model through unchanged", () => {
    const ownership = buildOwnershipModel(inventory())
    const dependency = buildDependencyModel([])
    const finding = buildFindingModel([])
    const change = buildChangeModel(
      {
        addedCapabilities: [],
        removedCapabilities: [],
        updatedCapabilities: [],
      },
      [],
    )
    const model = buildEvidenceModel(
      {
        capability: inventory(),
        lifecycle: lifecycleOf(inventory()),
        ownership,
        dependency,
        finding,
        change,
      },
      provenance(),
    )
    expect(model.ownership).toBe(ownership)
    expect(model.dependency).toBe(dependency)
    expect(model.finding).toBe(finding)
    expect(model.change).toBe(change)
  })

  it("always carries a required provenance through verbatim, commit included", () => {
    const model = buildEvidenceModel(
      { capability: inventory(), lifecycle: lifecycleOf(inventory()) },
      provenance({ commit: "abc123" }),
    )
    expect(model.provenance).toEqual({
      generatedAt: "2026-01-01T00:00:00.000Z",
      toolVersion: "0.1.0",
      commit: "abc123",
    })
  })

  it("records an absent commit explicitly as undefined, never omitted from the shape", () => {
    const model = buildEvidenceModel(
      { capability: inventory(), lifecycle: lifecycleOf(inventory()) },
      provenance(),
    )
    expect(Object.hasOwn(model.provenance, "commit")).toBe(true)
    expect(model.provenance.commit).toBeUndefined()
  })
})

describe("buildEvidenceModel -- computed flags (OUT-04)", () => {
  it("reports every optional sub-model as not computed when none was supplied", () => {
    const model = buildEvidenceModel(
      { capability: inventory(), lifecycle: lifecycleOf(inventory()) },
      provenance(),
    )
    expect(model.computed).toEqual({
      dependency: false,
      ownership: false,
      finding: false,
      change: false,
      flow: false,
      policy: false,
      observation: false,
      claims: false,
    })
  })

  it("reports every optional sub-model as computed when all were supplied", () => {
    const model = buildEvidenceModel(
      {
        capability: inventory(),
        lifecycle: lifecycleOf(inventory()),
        dependency: buildDependencyModel([]),
        ownership: buildOwnershipModel(inventory()),
        finding: buildFindingModel([]),
        change: buildChangeModel(
          { addedCapabilities: [], removedCapabilities: [], updatedCapabilities: [] },
          [],
        ),
      },
      provenance(),
    )
    expect(model.computed).toEqual({
      dependency: true,
      ownership: true,
      finding: true,
      change: true,
      flow: false,
      policy: false,
      observation: false,
      claims: false,
    })
  })

  it("is true for a pass that ran and found literally nothing -- an empty result is a real result", () => {
    // The whole point of OUT-04: "we scanned and proved zero edges" and "we
    // never scanned" must not serialize identically.
    const dependency = buildDependencyModel([])
    const finding = buildFindingModel([])
    const model = buildEvidenceModel(
      {
        capability: inventory(),
        lifecycle: lifecycleOf(inventory()),
        dependency,
        finding,
      },
      provenance(),
    )
    expect(dependency.edges).toEqual([])
    expect(finding.findings).toEqual([])
    expect(model.computed.dependency).toBe(true)
    expect(model.computed.finding).toBe(true)
  })

  it("distinguishes a per-model absence rather than collapsing to one all-or-nothing flag", () => {
    const model = buildEvidenceModel(
      {
        capability: inventory(),
        lifecycle: lifecycleOf(inventory()),
        ownership: buildOwnershipModel(inventory()),
      },
      provenance(),
    )
    expect(model.computed).toEqual({
      dependency: false,
      ownership: true,
      finding: false,
      change: false,
      flow: false,
      policy: false,
      observation: false,
      claims: false,
    })
  })

  it("keeps `computed` and the sub-model fields consistent for every key", () => {
    const model = buildEvidenceModel(
      {
        capability: inventory(),
        lifecycle: lifecycleOf(inventory()),
        dependency: buildDependencyModel([]),
      },
      provenance(),
    )
    for (const key of [
      "dependency",
      "ownership",
      "finding",
      "change",
      "flow",
      "policy",
      "observation",
      "claims",
    ] as const) {
      expect(model.computed[key]).toBe(model[key] !== undefined)
    }
  })

  it("has no flag for the always-populated models -- a flag that could only read true says nothing", () => {
    const model = buildEvidenceModel(
      { capability: inventory(), lifecycle: lifecycleOf(inventory()) },
      provenance(),
    )
    expect(Object.keys(model.computed).sort()).toEqual([
      "change",
      "claims",
      "dependency",
      "finding",
      "flow",
      "observation",
      "ownership",
      "policy",
    ])
  })
})

describe("buildEvidenceModel -- flow, policy, observation and claims (ADR 0070)", () => {
  const FILE = "src/user.ts"
  const flow = buildFlowModel({
    nodes: [
      {
        kind: "field",
        scope: FILE,
        name: "userData.email",
        status: "static",
        classification: "pii",
      },
      {
        kind: "boundary",
        scope: "boundary",
        name: "http-response",
        status: "declared",
        boundaryKind: "client-response",
      },
    ],
    edges: [
      {
        kind: "side-effect",
        from: flowNodeId("field", FILE, "userData.email"),
        to: flowNodeId("boundary", "boundary", "http-response"),
        status: "static",
      },
    ],
    unknowns: [],
  })
  const base = { capability: inventory(), lifecycle: lifecycleOf(inventory()) }

  it("is schema version 3", () => {
    expect(EVIDENCE_MODEL_SCHEMA_VERSION).toBe(3)
  })

  it("leaves flow, policy, observation and claims undefined when not supplied", () => {
    const model = buildEvidenceModel(base, provenance())
    expect(model.flow).toBeUndefined()
    expect(model.policy).toBeUndefined()
    expect(model.observation).toBeUndefined()
    expect(model.claims).toBeUndefined()
  })

  it("carries a supplied flow model through and derives claims from it", () => {
    const model = buildEvidenceModel({ ...base, flow }, provenance())
    expect(model.flow).toBe(flow)
    expect(model.computed.flow).toBe(true)
    expect(model.computed.claims).toBe(true)
    expect(model.claims?.claims.map((c) => c.kind)).toEqual(["field-reaches-boundary"])
  })

  it("derives claims from flow plus policy plus observation, never from caller-supplied claims", () => {
    const policy = buildPolicyModel(flow, [
      { id: "pii", appliesTo: { classification: "pii" }, forbidDestinations: ["client-response"] },
    ])
    const observation = buildObservationModel([
      {
        scope: "test:a",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData.email",
      },
    ])
    const model = buildEvidenceModel({ ...base, flow, policy, observation }, provenance())
    expect(model.computed).toMatchObject({
      flow: true,
      policy: true,
      observation: true,
      claims: true,
    })
    expect(model.claims?.summary.verified).toBe(1)
    expect(model.claims?.summary.contradicted).toBe(1)
  })

  it("does not compute claims without a flow model, even if observations were supplied", () => {
    const model = buildEvidenceModel(
      { ...base, observation: buildObservationModel([]) },
      provenance(),
    )
    expect(model.computed.observation).toBe(true)
    expect(model.computed.claims).toBe(false)
    expect(model.claims).toBeUndefined()
  })

  it("rejects policy supplied without a flow model it could have been evaluated against", () => {
    const policy = buildPolicyModel(flow, [])
    expect(() => buildEvidenceModel({ ...base, policy }, provenance())).toThrow(/flow/)
  })

  it("is JSON-round-trippable with the new sub-models present", () => {
    const model = buildEvidenceModel({ ...base, flow }, provenance())
    expect(JSON.parse(JSON.stringify(model))).toEqual(JSON.parse(JSON.stringify(model)))
    expect(
      (JSON.parse(JSON.stringify(model)) as { flow: { nodes: unknown[] } }).flow.nodes,
    ).toHaveLength(2)
  })
})
