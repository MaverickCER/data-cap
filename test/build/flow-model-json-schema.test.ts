import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateFlowModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.resolve(here, "../../schemas/flow-model.schema.json")

describe("published JSON Schema (Flow Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateFlowModelSchema(), null, 2)}\n`
    expect(readFileSync(schemaPath, "utf8")).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Flow Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
  const validate = ajv.compile(schema)
  const file = "src/profile.ts"

  it("an empty model validates", () => {
    expect(validate(buildFlowModel({ nodes: [], edges: [], unknowns: [] }))).toBe(true)
  })

  it("a model using every node kind, edge kind, status and unknown reason validates", () => {
    const fn = flowNodeId("function", file, "f")
    const field = flowNodeId("field", file, "User.email")
    const boundary = flowNodeId("boundary", "boundary", "http")
    const model = buildFlowModel({
      nodes: [
        {
          kind: "function",
          scope: file,
          name: "f",
          status: "static",
          source: { line: 1, column: 1 },
        },
        { kind: "parameter", scope: file, name: "f.user", status: "inferred" },
        { kind: "return", scope: file, name: "f#return", status: "declared" },
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
          from: fn,
          to: boundary,
          status: "static",
          path: ["email"],
          handling: "masked",
          source: { file, line: 3, column: 4 },
        },
        { kind: "reads", from: field, to: fn, status: "unknown" },
      ],
      unknowns: [
        {
          reason: "dynamic-access",
          source: { file, line: 9, column: 2 },
          subject: fn,
          detail: "obj[key]",
        },
      ],
    })
    const ok = validate(model)
    if (!ok) console.error(JSON.stringify(validate.errors, null, 1))
    expect(ok).toBe(true)
  })

  it("rejects a node with an unrecognised status", () => {
    const model = buildFlowModel({
      nodes: [{ kind: "function", scope: file, name: "f", status: "static" }],
      edges: [],
      unknowns: [],
    })
    const bad = JSON.parse(JSON.stringify(model)) as { nodes: { status: string }[] }
    bad.nodes[0]!.status = "guessed"
    expect(validate(bad)).toBe(false)
  })

  it("rejects a model missing its coverage summary", () => {
    const model = JSON.parse(
      JSON.stringify(buildFlowModel({ nodes: [], edges: [], unknowns: [] })),
    ) as Record<string, unknown>
    delete model["coverage"]
    expect(validate(model)).toBe(false)
  })
})
