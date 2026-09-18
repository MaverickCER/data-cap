import type { ReportFinding, ReportResult } from "../build/index.js"
import { PACKAGE_VERSION } from "../build/package-version.js"

/**
 * `--json`'s machine-readable contract lives here, in one place, so it's
 * unit/snapshot-testable without going through `main()`'s stdout spying and
 * doesn't make the CLI's control-flow function the de facto owner of a
 * public contract.
 */

/** Bump only when a consumer written for the previous version could
 *  misinterpret the new payload (a field changes type/meaning, or is
 *  removed) -- NOT for every additive field. */
export const JSON_SCHEMA_VERSION = 1

// One version source, shared with the `./build` entry -- `PACKAGE_VERSION` is
// `tsup`'s build-time constant (ADR 0058), so the CLI never reads its own
// manifest at runtime.
const TOOL_VERSION: string = PACKAGE_VERSION

/** The `--json` envelope for a successful run (generation completed without throwing). */
export interface JsonSuccessPayload extends ReportResult {
  readonly schemaVersion: typeof JSON_SCHEMA_VERSION
  readonly kind: "data-cap-report"
  readonly toolVersion: string
  readonly ok: true
  /** Present only when invoked with --check. Governs --check's own pass/fail
   *  exit code, independent of this envelope's top-level `ok` (which keeps
   *  its existing, unrelated meaning: "did generation complete without
   *  throwing"). */
  readonly checkResult?: { readonly ok: boolean; readonly stale: readonly string[] }
}

/** A thrown error's shape in the `--json` envelope. */
export interface JsonErrorInfo {
  readonly name: string
  readonly message: string
  /** Populated only when the thrown error carries a `ReportFinding[]` (`DataProjectGenerationError` always does). */
  readonly findings?: readonly ReportFinding[]
}

/** The `--json` envelope for a failed run (generation threw). */
export interface JsonErrorPayload {
  readonly schemaVersion: typeof JSON_SCHEMA_VERSION
  readonly kind: "data-cap-report"
  readonly toolVersion: string
  readonly ok: false
  readonly error: JsonErrorInfo
}

function hasFindings(error: unknown): error is { findings: readonly ReportFinding[] } {
  return (
    typeof error === "object" &&
    error !== null &&
    Array.isArray((error as { findings?: unknown }).findings)
  )
}

/** Wraps a completed {@link generateDataArtifacts}/{@link checkArtifacts} result in the `--json` success envelope. */
export function serializeSuccess(
  result: ReportResult,
  checkResult?: { readonly ok: boolean; readonly stale: readonly string[] },
): JsonSuccessPayload {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    kind: "data-cap-report",
    toolVersion: TOOL_VERSION,
    ok: true,
    ...result,
    ...(checkResult ? { checkResult } : {}),
  }
}

/** Wraps a thrown error in the `--json` failure envelope. */
export function serializeFailure(error: unknown): JsonErrorPayload {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    kind: "data-cap-report",
    toolVersion: TOOL_VERSION,
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      // exactOptionalPropertyTypes: omit the key rather than set it to
      // `undefined` when the thrown error carries no findings of its own.
      ...(hasFindings(error) ? { findings: error.findings } : {}),
    },
  }
}

/**
 * The complete `--json` envelope shape, success or failure -- the target
 * type the published JSON Schema (`schemas/data-cap-report.schema.json`,
 * `npm run schema`) is generated from.
 */
export type JsonReportPayload = JsonSuccessPayload | JsonErrorPayload

/** Writes a `--json` envelope to stdout, pretty-printed with a trailing newline. */
export function writeJson(payload: JsonReportPayload): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}
