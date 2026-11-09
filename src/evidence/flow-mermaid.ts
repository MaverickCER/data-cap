/**
 * Mermaid for the data-flow graph (ADR 0070): a diagram that embeds directly
 * in Markdown -- a README, a pull request, generated API documentation -- as
 * a projection of the one Evidence Model. Statuses are in the label text, not
 * only the colour; unknowns are visible nodes; an incomplete graph says so in
 * a legend node; an edge of a violated policy is thick and red.
 */

import { nodeLabel } from "./flow-graph-view.js"
import { edgeLabel, selectDiagram } from "./flow-diagram-selection.js"
import type { DiagramInput, FlowDiagramOptions } from "./flow-diagram-selection.js"
import type { FlowNode } from "../flow/flow-model.js"
import { unknownText } from "../flow/flow-findings.js"

function quote(text: string): string {
  return `"${text.replace(/"/g, "#quot;").replace(/\n/g, "<br/>")}"`
}

function declare(id: string, node: FlowNode, label: string): string {
  const text = quote(label)
  switch (node.kind) {
    case "field":
      return `${id}[/${text}/]`
    case "function":
      return `${id}([${text}])`
    case "parameter":
    case "return":
      return `${id}(${text})`
    default:
      return `${id}[(${text})]`
  }
}

/** Renders a Mermaid flowchart, or `undefined` when no flow was computed. */
export function renderFlowMermaid(
  evidence: DiagramInput,
  options: FlowDiagramOptions = {},
): string | undefined {
  const selection = selectDiagram(evidence, options)
  if (selection === undefined) return undefined
  if (selection.missingField !== undefined) {
    return `flowchart LR\n  none[${quote(`No field named ${selection.missingField} in this evidence`)}]\n`
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

  const lines: string[] = ["flowchart LR"]
  lines.push(
    `  %% Data flow -- ${selection.complete ? "complete" : "NOT complete: parts could not be followed"}`,
  )
  lines.push(
    `  cov[${quote(selection.complete ? "Coverage: complete" : "Coverage: NOT complete -- a missing flow is not proof of absence")}]`,
  )

  for (const node of selection.nodes) {
    const classification = node.classification === undefined ? "" : `\n(${node.classification})`
    lines.push(`  ${declare(assign(node.id), node, nodeLabel(node) + classification)}`)
  }
  for (const unknown of selection.unknowns) {
    const where = `${unknown.source.file}:${unknown.source.line}:${unknown.source.column}`
    lines.push(
      `  ${assign(unknown.id)}{{${quote(`unknown: ${unknown.reason}\n${where}\n${unknownText(unknown.reason)}`)}}}`,
    )
  }

  const styles: string[] = []
  let index = 0
  const arrows: Readonly<Record<"solid" | "dotted" | "thick", (text: string) => string>> = {
    solid: (text) => ` -- ${text} --> `,
    dotted: (text) => ` -. ${text} .-> `,
    thick: (text) => ` == ${text} ==> `,
  }
  const edge = (
    from: string,
    to: string,
    label: string,
    kind: "solid" | "dotted" | "thick",
    style?: string,
  ): void => {
    lines.push(`  ${from}${arrows[kind](quote(label))}${to}`)
    if (style !== undefined) styles.push(`  linkStyle ${index} ${style}`)
    index += 1
  }
  for (const item of selection.edges) {
    const from = assign(item.from)
    const to = assign(item.to)
    const label = edgeLabel(item)
    if (selection.violated.has(item.id))
      edge(from, to, label, "thick", "stroke:#d00,stroke-width:3px")
    else if (item.status === "static" && item.kind !== "calls") edge(from, to, label, "solid")
    else if (item.status === "declared") edge(from, to, label, "dotted", "stroke:#0072b2")
    else if (item.status === "inferred") edge(from, to, label, "dotted", "stroke:#e69f00")
    else if (item.status === "unknown")
      edge(from, to, label, "dotted", "stroke:#d00,stroke-dasharray:4")
    else edge(from, to, label, "dotted", "stroke:#888")
  }
  for (const unknown of selection.unknowns) {
    const subject = ids.get(unknown.subject)
    if (subject !== undefined) {
      edge(
        subject,
        assign(unknown.id),
        "could not follow",
        "dotted",
        "stroke:#d00,stroke-dasharray:4",
      )
    }
  }
  lines.push(...styles)
  return `${lines.join("\n")}\n`
}
