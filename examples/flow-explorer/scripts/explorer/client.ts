/**
 * The explorer's browser code. It reads ONE thing -- the Evidence Model embedded
 * in the page -- and uses data-cap's own isomorphic functions (`traceFlow`,
 * `diffFlow`, `buildFlowGraphView`, `renderFlowText`) for every question it
 * answers, so what the page says about a flow is, by construction, what the
 * build says. Nothing here re-derives a fact.
 *
 * The graph itself is a static SVG drawn at build time by a devDependency
 * (@viz-js/viz). This code makes it explorable:
 *
 *   - Tab moves between nodes. Enter or Space inspects one. T traces from it.
 *   - Choosing a field traces it downstream (where it goes) or upstream (where
 *     it came from), optionally for one path inside it.
 *   - Filters by status, classification, policy violation and execution (what a
 *     given test or run actually witnessed); a text search.
 *   - Coverage is always on screen, and an unknown is drawn like any other node.
 *   - A second revision's evidence can be loaded to see what changed.
 *
 * Every change of state is announced in a polite live region, and everything the
 * graph shows is also in the text equivalent below it.
 */
import { buildFlowGraphView, diffFlow, observedFlow, renderFlowText, traceFlow } from "data-cap/evidence"
import type { FlowEdge, FlowGraphView, FlowModel, FlowNode, FlowStatus, FlowUnknown } from "data-cap/evidence"
import type { EvidenceModel } from "data-cap/build"

const STATUSES: readonly FlowStatus[] = ["declared", "static", "observed", "inferred", "unknown"]
const ALL_EXECUTIONS = "__all__"

type Child = Node | string

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  for (const child of children) element.append(child)
  return element
}

function required<T extends Element>(id: string): T {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`The page is missing #${id}`)
  return found as unknown as T
}

function readEvidence(id: string): EvidenceModel | undefined {
  const node = document.getElementById(id)
  if (node === null || node.textContent === null || node.textContent.trim() === "") return undefined
  return JSON.parse(node.textContent) as EvidenceModel
}

const pathText = (path: readonly string[] | undefined): string => (path === undefined ? "" : path.length === 0 ? "(whole)" : path.join("."))

function start(): void {
  const evidence = readEvidence("evidence")
  const flow = evidence?.flow
  const live = required<HTMLElement>("summary")
  if (evidence === undefined || flow === undefined) {
    live.textContent = "This evidence has no flow analysis. Generate it with --flow-evidence."
    return
  }
  const view = buildFlowGraphView(evidence) as FlowGraphView
  new Explorer(evidence, flow, view).run()
}

class Explorer {
  private readonly nodes = new Map<string, FlowNode>()
  private readonly edges = new Map<string, FlowEdge>()
  private readonly unknowns = new Map<string, FlowUnknown>()
  private readonly nodeEls = new Map<string, Element>()
  private readonly edgeEls = new Map<string, Element>()
  private readonly violated = new Set<string>()
  private traceFrom: string | undefined
  private diff: ReturnType<typeof diffFlow> | undefined

  constructor(
    private readonly evidence: EvidenceModel,
    private readonly flow: FlowModel,
    private readonly view: FlowGraphView,
  ) {
    for (const node of flow.nodes) this.nodes.set(node.id, node)
    for (const edge of flow.edges) this.edges.set(edge.id, edge)
    for (const unknown of flow.unknowns) this.unknowns.set(unknown.id, unknown)
    for (const result of evidence.policy?.results ?? []) {
      if (result.outcome === "violated") for (const id of result.edges) this.violated.add(id)
    }
  }

  run(): void {
    this.indexGraph()
    this.fillControls()
    this.bind()
    this.restoreFromHash()
    this.apply()
    const baseline = readEvidence("baseline-evidence")
    if (baseline?.flow !== undefined) this.compare(baseline, "the revision embedded in this page")
  }

  // ----- the graph -------------------------------------------------------------------------------

  private indexGraph(): void {
    const graph = required<HTMLElement>("graph")
    for (const group of graph.querySelectorAll("g.node")) {
      const id = group.getAttribute("id")
      if (id === null) continue
      this.nodeEls.set(id, group)
      group.setAttribute("tabindex", "0")
      group.setAttribute("role", "button")
      group.setAttribute("aria-label", this.describeNode(id))
      const node = this.nodes.get(id)
      group.classList.add(`status-${node?.status ?? "unknown"}`, `kind-${node?.kind ?? "unknown"}`)
    }
    for (const group of graph.querySelectorAll("g.edge")) {
      const id = group.getAttribute("id")
      if (id === null) continue
      this.edgeEls.set(id, group)
      // The same information is in each node's connections and in the text equivalent, so edges are not tab stops.
      group.setAttribute("aria-hidden", "true")
      group.classList.add(`status-${this.edges.get(id)?.status ?? "unknown"}`)
      if (this.violated.has(id)) group.classList.add("violation")
    }
  }

  private describeNode(id: string): string {
    const unknown = this.unknowns.get(id)
    if (unknown !== undefined) return `Not followed: ${unknown.reason} at ${unknown.source.file} line ${unknown.source.line}, status unknown`
    const node = this.nodes.get(id)
    if (node === undefined) return id
    const label = this.view.nodes.find((candidate) => candidate.id === id)?.label ?? node.name
    const classification = node.classification === undefined ? "" : `, ${node.classification}`
    return `${label}, ${node.kind}, ${node.status}${classification}`
  }

  // ----- controls --------------------------------------------------------------------------------

  private fillControls(): void {
    const field = required<HTMLSelectElement>("field")
    field.append(el("option", { value: "" }, "All data (no trace)"))
    for (const item of this.view.fields) field.append(el("option", { value: item.id }, item.name))

    const classification = required<HTMLSelectElement>("classification")
    const classes = [...new Set(this.flow.nodes.flatMap((node) => (node.classification === undefined ? [] : [node.classification])))].sort()
    for (const value of classes) classification.append(el("option", { value }, value))

    const execution = required<HTMLSelectElement>("execution")
    const scopes = this.evidence.observation?.scopes ?? []
    if (scopes.length > 0) execution.append(el("option", { value: ALL_EXECUTIONS }, "Anything observed in any execution"))
    for (const scope of scopes) execution.append(el("option", { value: scope }, scope))

    const statuses = required<HTMLElement>("statuses")
    for (const status of STATUSES) {
      const box = el("input", { type: "checkbox", id: `status-${status}`, value: status, checked: "" })
      statuses.append(el("label", {}, box, ` ${status}`))
    }
  }

  private bind(): void {
    const rerun = (): void => this.apply()
    for (const id of ["field", "direction", "path", "classification", "violations", "search", "execution"]) {
      required<HTMLElement>(id).addEventListener(id === "path" || id === "search" ? "input" : "change", () => {
        if (id === "field") this.traceFrom = undefined
        rerun()
      })
    }
    required<HTMLElement>("statuses").addEventListener("change", rerun)
    const fit = required<HTMLButtonElement>("fit")
    fit.addEventListener("click", () => {
      const fitted = required<HTMLElement>("graph").classList.toggle("fit-width")
      fit.setAttribute("aria-pressed", String(fitted))
      fit.textContent = fitted ? "Show graph at actual size" : "Fit graph to width (overview)"
    })
    required<HTMLButtonElement>("reset").addEventListener("click", () => {
      this.traceFrom = undefined
      required<HTMLSelectElement>("field").value = ""
      required<HTMLInputElement>("path").value = ""
      required<HTMLInputElement>("search").value = ""
      required<HTMLSelectElement>("execution").value = ""
      required<HTMLSelectElement>("classification").value = ""
      required<HTMLInputElement>("violations").checked = false
      for (const box of required<HTMLElement>("statuses").querySelectorAll("input")) box.checked = true
      this.apply()
    })

    const graph = required<HTMLElement>("graph")
    graph.addEventListener("click", (event) => this.inspectFrom(event.target))
    graph.addEventListener("keydown", (event) => {
      const group = (event.target as Element).closest?.("g.node")
      if (group === null || group === undefined) return
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        this.inspectNode(group.getAttribute("id") ?? "")
      } else if (event.key === "t" || event.key === "T") {
        event.preventDefault()
        this.traceFromNode(group.getAttribute("id") ?? "")
      }
    })

    required<HTMLInputElement>("baseline").addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (file === undefined) return
      void file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as EvidenceModel
          if (parsed.flow === undefined) throw new Error("it has no flow analysis")
          this.compare(parsed, file.name)
        } catch (error) {
          required<HTMLElement>("diff-result").textContent = `${file.name} could not be used: ${error instanceof Error ? error.message : String(error)}.`
        }
      })
    })
  }

  private inspectFrom(target: EventTarget | null): void {
    const group = (target as Element | null)?.closest?.("g.node, g.edge")
    if (group === null || group === undefined) return
    const id = group.getAttribute("id") ?? ""
    if (group.classList.contains("node")) this.inspectNode(id)
    else this.inspectEdge(id)
  }

  // ----- tracing and filtering -------------------------------------------------------------------

  private traceFromNode(id: string): void {
    this.traceFrom = id
    required<HTMLSelectElement>("field").value = this.nodes.get(id)?.kind === "field" ? id : ""
    this.apply()
  }

  private selection(): { readonly nodes: ReadonlySet<string>; readonly edges: ReadonlySet<string>; readonly complete: boolean; readonly label: string } | undefined {
    const fieldId = required<HTMLSelectElement>("field").value
    const startId = this.traceFrom ?? (fieldId === "" ? undefined : fieldId)
    if (startId === undefined || !this.nodes.has(startId)) return undefined
    const direction = required<HTMLSelectElement>("direction").value === "upstream" ? "upstream" : "downstream"
    const rawPath = required<HTMLInputElement>("path").value.trim()
    const path = rawPath === "" ? undefined : rawPath.split(".")
    const trace = traceFlow(this.flow, startId, direction, path === undefined ? {} : { path })
    const unknownIds = trace.unknowns.map((unknown) => unknown.id)
    return {
      nodes: new Set([...trace.nodes.map((node) => node.id), ...unknownIds]),
      edges: new Set(trace.edges.map((edge) => edge.id)),
      complete: trace.complete,
      label: `${direction} from ${this.nodes.get(startId)?.name ?? startId}${path === undefined ? "" : `, path ${path.join(".")}`}`,
    }
  }

  private allowedStatuses(): ReadonlySet<string> {
    return new Set([...required<HTMLElement>("statuses").querySelectorAll("input")].filter((box) => box.checked).map((box) => box.value))
  }

  private apply(): void {
    const selected = this.selection()
    const statuses = this.allowedStatuses()
    const classification = required<HTMLSelectElement>("classification").value
    const violationsOnly = required<HTMLInputElement>("violations").checked
    const query = required<HTMLInputElement>("search").value.trim().toLowerCase()

    const visibleNode = (id: string): boolean => {
      const node = this.nodes.get(id)
      if (node === undefined) return statuses.has("unknown")
      if (!statuses.has(node.status)) return false
      if (classification !== "" && node.classification !== classification) return this.edgeTouches(id, (edge) => this.nodes.get(edge.origin ?? "")?.classification === classification)
      return true
    }
    const violationNodes = new Set<string>()
    if (violationsOnly) {
      for (const id of this.violated) {
        const edge = this.edges.get(id)
        if (edge !== undefined) violationNodes.add(edge.from).add(edge.to)
      }
    }

    const witnessed = this.witnessed()
    let shownNodes = 0
    let shownEdges = 0
    for (const [id, group] of this.nodeEls) {
      const hidden = !visibleNode(id) || (violationsOnly && !violationNodes.has(id))
      const dim =
        (selected !== undefined && !selected.nodes.has(id)) ||
        (witnessed !== undefined && !witnessed.nodes.has(id)) ||
        (query !== "" && !this.describeNode(id).toLowerCase().includes(query))
      group.classList.toggle("filtered", hidden)
      group.classList.toggle("dim", !hidden && dim)
      group.classList.toggle("trace", !hidden && !dim && selected !== undefined)
      if (!hidden && !dim) shownNodes += 1
    }
    for (const [id, group] of this.edgeEls) {
      const edge = this.edges.get(id)
      const endpointsHidden = edge !== undefined && (this.nodeEls.get(edge.from)?.classList.contains("filtered") === true || this.nodeEls.get(edge.to)?.classList.contains("filtered") === true)
      const hidden = edge === undefined ? false : endpointsHidden || !statuses.has(edge.status) || (violationsOnly && !this.violated.has(id))
      const dim = (selected !== undefined && !selected.edges.has(id)) || (witnessed !== undefined && !witnessed.edges.has(id))
      group.classList.toggle("filtered", hidden)
      group.classList.toggle("dim", !hidden && dim)
      group.classList.toggle("trace", !hidden && !dim && selected !== undefined)
      if (!hidden && !dim) shownEdges += 1
    }

    const parts = [
      witnessed !== undefined ? `Showing what ${witnessed.label} witnessed: ${witnessed.observations} observation(s), ${witnessed.unexplained} not explained by the static flow.` : "",
      selected === undefined ? (witnessed === undefined ? "Showing all data." : "") : `Tracing ${selected.label}.`,
      `${shownNodes} node(s) and ${shownEdges} edge(s) shown.`,
    ].filter((part) => part !== "")
    if (selected !== undefined && !selected.complete) parts.push("This trace is NOT complete: part of it reaches code the analysis could not follow.")
    else if (selected === undefined && !this.flow.coverage.complete) parts.push("The analysis is NOT complete.")
    required<HTMLElement>("summary").textContent = parts.join(" ")
    required<HTMLElement>("execution-note").textContent =
      witnessed === undefined
        ? ""
        : "Lit routes are the routes the static flow offers for what was observed: an observation says that data reached a boundary, not which of several possible routes it took."
    this.writeHash()
  }

  /** What the selected execution (or any execution) actually witnessed, or `undefined` when not filtering by execution. */
  private witnessed():
    | { readonly nodes: ReadonlySet<string>; readonly edges: ReadonlySet<string>; readonly label: string; readonly observations: number; readonly unexplained: number }
    | undefined {
    const choice = required<HTMLSelectElement>("execution").value
    const observation = this.evidence.observation
    if (choice === "" || observation === undefined) return undefined
    const result = observedFlow(this.flow, observation, choice === ALL_EXECUTIONS ? undefined : choice)
    return {
      nodes: new Set(result.nodes.map((node) => node.id)),
      edges: new Set(result.edges.map((edge) => edge.id)),
      label: choice === ALL_EXECUTIONS ? "every execution" : choice,
      observations: result.explained.length + result.unexplained.length,
      unexplained: result.unexplained.length,
    }
  }

  /** The state worth sharing: which trace, which filters. Everything else is derived from the evidence. */
  private writeHash(): void {
    const params = new URLSearchParams()
    const field = this.traceFrom ?? required<HTMLSelectElement>("field").value
    if (field !== "") params.set("from", field)
    const direction = required<HTMLSelectElement>("direction").value
    if (field !== "" && direction !== "downstream") params.set("direction", direction)
    const path = required<HTMLInputElement>("path").value.trim()
    if (path !== "") params.set("path", path)
    const classification = required<HTMLSelectElement>("classification").value
    if (classification !== "") params.set("classification", classification)
    if (required<HTMLInputElement>("violations").checked) params.set("violations", "1")
    const search = required<HTMLInputElement>("search").value.trim()
    if (search !== "") params.set("find", search)
    const execution = required<HTMLSelectElement>("execution").value
    if (execution !== "") params.set("execution", execution)
    const hidden = [...required<HTMLElement>("statuses").querySelectorAll("input")].filter((box) => !box.checked).map((box) => box.value)
    if (hidden.length > 0) params.set("hide", hidden.join(","))
    const text = params.toString()
    history.replaceState(null, "", text === "" ? location.pathname + location.search : `#${text}`)
  }

  private restoreFromHash(): void {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""))
    const from = params.get("from")
    if (from !== null && this.nodes.has(from)) {
      this.traceFrom = from
      required<HTMLSelectElement>("field").value = this.nodes.get(from)?.kind === "field" ? from : ""
    }
    if (params.get("direction") === "upstream") required<HTMLSelectElement>("direction").value = "upstream"
    required<HTMLInputElement>("path").value = params.get("path") ?? ""
    required<HTMLSelectElement>("classification").value = [...required<HTMLSelectElement>("classification").options].some((option) => option.value === params.get("classification")) ? (params.get("classification") as string) : ""
    required<HTMLInputElement>("violations").checked = params.get("violations") === "1"
    required<HTMLInputElement>("search").value = params.get("find") ?? ""
    const execution = required<HTMLSelectElement>("execution")
    execution.value = [...execution.options].some((option) => option.value === params.get("execution")) ? (params.get("execution") as string) : ""
    const hidden = new Set((params.get("hide") ?? "").split(",").filter((status) => status !== ""))
    for (const box of required<HTMLElement>("statuses").querySelectorAll("input")) box.checked = !hidden.has(box.value)
  }

  private edgeTouches(nodeId: string, test: (edge: FlowEdge) => boolean): boolean {
    for (const edge of this.edges.values()) if ((edge.from === nodeId || edge.to === nodeId) && test(edge)) return true
    return false
  }

  // ----- drill-down ------------------------------------------------------------------------------

  private show(heading: string, ...content: Child[]): void {
    const body = required<HTMLElement>("detail-body")
    body.replaceChildren(el("h3", {}, heading), ...content)
    required<HTMLElement>("detail").focus()
  }

  private list(items: readonly string[]): HTMLElement {
    return el("ul", {}, ...(items.length === 0 ? [el("li", {}, "none")] : items.map((item) => el("li", {}, item))))
  }

  private inspectNode(id: string): void {
    const unknown = this.unknowns.get(id)
    if (unknown !== undefined) {
      this.show(
        `Not followed: ${unknown.reason}`,
        el("p", {}, `At ${unknown.source.file}:${unknown.source.line}:${unknown.source.column}. Status: unknown -- the analysis assumed the data passes through, approximately.`),
        el("p", {}, "Data that entered it:"),
        this.list((unknown.data ?? []).map((item) => `${this.nodes.get(item.origin)?.name ?? item.origin}: ${pathText(item.path)}`)),
      )
      return
    }
    const node = this.nodes.get(id)
    if (node === undefined) return
    const fn = this.view.functions.find((candidate) => candidate.id === id)
    const field = this.view.fields.find((candidate) => candidate.id === id)
    const blocks: Child[] = [
      el("p", {}, `${node.kind} in ${node.scope}${node.source === undefined ? "" : `:${node.source.line}`}. Status: ${node.status}.${node.classification === undefined ? "" : ` Classification: ${node.classification}.`}`),
    ]
    if (fn !== undefined) {
      blocks.push(
        el("p", {}, `Confidence: ${fn.confidence}.`),
        el("h4", {}, "Reads"),
        this.list(fn.reads.map((read) => `${read.field}: ${pathText(read.path)} (via ${read.via})`)),
        el("h4", {}, "Passes on"),
        this.list(fn.forwards.map((flow) => `${flow.kind} ${flow.toName}: ${flow.field}: ${pathText(flow.path)}`)),
        el("h4", {}, "Side effects"),
        this.list(fn.sideEffects.map((effect) => `${effect.boundaryKind ?? "boundary"} ${effect.boundaryName}: ${effect.field}: ${pathText(effect.path)}`)),
        el("h4", {}, "Discards"),
        this.list(fn.discards.map((discard) => `${discard.field}: ${pathText(discard.path)}`)),
        el("h4", {}, "Callers and callees"),
        this.list([...fn.callers.map((caller) => `called by ${caller.name}`), ...fn.callees.map((callee) => `calls ${callee.name}`)]),
      )
    }
    if (field !== undefined) {
      blocks.push(
        el("h4", {}, "Fetched from"),
        this.list(field.sources.map((source) => `${source.boundaryName} (${source.boundaryKind ?? "boundary"}, ${source.status})`)),
        el("h4", {}, "Reaches"),
        this.list(field.destinations.map((destination) => `${destination.boundaryKind ?? "boundary"} ${destination.boundaryName}: ${destination.paths.map(pathText).join(", ")} (${destination.status})`)),
        el("h4", {}, "Dropped by"),
        this.list(field.discardedBy.map((item) => `${item.functionName}: ${pathText(item.path)}`)),
        el("p", {}, field.complete ? "Complete: yes." : "Complete: no -- part of this flow reaches code the analysis could not follow."),
      )
    }
    const claims = (this.evidence.claims?.claims ?? []).filter((claim) => claim.subject === node.name || claim.object === node.name || claim.subject.startsWith(`${node.name}.`))
    if (claims.length > 0) blocks.push(el("h4", {}, "Claims"), this.list(claims.map((claim) => `[${claim.verification}] ${claim.statement}`)))
    this.show(`${this.view.nodes.find((candidate) => candidate.id === id)?.label ?? node.name}`, ...blocks)
  }

  private inspectEdge(id: string): void {
    const edge = this.edges.get(id)
    if (edge === undefined) return
    const where = edge.source === undefined ? "no source location" : `${edge.source.file}:${edge.source.line}:${edge.source.column}`
    this.show(
      `${edge.kind}${edge.path === undefined ? "" : ` ${pathText(edge.path)}`}`,
      el("p", {}, `From ${this.nodes.get(edge.from)?.name ?? edge.from} to ${this.nodes.get(edge.to)?.name ?? edge.to}.`),
      el("p", {}, `Status: ${edge.status}. Source: ${where}.${edge.handling === undefined ? "" : ` Handling: ${edge.handling}.`}`),
      el("p", {}, `Carries data of ${edge.origin === undefined ? "no single field" : (this.nodes.get(edge.origin)?.name ?? edge.origin)}.`),
      ...(this.violated.has(id) ? [el("p", { class: "violation-note" }, "This edge is part of a violated policy rule.")] : []),
    )
  }

  // ----- comparing revisions ---------------------------------------------------------------------

  private compare(baseline: EvidenceModel, name: string): void {
    const baselineFlow = baseline.flow as FlowModel
    this.diff = diffFlow(baselineFlow, this.flow)
    const { diff } = this
    for (const [id, group] of this.nodeEls) group.classList.toggle("added", diff.addedNodes.some((node) => node.id === id) || diff.addedUnknowns.some((unknown) => unknown.id === id))
    for (const [id, group] of this.edgeEls) group.classList.toggle("added", diff.addedEdges.some((edge) => edge.id === id))

    const key = (result: { ruleId: string; outcome: string; subject?: string | undefined }): string => `${result.ruleId}:${result.outcome}:${result.subject ?? ""}`
    const before = new Set((baseline.policy?.results ?? []).map(key))
    const now = new Set((this.evidence.policy?.results ?? []).map(key))
    const newlyBroken = (this.evidence.policy?.results ?? []).filter((result) => result.outcome === "violated" && !before.has(key(result)))
    const fixed = (baseline.policy?.results ?? []).filter((result) => result.outcome === "violated" && !now.has(key(result)))

    const out = required<HTMLElement>("diff-result")
    if (diff.unchanged && newlyBroken.length === 0 && fixed.length === 0) {
      out.replaceChildren(el("p", {}, `No difference from ${name}.`))
      return
    }
    out.replaceChildren(
      el("p", {}, diff.unchanged ? `No difference from ${name}.` : `Compared with ${name}: ${diff.addedNodes.length} node(s) added, ${diff.removedNodes.length} removed, ${diff.changedNodes.length} changed; ${diff.addedEdges.length} edge(s) added, ${diff.removedEdges.length} removed; ${diff.addedUnknowns.length} new unknown(s).`),
      el("h3", {}, "Policy rules newly violated"),
      this.list(newlyBroken.map((result) => `${result.ruleId}${result.subject === undefined ? "" : ` for ${this.nodes.get(result.subject)?.name ?? result.subject}`}`)),
      el("h3", {}, "Policy rules no longer violated"),
      this.list(fixed.map((result) => result.ruleId)),
      el("h3", {}, "Added"),
      this.list(diff.addedNodes.map((node) => `${node.kind} ${node.name}`)),
      el("h3", {}, "Removed"),
      this.list(diff.removedNodes.map((node) => `${node.kind} ${node.name}`)),
    )
  }
}

// The text equivalent is rendered at build time so the page reads without scripts; rendering it again here proves the
// evidence entry runs in a browser and keeps the page honest if the evidence it shows is ever swapped.
function refreshText(): void {
  const evidence = readEvidence("evidence")
  const text = evidence === undefined ? undefined : renderFlowText(evidence, { headingLevel: 2 })
  const target = document.getElementById("text-body")
  if (text !== undefined && target !== null && target.textContent?.trim() === "") target.textContent = text
}

refreshText()
start()
