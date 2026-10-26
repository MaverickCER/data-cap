---
"data-cap": minor
---

Add field-level, interprocedural data flow to the Evidence Model, with declared flow policies, least-data analysis, runtime observation, and CI rules (Experimental; ADR 0070-0073).

`--flow-evidence` traces each capability field through your functions, across files, through destructuring, spreads, returns, closures and callbacks, and records what each function reads, passes on, sends across a boundary, and receives and discards. What it cannot follow becomes an explicit `unknown` that records the data that entered it, and a trace through it is marked not complete: a missing flow is never presented as proof of absence. Everything lands in the one evidence file (`EVIDENCE_MODEL_SCHEMA_VERSION` 3: `flow`, `policy`, `observation`, `claims`, each additive and optional).

- `flowPolicy` in `documentData()` declares where a field's data must never go; violations are blocking findings, undecidable rules are warnings that `--strict-flow` escalates.
- `analyzeLeastData` and the `LEAST_DATA_*` findings report fields or paths nothing uses, and whole records sent to a client.
- `data-cap/observe` records which field names crossed a boundary (never values, never I/O of its own); `--observations` joins them to the static facts as claims with a verification status.
- `--rules <file>` enforces deterministic rules over the evidence and exits 1 on a violation; a rule whose analysis did not run fails instead of passing.
- Pure projections of the evidence, isomorphic from `data-cap/evidence`: `traceFlow`, `filterFlow`, `diffFlow`, a stable graph view, a textual equivalent, DOT, Mermaid, W3C PROV-JSON, NIST OSCAL, OpenTelemetry, and SARIF with `codeFlows`. Findings now carry `evidence` references.
- `examples/flow-explorer` is an interactive, keyboard-operable, accessible explorer built on a devDependency renderer, and the feature's end-to-end test.

New schemas: `flow-model`, `policy-model`, `observation-model`, `claims-model`.
