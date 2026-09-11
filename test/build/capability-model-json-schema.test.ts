import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateCapabilityModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildInventory } from "../../src/build/inventory.js"
import type { DiscoveredCapability } from "../../src/build/link.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/capability-model.schema.json")

describe("published JSON Schema (Capability Model): freshness", () => {
  // Same rationale as test/build/json-schema.test.ts's freshness test --
  // ts-json-schema-generator runs a real TypeScript program/type-check,
  // slow enough under v8 coverage instrumentation to exceed vitest's
  // default 5000ms test timeout.
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateCapabilityModelSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Capability Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
  const validate = ajv.compile(schema)

  function discovered(overrides: Partial<DiscoveredCapability> = {}): DiscoveredCapability {
    return {
      file: "/project/user.ts",
      exportName: "userCapability",
      kind: "buildData",
      fieldsShape: undefined,
      operationNames: undefined,
      operationWrites: undefined,
      operationPresence: undefined,
      declarationPosition: { line: 1, column: 1 },
      fieldPositions: undefined,
      documentedBy: undefined,
      docs: undefined,
      ...overrides,
    }
  }

  it("a bare capability with no fields/operations validates against the schema", () => {
    const inventory = buildInventory({
      root: "/project",
      capabilities: [discovered()],
      warnings: [],
    })
    expect(validate(inventory)).toBe(true)
    if (!validate(inventory)) console.error(validate.errors)
  })

  it("a fully-populated capability (fields, every operation kind, docs, endpoints) validates against the schema", () => {
    const inventory = buildInventory({
      root: "/project",
      capabilities: [
        discovered({
          kind: "createData",
          fieldsShape: { cardToken: "" },
          operationNames: { getters: ["getCard"], mutators: ["updateCard"], subscriptions: [] },
          operationWrites: {
            getters: [{ name: "getCard", writes: true }],
            mutators: [{ name: "updateCard", writes: { cardToken: true } }],
            subscriptions: [],
          },
          operationPresence: {
            getters: [{ name: "getCard", hasProcessor: true, hasOptimistic: false }],
            mutators: [{ name: "updateCard", hasProcessor: false, hasOptimistic: true }],
            subscriptions: [],
          },
          docs: {
            owner: "payments-team",
            sensitivity: "restricted",
            active: true,
            fields: { cardToken: { sensitivity: "restricted", protections: "tokenized" } },
            getters: {
              getCard: {
                description: "Fetches the card token.",
                endpoints: [{ direction: "input", kind: "api", name: "stripe-api" }],
              },
            },
          },
        }),
      ],
      warnings: [{ file: "/project/user.ts", message: "example warning" }],
    })
    expect(validate(inventory)).toBe(true)
    if (!validate(inventory)) console.error(validate.errors)
  })
})
