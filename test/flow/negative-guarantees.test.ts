/**
 * The "never" checklist for the flow pass (ADR 0047, items 25-34), for the
 * guarantees that span more than one module and so have no single natural home
 * among the unit tests. The rest of the checklist is traced, in the ADR, to the
 * test files that already enforce each item.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { analyzeLeastData } from "../../src/flow/least-data.js"
import { buildFlowGraphView } from "../../src/evidence/flow-graph-view.js"
import { evaluateEvidenceRules } from "../../src/evidence/evidence-rules.js"
import { renderFlowDot } from "../../src/evidence/flow-dot.js"
import { renderFlowMermaid } from "../../src/evidence/flow-mermaid.js"
import { buildOscalAssessmentResults } from "../../src/evidence/flow-oscal.js"
import { observationsToOtlp } from "../../src/evidence/flow-otel.js"
import { buildProvDocument } from "../../src/evidence/flow-prov.js"
import { renderFlowText } from "../../src/evidence/flow-text.js"
import { buildSarifLog } from "../../src/build/sarif.js"
import {
  buildFlowEvidence,
  PROFILE_CAPABILITY,
  PROFILE_HANDLERS,
  profileFixture,
} from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"
import type { EvidenceModel } from "../../src/build/evidence-model.js"

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

/** Every adapter and analysis, applied to one evidence object, as strings so they can be searched. */
function everyProjection(evidence: EvidenceModel): Record<string, string> {
  const out: Record<string, string | undefined> = {
    graphView: JSON.stringify(buildFlowGraphView(evidence)),
    text: renderFlowText(evidence),
    dot: renderFlowDot(evidence),
    mermaid: renderFlowMermaid(evidence),
    prov: JSON.stringify(buildProvDocument(evidence)),
    oscal: JSON.stringify(
      buildOscalAssessmentResults(evidence, {
        controls: {
          "userData/no-password-to-client": ["ac-4"],
          "userData/no-role-to-log": ["au-3"],
        },
      }),
    ),
    otlp: JSON.stringify(observationsToOtlp(evidence)),
    sarif: JSON.stringify(
      evidence.finding === undefined
        ? undefined
        : buildSarifLog(evidence.finding, { flow: evidence.flow }),
    ),
    rules: JSON.stringify(
      evaluateEvidenceRules(evidence, {
        noPolicyViolations: true,
        maxUnknowns: 0,
        requireComplete: true,
        maxUnusedSensitivePaths: 0,
        maxWholeFieldToClient: 0,
      }),
    ),
    leastData: JSON.stringify(
      evidence.flow === undefined
        ? undefined
        : analyzeLeastData({ capability: evidence.capability, flow: evidence.flow }),
    ),
  }
  return Object.fromEntries(Object.entries(out).map(([name, value]) => [name, value ?? ""]))
}

describe("Negative guarantee 25 -- a projection never mutates the evidence it reads", () => {
  let fixture: FlowEvidenceFixture
  beforeAll(async () => {
    fixture = await profileFixture({
      observations: [
        {
          scope: "s",
          boundary: { kind: "client-response", name: "http-response" },
          field: "userData.user.email",
        },
      ],
    })
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  it("every adapter, view, analysis and rule runs over deeply frozen evidence without throwing, and gives the same answer as over an unfrozen copy", () => {
    const plain = everyProjection(structuredClone(fixture.evidence))
    const frozen = everyProjection(deepFreeze(structuredClone(fixture.evidence)))
    expect(frozen).toEqual(plain)
    for (const [name, output] of Object.entries(plain))
      expect(output.length, name).toBeGreaterThan(0)
  })
})

describe("Negative guarantee 26 -- no field value ever reaches the evidence or any projection of it", () => {
  it("a value smuggled into an observation event is dropped at the model, and appears in nothing", async () => {
    const SECRET = "ada@example.com"
    const smuggled = {
      scope: "s",
      boundary: { kind: "client-response", name: "http-response" },
      field: "userData.user.email",
      value: SECRET,
      payload: { email: SECRET },
    }
    const fixture = await profileFixture({ observations: [smuggled as never] })
    try {
      expect(JSON.stringify(fixture.evidence)).not.toContain(SECRET)
      for (const [name, output] of Object.entries(everyProjection(fixture.evidence)))
        expect(output, name).not.toContain(SECRET)
    } finally {
      await fixture.cleanup()
    }
  })
})

describe("Negative guarantee 28 -- an unknown is never presented as complete", () => {
  it("every rendering of evidence with an unknown says it is not complete, and none claims the opposite", async () => {
    const fixture = await profileFixture()
    try {
      expect(fixture.evidence.flow?.coverage.complete).toBe(false)
      const outputs = everyProjection(fixture.evidence)
      expect(outputs["text"]).toMatch(/not complete/)
      expect(outputs["dot"]).toMatch(/NOT complete/)
      expect(outputs["mermaid"]).toMatch(/NOT complete/)
      expect(outputs["graphView"]).toContain('"complete":false')
      for (const name of ["text", "dot", "mermaid"])
        expect(outputs[name], name).not.toMatch(/-- complete[.;"]/)
      expect(evaluateEvidenceRules(fixture.evidence, { requireComplete: true }).ok).toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it("and the same renderings do say complete when nothing is unknown (the control)", async () => {
    const fixture = await buildFlowEvidence({
      "features/user.ts": PROFILE_CAPABILITY,
      "app/profile.ts": PROFILE_HANDLERS,
    })
    try {
      expect(fixture.evidence.flow?.coverage.complete).toBe(true)
      expect(renderFlowText(fixture.evidence)).toMatch(/-- complete\./)
      expect(renderFlowDot(fixture.evidence)).toMatch(/Data flow -- complete/)
      expect(evaluateEvidenceRules(fixture.evidence, { requireComplete: true }).ok).toBe(true)
    } finally {
      await fixture.cleanup()
    }
  })
})

describe("Negative guarantee 29 -- a gate over analysis that did not run never passes", () => {
  it("every rule that needs flow fails when flow was not computed", async () => {
    const fixture = await profileFixture({ flowEvidence: false })
    try {
      const rules = [
        "noPolicyViolations",
        "noIndeterminatePolicies",
        "maxContradictedClaims",
        "maxUnknowns",
        "requireComplete",
        "maxUnusedSensitivePaths",
        "maxWholeFieldToClient",
        "minVerifiedClaims",
      ] as const
      for (const rule of rules) {
        const setting =
          rule === "noPolicyViolations" ||
          rule === "noIndeterminatePolicies" ||
          rule === "requireComplete"
            ? true
            : 0
        expect(evaluateEvidenceRules(fixture.evidence, { [rule]: setting }).ok, rule).toBe(false)
      }
    } finally {
      await fixture.cleanup()
    }
  })
})
