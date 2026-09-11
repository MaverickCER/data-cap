import { describe, expect, it } from "vitest"
import type { EvidenceModel, EvidenceProvenance } from "../../src/build/evidence-model.js"
import { buildEvidenceModel } from "../../src/build/evidence-model.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import { buildLifecycleModel } from "../../src/build/lifecycle-model.js"
import {
  defineEvidenceProjection,
  readOnlyMembraneError,
  wrapForTracking,
} from "../../src/evidence/define-evidence-projection.js"

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "user.ts",
    exportName: "userCapability",
    kind: "buildData",
    docs: { owner: "identity-team", sensitivity: "restricted" },
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

function inventory(capabilities: readonly CapabilityNode[] = []): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
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

function evidenceOf(capabilities: readonly CapabilityNode[] = []): EvidenceModel {
  const capabilityModel = inventory(capabilities)
  return buildEvidenceModel(
    {
      capability: capabilityModel,
      lifecycle: buildLifecycleModel(capabilityModel, 30, new Date("2026-01-01T00:00:00.000Z")),
    },
    provenance(),
  )
}

describe("defineEvidenceProjection -- direct call", () => {
  it("returns a callable that computes every schema field against the given evidence", () => {
    const projection = defineEvidenceProjection<{ count: number; toolVersion: string }>({
      count: (evidence) => evidence.capability.capabilities.length,
      toolVersion: (evidence) => evidence.provenance.toolVersion,
    })
    expect(projection(evidenceOf([capability()]))).toEqual({ count: 1, toolVersion: "0.1.0" })
  })

  it("computes a field that reads nothing at all (a constant) without touching the evidence", () => {
    const projection = defineEvidenceProjection<{ disclaimer: string }>({
      disclaimer: () => "presence only",
    })
    expect(projection.project(evidenceOf()).sources.disclaimer).toEqual([])
  })

  it("propagates a projector's own thrown error unchanged, with no wrapping", () => {
    const original = new Error("boom")
    const projection = defineEvidenceProjection<{ bad: never }>({
      bad: () => {
        throw original
      },
    })
    expect(() => projection(evidenceOf())).toThrow(original)
  })
})

describe("defineEvidenceProjection -- .project() provenance", () => {
  it("returns the same value the direct call does, alongside per-field sources", () => {
    const projection = defineEvidenceProjection<{ count: number }>({
      count: (evidence) => evidence.capability.capabilities.length,
    })
    const evidence = evidenceOf([capability()])
    const result = projection.project(evidence)
    expect(result.value).toEqual(projection(evidence))
  })

  it("records every dotted path a projector actually read, sorted", () => {
    const projection = defineEvidenceProjection<{ owner: string | undefined }>({
      owner: (evidence) => evidence.capability.capabilities[0]?.docs?.owner,
    })
    const result = projection.project(evidenceOf([capability()]))
    expect(result.value.owner).toBe("identity-team")
    expect(result.sources.owner).toEqual([
      "capability",
      "capability.capabilities",
      "capability.capabilities.0",
      "capability.capabilities.0.docs",
      "capability.capabilities.0.docs.owner",
    ])
    expect(result.sources.owner).toEqual([...result.sources.owner].sort())
  })

  it("attributes reads per output field, never pooling them across the whole projection", () => {
    const projection = defineEvidenceProjection<{
      capabilityCount: number
      generatedAt: string
    }>({
      capabilityCount: (evidence) => evidence.capability.capabilities.length,
      generatedAt: (evidence) => evidence.provenance.generatedAt,
    })
    const { sources } = projection.project(evidenceOf([capability()]))
    expect(sources.capabilityCount).toEqual(["capability", "capability.capabilities"])
    expect(sources.generatedAt).toEqual(["provenance", "provenance.generatedAt"])
  })

  it("never records an array's own `length` as a read path", () => {
    const projection = defineEvidenceProjection<{ count: number }>({
      count: (evidence) => evidence.capability.capabilities.length,
    })
    const { sources } = projection.project(evidenceOf([capability()]))
    expect(sources.count).not.toContain("capability.capabilities.length")
  })

  it("sorts each field's read paths even when the projector reads them out of order", () => {
    const projection = defineEvidenceProjection<{ mixed: string }>({
      mixed: (evidence) => {
        // read `provenance` first, then `capability` -- insertion order is the
        // reverse of sorted order.
        const gen = evidence.provenance.generatedAt
        const count = evidence.capability.capabilities.length
        return `${gen}:${String(count)}`
      },
    })
    const { sources } = projection.project(evidenceOf([capability()]))
    expect(sources.mixed).toEqual([
      "capability",
      "capability.capabilities",
      "provenance",
      "provenance.generatedAt",
    ])
  })

  it("hands a projector the same wrapper object for a node it reads twice", () => {
    const projection = defineEvidenceProjection<{ stable: boolean }>({
      stable: (evidence) => evidence.capability === evidence.capability,
    })
    expect(projection(evidenceOf([capability()])).stable).toBe(true)
  })

  it("returns primitive leaf values through the membrane unchanged (not wrapped)", () => {
    const projection = defineEvidenceProjection<{ owner: unknown; version: unknown }>({
      owner: (evidence) => evidence.capability.capabilities[0]?.docs?.owner,
      version: (evidence) => evidence.provenance.toolVersion,
    })
    const { value } = projection.project(evidenceOf([capability()]))
    expect(value.owner).toBe("identity-team")
    expect(typeof value.owner).toBe("string")
    expect(value.version).toBe("0.1.0")
  })
})

describe("defineEvidenceProjection -- read-only membrane", () => {
  it("throws TypeError on a top-level assignment inside a projector", () => {
    const projection = defineEvidenceProjection<{ bad: number }>({
      bad: (evidence) => {
        ;(evidence as unknown as { schemaVersion: number }).schemaVersion = 99
        return 0
      },
    })
    expect(() => projection(evidenceOf())).toThrow(readOnlyMembraneError().message)
  })

  it("throws TypeError on a nested mutation inside a projector", () => {
    const projection = defineEvidenceProjection<{ bad: number }>({
      bad: (evidence) => {
        ;(evidence.capability as unknown as { schemaVersion: number }).schemaVersion = 99
        return 0
      },
    })
    expect(() => projection(evidenceOf())).toThrow(readOnlyMembraneError().message)
  })

  it("throws TypeError on a property deletion inside a projector", () => {
    const projection = defineEvidenceProjection<{ bad: number }>({
      bad: (evidence) => {
        delete (evidence as unknown as { provenance?: unknown }).provenance
        return 0
      },
    })
    expect(() => projection(evidenceOf())).toThrow(readOnlyMembraneError().message)
  })

  it("throws TypeError on Object.defineProperty inside a projector", () => {
    const projection = defineEvidenceProjection<{ bad: number }>({
      bad: (evidence) => {
        Object.defineProperty(evidence, "injected", { value: 1 })
        return 0
      },
    })
    expect(() => projection(evidenceOf())).toThrow(readOnlyMembraneError().message)
  })

  it("throws TypeError on Object.setPrototypeOf inside a projector", () => {
    const projection = defineEvidenceProjection<{ bad: number }>({
      bad: (evidence) => {
        Object.setPrototypeOf(evidence, null)
        return 0
      },
    })
    expect(() => projection(evidenceOf())).toThrow(readOnlyMembraneError().message)
  })

  it("leaves the caller's own evidence object untouched (the membrane wraps a clone)", () => {
    const evidence = evidenceOf([capability()])
    const projection = defineEvidenceProjection<{ names: readonly string[] }>({
      names: (e) => e.capability.capabilities.map((c) => c.exportName),
    })
    projection(evidence)
    expect(evidence.capability.capabilities[0]!.exportName).toBe("userCapability")
  })

  it("projects an already-frozen EvidenceModel without throwing", () => {
    const evidence = Object.freeze(evidenceOf([capability()]))
    const projection = defineEvidenceProjection<{ count: number }>({
      count: (e) => e.capability.capabilities.length,
    })
    expect(projection(evidence).count).toBe(1)
  })

  it("carries one exact, pinned message on every membrane TypeError", () => {
    expect(readOnlyMembraneError().message).toBe(
      "EvidenceModel is read-only inside a projector -- a projection must be a pure function of its evidence argument.",
    )
  })
})

describe("wrapForTracking (membrane primitive/cache branches, direct)", () => {
  const ctx = () => ({ paths: new Set<string>(), wrapped: new WeakMap<object, unknown>() })

  it.each([
    ["string", "identity-team"],
    ["number", 42],
    ["boolean", true],
    ["null", null],
    ["undefined", undefined],
  ])("returns a %s primitive as-is, never a proxy of it", (_label, primitive) => {
    expect(wrapForTracking(primitive, ["p"], ctx())).toBe(primitive)
  })

  it("returns the identical wrapper for the same object on a second call (cache hit)", () => {
    const shared = ctx()
    const node = { a: 1 }
    const first = wrapForTracking(node, ["n"], shared)
    const second = wrapForTracking(node, ["n"], shared)
    expect(second).toBe(first)
  })

  it("wraps a distinct object in a fresh membrane that records reads and forbids writes", () => {
    const shared = ctx()
    const wrapped = wrapForTracking({ a: { b: 1 } }, ["n"], shared)
    expect(wrapped.a.b).toBe(1)
    expect([...shared.paths].sort()).toEqual(["n.a", "n.a.b"])
    expect(() => {
      wrapped.a = { b: 9 }
    }).toThrow(readOnlyMembraneError().message)
  })
})
