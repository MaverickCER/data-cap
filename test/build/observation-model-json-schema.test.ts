import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateObservationModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildObservationModel } from "../../src/flow/observation-model.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.resolve(here, "../../schemas/observation-model.schema.json")

describe("published JSON Schema (Observation Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateObservationModelSchema(), null, 2)}\n`
    expect(readFileSync(schemaPath, "utf8")).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Observation Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")) as object)

  it("an empty model validates", () => {
    expect(validate(buildObservationModel([]))).toBe(true)
  })

  it("a model with and without handling validates", () => {
    const model = buildObservationModel([
      {
        scope: "t",
        boundary: { kind: "client-response", name: "http" },
        field: "a.b",
        handling: "masked",
      },
      { scope: "t", boundary: { kind: "log", name: "stdout" }, field: "a.c" },
    ])
    const ok = validate(model)
    if (!ok) console.error(JSON.stringify(validate.errors, null, 1))
    expect(ok).toBe(true)
  })

  it("rejects an observation whose status is not observed", () => {
    const bad = JSON.parse(
      JSON.stringify(
        buildObservationModel([{ scope: "t", boundary: { kind: "api", name: "x" }, field: "a.b" }]),
      ),
    ) as { observations: { status: string }[] }
    bad.observations[0]!.status = "static"
    expect(validate(bad)).toBe(false)
  })
})
