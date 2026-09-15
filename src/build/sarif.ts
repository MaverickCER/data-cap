/**
 * SARIF Security Findings Report (ADR 0050) -- an adapter over Finding
 * Model, not a new fact source. Produces a minimal, spec-conformant SARIF
 * 2.1.0 log (https://docs.oasis-open.org/sarif/sarif/v2.1.0/) so `data-cap`'s
 * findings can be consumed by any SARIF-aware tool (GitHub code scanning,
 * most CI security dashboards) without a bespoke integration.
 */

import { PACKAGE_VERSION } from "./package-version.js"
import type { FindingModel, LocatedFinding } from "./finding-model.js"
import type { ReportSeverity } from "./findings.js"

/** SARIF's `level` enum -- see the SARIF 2.1.0 spec, section 3.27.10. */
type SarifLevel = "none" | "note" | "warning" | "error"

function sarifLevel(severity: ReportSeverity): SarifLevel {
  if (severity === "info") return "note"
  return severity
}

interface SarifLocation {
  readonly physicalLocation: { readonly artifactLocation: { readonly uri: string } }
}

function sarifLocations(finding: LocatedFinding): readonly SarifLocation[] | undefined {
  if (finding.location.kind === "none") return undefined
  return [{ physicalLocation: { artifactLocation: { uri: finding.location.capability.file } } }]
}

interface SarifResult {
  readonly ruleId: string
  readonly level: SarifLevel
  readonly message: { readonly text: string }
  readonly locations?: readonly SarifLocation[]
}

/** A minimal SARIF 2.1.0 log -- only the properties this adapter actually populates, not the full spec surface. */
export interface SarifLog {
  readonly $schema: string
  readonly version: "2.1.0"
  readonly runs: readonly {
    readonly tool: {
      readonly driver: {
        readonly name: string
        readonly informationUri: string
        readonly version: string
        readonly rules: readonly { readonly id: string }[]
      }
    }
    readonly results: readonly SarifResult[]
  }[]
}

/** Projects Finding Model into a SARIF 2.1.0 log. */
export function buildSarifLog(findingModel: FindingModel): SarifLog {
  const ruleIds = [...new Set(findingModel.findings.map((f) => f.code))].sort()

  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "data-cap",
            informationUri: "https://github.com/maverickcer/data-cap#readme",
            version: PACKAGE_VERSION,
            rules: ruleIds.map((id) => ({ id })),
          },
        },
        // exactOptionalPropertyTypes: spread `locations` in only when
        // sarifLocations() actually has one, rather than ever setting the
        // key to `undefined` explicitly.
        results: findingModel.findings.map((finding) => {
          const locations = sarifLocations(finding)
          return {
            ruleId: finding.code,
            level: sarifLevel(finding.severity),
            message: { text: finding.message },
            ...(locations === undefined ? {} : { locations }),
          }
        }),
      },
    ],
  }
}
