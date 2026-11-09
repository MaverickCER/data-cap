/**
 * The textual equivalent of the data-flow graph (ADR 0070): the same facts the
 * graph view carries, written as Markdown a screen reader, a code review, a
 * terminal or a compliance document can read without drawing anything. It is a
 * pure projection of the one Evidence Model.
 *
 * It states what the analysis could not follow as plainly as what it could,
 * and says "not complete" whenever that is so -- an absent flow below is not
 * proof that no such flow exists unless the picture is complete (ADR 0071).
 */

import { unknownText } from "../flow/flow-findings.js"
import type { FlowUnknown } from "../flow/flow-model.js"
import { buildFlowGraphView } from "./flow-graph-view.js"
import type {
  FieldView,
  FlowGraphView,
  FlowGraphViewInput,
  FunctionView,
} from "./flow-graph-view.js"

/** Options for `renderFlowText`. */
export interface FlowTextOptions {
  /** Limit the output to one field (by its name, for example `userData.user`) and the functions that touch it. */
  readonly field?: string | undefined
  /** Heading level of the title (default 1); sections nest below it, so the text can be embedded in a larger document. */
  readonly headingLevel?: number | undefined
}

function pathText(path: readonly string[]): string {
  return path.length === 0 ? "(whole)" : path.join(".")
}

function pathList(paths: readonly (readonly string[])[]): string {
  const unique = new Set(paths.map(pathText))
  const rest = [...unique].filter((path) => path !== "(whole)").sort()
  return (unique.has("(whole)") ? ["(whole)", ...rest] : rest).join(", ")
}

/** Items sharing a key, with the first of them to hand (a group is never empty). */
interface Group<T> {
  readonly first: T
  readonly items: readonly T[]
}

/** Groups by key in key order; within a group the items keep their input order (an item is ordered after an equal one, so ties never reorder). */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Group<T>[] {
  const ordered = items
    .map((item) => ({ id: key(item), item }))
    .sort((x, y) => (x.id < y.id ? -1 : 1))
  const groups = new Map<string, { readonly first: T; readonly items: T[] }>()
  for (const { id, item } of ordered) {
    const group = groups.get(id)
    if (group === undefined) groups.set(id, { first: item, items: [item] })
    else group.items.push(item)
  }
  return [...groups.values()]
}

function names(refs: readonly { readonly name: string }[]): string {
  return refs.length === 0 ? "none" : [...new Set(refs.map((ref) => ref.name))].sort().join(", ")
}

function locationOf(unknown: FlowUnknown): string {
  return `${unknown.source.file}:${unknown.source.line}:${unknown.source.column}`
}

function functionBlock(
  fn: FunctionView,
  unknowns: ReadonlyMap<string, FlowUnknown>,
  heading: string,
): string[] {
  const lines = [`${heading} ${fn.name}`, ""]
  lines.push(`- Confidence: ${fn.confidence}`)
  if (fn.classifications.length > 0)
    lines.push(`- Classifications: ${fn.classifications.join(", ")}`)
  lines.push(
    `- Inputs: ${fn.inputs.length === 0 ? "none" : fn.inputs.map((input) => input.name.slice(input.name.lastIndexOf(".") + 1)).join(", ")}`,
  )

  const reads = groupBy(fn.reads, (read) => `${read.field}\u0000${read.via}`).map(
    ({ first, items }) =>
      `${first.field}${first.via === "field" ? "" : ` (via ${first.via})`}: ${pathList(items.map((read) => read.path))}`,
  )
  lines.push(`- Reads: ${reads.length === 0 ? "none" : reads.join("; ")}`)

  const returned = groupBy(
    fn.forwards.filter((flow) => flow.kind === "returns"),
    (flow) => flow.field,
  ).map(({ first, items }) => `${first.field}: ${pathList(items.map((flow) => flow.path))}`)
  lines.push(`- Returns: ${returned.length === 0 ? "none" : returned.join("; ")}`)

  const passed = groupBy(
    fn.forwards.filter((flow) => flow.kind !== "returns"),
    (flow) => `${flow.to}\u0000${flow.field}`,
  ).map(
    ({ first, items }) =>
      `${first.toName} -- ${first.field}: ${pathList(items.map((flow) => flow.path))}`,
  )
  lines.push(`- Passes on: ${passed.length === 0 ? "none" : passed.join("; ")}`)

  const effects = groupBy(
    fn.sideEffects,
    (effect) => `${effect.boundary}\u0000${effect.field}`,
  ).map(({ first, items }) => {
    const handling = [
      ...new Set(
        items.flatMap((effect) => (effect.handling === undefined ? [] : [effect.handling])),
      ),
    ]
    return `${first.boundaryKind ?? "boundary"} ${first.boundaryName}: ${first.field}: ${pathList(items.map((effect) => effect.path))}${handling.length === 0 ? "" : ` (${handling.join(", ")})`}`
  })
  lines.push(`- Side effects: ${effects.length === 0 ? "none" : effects.join("; ")}`)

  const discards = groupBy(fn.discards, (discard) => discard.field).map(
    ({ first, items }) => `${first.field}: ${pathList(items.map((discard) => discard.path))}`,
  )
  lines.push(`- Discards: ${discards.length === 0 ? "none" : discards.join("; ")}`)
  lines.push(`- Callers: ${names(fn.callers)}`)
  lines.push(`- Callees: ${names(fn.callees)}`)
  for (const id of fn.unknowns) {
    const unknown = unknowns.get(id)
    if (unknown !== undefined)
      lines.push(`- Not followed: ${locationOf(unknown)} -- ${unknownText(unknown.reason)}`)
  }
  lines.push("")
  return lines
}

function coverageLine(coverage: FlowGraphView["coverage"]): string {
  const parts = [`${coverage.functionsAnalyzed} function(s) analyzed`]
  if (coverage.functionsUnanalyzed > 0)
    parts.push(`${coverage.functionsUnanalyzed} not fully analyzed`)
  if (coverage.unknowns > 0) parts.push(`${coverage.unknowns} unknown(s)`)
  return coverage.complete
    ? `Coverage: ${parts.join(", ")} -- complete.`
    : `Coverage: ${parts.join(", ")} -- not complete: parts of the program could not be followed, so a flow missing below is not proof that it does not exist.`
}

/** The fields and functions to show: all of them, or only the wanted field and the functions that touch it. */
function selectByField(
  view: FlowGraphView,
  wantedField: string | undefined,
): { readonly fields: readonly FieldView[]; readonly functions: readonly FunctionView[] } {
  if (wantedField === undefined) return { fields: view.fields, functions: view.functions }
  return {
    fields: view.fields.filter((field) => field.name === wantedField),
    functions: view.functions.filter((fn) =>
      [...fn.reads, ...fn.forwards, ...fn.sideEffects, ...fn.discards].some(
        (item) => item.field === wantedField,
      ),
    ),
  }
}

function fieldBlock(field: FieldView, heading: string): string[] {
  const lines = [`${heading} ${field.name}`, ""]
  if (field.classification !== undefined) lines.push(`- Classification: ${field.classification}`)
  const sources = field.sources.map(
    (source) => `${source.boundaryName} (${source.boundaryKind ?? "boundary"}, ${source.status})`,
  )
  lines.push(`- Fetched from: ${sources.length === 0 ? "none declared" : sources.join("; ")}`)
  const reaches = field.destinations.map(
    (destination) =>
      `${destination.boundaryKind ?? "boundary"} ${destination.boundaryName}: ${pathList(destination.paths)} (${destination.status})`,
  )
  lines.push(
    `- Reaches: ${reaches.length === 0 ? "nowhere in the analyzed code" : reaches.join("; ")}`,
  )
  const dropped = groupBy(field.discardedBy, (item) => item.functionName).map(
    ({ first, items }) => `${first.functionName}: ${pathList(items.map((item) => item.path))}`,
  )
  lines.push(`- Dropped by: ${dropped.length === 0 ? "none" : dropped.join("; ")}`)
  lines.push(
    `- Read by: ${field.readers.length === 0 ? "none" : [...new Set(field.readers.map((reader) => reader.functionName))].sort().join(", ")}`,
  )
  lines.push(
    field.complete
      ? "- Complete: yes"
      : "- Complete: no -- the analysis could not follow part of this field's flow, so the destinations above may be incomplete.",
    "",
  )
  return lines
}

/** The claims section, only when claims exist and the output is not limited to one field. */
function claimsBlock(
  evidence: FlowGraphViewInput,
  wantedField: string | undefined,
  heading: string,
): string[] {
  if (evidence.claims === undefined || wantedField !== undefined) return []
  const lines = [`${heading} Claims`, ""]
  for (const claim of evidence.claims.claims)
    lines.push(`- [${claim.verification}] ${claim.statement} (${claim.status})`)
  if (evidence.claims.claims.length === 0) lines.push("None.")
  lines.push("")
  return lines
}

function unknownsBlock(view: FlowGraphView, heading: string): string[] {
  if (view.unknowns.length === 0) return []
  const lines = [`${heading} What the analysis could not follow`, ""]
  for (const unknown of view.unknowns) {
    lines.push(
      `- ${locationOf(unknown)} -- ${unknownText(unknown.reason)}${unknown.detail === undefined ? "" : ` (${unknown.detail})`}`,
    )
  }
  lines.push("")
  return lines
}

/** Renders the graph as Markdown, or `undefined` when no flow was computed. */
export function renderFlowText(
  evidence: FlowGraphViewInput,
  options: FlowTextOptions = {},
): string | undefined {
  const view = buildFlowGraphView(evidence)
  if (view === undefined) return undefined

  const level = Math.max(1, Math.min(4, options.headingLevel ?? 1))
  const h = (offset: number): string => "#".repeat(level + offset)
  const lines: string[] = [`${h(0)} Data flow`, "", coverageLine(view.coverage), ""]

  const wantedField = options.field
  const { fields, functions } = selectByField(view, wantedField)
  if (wantedField !== undefined && fields.length === 0) {
    lines.push(`No field named ${wantedField} in this evidence.`, "")
    return `${lines.join("\n").trimEnd()}\n`
  }
  const unknowns = new Map(view.unknowns.map((unknown) => [unknown.id, unknown]))

  lines.push(`${h(1)} Status legend`, "")
  for (const entry of view.statusLegend) lines.push(`- **${entry.status}**: ${entry.meaning}`)
  lines.push("")

  lines.push(`${h(1)} Functions`, "")
  for (const fn of functions) lines.push(...functionBlock(fn, unknowns, h(2)))
  if (functions.length === 0) lines.push("None.", "")

  lines.push(`${h(1)} Fields`, "")
  for (const field of fields) lines.push(...fieldBlock(field, h(2)))

  lines.push(...claimsBlock(evidence, wantedField, h(1)), ...unknownsBlock(view, h(1)))

  return `${lines.join("\n").trimEnd()}\n`
}
