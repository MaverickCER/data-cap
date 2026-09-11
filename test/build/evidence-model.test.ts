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
    for (const key of ["dependency", "ownership", "finding", "change"] as const) {
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
      "dependency",
      "finding",
      "ownership",
    ])
  })
})
