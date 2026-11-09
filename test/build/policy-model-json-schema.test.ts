import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generatePolicyModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.resolve(here, "../../schemas/policy-model.schema.json")

describe("published JSON Schema (Policy Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generatePolicyModelSchema(), null, 2)}\n`
    expect(readFileSync(schemaPath, "utf8")).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Policy Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")) as object)
  const file = "src/profile.ts"
  const flow = buildFlowModel({
    nodes: [
      { kind: "field", scope: file, name: "User.email", status: "static", classification: "pii" },
      {
        kind: "boundary",
        scope: "boundary",
        name: "http",
        status: "declared",
        boundaryKind: "client-response",
      },
    ],
    edges: [
      {
        kind: "side-effect",
        from: flowNodeId("field", file, "User.email"),
        to: flowNodeId("boundary", "boundary", "http"),
        status: "static",
      },
    ],
    unknowns: [],
  })

  it("an empty model validates", () => {
    expect(validate(buildPolicyModel(flow, []))).toBe(true)
  })

  it("a model with violated, satisfied and indeterminate results validates", () => {
    const model = buildPolicyModel(flow, [
      {
        id: "a",
        appliesTo: { classification: "pii" },
        forbidDestinations: ["client-response"],
        allowedHandling: ["masked"],
        description: "no pii to clients",
      },
      { id: "b", appliesTo: { classification: "secret" }, forbidDestinations: ["log"] },
      { id: "c", appliesTo: { field: "User.email" }, requireHandling: ["masked"] },
    ])
    expect(new Set(model.results.map((r) => r.outcome))).toEqual(
      new Set(["violated", "indeterminate"]),
    )
    const ok = validate(model)
    if (!ok) console.error(JSON.stringify(validate.errors, null, 1))
    expect(ok).toBe(true)
  })

  it("rejects an unrecognised outcome", () => {
    const bad = JSON.parse(
      JSON.stringify(
        buildPolicyModel(flow, [
          {
            id: "a",
            appliesTo: { classification: "pii" },
            forbidDestinations: ["client-response"],
          },
        ]),
      ),
    ) as {
      results: { outcome: string }[]
    }
    bad.results[0]!.outcome = "maybe"
    expect(validate(bad)).toBe(false)
  })
})
