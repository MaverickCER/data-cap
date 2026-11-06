import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import addFormats from "ajv-formats"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildOscalAssessmentResults } from "../../src/evidence/flow-oscal.js"
import type { OscalAssessmentResults } from "../../src/evidence/flow-oscal.js"
import { deterministicUuid } from "../../src/evidence/uuid.js"
import {
  buildFlowEvidence,
  PROFILE_CAPABILITY,
  profileFixture,
} from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(
  readFileSync(
    path.join(here, "../fixtures/standards/oscal_assessment-results_schema-1.1.2.json"),
    "utf8",
  ),
) as object
const UUID =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[45][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/

function validator() {
  const ajv = new Ajv({ strict: false, allErrors: true })
  addFormats(ajv)
  return ajv.compile(schema)
}

describe("deterministicUuid", () => {
  it("is an RFC 4122 name-based (version 5) shaped uuid", () => {
    expect(deterministicUuid("anything")).toMatch(UUID)
    expect(deterministicUuid("anything")[14]).toBe("5")
  })

  it("is stable for a key and different for different keys", () => {
    expect(deterministicUuid("a")).toBe(deterministicUuid("a"))
    expect(deterministicUuid("a")).not.toBe(deterministicUuid("b"))
    const many = new Set(Array.from({ length: 2000 }, (_, i) => deterministicUuid(`key-${i}`)))
    expect(many.size).toBe(2000)
  })
})

describe("buildOscalAssessmentResults", () => {
  let fixture: FlowEvidenceFixture
  let doc: OscalAssessmentResults

  const CONTROLS = {
    "userData/no-password-to-client": ["ac-4", "sc-28"],
    "userData/no-role-to-log": ["au-3"],
  }

  beforeAll(async () => {
    fixture = await profileFixture()
    doc = buildOscalAssessmentResults(fixture.evidence, { controls: CONTROLS })!
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  const result = () => doc["assessment-results"].results[0]!

  it("is valid against NIST's official OSCAL 1.1.2 assessment-results schema", () => {
    const validate = validator()
    const ok = validate(doc)
    if (!ok) console.error(JSON.stringify(validate.errors?.slice(0, 6), null, 1))
    expect(ok).toBe(true)
  })

  it("stamps the metadata from the evidence's own provenance", () => {
    const { metadata } = doc["assessment-results"]
    expect(metadata["oscal-version"]).toBe("1.1.2")
    expect(metadata["last-modified"]).toBe("2026-01-01T00:00:00.000Z")
    expect(metadata.version).toBe(fixture.evidence.provenance.toolVersion)
    expect(metadata.title).toBe("data-cap data-flow assessment")
  })

  it("reviews exactly the controls the caller mapped, in order, once each", () => {
    const included = result()["reviewed-controls"]["control-selections"][0]?.[
      "include-controls"
    ]?.map((c) => c["control-id"])
    expect(included).toEqual(["ac-4", "au-3", "sc-28"])
  })

  it("makes one finding per rule and control: a violated rule is not-satisfied for each of its controls", () => {
    const findings = result().findings ?? []
    expect(findings).toHaveLength(3)
    const status = (control: string) =>
      findings.find((f) => f.target["target-id"] === control)?.target.status
    expect(status("ac-4")).toMatchObject({ state: "not-satisfied", reason: "fail" })
    expect(status("sc-28")).toMatchObject({ state: "not-satisfied", reason: "fail" })
    expect(findings.map((f) => f.target.type)).toEqual([
      "objective-id",
      "objective-id",
      "objective-id",
    ])
  })

  it("a rule that holds statically is satisfied, and says it was not observed at runtime", () => {
    const finding = (result().findings ?? []).find((f) => f.target["target-id"] === "au-3")
    expect(finding?.target.status).toMatchObject({ state: "satisfied", reason: "pass" })
    expect(finding?.target.status.remarks).toMatch(/not observed at runtime/)
  })

  it("links each finding to an observation describing the claim, with the evidence it rests on", () => {
    const finding = (result().findings ?? []).find((f) => f.target["target-id"] === "ac-4")!
    const linked = finding["related-observations"]?.map((o) => o["observation-uuid"]) ?? []
    expect(linked.length).toBeGreaterThan(0)
    const observations = (result().observations ?? []).filter((o) => linked.includes(o.uuid))
    expect(observations[0]?.description).toMatch(
      /Rule userData\/no-password-to-client holds for userData\.user/,
    )
    expect(observations[0]?.description).toMatch(/contradicted/)
    expect(observations[0]?.methods).toContain("EXAMINE")
    expect(observations[0]?.["relevant-evidence"]?.length).toBeGreaterThan(0)
    expect(observations[0]?.collected).toBe("2026-01-01T00:00:00.000Z")
  })

  it("reports a rule it could not map to a control, instead of dropping it silently", () => {
    const partial = buildOscalAssessmentResults(fixture.evidence, {
      controls: { "userData/no-role-to-log": ["au-3"] },
    })!
    const props = partial["assessment-results"].results[0]!.props ?? []
    expect(props).toContainEqual({ name: "unmapped-rule", value: "userData/no-password-to-client" })
    expect(validator()(partial)).toBe(true)
  })

  it("maps nothing by itself: with no controls there are no findings, and that is stated", () => {
    const none = buildOscalAssessmentResults(fixture.evidence, { controls: {} })!
    const res = none["assessment-results"].results[0]!
    expect(res.findings ?? []).toEqual([])
    expect(res.description).toMatch(/no controls were mapped/i)
    expect(validator()(none)).toBe(true)
    const unmapped = (res.props ?? [])
      .filter((p) => p.name === "unmapped-rule")
      .map((p) => p.value)
      .sort()
    expect(unmapped).toEqual(["userData/no-password-to-client", "userData/no-role-to-log"])
  })

  it("uses RFC 4122 uuids, all distinct, and is deterministic", () => {
    const uuids = [
      doc["assessment-results"].uuid,
      result().uuid,
      ...(result().findings ?? []).map((f) => f.uuid),
      ...(result().observations ?? []).map((o) => o.uuid),
    ]
    for (const uuid of uuids) expect(uuid).toMatch(UUID)
    expect(new Set(uuids).size).toBe(uuids.length)
    expect(buildOscalAssessmentResults(fixture.evidence, { controls: CONTROLS })).toEqual(doc)
  })

  it("accepts a title and an assessment-plan reference", () => {
    const custom = buildOscalAssessmentResults(fixture.evidence, {
      controls: CONTROLS,
      title: "Q4 data flow review",
      assessmentPlan: "https://example.com/plans/q4.json",
    })!
    expect(custom["assessment-results"].metadata.title).toBe("Q4 data flow review")
    expect(custom["assessment-results"]["import-ap"].href).toBe("https://example.com/plans/q4.json")
    expect(validator()(custom)).toBe(true)
  })

  it("an indeterminate rule is never reported as satisfied", async () => {
    const opaque = await buildFlowEvidence({
      "features/user.ts": PROFILE_CAPABILITY,
      "app/handler.ts": `import { userData } from "../features/user.js";\nimport { audit } from "some-lib";\nexport function h() { audit(userData.getSnapshot().fields.user) }\n`,
    })
    try {
      const rule = "userData/no-password-to-client"
      expect(
        opaque.evidence.policy?.results.filter((r) => r.ruleId === rule).map((r) => r.outcome),
      ).toEqual(["indeterminate"])
      const out = buildOscalAssessmentResults(opaque.evidence, { controls: { [rule]: ["ac-4"] } })!
      const finding = out["assessment-results"].results[0]!.findings?.[0]
      expect(finding?.target.status).toMatchObject({ state: "not-satisfied", reason: "other" })
      expect(finding?.target.status.remarks).toMatch(/could not be decided/i)
      expect(validator()(out)).toBe(true)
    } finally {
      await opaque.cleanup()
    }
  })

  it("a rule that holds statically but is contradicted by an observation is not-satisfied", async () => {
    const seen = await profileFixture({
      observations: [
        { scope: "e2e", boundary: { kind: "log", name: "stdout" }, field: "userData.user.role" },
      ],
    })
    try {
      const out = buildOscalAssessmentResults(seen.evidence, {
        controls: { "userData/no-role-to-log": ["au-3"] },
      })!
      const finding = out["assessment-results"].results[0]!.findings?.[0]
      expect(finding?.target.status).toMatchObject({ state: "not-satisfied", reason: "fail" })
      expect(finding?.target.status.remarks).toMatch(/contradicted by runtime observation/i)
    } finally {
      await seen.cleanup()
    }
  })

  it("returns undefined when no flow was computed", async () => {
    const without = await profileFixture({ flowEvidence: false })
    try {
      expect(buildOscalAssessmentResults(without.evidence, { controls: CONTROLS })).toBeUndefined()
    } finally {
      await without.cleanup()
    }
  })
})
