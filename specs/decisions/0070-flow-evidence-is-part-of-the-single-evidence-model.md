# 0070: Field-level data flow, policy, and observation are sub-models of the single Evidence Model

## Status

Accepted. Extends ADR 0050 (fact-model architecture). Implemented by the `flow`, `policy`,
`observation`, and `claims` sub-models of `EvidenceModel` (schema version 3).

## Context

Field-level, interprocedural data-flow analysis, least-data analysis, data-flow policies, and runtime
observation all need somewhere to put their results. The tempting design is a second artifact (a "flow
graph file", a "policy report", an "observation log") with its own schema and its own readers. ADR 0050
rejects that shape: one provenance-stamped `EvidenceModel` is the only persisted source of truth, and every
report, diagram, finding list, and CI rule is a pure projection of it.

Several consumers need the flow facts: engineers (trace a field), operators (CI rules), auditors and legal
reviewers (claims with evidence). If each had a private artifact they could disagree, and "which one is
authoritative" would become a recurring question.

## Decision

- `EvidenceModel` gains four optional sub-models, each with a `computed` flag alongside the existing four
  (`dependency`, `ownership`, `finding`, `change`), so absence of a pass is never read as "the pass found
  nothing" (OUT-04):
  - `flow`: functions, parameters, returns, field reads/writes/transforms/discards, calls, side effects, and
    boundary crossings, as nodes and edges inside the evidence.
  - `policy`: declared classifications and constraints, and their evaluation results.
  - `observation`: ingested runtime observations and their join to static facts.
  - `claims`: statements with scope, coverage, supporting and contradicting evidence, provenance, and
    verification status.
- Nothing else is persisted. The graph view, trace and diff helpers, DOT, Mermaid, PROV, SARIF, OSCAL, OTel
  mapping, text equivalent, least-data report, and CI rules are pure functions of the evidence (ADR 0073): they
  read the evidence and nothing else, never mutate it (a test runs every one over deeply frozen evidence), and
  write nothing. Drill-down is carried by evidence references on findings and claims, which name the flow edges,
  policy result or unknown a statement rests on. `defineEvidenceProjection` remains available to wrap any of them
  when a consumer also wants per-output-key `sources`.
- Rendering is outside the analysis engine. The package ships the evidence and text/standards projections.
  Interactive and SVG/HTML rendering is done by a consumer (the `examples/flow-explorer` example, with a
  devDependency renderer) from the evidence JSON alone.
- `EVIDENCE_MODEL_SCHEMA_VERSION` goes 2 to 3. The change is additive and every new field is optional, so a
  v2 reader's interpretation of the fields it knows is unchanged.
- The pure models and queries live in `src/flow/` (flow, policy, observation and claims models, trace/filter/diff,
  least-data analysis, flow findings): a neutral directory with no Node or compiler dependency, imported by both
  `src/build/` (which produces the facts) and `src/evidence/` (the isomorphic entry, whose rule is that it imports
  `src/build/` for types only). The scanner, which needs the compiler, stays in `src/build/`.
- Every data-carrying edge names the field whose data it carries (`origin`), and `path` is always in that field's
  frame. Without it a helper shared by two fields would make each appear to reach the other's destinations.
- Evidence IDs for flow nodes and edges are content-addressed (derived from kind, root-relative location,
  and name), so two evidence files from different commits can be diffed.

## Consequences

- One file answers every question; two evidence files answer "what changed between revisions".
- A projection cannot pass vacuously on an un-run pass: it must consult the `computed` flag.
- The evidence file grows with the size of the analyzed program. `flow` is only computed when the caller asks
  for it, mirroring how the usage scan is opt-in today.
