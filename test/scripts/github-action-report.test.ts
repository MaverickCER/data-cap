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
        { code: "EXCLUSIVE_GROUP_CONFLICT", severity: "error", message: "conflict" },
        { code: "UNRESOLVED_CONSUMER", severity: "info", message: "maybe" },
      ],
    } as unknown as ReportResult)
    expect(findings).toEqual([
      { level: "warning", file: undefined, message: "no owner", code: "CAPABILITY_MISSING_OWNER" },
      { level: "error", file: undefined, message: "conflict", code: "EXCLUSIVE_GROUP_CONFLICT" },
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
        findings: [{ code: "EXCLUSIVE_GROUP_CONFLICT", severity: "error", message: "conflict" }],
      },
    } as unknown as ReportResult)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.code).toBe("EXCLUSIVE_GROUP_CONFLICT")
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
        { code: "EXCLUSIVE_GROUP_CONFLICT", severity: "error", message: "conflict" },
        { code: "CAPABILITY_MISSING_OWNER", severity: "warning", message: "no owner" },
      ],
    } as unknown as ReportResult)
    expect(summary).toContain("# data-cap report")
    expect(summary).toContain("- Errors: 1")
    expect(summary).toContain("- Warnings: 1")
    expect(summary).toContain("- Notices: 0")
    expect(summary).toContain("## Blocking findings")
    expect(summary).toContain("EXCLUSIVE_GROUP_CONFLICT")
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

  it("renders the manifest section with its active-capability count", () => {
    const summary = renderMarkdownSummary({
      findings: [],
      manifest: {
        location: "src/generated/data.manifest.ts",
        snapshot: { capabilities: [{}, {}] },
      },
    })
    expect(summary).toContain("## Manifest")
    expect(summary).toContain("src/generated/data.manifest.ts")
    expect(summary).toContain("2 active capability(ies)")
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

  it("embeds the flow overview.md content (including its Mermaid diagram) directly, without re-deriving it", () => {
    const summary = renderMarkdownSummary({
      findings: [],
      flow: {
        files: [
          { path: "/root/docs/flow/overview.mmd", content: "flowchart TB" },
          {
            path: "/root/docs/flow/overview.md",
            content: "# Security Data-Flow Review\n\n```mermaid\nflowchart TB\n```\n",
          },
        ],
      },
    })
    expect(summary).toContain("## Data Flow Diagram + Security Data-Flow Review")
    expect(summary).toContain("```mermaid")
    expect(summary).toContain("# Security Data-Flow Review")
  })

  it("omits the flow section entirely when --flow wasn't requested", () => {
    const summary = renderMarkdownSummary({ findings: [] })
    expect(summary).not.toContain("Data Flow Diagram")
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
      [{ level: "error", file: undefined, message: "boom", code: "EXCLUSIVE_GROUP_CONFLICT" }],
      "/workspace",
      "/workspace",
    )
    expect(lines).toEqual(["::error::[EXCLUSIVE_GROUP_CONFLICT] boom"])
  })
})
