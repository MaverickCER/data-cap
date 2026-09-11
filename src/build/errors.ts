/**
 * Coded error thrown by `generateDataArtifacts` when at least one blocking
 * (`error`-severity, post-`--strict*`-escalation) finding exists. Nothing
 * is written in that case -- atomicity is a hard invariant, not an
 * optimization: a partially-written artifact set is worse than none.
 * Carries every finding (not just the first) so a caller can report the
 * full picture.
 */

import { DataCapError } from "../core/errors.js"
import type { ReportFinding } from "./findings.js"

export class DataProjectGenerationError extends DataCapError {
  readonly code = "DATA_CAP_PROJECT_GENERATION_FAILED"
  /** Every finding from the run (not just the blocking ones), for a caller that wants the full picture. */
  readonly findings: readonly ReportFinding[]

  constructor(findings: readonly ReportFinding[]) {
    const blocking = findings.filter((finding) => finding.severity === "error")
    super(
      [
        `${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"} prevented artifact generation:`,
        ...blocking.map((finding) => `  - [${finding.code}] ${finding.message}`),
      ].join("\n"),
    )
    this.name = "DataProjectGenerationError"
    this.findings = findings
  }
}
