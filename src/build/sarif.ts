/**
 * SARIF Security Findings Report (ADR 0050) -- an adapter over Finding
 * Model, not a new fact source. Produces a minimal, spec-conformant SARIF
 * 2.1.0 log (https://docs.oasis-open.org/sarif/sarif/v2.1.0/) so `data-cap`'s
 * findings can be consumed by any SARIF-aware tool (GitHub code scanning,
 * most CI security dashboards) without a bespoke integration.
 *
 * A finding that carries flow evidence (ADR 0070) is anchored at the code it is
 * about -- a precise region -- and, when the evidence is a path through the
 * program, gets a SARIF `codeFlow`: the steps from where the data starts to
 * where it leaves. SARIF represents findings, not the complete data-flow
 * graph; the graph itself is the Evidence Model's `flow`.
 */

import type { EvidenceRef } from "../flow/claims-model.js"
import type { FlowEdge, FlowModel, FlowNode, FlowUnknown } from "../flow/flow-model.js"
import { PACKAGE_VERSION } from "./package-version.js"
import type { FindingModel, LocatedFinding } from "./finding-model.js"
import type { ReportSeverity } from "./findings.js"

/** SARIF's `level` enum -- see the SARIF 2.1.0 spec, section 3.27.10. */
type SarifLevel = "none" | "note" | "warning" | "error"

function sarifLevel(severity: ReportSeverity): SarifLevel {
  if (severity === "info") return "note"
  return severity
}

/** A SARIF `physicalLocation`. */
interface SarifPhysicalLocation {
  readonly artifactLocation: { readonly uri: string; readonly uriBaseId?: string }
  readonly region?: { readonly startLine: number; readonly startColumn: number }
}

interface SarifLocation {
  readonly physicalLocation: SarifPhysicalLocation
}

interface SarifThreadFlowLocation {
  readonly location: SarifLocation & { readonly message: { readonly text: string } }
}

interface SarifCodeFlow {
  readonly threadFlows: readonly { readonly locations: readonly SarifThreadFlowLocation[] }[]
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
  readonly codeFlows?: readonly SarifCodeFlow[]
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

/** Options for `buildSarifLog`. */
export interface BuildSarifLogOptions {
  /** The Flow Model that findings' flow evidence refers to; without it findings keep their coarse, file-level location. */
  readonly flow?: FlowModel | undefined
}

function at(file: string, line: number, column: number): SarifPhysicalLocation {
  return {
    artifactLocation: { uri: file, uriBaseId: "%SRCROOT%" },
    region: { startLine: line, startColumn: column },
  }
}

function edgeStep(edge: FlowEdge): SarifThreadFlowLocation | undefined {
  if (edge.source === undefined) return undefined
  const path =
    edge.path === undefined ? "" : ` ${edge.path.length === 0 ? "(whole)" : edge.path.join(".")}`
  const status = edge.status === "static" ? "" : ` [${edge.status}]`
  return {
    location: {
      physicalLocation: at(edge.source.file, edge.source.line, edge.source.column),
      message: { text: `${edge.kind}${path}${status}` },
    },
  }
}

/** Resolves a finding's flow evidence to SARIF locations: the precise primary location and, for a path, the code flow. */
function flowEvidence(
  refs: readonly EvidenceRef[],
  flow: FlowModel,
): {
  readonly primary: SarifPhysicalLocation | undefined
  readonly codeFlow: SarifCodeFlow | undefined
} {
  const edges = new Map<string, FlowEdge>(flow.edges.map((edge) => [edge.id, edge]))
  const unknowns = new Map<string, FlowUnknown>(
    flow.unknowns.map((unknown) => [unknown.id, unknown]),
  )
  const nodes = new Map<string, FlowNode>(flow.nodes.map((node) => [node.id, node]))

  const steps: SarifThreadFlowLocation[] = []
  let primary: SarifPhysicalLocation | undefined
  for (const ref of refs) {
    if (ref.model !== "flow") continue
    const edge = edges.get(ref.id)
    if (edge !== undefined) {
      const step = edgeStep(edge)
      if (step !== undefined) {
        steps.push(step)
        primary = step.location.physicalLocation
      }
      continue
    }
    const unknown = unknowns.get(ref.id)
    if (unknown !== undefined) {
      primary = at(unknown.source.file, unknown.source.line, unknown.source.column)
      continue
    }
    const node = nodes.get(ref.id)
    if (node?.source !== undefined && primary === undefined)
      primary = at(node.scope, node.source.line, node.source.column)
  }
  return {
    primary,
    codeFlow: steps.length === 0 ? undefined : { threadFlows: [{ locations: steps }] },
  }
}

/** Projects Finding Model into a SARIF 2.1.0 log. */
export function buildSarifLog(
  findingModel: FindingModel,
  options: BuildSarifLogOptions = {},
): SarifLog {
  const ruleIds = [...new Set(findingModel.findings.map((f) => f.code))].sort()

  return {
    $schema:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
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
        // exactOptionalPropertyTypes: spread `locations`/`codeFlows` in only
        // when there is one, rather than ever setting the key to `undefined`
        // explicitly.
        results: findingModel.findings.map((finding) => {
          const resolved =
            options.flow !== undefined && finding.evidence !== undefined
              ? flowEvidence(finding.evidence, options.flow)
              : undefined
          const locations =
            resolved?.primary === undefined
              ? sarifLocations(finding)
              : [{ physicalLocation: resolved.primary }]
          return {
            ruleId: finding.code,
            level: sarifLevel(finding.severity),
            message: { text: finding.message },
            ...(locations === undefined ? {} : { locations }),
            ...(resolved?.codeFlow === undefined ? {} : { codeFlows: [resolved.codeFlow] }),
          }
        }),
      },
    ],
  }
}
