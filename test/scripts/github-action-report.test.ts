import { describe, expect, it } from "vitest"
import {
  classifyFindings,
  renderAnnotations,
  renderMarkdownSummary,
  // report.mjs itself stays plain, dependency-free JS -- types come from the
  // hand-written sibling report.d.mts, checked here.
} from "../../scripts/github-action/report.mjs"
import type { ReportResult } from "../../scripts/github-action/report.d.mts"

describe("classifyFindings", () => {
  it("maps result.findings, folding severity to a GitHub annotation level", () => {
    const findings = classifyFindings({
      findings: [
        { code: "CAPABILITY_MISSING_OWNER", severity: "warning", message: "no owner" },
        { code: "EXCLUSIVE_GROUP_VIOLATION", severity: "error", message: "conflict" },
        { code: "UNRESOLVED_CONSUMER", severity: "info", message: "maybe" },
      ],
    } as unknown as ReportResult)
    expect(findings).toEqual([
      { level: "warning", file: undefined, message: "no owner", code: "CAPABILITY_MISSING_OWNER" },
      { level: "error", file: undefined, message: "conflict", code: "EXCLUSIVE_GROUP_VIOLATION" },
      { level: "notice", file: undefined, message: "maybe", code: "UNRESOLVED_CONSUMER" },
    ])
  })

  it("resolves file from finding.capability.file when present, appending the export name to the message", () => {
    const findings = classifyFindings({
      findings: [
        {
          code: "CAPABILITY_MISSING_OWNER",
          family: "governance",
          severity: "warning",
          message: "no owner",
          capability: { file: "features/a/user.ts", exportName: "userCapability" },
        },
      ],
    } as unknown as ReportResult)
    expect(findings[0]).toEqual({
      level: "warning",
      file: "features/a/user.ts",
      message: "no owner (userCapability)",
      code: "CAPABILITY_MISSING_OWNER",
    })
  })

  it("falls back to finding.source (a usage-scan consumer file) when capability is absent", () => {
    const findings = classifyFindings({
      findings: [
        {
          code: "UNRESOLVED_CONSUMER",
          family: "usage",
          severity: "info",
          message: "barrel re-export",
          source: "src/consumer.ts",
        },
      ],
    } as unknown as ReportResult)
    expect(findings[0]?.file).toBe("src/consumer.ts")
  })

  it("falls back to result.error.findings when the run failed with a blocking DataProjectGenerationError", () => {
    const findings = classifyFindings({
      ok: false,
      error: {
        name: "DataProjectGenerationError",
        findings: [{ code: "EXCLUSIVE_GROUP_VIOLATION", severity: "error", message: "conflict" }],
      },
    } as unknown as ReportResult)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.code).toBe("EXCLUSIVE_GROUP_VIOLATION")
  })

  it("returns an empty array for a usage error with no findings at all (e.g. no target flags given)", () => {
    expect(
      classifyFindings({
        ok: false,
        error: { name: "Error", message: "At least one of --location, --docs... is required." },
      }),
    ).toEqual([])
  })

  it("returns an empty array for an undefined result", () => {
    expect(classifyFindings(undefined)).toEqual([])
  })
})

describe("renderMarkdownSummary", () => {
  it("renders the error/warning/notice counts and a blocking-findings table", () => {
    const summary = renderMarkdownSummary({
      findings: [
        { code: "EXCLUSIVE_GROUP_VIOLATION", severity: "error", message: "conflict" },
        { code: "CAPABILITY_MISSING_OWNER", severity: "warning", message: "no owner" },
      ],
    } as unknown as ReportResult)
    expect(summary).toContain("# data-cap report")
    expect(summary).toContain("- Errors: 1")
    expect(summary).toContain("- Warnings: 1")
    expect(summary).toContain("- Notices: 0")
    expect(summary).toContain("## Blocking findings")
    expect(summary).toContain("EXCLUSIVE_GROUP_VIOLATION")
  })

  it("omits the blocking-findings table when nothing is at error severity", () => {
    const summary = renderMarkdownSummary({
      findings: [{ code: "CAPABILITY_MISSING_OWNER", severity: "warning", message: "no owner" }],
    } as unknown as ReportResult)
    expect(summary).not.toContain("## Blocking findings")
  })

  it("highlights SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY findings in their own section", () => {
    const summary = renderMarkdownSummary({
      findings: [
        {
          code: "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY",
          family: "flow",
          severity: "warning",
          message: "restricted field reaches stripe-api",
          capability: { file: "features/payments/payments.ts", exportName: "paymentsCapability" },
        },
      ],
    } as unknown as ReportResult)
    expect(summary).toContain("## Sensitive data crossing an external boundary")
    expect(summary).toContain("restricted field reaches stripe-api")
  })

  it("reports the failure name and message when generation failed with no findings", () => {
    const summary = renderMarkdownSummary({
      ok: false,
      error: { name: "Error", message: "At least one of --location... is required." },
    })
    expect(summary).toContain("**Generation failed:** `Error`")
    expect(summary).toContain("At least one of --location... is required.")
  })

  it("renders the inventory section from the evidence every run composes", () => {
    const summary = renderMarkdownSummary({
      findings: [],
      evidence: {
        capability: { capabilities: [{}, {}] },
        dependency: { edges: [{}, {}, {}] },
      },
    })
    expect(summary).toContain("## Inventory")
    expect(summary).toContain("2 capability(ies) discovered, 3 proven dependency edge(s).")
  })

  it("says nothing about dependencies when the run did not scan for them", () => {
    const summary = renderMarkdownSummary({
      findings: [],
      evidence: { capability: { capabilities: [{}] } },
    })
    expect(summary).toContain("1 capability(ies) discovered.")
    expect(summary).not.toContain("dependency edge")
  })

  it("omits the inventory section when there is no evidence", () => {
    expect(renderMarkdownSummary({ findings: [] })).not.toContain("## Inventory")
  })

  it("renders a data-flow section from the evidence when flow analysis ran: coverage, policy, observations and claims", () => {
    const markdown = renderMarkdownSummary({
      ok: true,
      findings: [],
      evidence: {
        capability: { capabilities: [] },
        flow: {
          coverage: {
            functionsAnalyzed: 9,
            functionsUnanalyzed: 1,
            edgesUnresolved: 0,
            unknowns: 2,
            complete: false,
          },
        },
        policy: { summary: { satisfied: 3, violated: 1, indeterminate: 2 } },
        observation: { scopes: ["a", "b"], observations: [{}, {}, {}], skipped: 0 },
        claims: {
          summary: {
            verified: 4,
            inferred: 0,
            unobserved: 5,
            contradicted: 1,
            "observed-only": 0,
            indeterminate: 2,
          },
        },
      },
    } as unknown as ReportResult)
    expect(markdown).toContain("## Data flow")
    expect(markdown).toContain(
      "- Coverage: 9 function(s) analyzed, 1 not fully analyzed, 2 unknown(s) -- **not complete**; a flow missing from the evidence is not proof that it does not exist.",
    )
    expect(markdown).toContain("- Policy: 3 satisfied, 1 violated, 2 indeterminate.")
    expect(markdown).toContain("- Observations: 3 across 2 scope(s).")
    expect(markdown).toContain(
      "- Claims: 4 verified, 5 unobserved, 1 contradicted, 2 indeterminate.",
    )
  })

  it("says complete only when the flow is complete, and omits lines for sub-models that were not computed", () => {
    const markdown = renderMarkdownSummary({
      ok: true,
      findings: [],
      evidence: {
        capability: { capabilities: [] },
        flow: {
          coverage: {
            functionsAnalyzed: 3,
            functionsUnanalyzed: 0,
            edgesUnresolved: 0,
            unknowns: 0,
            complete: true,
          },
        },
      },
    })
    expect(markdown).toContain("- Coverage: 3 function(s) analyzed -- complete.")
    expect(markdown).not.toContain("- Policy:")
    expect(markdown).not.toContain("- Observations:")
    expect(markdown).not.toContain("- Claims:")
  })

  it("has no data-flow section when the flow analysis did not run", () => {
    expect(
      renderMarkdownSummary({
        ok: true,
        findings: [],
        evidence: { capability: { capabilities: [] } },
      }),
    ).not.toContain("## Data flow")
  })

  it("renders the evidence-rules verdict: satisfied, or a table of violations", () => {
    const ok = renderMarkdownSummary({
      ok: true,
      findings: [],
      evidenceRules: { ok: true, evaluated: ["a", "b"], violations: [] },
    })
    expect(ok).toContain("## Evidence rules")
    expect(ok).toContain("All 2 rule(s) satisfied.")
    const bad = renderMarkdownSummary({
      ok: true,
      findings: [],
      evidenceRules: {
        ok: false,
        evaluated: ["x", "y"],
        violations: [{ rule: "x", message: "Rule a/b is violated.", evidence: [] }],
      },
    } as unknown as ReportResult)
    expect(bad).toContain("1 of 2 rule(s) violated:")
    expect(bad).toContain("| x | Rule a/b is violated. |")
  })

  it("keeps a violation's message from breaking the table", () => {
    const bad = renderMarkdownSummary({
      ok: true,
      findings: [],
      evidenceRules: {
        ok: false,
        evaluated: ["x"],
        violations: [{ rule: "x", message: "a | b\nc", evidence: [] }],
      },
    } as unknown as ReportResult)
    expect(bad).toContain("| x | a \\| b c |")
  })

  it("renders the drift-check section, up-to-date and stale variants", () => {
    const upToDate = renderMarkdownSummary({
      findings: [],
      checkResult: { ok: true, stale: [] },
    })
    expect(upToDate).toContain("All generated artifacts are up to date.")

    const stale = renderMarkdownSummary({
      findings: [],
      checkResult: { ok: false, stale: ["a.ts", "b.md"] },
    })
    expect(stale).toContain("2 artifact(s) are stale or missing.")
  })
})

describe("renderAnnotations", () => {
  it("resolves a capability-relative file into a workspace-relative annotation path", () => {
    const lines = renderAnnotations(
      [
        {
          level: "warning",
          file: "features/a/user.ts",
          message: "no owner",
          code: "CAPABILITY_MISSING_OWNER",
        },
      ],
      "/workspace/packages/app",
      "/workspace",
    )
    expect(lines).toEqual([
      "::warning file=packages/app/features/a/user.ts::[CAPABILITY_MISSING_OWNER] no owner",
    ])
  })

  it("omits the file= segment for a finding with no associated file", () => {
    const lines = renderAnnotations(
      [{ level: "error", file: undefined, message: "boom", code: "EXCLUSIVE_GROUP_VIOLATION" }],
      "/workspace",
      "/workspace",
    )
    expect(lines).toEqual(["::error::[EXCLUSIVE_GROUP_VIOLATION] boom"])
  })
})
