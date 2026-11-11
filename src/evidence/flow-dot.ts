/**
 * Graphviz DOT for the data-flow graph (ADR 0070): a static, diffable,
 * renderer-independent picture of the one Evidence Model. Every status is
 * stated in the edge's text as well as drawn in colour and line style;
 * anything the analysis could not follow is a visible node, and a graph that
 * is not complete says so on its own title; an edge of a violated policy is
 * drawn thick and red.
 */

import { flowEvidenceDisclaimer } from "./flow-disclaimer.js"
import { nodeLabel } from "./flow-graph-view.js"
import { edgeLabel, selectDiagram } from "./flow-diagram-selection.js"
import type { DiagramInput, FlowDiagramOptions } from "./flow-diagram-selection.js"
import type { FlowNode, FlowStatus } from "../flow/flow-model.js"
import { unknownText } from "../flow/flow-findings.js"

function statusStyle(status: FlowStatus): string {
  const styles: Readonly<Record<FlowStatus, string>> = {
    static: "",
    declared: ", style=dashed, color=blue",
    observed: ", color=green4",
    inferred: ", style=dotted, color=orange",
    unknown: ", style=dashed, color=red",
  }
  return styles[status]
}

function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
}

function shapeOf(node: FlowNode): string {
  switch (node.kind) {
    case "field":
      return "parallelogram"
    case "function":
      return "box, style=rounded"
    case "parameter":
    case "return":
      return "ellipse"
    default:
      switch (node.boundaryKind) {
        case "database":
        case "cache":
        case "storage":
        case "queue":
          return "cylinder"
        case "client-response":
          return "invhouse"
        case "log":
          return "note"
        default:
          return "doubleoctagon"
      }
  }
}

function nodeStyle(node: FlowNode): string {
  if (node.status === "unknown") return ", color=red, style=dashed"
  if (node.status === "inferred") return ", color=orange, style=dashed"
  if (node.status === "declared") return ", color=blue"
  return ""
}

/** Renders DOT, or `undefined` when no flow was computed. */

export function renderFlowDot(
  evidence: DiagramInput,
  options: FlowDiagramOptions = {},
): string | undefined {
  const selection = selectDiagram(evidence, options)
  if (selection === undefined) return undefined
  if (selection.missingField !== undefined) {
    return `// ${flowEvidenceDisclaimer()}\ndigraph "data-flow" {\n  label="No field named ${escape(selection.missingField)} in this evidence";\n}\n`
  }

  // Keyed by `string | undefined` so an unknown with no subject simply finds no node.
  const ids = new Map<string | undefined, string>()
  const assign = (key: string): string => {
    const existing = ids.get(key)
    if (existing !== undefined) return existing
    const id = `n${ids.size}`
    ids.set(key, id)
    return id
  }

  const lines: string[] = [
    `// ${flowEvidenceDisclaimer()}`,
    'digraph "data-flow" {',
    "  rankdir=LR;",
    `  labelloc=t;`,
  ]
  lines.push(
    `  label="Data flow -- ${selection.complete ? "complete" : "NOT complete: parts could not be followed, so a missing flow is not proof of absence"}";`,
  )
  lines.push("  node [fontname=Helvetica];", "  edge [fontname=Helvetica];")

  for (const node of selection.nodes) {
    const classification = node.classification === undefined ? "" : `\n(${node.classification})`
    lines.push(
      `  "${assign(node.id)}" [id="${escape(node.id)}", label="${escape(nodeLabel(node) + classification)}", shape=${shapeOf(node)}${nodeStyle(node)}];`,
    )
  }
  for (const unknown of selection.unknowns) {
    const where = `${unknown.source.file}:${unknown.source.line}:${unknown.source.column}`
    lines.push(
      `  "${assign(unknown.id)}" [id="${escape(unknown.id)}", label="${escape(`unknown: ${unknown.reason}\n${where}\n${unknownText(unknown.reason)}`)}", shape=octagon, color=red, style=dashed];`,
    )
  }
  for (const edge of selection.edges) {
    const base = edge.kind === "calls" ? ", style=dashed, color=gray50" : statusStyle(edge.status)
    const emphasis = selection.violated.has(edge.id) ? ", color=red, penwidth=2" : ""
    lines.push(
      `  "${assign(edge.from)}" -> "${assign(edge.to)}" [id="${escape(edge.id)}", label="${escape(edgeLabel(edge))}"${base}${emphasis}];`,
    )
  }
  for (const unknown of selection.unknowns) {
    const subject = ids.get(unknown.subject)
    if (subject !== undefined) {
      lines.push(
        `  "${subject}" -> "${assign(unknown.id)}" [label="could not follow", style=dashed, color=red];`,
      )
    }
  }
  lines.push("}")
  return `${lines.join("\n")}\n`
}
