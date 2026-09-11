import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateDependencyModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildDependencyModel } from "../../src/build/dependency-model.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/dependency-model.schema.json")

describe("published JSON Schema (Dependency Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateDependencyModelSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Dependency Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
  const validate = ajv.compile(schema)

  it("a model with no edges validates against the schema", () => {
    const model = buildDependencyModel([])
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })

  it("a model with every relationship/resolution kind validates against the schema", () => {
    const model = buildDependencyModel([
      {
        relationship: "imports",
        from: "/project/a.ts",
        to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
        resolution: "resolved",
        position: undefined,
      },
      {
        relationship: "reads-field",
        from: "/project/b.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
        },
        resolution: "unresolved-consumer",
        position: { line: 12, column: 1 },
      },
      {
        relationship: "calls-getter",
        from: "/project/c.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          operation: "getUser",
        },
        resolution: "indeterminate",
        position: { line: 7, column: 1 },
      },
    ])
    expect(validate(model)).toBe(true)
    if (!validate(model)) console.error(validate.errors)
  })
})
