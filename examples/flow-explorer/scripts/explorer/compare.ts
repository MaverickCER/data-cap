/**
 * Comparing two revisions of the evidence, as data.
 *
 * Every question is answered by data-cap itself: `diffFlow` says which nodes, edges and unknowns differ (by
 * content-addressed id), and the policy results are compared by the rule, field and boundary they are about.
 * This module only arranges the answers into a list a person can read and walk -- the page renders the same
 * list as buttons, `npm run docs` renders it as plain text (`docs/flow.diff.md`), and the page's static HTML
 * carries it too, so the comparison reads without scripts.
 *
 * It is browser-safe (no Node imports) and has no DOM access: tests call it directly.
 */
import { diffFlow } from "data-cap/evidence"
import type { FlowEdge, FlowModel, FlowNode, FlowUnknown, PolicyResult } from "data-cap/evidence"
import type { EvidenceModel } from "data-cap/build"

export type ChangeGroup =
  | "added-edges"
  | "removed-edges"
  | "added-nodes"
  | "removed-nodes"
  | "changed-nodes"
  | "new-unknowns"
  | "resolved-unknowns"
  | "changed-policy"

/** Which revision a change item can be inspected in: the one on screen, or only the one compared against. */
export type ChangeSide = "now" | "before"

export interface ChangeItem {
  /** `group|id`: stable, and what the URL records for a selected change. */
  readonly key: string
  readonly group: ChangeGroup
  /** The id of the node, edge or unknown (a policy result's key for a policy change). */
  readonly id: string
  readonly kind: "node" | "edge" | "unknown" | "policy"
  readonly side: ChangeSide
  /** One line a person (or a screen reader) can understand without the graph. */
  readonly label: string
  /** `file:line:column` when the evidence knows where this arises. */
  readonly location: string | undefined
  /** Ids of graph elements to highlight for this item (edges of a policy result, the node itself). */
  readonly highlights: readonly string[]
}

export interface ChangeSection {
  readonly group: ChangeGroup
  readonly heading: string
  readonly items: readonly ChangeItem[]
}

export interface Comparison {
  readonly unchanged: boolean
  readonly sections: readonly ChangeSection[]
  /** Ids that are new or different in the revision on screen, by kind, for highlighting. */
  readonly added: { readonly nodes: ReadonlySet<string>; readonly edges: ReadonlySet<string> }
  readonly changed: { readonly nodes: ReadonlySet<string>; readonly edges: ReadonlySet<string> }
  readonly counts: Readonly<Record<ChangeGroup, number>>
}

const HEADINGS: Readonly<Record<ChangeGroup, string>> = {
  "changed-policy": "Changed policy results",
  "added-edges": "Added edges",
  "removed-edges": "Removed edges",
  "added-nodes": "Added nodes",
  "removed-nodes": "Removed nodes",
  "changed-nodes": "Changed nodes",
  "new-unknowns": "New unknowns (parts of the program the analysis could not follow)",
  "resolved-unknowns": "Resolved unknowns",
}

const ORDER: readonly ChangeGroup[] = [
  "changed-policy",
  "added-edges",
  "removed-edges",
  "added-nodes",
  "removed-nodes",
  "changed-nodes",
  "new-unknowns",
  "resolved-unknowns",
]

const pathText = (path: readonly string[] | undefined): string => (path === undefined ? "" : path.length === 0 ? " (whole)" : ` ${path.join(".")}`)

function nameOf(nodes: ReadonlyMap<string, FlowNode>, id: string): string {
  return nodes.get(id)?.name ?? id
}

function edgeLabel(edge: FlowEdge, nodes: ReadonlyMap<string, FlowNode>): string {
  return `${edge.kind}${pathText(edge.path)}: ${nameOf(nodes, edge.from)} to ${nameOf(nodes, edge.to)} (${edge.status})`
}

const edgeLocation = (edge: FlowEdge): string | undefined => (edge.source === undefined ? undefined : `${edge.source.file}:${edge.source.line}:${edge.source.column}`)
const nodeLocation = (node: FlowNode): string | undefined => (node.source === undefined ? undefined : `${node.scope}:${node.source.line}:${node.source.column}`)
const unknownLocation = (unknown: FlowUnknown): string => `${unknown.source.file}:${unknown.source.line}:${unknown.source.column}`

function nodeItem(group: ChangeGroup, node: FlowNode, side: ChangeSide, label: string): ChangeItem {
  return { key: `${group}|${node.id}`, group, id: node.id, kind: "node", side, label, location: nodeLocation(node), highlights: [node.id] }
}

function edgeItem(group: ChangeGroup, edge: FlowEdge, side: ChangeSide, nodes: ReadonlyMap<string, FlowNode>): ChangeItem {
  return { key: `${group}|${edge.id}`, group, id: edge.id, kind: "edge", side, label: edgeLabel(edge, nodes), location: edgeLocation(edge), highlights: [edge.id] }
}

function unknownItem(group: ChangeGroup, unknown: FlowUnknown, side: ChangeSide): ChangeItem {
  return {
    key: `${group}|${unknown.id}`,
    group,
    id: unknown.id,
    kind: "unknown",
    side,
    label: `${unknown.reason} at ${unknownLocation(unknown)}${unknown.detail === undefined ? "" : ` -- ${unknown.detail}`}`,
    location: unknownLocation(unknown),
    highlights: [unknown.id],
  }
}

/** Results are matched by rule and field: a rule that held before and is violated now has different boundaries, but it is one question. */
function policyGroups(evidence: EvidenceModel): Map<string, PolicyResult[]> {
  const groups = new Map<string, PolicyResult[]>()
  for (const result of evidence.policy?.results ?? []) {
    const key = `${result.ruleId}|${result.subject ?? ""}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  }
  return groups
}

function describeResults(results: readonly PolicyResult[] | undefined, nodes: ReadonlyMap<string, FlowNode>): string {
  if (results === undefined) return "absent"
  const parts = results.map((result) => `${result.outcome}${result.reason === undefined ? "" : ` (${result.reason})`}${result.boundary === undefined ? "" : ` reaching ${nameOf(nodes, result.boundary)}`}, ${result.basis}`)
  return [...new Set(parts)].sort().join("; ")
}

function policyChanges(before: EvidenceModel, after: EvidenceModel, beforeNodes: ReadonlyMap<string, FlowNode>, afterNodes: ReadonlyMap<string, FlowNode>): ChangeItem[] {
  const was = policyGroups(before)
  const now = policyGroups(after)
  const items: ChangeItem[] = []
  for (const key of [...new Set([...was.keys(), ...now.keys()])].sort()) {
    const previous = was.get(key)
    const current = now.get(key)
    const beforeText = describeResults(previous, beforeNodes)
    const afterText = describeResults(current, afterNodes)
    if (beforeText === afterText) continue
    const shown = (current ?? previous ?? [])[0]
    if (shown === undefined) continue
    const nodes = current === undefined ? beforeNodes : afterNodes
    const subject = shown.subject === undefined ? "" : ` for ${nameOf(nodes, shown.subject)}`
    // The crossing is the last edge of the path a result rests on: that is where the code to look at is.
    const anchored = (current ?? previous ?? []).filter((result) => result.edges.length > 0).at(-1)
    const anchor = anchored?.edges.at(-1)
    const edges = (current === undefined ? before.flow?.edges : after.flow?.edges) ?? []
    const edge = edges.find((candidate) => candidate.id === anchor)
    items.push({
      key: `changed-policy|${key}`,
      group: "changed-policy",
      id: key,
      kind: "policy",
      side: current === undefined ? "before" : "now",
      label: `${shown.ruleId}${subject}: ${beforeText} before, ${afterText} now`,
      location: edge === undefined ? undefined : edgeLocation(edge),
      highlights: (current ?? []).flatMap((result) => (result.outcome === "satisfied" ? [] : result.edges)),
    })
  }
  return items
}

const byLabel = (a: ChangeItem, b: ChangeItem): number => a.label.localeCompare(b.label, "en") || a.key.localeCompare(b.key, "en")

/** Compares two revisions of the evidence. Both must have a flow. */
export function compareEvidence(before: EvidenceModel, after: EvidenceModel): Comparison {
  const beforeFlow = before.flow as FlowModel
  const afterFlow = after.flow as FlowModel
  const diff = diffFlow(beforeFlow, afterFlow)
  const beforeNodes = new Map(beforeFlow.nodes.map((node) => [node.id, node]))
  const afterNodes = new Map(afterFlow.nodes.map((node) => [node.id, node]))

  const groups: Record<ChangeGroup, ChangeItem[]> = {
    "changed-policy": policyChanges(before, after, beforeNodes, afterNodes),
    "added-edges": diff.addedEdges.map((edge) => edgeItem("added-edges", edge, "now", afterNodes)),
    "removed-edges": diff.removedEdges.map((edge) => edgeItem("removed-edges", edge, "before", beforeNodes)),
    "added-nodes": diff.addedNodes.map((node) => nodeItem("added-nodes", node, "now", `${node.kind} ${node.name} (${node.status})`)),
    "removed-nodes": diff.removedNodes.map((node) => nodeItem("removed-nodes", node, "before", `${node.kind} ${node.name} (${node.status})`)),
    "changed-nodes": diff.changedNodes.map((change) =>
      nodeItem("changed-nodes", change.after, "now", `${change.after.kind} ${change.after.name}: ${change.before.status}${change.before.classification === change.after.classification ? "" : `, ${change.before.classification ?? "unclassified"}`} before, ${change.after.status}${change.before.classification === change.after.classification ? "" : `, ${change.after.classification ?? "unclassified"}`} now`),
    ),
    "new-unknowns": diff.addedUnknowns.map((unknown) => unknownItem("new-unknowns", unknown, "now")),
    "resolved-unknowns": diff.removedUnknowns.map((unknown) => unknownItem("resolved-unknowns", unknown, "before")),
  }
  for (const items of Object.values(groups)) items.sort(byLabel)

  const sections = ORDER.map((group) => ({ group, heading: HEADINGS[group], items: groups[group] }))
  const counts = Object.fromEntries(ORDER.map((group) => [group, groups[group].length])) as Record<ChangeGroup, number>
  const policyEdges = new Set(groups["changed-policy"].flatMap((item) => (item.side === "now" ? item.highlights : [])))
  return {
    unchanged: ORDER.every((group) => counts[group] === 0),
    sections,
    added: {
      nodes: new Set([...diff.addedNodes.map((node) => node.id), ...diff.addedUnknowns.map((unknown) => unknown.id)]),
      edges: new Set(diff.addedEdges.map((edge) => edge.id)),
    },
    changed: { nodes: new Set(diff.changedNodes.map((change) => change.after.id)), edges: policyEdges },
    counts,
  }
}

/** One sentence for the live region and the top of the list. */
export function summarize(comparison: Comparison, name: string): string {
  if (comparison.unchanged) return `No difference from ${name}.`
  const { counts } = comparison
  return `Compared with ${name}: ${counts["added-edges"]} edge(s) added, ${counts["removed-edges"]} removed; ${counts["added-nodes"]} node(s) added, ${counts["removed-nodes"]} removed, ${counts["changed-nodes"]} changed; ${counts["new-unknowns"]} new unknown(s), ${counts["resolved-unknowns"]} resolved; ${counts["changed-policy"]} policy result(s) changed.`
}

/** The comparison as plain Markdown: the textual equivalent, readable in a pull request. */
export function renderComparisonMarkdown(comparison: Comparison, name: string): string {
  const lines = [`# Data-flow changes`, "", summarize(comparison, name), ""]
  for (const section of comparison.sections) {
    lines.push(`## ${section.heading}`, "")
    if (section.items.length === 0) lines.push("- none")
    for (const item of section.items) lines.push(`- ${item.label}${item.location === undefined ? "" : ` [${item.location}]`}${item.side === "before" ? " (only in the earlier revision)" : ""}`)
    lines.push("")
  }
  return `${lines.join("\n")}`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/**
 * The comparison as HTML: a summary line (a live region of its own, so a screen reader hears one sentence rather than
 * the whole list), then one headed list per kind of change. `interactive` makes each item a native button the page
 * wires up; without it the same list is plain text, which is what the page ships with so it reads without scripts.
 */
export function renderComparisonHtml(comparison: Comparison, name: string, interactive: boolean): string {
  const summary = `<p id="diff-summary" role="status">${escapeHtml(summarize(comparison, name))}</p>`
  if (comparison.unchanged) return summary
  const sections = comparison.sections.map((section) => {
    const items =
      section.items.length === 0
        ? "<li>none</li>"
        : section.items
            .map((item) => {
              const label = interactive ? `<button type="button" data-change="${escapeHtml(item.key)}">${escapeHtml(item.label)}</button>` : escapeHtml(item.label)
              const where = item.location === undefined ? "" : ` <span class="where">${escapeHtml(item.location)}</span>`
              return `<li>${label}${where}</li>`
            })
            .join("")
    return `<h3>${escapeHtml(section.heading)} (${section.items.length})</h3><ul data-group="${section.group}">${items}</ul>`
  })
  const note = "<p>Items only in the revision compared against are listed but not drawn: they are not in this revision&rsquo;s graph.</p>"
  return `${summary}${sections.join("")}${note}`
}
