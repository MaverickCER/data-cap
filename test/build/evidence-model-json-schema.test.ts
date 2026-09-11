import Ajv from "ajv"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { generateEvidenceModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildChangeModel } from "../../src/build/change-model.js"
import { buildDependencyModel } from "../../src/build/dependency-model.js"
import type { EvidenceProvenance } from "../../src/build/evidence-model.js"
import { buildEvidenceModel } from "../../src/build/evidence-model.js"
import { buildFindingModel } from "../../src/build/finding-model.js"
import type { CapabilityInventory } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { LifecycleModel } from "../../src/build/lifecycle-model.js"
import { buildLifecycleModel } from "../../src/build/lifecycle-model.js"
import { buildOwnershipModel } from "../../src/build/ownership-model.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/evidence-model.schema.json")

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

describe("published JSON Schema (Evidence Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateEvidenceModelSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Evidence Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
  const validate = ajv.compile(schema)

  it("a minimal model (capability only) validates against the schema", () => {
    const model = buildEvidenceModel(
      { capability: inventory(), lifecycle: lifecycleOf(inventory()) },
      provenance(),
    )
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })

  it("a fully-composed model, with provenance, validates against the schema", () => {
    const model = buildEvidenceModel(
      {
        capability: inventory(),
        lifecycle: lifecycleOf(inventory()),
        dependency: buildDependencyModel([]),
        ownership: buildOwnershipModel(inventory()),
        finding: buildFindingModel([]),
        change: buildChangeModel(
          {
            addedCapabilities: [],
            removedCapabilities: [],
            updatedCapabilities: [],
          },
          [],
        ),
      },
      provenance({ commit: "abc123" }),
    )
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })
})
