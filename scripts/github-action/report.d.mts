// Hand-written type declaration for report.mjs, kept as plain, dependency-free
// JS at runtime. This file exists purely so the test suite
// (test/scripts/github-action-report.test.ts) gets real type-checking
// instead of treating every import as `any`; it is not shipped (outside
// `files` in package.json) and never affects the published package's types.
//
// Deliberately minimal, structural types -- just the fields each function
// actually reads, not the full ReportFinding/ReportResult shapes -- since
// that's report.mjs's real (duck-typed) contract and it's what test fixtures
// naturally construct. report.mjs and the JSON contract are coupled by
// convention, not a shared type; this file is the same kind of
// manually-kept-in-sync duplication, just for local type-checking.

export interface Finding {
  readonly level: "error" | "warning" | "notice"
  readonly file: string | undefined
  readonly message: string
  readonly code: string
}

interface FindingLike {
  readonly code: string
  readonly severity: "error" | "warning" | "info"
  readonly message: string
  readonly capability?: { readonly file: string; readonly exportName: string }
  readonly source?: string
}

interface FlowFileLike {
  readonly path: string
  readonly content: string
}

interface ManifestSectionLike {
  readonly location: string
  readonly snapshot?: { readonly capabilities?: readonly unknown[] }
}

interface FlowSectionLike {
  readonly files?: readonly FlowFileLike[]
}

interface CheckResultLike {
  readonly ok: boolean
  readonly stale?: readonly string[]
}

interface ErrorSectionLike {
  readonly name?: string
  readonly message?: string
  readonly findings?: readonly FindingLike[]
}

export interface ReportResult {
  // Optional -- classifyFindings()/renderMarkdownSummary() only ever check
  // `result?.ok === false`, which is safely false when absent.
  readonly ok?: boolean
  readonly findings?: readonly FindingLike[]
  readonly manifest?: ManifestSectionLike
  readonly flow?: FlowSectionLike
  readonly checkResult?: CheckResultLike
  readonly error?: ErrorSectionLike
}

export function classifyFindings(result: ReportResult | undefined): Finding[]
export function renderMarkdownSummary(result: ReportResult | undefined): string
export function renderAnnotations(
  findings: readonly Finding[],
  cliRoot: string,
  workspaceRoot: string,
): string[]
