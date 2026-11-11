import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { evidenceDisclaimer } from "../../src/build/generated-banner.js"
import { buildCycloneDxBom } from "../../src/evidence/flow-cyclonedx.js"
import { flowEvidenceDisclaimer } from "../../src/evidence/flow-disclaimer.js"
import { renderFlowDot } from "../../src/evidence/flow-dot.js"
import { renderFlowMermaid } from "../../src/evidence/flow-mermaid.js"
import { buildOscalAssessmentResults } from "../../src/evidence/flow-oscal.js"
import { observationsToOtlp } from "../../src/evidence/flow-otel.js"
import { buildProvDocument } from "../../src/evidence/flow-prov.js"
import { renderFlowText } from "../../src/evidence/flow-text.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"
import { profileFixture } from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

/**
 * A reader of an OSCAL result, a CycloneDX BOM or a PROV document may never see the Markdown report that
 * opens with the evidence disclaimer, so every data-flow artifact carries the sentence inside itself,
 * and none of them says in its own words that anything is compliant, verified or proven. The claims
 * model's enum value `"verified"` is data, not prose; it is the one place the word may appear.
 */

/** Words that would turn an artifact from evidence into an assertion. */
const COMPLIANCE_WORDS = /\b(compliant|certified|proven|guarantees?|litigation|legally)\b/i

/** Every string in a JSON document, in document order, except the one enum value that is data. */
function strings(value: unknown, into: string[] = [], key = ""): string[] {
  if (typeof value === "string") {
    if (!(key === "verification" && value === "verified")) into.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) strings(item, into, key)
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) strings(v, into, k)
  }
  return into
}

function assertNoComplianceWords(label: string, text: string): void {
  const withoutDisclaimer = text.split(flowEvidenceDisclaimer()).join("")
  const hit = COMPLIANCE_WORDS.exec(withoutDisclaimer)
  expect(hit, `${label} says "${hit?.[0] ?? ""}"`).toBeNull()
}

describe("the flow evidence disclaimer", () => {
  it("is the build entry's disclaimer plus what the flow analysis adds, so the two cannot drift", () => {
    expect(flowEvidenceDisclaimer().startsWith(evidenceDisclaimer())).toBe(true)
    expect(flowEvidenceDisclaimer()).toContain("Incomplete traces are recorded as unknown")
    expect(flowEvidenceDisclaimer()).toContain("does not itself establish compliance")
  })
})

describe("every data-flow artifact carries the disclaimer and asserts nothing", () => {
  let fixture: FlowEvidenceFixture
  beforeAll(async () => {
    fixture = await profileFixture()
  }, 120_000)
  afterAll(async () => {
    await fixture.cleanup()
  })

  it("DOT: as a leading comment", () => {
    const dot = renderFlowDot(fixture.evidence)!
    expect(dot.startsWith(`// ${flowEvidenceDisclaimer()}\n`)).toBe(true)
    assertNoComplianceWords("DOT", dot)
    // The one-line answer for a field the evidence does not have carries it too.
    const missing = renderFlowDot(fixture.evidence, { field: "nope" })!
    expect(missing.startsWith(`// ${flowEvidenceDisclaimer()}\n`)).toBe(true)
  })

  it("Mermaid: as a leading %% comment", () => {
    const mmd = renderFlowMermaid(fixture.evidence)!
    expect(mmd.startsWith(`%% ${flowEvidenceDisclaimer()}\n`)).toBe(true)
    assertNoComplianceWords("Mermaid", mmd)
    const missing = renderFlowMermaid(fixture.evidence, { field: "nope" })!
    expect(missing.startsWith(`%% ${flowEvidenceDisclaimer()}\n`)).toBe(true)
  })

  it("Markdown text: as a blockquote under the heading", () => {
    const text = renderFlowText(fixture.evidence)!
    expect(text).toContain(`\n> ${flowEvidenceDisclaimer()}\n`)
    assertNoComplianceWords("text", text)
  })

  it("PROV-JSON: on the tool agent", () => {
    const prov = buildProvDocument(fixture.evidence)!
    expect(prov.agent["dc:tool"]?.["dc:disclaimer"]).toBe(flowEvidenceDisclaimer())
    assertNoComplianceWords("PROV", strings(prov).join("\n"))
  })

  it("CycloneDX: as a metadata property", () => {
    const bom = buildCycloneDxBom(fixture.evidence)!
    expect(bom.metadata.properties).toContainEqual({
      name: "data-cap:disclaimer",
      value: flowEvidenceDisclaimer(),
    })
    assertNoComplianceWords("CycloneDX", strings(bom).join("\n"))
  })

  it("OSCAL: in the metadata remarks", () => {
    const oscal = buildOscalAssessmentResults(fixture.evidence, {
      controls: { "userData/no-password-to-client": ["ac-4"], "userData/no-role-to-log": ["au-3"] },
      evidenceHref: "docs/data.evidence.json",
    })!
    // The fixture's rules map, so findings, observations and back-matter text are all scanned.
    expect(oscal["assessment-results"].results[0]?.findings?.length).toBeGreaterThan(0)
    expect(oscal["assessment-results"]["back-matter"]?.resources.length).toBeGreaterThan(0)
    expect(oscal["assessment-results"].metadata.remarks).toBe(flowEvidenceDisclaimer())
    assertNoComplianceWords("OSCAL", strings(oscal).join("\n"))
  })

  it("OTLP: as a resource attribute", () => {
    const events: ObservationEvent[] = [
      {
        scope: "test:profile",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData.user.email",
      },
    ]
    const traces = observationsToOtlp({
      observation: buildObservationModel(events),
      provenance: fixture.evidence.provenance,
    })!
    const attributes = traces.resourceSpans[0]!.resource.attributes
    expect(attributes).toContainEqual({
      key: "data_cap.disclaimer",
      value: { stringValue: flowEvidenceDisclaimer() },
    })
    assertNoComplianceWords("OTLP", strings(traces).join("\n"))
  })
})
