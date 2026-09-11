/**
 * The shared finding vocabulary every static rule (`exclusive-group.ts`,
 * `structural-duplication.ts`, the ownership/sensitivity checks) and every
 * usage-scan/data-flow pass emits into, instead of each generator
 * inventing its own ad hoc shape. Establishing this once, before any
 * generator exists, is what keeps "what counts as a conflict" consistent
 * across the whole report-generation engine -- see ADR 0049 and
 * `specs/architecture.md`'s Phase B.5 model section.
 */

import type { SourceLocation, SourcePosition } from "./source-position.js"

/** How strongly a finding should be treated: `info` never blocks, `warning` blocks only under `--strict*`, `error` always blocks. */
export type ReportSeverity = "info" | "warning" | "error"

/**
 * Which analysis pass a finding came out of -- an orthogonal axis to
 * `severity` (how much it matters) and `code` (exactly what it is).
 *
 * This is what makes the `--strict*` flags' own groupings legible in the
 * output rather than only in the orchestrator's source: `--strict-docs`
 * escalates `"governance"`/`"structural"`/`"citation"`, `--strict-ownership`
 * escalates `"usage"`, `--strict-flow` escalates `"flow"`. A consumer
 * filtering a report ("show me only what a usage scan proved") currently has
 * to hardcode a list of `ReportFindingCode`s and keep it in sync by hand;
 * `family` makes that a real, stable field instead.
 *
 * Deliberately assigned at the emission site, never derived from `code` by a
 * lookup table: the rule that produces a finding is the only thing that
 * actually knows which pass it belongs to, and a table would be a second
 * source of truth to drift out of sync (the same reasoning that keeps
 * `severity` at the emission site).
 */
export type ReportFindingFamily =
  /** Declared-metadata quality: ownership, sensitivity, purpose, legal basis, audit trail (`static-rules.ts`). */
  | "governance"
  /** The shape of the capability graph itself: exclusive-group conflicts, duplicate field shapes/endpoints, manifest export collisions. */
  | "structural"
  /** Requires a real usage scan to conclude anything: abandoned capabilities, unconsumed fields, consumer resolution (`usage-report.ts`). */
  | "usage"
  /** A developer-supplied `dynamicAccess` citation's own current integrity (`citation-verification.ts`). */
  | "citation"
  /** Declared data-flow boundary crossings for sensitive fields (`flow-graph.ts`). */
  | "flow"

/** Every kind of fact a static rule or usage-scan/data-flow pass can report. */
export type ReportFindingCode =
  | "CAPABILITY_MISSING_OWNER"
  | "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS"
  | "SENSITIVE_FIELD_MISSING_PROTECTIONS"
  | "SENSITIVE_FIELD_MISSING_PURPOSE"
  | "SENSITIVE_FIELD_MISSING_LEGAL_BASIS"
  | "AUDIT_REQUIRED_WITHOUT_OWNER"
  | "NONSTANDARD_SENSITIVITY_LEVEL"
  | "EXCLUSIVE_GROUP_CONFLICT"
  | "MANIFEST_EXPORT_NAME_COLLISION"
  | "DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES"
  | "DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES"
  | "ABANDONED_CAPABILITY"
  | "UNCONSUMED_FIELD"
  | "FIELD_ACCESS_INDETERMINATE"
  | "FIELD_DYNAMIC_ACCESS_DECLARED"
  | "DYNAMIC_ACCESS_CITATION_MISSING"
  | "DYNAMIC_ACCESS_CITATION_STALE"
  | "UNRESOLVED_CONSUMER"
  | "INDETERMINATE_CONSUMER"
  | "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY"
  | "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING"

/**
 * One reportable fact about the discovered capability graph. `severity` is
 * assigned by the rule that produces the finding, following the two
 * governing invariants in AGENTS.md: static analysis never infers a
 * relationship from insufficient evidence (an ambiguous case is `info` or
 * `indeterminate`-flavored, never guessed at as `error`), and a finding
 * built from declared metadata (e.g. a missing `protections` field) never
 * claims more than "documented" vs. "not documented."
 */
export interface ReportFinding {
  /** Which kind of fact this finding reports. */
  readonly code: ReportFindingCode
  /** Which analysis pass produced this finding -- see `ReportFindingFamily`. */
  readonly family: ReportFindingFamily
  /** How strongly this finding should be treated. */
  readonly severity: ReportSeverity
  /** Human-readable explanation of the finding. */
  readonly message: string
  /** The capability this finding is about, if any. */
  readonly capability?: {
    /** Absolute path of the file declaring the capability. */
    readonly file: string
    /** The binding name the capability is exported as. */
    readonly exportName: string
  }
  /** The field path this finding is about, if any. */
  readonly field?: readonly string[]
  /** The operation name this finding is about, if any. */
  readonly operation?: string
  /** The consuming file, for usage-scan-derived findings only. */
  readonly source?: string
  /** Position of the declaration site (capability's own call, or field's own key) this finding is anchored to, when one is available -- see ADR 0052. Additive: absent for findings with no single declaration-site anchor (e.g. a usage-scan finding whose subject is a consuming file, not a declaration). */
  readonly position?: SourcePosition
  /** Every candidate access site a `"FIELD_ACCESS_INDETERMINATE"` finding could actually be about -- populated only for that code. Spans potentially multiple consuming files, so each entry carries its own `file` (`SourceLocation`, not just `SourcePosition`). */
  readonly indeterminateSites?: readonly SourceLocation[]
}
