/**
 * Builds docs/explorer.html: one self-contained file with the evidence embedded
 * as JSON, the graph as an SVG drawn by the devDependency renderer, the
 * browser code bundled in, and the text equivalent pre-rendered so the page
 * reads without scripts.
 *
 * The palette lives here, as data, so the CSS and the contrast test share the
 * same values: if a colour changes, the test that proves it still meets WCAG
 * AA changes with it.
 */
import path from "node:path"
import { build } from "esbuild"
import type { EvidenceModel } from "data-cap/build"
import { compareEvidence, renderComparisonHtml } from "../explorer/compare.js"
import { exampleRoot } from "./pipeline.js"

export const LIGHT = {
  bg: "#ffffff",
  fg: "#1a1f24",
  muted: "#4a5560",
  panel: "#f1f4f7",
  border: "#5c6773",
  accent: "#0a58a8",
  "accent-fg": "#ffffff",
  danger: "#a8071a",
  warn: "#8a4a00",
  ok: "#1b6e2d",
} as const

export const DARK = {
  bg: "#0f141a",
  fg: "#e8edf2",
  muted: "#aeb9c4",
  panel: "#18202a",
  border: "#8a97a5",
  accent: "#7db7f5",
  "accent-fg": "#0f141a",
  danger: "#ff8a97",
  warn: "#f0b866",
  ok: "#7fd18f",
} as const

/** Foreground/background pairs the page actually uses, with the minimum WCAG contrast each must meet (4.5 text, 3 for UI boundaries). */
export const CONTRAST_PAIRS: readonly { readonly fg: keyof typeof LIGHT; readonly bg: keyof typeof LIGHT; readonly min: number }[] = [
  { fg: "fg", bg: "bg", min: 4.5 },
  { fg: "fg", bg: "panel", min: 4.5 },
  { fg: "muted", bg: "bg", min: 4.5 },
  { fg: "muted", bg: "panel", min: 4.5 },
  { fg: "accent", bg: "bg", min: 4.5 },
  { fg: "accent", bg: "panel", min: 4.5 },
  { fg: "accent-fg", bg: "accent", min: 4.5 },
  { fg: "danger", bg: "bg", min: 4.5 },
  { fg: "danger", bg: "panel", min: 4.5 },
  { fg: "warn", bg: "bg", min: 4.5 },
  { fg: "ok", bg: "bg", min: 4.5 },
  { fg: "border", bg: "bg", min: 3 },
  { fg: "border", bg: "panel", min: 3 },
]

function tokens(palette: Readonly<Record<string, string>>): string {
  return Object.entries(palette).map(([name, value]) => `--${name}: ${value};`).join(" ")
}

const CSS = `
:root { color-scheme: light dark; ${tokens(LIGHT)} }
@media (prefers-color-scheme: dark) { :root { ${tokens(DARK)} } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
.skip { position: absolute; left: 8px; top: -48px; background: var(--accent); color: var(--accent-fg); padding: 8px 12px; z-index: 10; }
.skip:focus { top: 8px; }
header, main { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
h1 { margin: 16px 0 4px; font-size: 1.6rem; }
h2 { margin: 24px 0 8px; font-size: 1.2rem; }
h3 { margin: 12px 0 4px; font-size: 1rem; }
p, li { max-width: 80ch; }
section { border-top: 1px solid var(--border); padding-bottom: 8px; }
.banner { margin: 8px 0; padding: 8px 12px; border: 2px solid var(--warn); color: var(--warn); font-weight: 600; }
.banner.complete { border-color: var(--ok); color: var(--ok); }
.controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px 16px; align-items: end; }
.controls label { display: block; font-weight: 600; }
.controls button { align-self: end; }
select, input[type="text"], input[type="search"], button, input[type="file"] { font: inherit; color: var(--fg); background: var(--panel); border: 1px solid var(--border); padding: 6px 8px; min-height: 36px; }
button { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); cursor: pointer; }
fieldset { border: 1px solid var(--border); padding: 4px 8px 8px; }
fieldset label { display: inline-block; margin-right: 12px; font-weight: 400; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
#graph { overflow: auto; border: 1px solid var(--border); background: var(--bg); max-height: 70vh; }
#graph svg { height: auto; }
#graph.fit-width svg { width: 100%; }
#graph svg g.graph > polygon { fill: var(--bg); stroke: none; }
#graph svg text { fill: var(--fg); }
#graph g.node polygon, #graph g.node ellipse, #graph g.node path, #graph g.node polyline { stroke: var(--fg); fill: var(--panel); }
#graph g.edge path, #graph g.edge polyline { stroke: var(--muted); }
#graph g.edge polygon { stroke: var(--muted); fill: var(--muted); }
#graph g.node { cursor: pointer; }
#graph g.node.status-declared polygon, #graph g.node.status-declared ellipse, #graph g.node.status-declared path { stroke: var(--accent); stroke-dasharray: 5 3; }
#graph g.node.status-inferred polygon, #graph g.node.status-inferred ellipse, #graph g.node.status-inferred path { stroke: var(--warn); stroke-dasharray: 2 3; }
#graph g.node.status-unknown polygon, #graph g.node.status-unknown ellipse, #graph g.node.status-unknown path { stroke: var(--danger); stroke-dasharray: 6 3; stroke-width: 2; }
#graph g.edge.status-declared path { stroke: var(--accent); stroke-dasharray: 5 3; }
#graph g.edge.status-inferred path { stroke: var(--warn); stroke-dasharray: 2 3; }
#graph g.edge.status-unknown path { stroke: var(--danger); stroke-dasharray: 6 3; }
#graph g.edge.violation path { stroke: var(--danger); stroke-width: 3; stroke-dasharray: none; }
#graph g.edge.violation polygon { stroke: var(--danger); fill: var(--danger); }
#graph g.added polygon, #graph g.added ellipse, #graph g.added path { stroke: var(--ok); stroke-width: 3; }
#graph g.node.changed polygon, #graph g.node.changed ellipse, #graph g.node.changed path { stroke: var(--warn); stroke-width: 3; stroke-dasharray: 8 2; }
#graph g.edge.changed:not(.violation) path { stroke: var(--warn); stroke-width: 3; }
#diff-result ul { list-style: none; padding-left: 0; }
#diff-result li { margin: 2px 0; }
#diff-result li button { background: none; color: var(--accent); border: 0; border-bottom: 1px solid var(--accent); padding: 2px 0; min-height: 0; text-align: left; }
#diff-result li button[aria-current="true"] { font-weight: 700; }
.where { color: var(--muted); font-family: ui-monospace, monospace; font-size: 0.9em; }
#graph g.node:focus { outline: 3px solid var(--accent); outline-offset: 2px; }
#graph .dim { opacity: 0.18; }
#graph .filtered { display: none; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 8px 0; padding: 0; list-style: none; }
#detail:focus { outline: 3px solid var(--accent); }
#detail-body ul { margin: 4px 0 8px; padding-left: 20px; }
.violation-note { color: var(--danger); font-weight: 600; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--panel); border: 1px solid var(--border); padding: 12px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: var(--panel); }
@media (forced-colors: active) { #graph g.node polygon, #graph g.node ellipse, #graph g.node path { stroke: CanvasText; } }
`

/** Escapes a JSON document for embedding in a `<script type="application/json">` element. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Bundles the browser code (which imports data-cap/evidence) into one script. */
export async function bundleClient(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(exampleRoot, "scripts/explorer/client.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
    legalComments: "none",
  })
  return (result.outputFiles[0]?.text ?? "").replace(/<\/script/gi, "<\\/script")
}

export interface ExplorerInput {
  readonly evidence: EvidenceModel
  /** An earlier revision's evidence, to compare against. Optional: the page can also load one from a file. */
  readonly baseline?: EvidenceModel | undefined
  /** The graph as SVG, drawn by the renderer. */
  readonly svg: string
  /** The pre-rendered text equivalent. */
  readonly text: string
}

/** Builds the complete page. */
export async function buildExplorerHtml(input: ExplorerInput): Promise<string> {
  const svg = input.svg.slice(input.svg.indexOf("<svg"))
  const claims = input.evidence.claims?.claims ?? []
  const coverage = input.evidence.flow?.coverage
  const complete = coverage?.complete === true
  const baselineFlow = input.baseline?.flow
  const hasBaseline = baselineFlow !== undefined
  const comparisonHtml =
    input.baseline === undefined || input.evidence.flow === undefined || !hasBaseline
      ? '<p id="diff-summary" role="status">Not comparing: this page has no earlier revision embedded. Load an evidence file to compare.</p>'
      : renderComparisonHtml(compareEvidence(input.baseline, input.evidence), "the revision embedded in this page", false)
  const rows = claims
    .map((claim) => `<tr><td>${escapeHtml(claim.verification)}</td><td>${escapeHtml(claim.statement)}</td><td>${escapeHtml(claim.status)}</td><td>${escapeHtml(claim.scope.traceComplete ? "complete" : "not complete")}</td></tr>`)
    .join("\n")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data flow explorer</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the controls</a>
<header>
  <h1>Data flow explorer</h1>
  <p class="banner${complete ? " complete" : ""}" id="coverage" role="status">${
    coverage === undefined
      ? "No flow analysis in this evidence."
      : complete
        ? `Coverage: ${coverage.functionsAnalyzed} function(s) analyzed -- complete.`
        : `Coverage: ${coverage.functionsAnalyzed} function(s) analyzed, ${coverage.unknowns} unknown(s) -- NOT complete. A flow missing from the graph is not proof it does not exist.`
  }</p>
  <noscript><p>Interactive tracing needs JavaScript. The graph, the claims and the text equivalent below are complete without it.</p></noscript>
</header>
<main id="main">
  <section aria-labelledby="controls-h">
    <h2 id="controls-h">Trace data</h2>
    <div class="controls">
      <div><label for="field">Field</label><select id="field"></select></div>
      <div><label for="direction">Direction</label><select id="direction"><option value="downstream">Downstream: where it goes</option><option value="upstream">Upstream: where it came from</option></select></div>
      <div><label for="path">Path inside the field (optional)</label><input type="text" id="path" autocomplete="off" placeholder="for example passwordHash"></div>
      <div><label for="classification">Classification</label><select id="classification"><option value="">Any</option></select></div>
      <div><label for="execution">Execution</label><select id="execution"><option value="">Any (do not filter by execution)</option></select></div>
      <div><label for="search">Find a node</label><input type="search" id="search" autocomplete="off"></div>
      <div><label><input type="checkbox" id="violations"> Only policy violations</label></div>
      <div><button type="button" id="reset">Show everything</button></div>
    </div>
    <fieldset id="statuses"><legend>Show evidence with these statuses</legend></fieldset>
    <p id="summary" role="status" aria-live="polite">Loading.</p>
    <p id="execution-note"></p>
  </section>
  <section aria-labelledby="graph-h">
    <h2 id="graph-h">Graph</h2>
    <p><button type="button" id="fit" aria-pressed="false">Fit graph to width (overview)</button></p>
    <p>Tab moves between nodes. Enter or Space inspects one; T traces data from it. Dashed outlines are declared, dotted are inferred, and red dashed is something the analysis could not follow. Status is also stated in each node's name for assistive technology.</p>
    <div id="graph" role="region" aria-label="Data flow graph" tabindex="0">${svg}</div>
  </section>
  <section id="detail" tabindex="-1" aria-labelledby="detail-h">
    <h2 id="detail-h">Details</h2>
    <div id="detail-body"><p>Select a node or an edge to see what the evidence says about it.</p></div>
  </section>
  <section aria-labelledby="diff-h">
    <h2 id="diff-h">Compare with another revision</h2>
    <p>Load the <code>docs/data.evidence.json</code> of another commit to see which edges, nodes, unknowns and policy results differ. What is new is outlined in green and what changed in amber, and each is named in the node&rsquo;s accessible name; the lists below say the same in words, and each item opens the details with its source location. A loaded file cannot be put in a link; the embedded revision can.</p>
    <div class="controls">
      <div><label for="baseline">Evidence file (from another commit)</label><input type="file" id="baseline" accept="application/json,.json"></div>
      <div><button type="button" id="compare-embedded"${hasBaseline ? "" : " disabled"}>Compare with the revision embedded in this page</button></div>
      <div><button type="button" id="compare-off">Stop comparing</button></div>
      <div><label><input type="checkbox" id="only-changes"> Dim everything that did not change</label></div>
    </div>
    <div id="diff-result">${comparisonHtml}</div>
  </section>
  <section aria-labelledby="claims-h">
    <h2 id="claims-h">Claims</h2>
    <table>
      <caption>What the evidence claims, and how well each claim is supported</caption>
      <thead><tr><th scope="col">Verification</th><th scope="col">Claim</th><th scope="col">Status</th><th scope="col">Trace</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>
  <section aria-labelledby="text-h">
    <h2 id="text-h">Text equivalent</h2>
    <p>Everything the graph shows, as text.</p>
    <pre id="text-body">${escapeHtml(input.text)}</pre>
  </section>
</main>
<script type="application/json" id="evidence">${embedJson(input.evidence)}</script>
<script type="application/json" id="baseline-evidence">${input.baseline === undefined ? "" : embedJson(input.baseline)}</script>
<script>${await bundleClient()}</script>
</body>
</html>
`
}
