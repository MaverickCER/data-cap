# 0073: Views, standards adapters and CI rules are projections; the renderer is not in the package

## Status

Accepted. Extends ADR 0070. Implemented in `src/evidence/` (`flow-graph-view.ts`, `flow-text.ts`, `flow-dot.ts`,
`flow-mermaid.ts`, `flow-prov.ts`, `flow-oscal.ts`, `flow-otel.ts`, `evidence-rules.ts`), `src/build/sarif.ts`, and
`examples/flow-explorer/`.

## Context

Once flow, policy, observation and claims are in the evidence, three audiences want different things from it:
engineers want to trace a field and drill into a function; operators want a build to pass or fail; auditors and legal
reviewers want the same facts in standards they already use (provenance, control assessment, findings, traces) and in a
form a person using a screen reader can read. A package that tries to be all of these grows a UI, a layout engine and a
dependency on each standard's tooling -- and a UI library in a package that ships into a build step is the wrong trade.

## Decision

- **One input, many views.** Every view is a pure function of the one Evidence Model, exported from the isomorphic
  `data-cap/evidence` entry (and re-exported from `data-cap/build`): a stable, documented graph view
  (`buildFlowGraphView`); its textual equivalent (`renderFlowText`); DOT and Mermaid; W3C PROV-JSON; NIST OSCAL
  assessment-results; OpenTelemetry (OTLP/JSON) in both directions; SARIF with regions and `codeFlows`. None reads a
  source file, writes a file, or depends on a rendering library.
- **The renderer is not in the package.** The interactive explorer is `examples/flow-explorer/`, which draws the graph
  with a devDependency (`@viz-js/viz`) and does its interaction with the package's own `traceFlow`, `diffFlow` and
  `renderFlowText`. It is also the feature's end-to-end regression test. A consumer who wants a different renderer
  builds it from the graph view.
- **A view says what it does not know.** Status is in text as well as colour; an unknown is drawn as a node; a graph
  that is not complete says so on itself; an edge of a violated policy is highlighted; isolated parameter and return
  nodes are omitted from the whole-graph view (they carry no flow) but never a function, and the text equivalent lists
  every input.
- **Findings carry evidence.** `ReportFinding.evidence` references the flow edges, policy result or unknown a finding
  rests on, so a reader can drill from a finding to the analysis behind it, and SARIF can anchor a result at the exact
  code and show the path.
- **Control identifiers are never inferred.** OSCAL needs control ids; they belong to whoever owns the catalog, so the
  caller supplies a rule-to-controls mapping, an unmapped rule is listed rather than dropped, and an indeterminate rule
  is `not-satisfied` with the reason stated, never `satisfied`.
- **CI rules are deterministic, closed and strict.** `evaluateEvidenceRules` runs a small named set of rules over the
  evidence. A rule that needs analysis which did not run is a violation, and a misspelled, mistyped or empty rule set
  is rejected by name when parsed. The CLI reads them from one file (`--rules`), because a flag per rule would be the
  growth ADR 0066 exists to stop.
- **Standards are validated by their own tools.** The tests check SARIF and OSCAL against the vendored official JSON
  Schemas, DOT with Graphviz itself and Mermaid with the real parser (in the example, which has the dependencies),
  rather than against shapes written for the occasion.

## Consequences

- Adding a view means writing a function of the evidence and its tests; nothing else in the package changes.
- The package has no UI dependency. The cost is that an interactive view is an example to adopt, not a feature to
  install.
- OpenTelemetry is a mapping, not an integration: an application opts in by putting `data_cap.*` attributes on its own
  spans, and a span is evidence of one execution, not a proof about every path.
