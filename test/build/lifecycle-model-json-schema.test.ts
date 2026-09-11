import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateLifecycleModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildLifecycleModel } from "../../src/build/lifecycle-model.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { CapabilityInventory } from "../../src/build/inventory.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/lifecycle-model.schema.json")

const NOW = new Date("2026-01-01T00:00:00.000Z")

describe("published JSON Schema (Lifecycle Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateLifecycleModelSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Lifecycle Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
  const validate = ajv.compile(schema)

  it("an empty model validates against the schema", () => {
    const inventory: CapabilityInventory = {
      schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
      capabilities: [],
      warnings: [],
    }
    const model = buildLifecycleModel(inventory, 30, NOW)
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })

  it("a model with every lifecycle property populated validates against the schema", () => {
    const inventory: CapabilityInventory = {
      schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
      capabilities: [
        {
          file: "src/user.ts",
          exportName: "userCapability",
          kind: "buildData",
          docs: {
            expiresAt: "2026-01-15",
            deprecated: true,
            deprecatedReason: "superseded by profileData",
            retention: "account lifetime",
          },
          active: true,
          exclusiveGroup: undefined,
          declarationPosition: { line: 1, column: 1 },
          fields: [
            {
              path: ["contactEmail"],
              docs: {
                expiresAt: "2026-01-10",
                deprecated: true,
                deprecatedReason: "use profile.email",
                removeBy: "2026-06-01",
                renamedFrom: "email",
                retention: "delete after 90 days",
              },
              owner: { value: undefined, declaredOn: undefined },
              sensitivity: { value: undefined, declaredOn: undefined },
              purpose: { value: undefined, declaredOn: undefined },
              legalBasis: { value: undefined, declaredOn: undefined },
              dataResidency: { value: undefined, declaredOn: undefined },
              auditRequired: { value: undefined, declaredOn: undefined },
              declarationPosition: undefined,
              writtenBy: [],
              shape: "",
            },
          ],
          getters: [],
          mutators: [],
          subscriptions: [],
        },
      ],
      warnings: [],
    }
    const model = buildLifecycleModel(inventory, 30, NOW)
    expect(model.expiring).toHaveLength(2)
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })
})
