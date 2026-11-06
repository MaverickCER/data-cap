import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv-draft-04"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildFindingModel } from "../../src/build/finding-model.js"
import { buildSarifLog } from "../../src/build/sarif.js"
import type { SarifLog } from "../../src/build/sarif.js"
import { profileFixture } from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const sarifSchema = JSON.parse(
  readFileSync(path.join(here, "../fixtures/standards/sarif-schema-2.1.0.json"), "utf8"),
) as object

describe("buildSarifLog with flow evidence (ADR 0070)", () => {
  let fixture: FlowEvidenceFixture
  let log: SarifLog

  beforeAll(async () => {
    fixture = await profileFixture()
    log = buildSarifLog(fixture.evidence.finding!, { flow: fixture.evidence.flow })
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  const results = (ruleId: string) =>
    log.runs[0]!.results.filter((result) => result.ruleId === ruleId)

  it("is valid against the official SARIF 2.1.0 schema", () => {
    const validate = new Ajv({ strict: false, allErrors: true }).compile(sarifSchema)
    const ok = validate(log)
    if (!ok) console.error(JSON.stringify(validate.errors?.slice(0, 5), null, 1))
    expect(ok).toBe(true)
  })

  it("is still valid when no flow is supplied (the existing behaviour)", () => {
    const plain = buildSarifLog(fixture.evidence.finding!)
    expect(new Ajv({ strict: false }).compile(sarifSchema)(plain)).toBe(true)
  })

  it("anchors a policy violation at the code that sends the data, with a region", () => {
    const [violation] = results("FLOW_POLICY_VIOLATED")
    expect(violation).toBeDefined()
    const location = violation?.locations?.[0]?.physicalLocation
    expect(location?.artifactLocation).toEqual({ uri: "app/export.ts", uriBaseId: "%SRCROOT%" })
    expect(location?.region).toEqual({ startLine: 4, startColumn: 3 })
  })

  it("gives a policy violation a codeFlow: the steps from the data's source to where it leaves", () => {
    const [violation] = results("FLOW_POLICY_VIOLATED")
    const flow = violation?.codeFlows?.[0]?.threadFlows[0]?.locations ?? []
    expect(flow.length).toBeGreaterThan(0)
    for (const step of flow) {
      expect(step.location.physicalLocation.artifactLocation.uri).toMatch(/\.ts$/)
      expect(step.location.message.text.length).toBeGreaterThan(0)
    }
    expect(flow.at(-1)?.location.message.text).toContain("side-effect")
  })

  it("points an incomplete-analysis finding at the exact unresolved call", () => {
    const [incomplete] = results("FLOW_ANALYSIS_INCOMPLETE")
    expect(incomplete?.locations?.[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: "app/track.ts", uriBaseId: "%SRCROOT%" },
      region: { startLine: 5, startColumn: 3 },
    })
  })

  it("does not add codeFlows to a finding that carries no flow evidence", () => {
    const owner = log.runs[0]!.results.find(
      (result) => result.ruleId === "CAPABILITY_MISSING_OWNER",
    )
    for (const result of log.runs[0]!.results) {
      if (result.ruleId.startsWith("FLOW_") || result.ruleId.startsWith("LEAST_DATA_")) continue
      expect(result.codeFlows, result.ruleId).toBeUndefined()
    }
    expect(owner?.codeFlows === undefined).toBe(true)
  })

  it("ignores evidence that does not resolve in the supplied flow, rather than failing", () => {
    const finding = buildFindingModel([
      {
        code: "FLOW_POLICY_VIOLATED",
        family: "flow",
        severity: "error",
        message: "m",
        capability: { file: "features/user.ts", exportName: "userData" },
        evidence: [{ model: "flow", id: "edge:that-does-not-exist" }],
      },
    ])
    const out = buildSarifLog(finding, { flow: fixture.evidence.flow })
    expect(out.runs[0]!.results[0]!.codeFlows).toBeUndefined()
    expect(new Ajv({ strict: false }).compile(sarifSchema)(out)).toBe(true)
  })

  it("is deterministic", () => {
    expect(buildSarifLog(fixture.evidence.finding!, { flow: fixture.evidence.flow })).toEqual(log)
  })
})
