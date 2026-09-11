import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateOwnershipModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildOwnershipModel } from "../../src/build/ownership-model.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/ownership-model.schema.json")

describe("published JSON Schema (Ownership Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateOwnershipModelSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Ownership Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
  const validate = ajv.compile(schema)

  it("an empty model validates against the schema", () => {
    const model = buildOwnershipModel({
      schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
      capabilities: [],
      warnings: [],
    })
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })

  it("a model with owned and unowned capabilities/fields validates against the schema", () => {
    const model = buildOwnershipModel({
      schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
      capabilities: [
        {
          file: "/project/user.ts",
          exportName: "userCapability",
          kind: "buildData",
          docs: { owner: "identity-team" },
          active: true,
          exclusiveGroup: undefined,
          declarationPosition: { line: 1, column: 1 },
          fields: [
            {
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
            },
          ],
          getters: [],
          mutators: [],
          subscriptions: [],
        },
      ],
      warnings: [],
    })
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })
})
