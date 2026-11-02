import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import Ajv04 from "ajv-draft-04"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ReportFinding } from "../../src/build/findings.js"
import { buildSarifLog } from "../../src/build/sarif.js"
import { evaluateEvidenceRules } from "../../src/evidence/evidence-rules.js"
import { buildFlowEvidence } from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"
import { computeDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

/**
 * Redundant transformations through the real pipeline (ADR 0075): a project that copies a record for nothing, passes a
 * field through three wrappers and derives a value nobody reads. The findings, the evidence, SARIF and the CI rule all
 * say so, from the one Evidence Model.
 */
const CAPABILITY = `export const userData = createData({
  fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" } },
});
documentData(
  { fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" } } },
  { owner: "platform", sensitivity: "confidential", purpose: "accounts", legalBasis: "contract", protections: "encrypted at rest" },
);
`

const HANDLERS = `import { userData } from "../features/user.js";

export function copyHandler(res: any) {
  const user = userData.getSnapshot().fields.user
  res.json(JSON.parse(JSON.stringify({ name: user.name })))
}

function first(email: any) { return second(email) }
function second(email: any) { return third(email) }
function third(email: any) { return last(email) }
function last(email: any) { return email.toLowerCase() }

export function chainHandler(res: any) {
  res.json(first(userData.getSnapshot().fields.user.email))
}

export function deadHandler() {
  const shout = userData.getSnapshot().fields.user.id.toUpperCase()
}

export function cleanHandler(res: any) {
  const user = userData.getSnapshot().fields.user
  res.json({ id: user.id })
}
`

const redundant = (findings: readonly ReportFinding[]): ReportFinding[] =>
  findings.filter((finding) => finding.code === "LEAST_DATA_REDUNDANT_TRANSFORM")

describe("redundant transformations through the pipeline", () => {
  let fixture: FlowEvidenceFixture
  let findings: readonly ReportFinding[]

  beforeAll(async () => {
    fixture = await buildFlowEvidence({
      "features/user.ts": CAPABILITY,
      "app/handlers.ts": HANDLERS,
    })
    const { result } = await computeDataArtifacts({
      fs: nodeBuildFs,
      root: fixture.root,
      tsconfig: false,
      flowEvidence: true,
      strictFlow: true,
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      commit: "0123456789abcdef0123456789abcdef01234567",
    })
    findings = result.findings
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  it("reports each kind once, as an info finding in the flow family, at the place it happens", () => {
    expect(
      redundant(findings).map((finding) => [
        finding.family,
        finding.severity,
        finding.source,
        finding.position,
        finding.capability?.exportName,
        finding.field,
      ]),
    ).toEqual([
      ["flow", "info", "app/handlers.ts", { line: 5, column: 12 }, "userData", ["user"]],
      ["flow", "info", "app/handlers.ts", { line: 8, column: 37 }, "userData", ["user"]],
      ["flow", "info", "app/handlers.ts", { line: 18, column: 9 }, "userData", ["user"]],
    ])
  })

  it("says in plain words what is redundant", () => {
    expect(redundant(findings).map((finding) => finding.message)).toEqual([
      'Redundant transformation (round-trip): field "user" on "userData" (name) is serialized and deserialized again at app/handlers.ts:5:12 with nothing changed; the copy has the same shape as the original.',
      'Redundant transformation (forwarding-hop): field "user" on "userData" (email) passes unchanged through 3 functions that only hand it on (first -> second -> third) before it reaches "last" at app/handlers.ts:8:37; call the function that uses it directly.',
      'Redundant transformation (dead-derivation): a value derived from field "user" on "userData" (id) is computed at app/handlers.ts:18:9 and never used.',
    ])
  })

  it("is never escalated, even under strict flow (which turns warnings into errors): it is information, not a verdict", () => {
    expect(findings.some((finding) => finding.severity === "error")).toBe(true)
    expect(redundant(findings).map((finding) => finding.severity)).toEqual(["info", "info", "info"])
  })

  it("leaves a handler that copies and derives nothing alone", () => {
    expect(redundant(findings).some((finding) => finding.message.includes("cleanHandler"))).toBe(
      false,
    )
    expect(redundant(findings)).toHaveLength(3)
  })

  it("rests every finding on records that are in the evidence", () => {
    const { flow } = fixture.evidence
    const ids = new Set([
      ...(flow?.nodes ?? []).map((node) => node.id),
      ...(flow?.edges ?? []).map((edge) => edge.id),
    ])
    for (const finding of redundant(findings)) {
      expect(finding.evidence?.length).toBeGreaterThan(1)
      for (const ref of finding.evidence ?? []) {
        expect(ref.model).toBe("flow")
        expect(ids.has(ref.id)).toBe(true)
      }
    }
  })

  it("keeps the tags the scan saw in the flow model, and the evidence validates against the published schema", () => {
    const { flow } = fixture.evidence
    expect(flow?.edgeTags?.map((tag) => [tag.via, tag.source.line])).toEqual([
      ["derive", 18],
      ["serialize-roundtrip", 5],
    ])
    const here = path.dirname(fileURLToPath(import.meta.url))
    const schema = JSON.parse(
      readFileSync(path.resolve(here, "../../schemas/evidence-model.schema.json"), "utf8"),
    ) as object
    const validate = new Ajv({ strict: false, allErrors: true }).compile(schema)
    expect(validate(JSON.parse(JSON.stringify(fixture.evidence)))).toBe(true)
  })

  it("is SARIF: a result with the code as rule id, anchored where the flow evidence puts it (the last hop for a chain), and the log is valid", () => {
    const log = buildSarifLog(fixture.evidence.finding!, { flow: fixture.evidence.flow })
    const results = log.runs[0]!.results.filter(
      (result) => result.ruleId === "LEAST_DATA_REDUNDANT_TRANSFORM",
    )
    expect(results).toHaveLength(3)
    expect(results.map((result) => result.level)).toEqual(["note", "note", "note"])
    expect(results.map((result) => result.locations?.[0]?.physicalLocation.region)).toEqual([
      { startLine: 5, startColumn: 46 },
      { startLine: 10, startColumn: 37 },
      { startLine: 18, startColumn: 9 },
    ])
    const here = path.dirname(fileURLToPath(import.meta.url))
    const sarifSchema = JSON.parse(
      readFileSync(path.join(here, "../fixtures/standards/sarif-schema-2.1.0.json"), "utf8"),
    ) as object
    expect(new Ajv04({ strict: false }).compile(sarifSchema)(log)).toBe(true)
  })

  it("is the CI rule maxRedundantTransforms", () => {
    const { flow, capability, policy, claims, observation, computed, provenance } = fixture.evidence
    const evidence = { flow, capability, policy, claims, observation, computed, provenance }
    expect(evaluateEvidenceRules(evidence, { maxRedundantTransforms: 3 }).ok).toBe(true)
    const failed = evaluateEvidenceRules(evidence, { maxRedundantTransforms: 2 })
    expect(failed.ok).toBe(false)
    expect(failed.violations.map((violation) => violation.message)).toEqual([
      "3 redundant transformation(s) (round-trip of user, forwarding-hop of user, dead-derivation of user); at most 2 allowed.",
    ])
  })

  it("is deterministic: a second run gives byte-identical evidence", async () => {
    const again = await buildFlowEvidence({
      "features/user.ts": CAPABILITY,
      "app/handlers.ts": HANDLERS,
    })
    try {
      expect(JSON.stringify(again.evidence.flow)).toBe(JSON.stringify(fixture.evidence.flow))
    } finally {
      await again.cleanup()
    }
  })
})
