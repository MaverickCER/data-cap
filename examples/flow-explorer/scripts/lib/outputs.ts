/**
 * Every file the example produces, computed in memory from the one pipeline run.
 * `build.ts` writes them; `check.ts` diffs them against what is committed. Each
 * is a projection of the evidence file -- none of them reads a source file.
 */
import { instance } from "@viz-js/viz"
import {
  buildFlowGraphView,
  buildOscalAssessmentResults,
  buildProvDocument,
  buildSarifLog,
  observationsToOtlp,
  renderFlowDot,
  renderFlowMermaid,
  renderFlowText,
} from "data-cap/build"
import type { ReportResult } from "data-cap/build"
import { recordScenario } from "../../src/instrumentation.js"
import { buildExplorerHtml } from "./explorer.js"
import { CONTROLS, runPipeline } from "./pipeline.js"

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

export interface Outputs {
  readonly result: ReportResult
  /** Root-relative path under docs/ to content. */
  readonly files: Readonly<Record<string, string>>
}

export async function computeOutputs(): Promise<Outputs> {
  const observations = await recordScenario()
  const result = await runPipeline({ observations })
  // The revision before the debug endpoint existed: what the explorer compares against.
  const before = await runPipeline({
    observations: observations.filter((event) => event.scope !== "scenario:debug-export"),
    exclude: ["src/app/export.ts"],
  })
  const { evidence } = result

  const dot = renderFlowDot(evidence)
  const mermaid = renderFlowMermaid(evidence)
  const text = renderFlowText(evidence)
  const prov = buildProvDocument(evidence)
  const oscal = buildOscalAssessmentResults(evidence, { controls: CONTROLS, title: "Profile service: data-flow assessment" })
  const otlp = observationsToOtlp(evidence, { serviceName: "profile-service" })
  if (dot === undefined || mermaid === undefined || text === undefined || prov === undefined || oscal === undefined || otlp === undefined || evidence.finding === undefined) {
    throw new Error("the example's evidence is missing a sub-model; the flow analysis did not run")
  }

  const viz = await instance()
  const svg = viz.renderString(dot, { format: "svg", engine: "dot" })
  const html = await buildExplorerHtml({ evidence, baseline: before.evidence, svg, text })

  return {
    result,
    files: {
      "data.evidence.json": json(evidence),
      "observations.json": json(observations),
      "flow.md": `${text}\n## Diagram\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n`,
      "flow.mmd": mermaid,
      "flow.dot": dot,
      "flow.svg": svg,
      "flow.graph-view.json": json(buildFlowGraphView(evidence)),
      "flow.prov.json": json(prov),
      "flow.sarif.json": json(buildSarifLog(evidence.finding, { flow: evidence.flow })),
      "flow.oscal.json": json(oscal),
      "flow.otlp.json": json(otlp),
      "explorer.html": html,
    },
  }
}
