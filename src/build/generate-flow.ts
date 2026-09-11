/**
 * Orchestrates C10: builds the flow graph, renders the overview/per-
 * capability/per-sensitivity-level Mermaid diagrams, and the Security
 * Data-Flow Review. Pure -- returns `{path, content}` entries for the
 * caller (C8's orchestrator) to write; performs no filesystem access
 * itself, matching `generate-manifest.ts`/`generate-documentation.ts`.
 */

import path from "node:path"
import { displayPath } from "./display-path.js"
import { evidenceDisclaimer, evidenceProjectionNote, generatedBanner } from "./generated-banner.js"
import { buildFlowGraph } from "./flow-graph.js"
import {
  renderCapabilityDiagram,
  renderOverviewDiagram,
  renderSensitivityDiagram,
} from "./flow-diagram.js"
import type { CapabilityInventory } from "./inventory.js"
import type { DependencyEdge } from "./dependency-types.js"
import type { ReportFinding, ReportSeverity } from "./findings.js"

/** Options for `generateFlow`. */
export interface GenerateFlowOptions {
  /** The inventory to build the flow graph from. */
  readonly inventory: CapabilityInventory
  /** Discovery root every rendered path (consumer nodes, proven-edge labels) displays relative to. */
  readonly root: string
  /** Directory the flow artifact set will be written under. */
  readonly location: string
  /** Proven consumer edges from a usage scan, used to derive in-repo flow paths. */
  readonly edges: readonly DependencyEdge[]
  /** Findings from other passes (C2's static rules, C6's usage scan) to fold into the Security Data-Flow Review -- optional, so `--flow` alone still produces a meaningful review of just its own findings. */
  readonly additionalFindings?: readonly ReportFinding[]
  /** This same run's own `--evidence` output path, when requested -- named in the generated banner's Evidence Model note. */
  readonly evidencePath?: string
}

/** One file within the generated flow artifact set. */
export interface GenerateFlowFile {
  /** Absolute output path. */
  readonly path: string
  /** The file's full rendered content. */
  readonly content: string
}

/** The generated Data Flow Diagram + Security Data-Flow Review set. */
export interface GenerateFlowResult {
  /** The directory this set was written under. */
  readonly location: string
  /** Every generated file in the set. */
  readonly files: readonly GenerateFlowFile[]
  /** This pass's own findings only (`SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY`) -- `additionalFindings` are folded into the rendered review but not echoed back here, so a caller aggregating findings across every generator never double-counts them. */
  readonly findings: readonly ReportFinding[]
}

function sanitizeFileName(text: string): string {
  return text.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function renderSeverityGroup(findings: readonly ReportFinding[], severity: ReportSeverity): string {
  const matches = findings.filter((f) => f.severity === severity)
  if (matches.length === 0) return "_None._"
  return matches.map((f) => `- **${f.code}**: ${f.message}`).join("\n")
}

function renderOverviewMarkdown(
  reviewFindings: readonly ReportFinding[],
  diagram: string,
  evidencePath: string | undefined,
): string {
  return [
    generatedBanner("markdown"),
    "",
    `> ${evidenceDisclaimer()}`,
    "",
    `> ${evidenceProjectionNote(evidencePath)}`,
    "",
    "# Data Flow Diagram & Security Data-Flow Review",
    "",
    "This report cannot trace data *through* a third-party system once it reaches an external-service/api endpoint -- what that system does with it afterward is unknowable to a static scan of one repository. It does not assign a regulatory classification, since that's jurisdiction-specific; record it in a capability's `metadata` instead (see `specs/decisions/0049-capability-metadata-vocabulary.md`).",
    "",
    "## Security Data-Flow Review",
    "",
    "### Critical (error)",
    "",
    renderSeverityGroup(reviewFindings, "error"),
    "",
    "### Warnings",
    "",
    renderSeverityGroup(reviewFindings, "warning"),
    "",
    "### Informational",
    "",
    renderSeverityGroup(reviewFindings, "info"),
    "",
    "## System overview diagram",
    "",
    "```mermaid",
    diagram,
    "```",
    "",
  ].join("\n")
}

/** Builds the flow graph and renders the full Data Flow Diagram + Security Data-Flow Review artifact set (C10). */
export function generateFlow(options: GenerateFlowOptions): GenerateFlowResult {
  const { inventory, root, location, edges, evidencePath } = options
  const flowGraph = buildFlowGraph(inventory, edges)
  // Array-literal spread, not `.unshift(...arr)` -- `unshift`/`push` pass a
  // spread argument list as individual call arguments, which throws
  // "Maximum call stack size exceeded" (V8's native argument-count limit,
  // not a real recursion depth) once `additionalFindings` is large enough
  // (hit at real-world project sizes -- see the extreme-tier benchmark).
  const reviewFindings =
    options.additionalFindings !== undefined
      ? [...options.additionalFindings, ...flowGraph.findings]
      : [...flowGraph.findings]

  const files: GenerateFlowFile[] = []

  const overviewDiagram = renderOverviewDiagram(inventory.capabilities, flowGraph.fields, root)
  files.push({ path: path.join(location, "overview.mmd"), content: overviewDiagram })
  files.push({
    path: path.join(location, "overview.md"),
    content: renderOverviewMarkdown(
      reviewFindings,
      overviewDiagram,
      evidencePath === undefined ? undefined : displayPath(root, evidencePath),
    ),
  })

  for (const capability of inventory.capabilities) {
    if (!capability.active) continue
    files.push({
      path: path.join(location, "capabilities", `${sanitizeFileName(capability.exportName)}.mmd`),
      content: renderCapabilityDiagram(capability, flowGraph.fields, root),
    })
  }

  const levels = new Set(
    flowGraph.fields
      .map((flow) => flow.sensitivity)
      .filter((sensitivity): sensitivity is string => sensitivity !== undefined),
  )
  for (const level of levels) {
    files.push({
      path: path.join(location, "sensitivity", `${sanitizeFileName(level)}.mmd`),
      content: renderSensitivityDiagram(level, inventory.capabilities, flowGraph.fields, root),
    })
  }

  return { location, files, findings: flowGraph.findings }
}
