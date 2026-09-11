import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateRuntimeContractModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildRuntimeContractModel } from "../../src/build/runtime-contract-model.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/runtime-contract-model.schema.json")

describe("published JSON Schema (Runtime Contract Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateRuntimeContractModelSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Runtime Contract Model): correctness", () => {
  it("the real, hand-authored model validates against the schema", () => {
    const ajv = new Ajv({ strict: false })
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
    const validate = ajv.compile(schema)
    const model = buildRuntimeContractModel()
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })
})
