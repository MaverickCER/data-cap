import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateClaimsModelSchema } from "../../scripts/generate-json-schema.mjs"
import { buildClaimsModel } from "../../src/flow/claims-model.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.resolve(here, "../../schemas/claims-model.schema.json")

describe("published JSON Schema (Claims Model): freshness", () => {
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateClaimsModelSchema(), null, 2)}\n`
    expect(readFileSync(schemaPath, "utf8")).toBe(fresh)
  }, 15000)
})

describe("published JSON Schema (Claims Model): correctness", () => {
  const ajv = new Ajv({ strict: false })
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")) as object)
  const file = "src/profile.ts"
  const flow = buildFlowModel({
    nodes: [
      { kind: "field", scope: file, name: "u.email", status: "static", classification: "pii" },
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
        from: flowNodeId("field", file, "u.email"),
        to: flowNodeId("boundary", "boundary", "http"),
        status: "static",
      },
    ],
    unknowns: [],
  })

  it("an empty model validates", () => {
    expect(
      validate(buildClaimsModel({ flow: buildFlowModel({ nodes: [], edges: [], unknowns: [] }) })),
    ).toBe(true)
  })

  it("a model with reach and policy claims in several verification states validates", () => {
    const model = buildClaimsModel({
      flow,
      policy: buildPolicyModel(flow, [
        { id: "r", appliesTo: { classification: "pii" }, forbidDestinations: ["client-response"] },
      ]),
      observation: buildObservationModel([
        { scope: "t", boundary: { kind: "client-response", name: "http" }, field: "u.email" },
        { scope: "t", boundary: { kind: "api", name: "x" }, field: "u.ghost" },
      ]),
    })
    expect(new Set(model.claims.map((c) => c.verification)).size).toBeGreaterThan(1)
    const ok = validate(model)
    if (!ok) console.error(JSON.stringify(validate.errors, null, 1))
    expect(ok).toBe(true)
  })

  it("rejects an unrecognised verification", () => {
    const bad = JSON.parse(JSON.stringify(buildClaimsModel({ flow }))) as {
      claims: { verification: string }[]
    }
    bad.claims[0]!.verification = "probably"
    expect(validate(bad)).toBe(false)
  })
})
