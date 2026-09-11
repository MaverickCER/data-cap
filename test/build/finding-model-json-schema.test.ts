import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateFindingModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildFindingModel } from "../../src/build/finding-model.js"
import type { ReportFinding } from "../../src/build/findings.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/finding-model.schema.json")

describe("published JSON Schema (Finding Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateFindingModelSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Finding Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
  const validate = ajv.compile(schema)

  it("an empty model validates against the schema", () => {
    const model = buildFindingModel([])
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })

  it("a model covering every location kind validates against the schema", () => {
    const capability = { file: "/project/user.ts", exportName: "userCapability" }
    const findings: ReportFinding[] = [
      {
        code: "MANIFEST_EXPORT_NAME_COLLISION",
        family: "structural",
        severity: "error",
        message: "no capability",
      },
      {
        code: "CAPABILITY_MISSING_OWNER",
        family: "governance",
        severity: "warning",
        message: "capability only",
        capability,
      },
      {
        code: "UNCONSUMED_FIELD",
        family: "usage",
        severity: "warning",
        message: "field",
        capability,
        field: ["email"],
      },
      {
        code: "UNRESOLVED_CONSUMER",
        family: "usage",
        severity: "info",
        message: "consumer",
        capability,
        source: "/project/consumer.ts",
      },
    ]
    const model = buildFindingModel(findings)
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })
})
