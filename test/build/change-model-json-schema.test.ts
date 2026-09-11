import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateChangeModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildChangeModel } from "../../src/build/change-model.js"
import { buildDependencyModel } from "../../src/build/dependency-model.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/change-model.schema.json")

describe("published JSON Schema (Change Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateChangeModelSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Change Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
  const validate = ajv.compile(schema)

  it("a model with no DependencyModel (blastRadius undefined) validates against the schema", () => {
    const model = buildChangeModel(
      {
        addedCapabilities: [],
        removedCapabilities: [],
        updatedCapabilities: [],
      },
      [],
    )
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })

  it("a model with a full diff and blastRadius validates against the schema", () => {
    const capabilities = [
      { file: "/project/user.ts", exportName: "userCapability" },
      { file: "/project/other.ts", exportName: "otherCapability" },
    ]
    const dependencyModel = buildDependencyModel([
      {
        relationship: "reads-field",
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
        },
        resolution: "resolved",
        position: { line: 4, column: 1 },
      },
    ])
    const model = buildChangeModel(
      {
        addedCapabilities: ["/project/user.ts#userCapability"],
        removedCapabilities: ["/project/gone.ts#goneCapability"],
        updatedCapabilities: [
          {
            capability: "/project/other.ts#otherCapability",
            changes: ["became inactive"],
            fields: { added: [], removed: [] },
          },
        ],
      },
      capabilities,
      dependencyModel,
    )
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })
})
