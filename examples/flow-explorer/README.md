# flow-explorer: Data flow explorer

**Tier 4: "For any one piece of data, can I see every function that touches it and everywhere it goes? Does the page tell me when it could not tell?"**

One file, `docs/data.evidence.json`, is the only input. Everything else in `docs/` is a projection of it, and none of it reads a source file.

| File                     | What it is                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.evidence.json`     | The Evidence Model: the flow, the declared policy and its results, the observations, and the claims.                                                  |
| `explorer.html`          | The interactive page. Open it. Self-contained: no network, works without JavaScript for reading.                                                      |
| `flow.md`                | The same facts as text (and a Mermaid diagram), for a pull request or a screen reader.                                                                |
| `flow.dot`, `flow.svg`   | Graphviz DOT, and the SVG a devDependency (`@viz-js/viz`) draws from it.                                                                              |
| `flow.mmd`               | Mermaid.                                                                                                                                              |
| `flow.graph-view.json`   | The stable graph model any renderer reads (per-function inputs, reads, forwards, discards, callers, ...).                                             |
| `flow.prov.json`         | W3C PROV-JSON lineage.                                                                                                                                |
| `flow.sarif.json`        | SARIF 2.1.0: the leak anchored at the exact line, with the path the data took.                                                                        |
| `flow.oscal.json`        | NIST OSCAL assessment-results, with control ids _you_ supply.                                                                                         |
| `flow.otlp.json`         | OpenTelemetry (OTLP/JSON) spans, one per observation: names, never values.                                                                            |
| `flow.cdx.json`          | CycloneDX 1.6: one service per boundary and per capability-owning file, `data[]` flows with their status, unknowns and policy results as annotations. |
| `baseline.evidence.json` | The evidence of the earlier revision (before the debug endpoint existed): load it in the explorer to compare.                                         |
| `flow.diff.md`           | The comparison of that revision with this one as plain text: added and removed edges, changed policy results, ...                                     |
| `observations.json`      | What `data-cap/observe` recorded while the handlers ran.                                                                                              |

## The scenario

A profile service reading one capability, `userData.user` (a database row: `id`, `name`,
`email`, `passwordHash`, `role`), with two rules declared next to the data:

- `src/app/profile.ts` is the intended path. `buildUserProfile` keeps three fields and **discards** `passwordHash` and `role`. The analysis reports that, field by field.
- `src/app/export.ts` is a debug endpoint left in by mistake. `res.json(user)` sends the whole record, `passwordHash` included. No single line looks wrong; the rule `no-password-to-client` reports it as a blocking error.
- `src/app/track.ts` calls a third-party analytics SDK. The analysis cannot see inside a package, so it records **one unknown, at this line, that only ever received `email`**. The rule about `role` is still decided, and holds. A trace of `email` is marked not complete.

## Run it

Build the package first: `npm run build` at the repository root. Then, in this directory, run `npm install` and:

| Command         | Exit code | Look for                                                                                              |
| --------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `npm run docs`  | 0         | `Wrote ... files to docs/ (... error finding(s): the example's leak is meant to block a real build).` |
| `npm start`     | 0         | `flow-explorer: all assertions passed`                                                                |
| `npm run check` | 0         | `[flow-explorer check] all ... generated files are up to date.`                                       |
| `npm test`      | 0         | the `node:test` summary with `fail 0`                                                                 |

Then open `docs/explorer.html`. A failed assertion or test exits 1, and `npm run check` exits 1 listing each stale file.

CI's `examples` job runs `npm run typecheck` here. It then runs `npm start`, `npm run check` and `npm test` through `test/examples/flow-explorer.test.ts`. That job does not block a merge.

In the page, choose `userData.user` and type `passwordHash` as the path. Its one route, to the debug endpoint and out to the client, turns red while everything else dims. Press **T** on any node to trace from it. Tab moves between nodes; Enter inspects one.

The page opens already comparing with the revision before the debug endpoint existed (`docs/baseline.evidence.json`). Load that, or any other commit's `data.evidence.json`, with the file input. The comparison lists added and removed edges, changed policy results, and added, removed and changed nodes and unknowns. Each item is a button that opens its details and source location.

The graph outlines the same changes (green: new, amber: changed), and each node's accessible name states them. "Dim everything that did not change" leaves only the difference lit. The URL records the trace and the comparison (`compare=off`, `changes=1`, `change=...`), so a link shares them. A file you loaded cannot be put in a link.

## What it checks

- `npm start` asserts the facts above, from the example's source and its recorded observations.
- `npm run check` compares every committed file under `docs/` with a fresh generation.
- `npm test` runs the explorer in jsdom: keyboard, ARIA, live regions, filters, deep links and the diff. It runs axe-core, and checks WCAG contrast on the palette the CSS uses.
- `npm test` also checks each export with its standard's own tools. Graphviz lays out the DOT, the Mermaid parser parses the diagram, and SARIF and OSCAL validate against the official schemas.
- None of this runs in a real browser or with a screen reader.

## Why this is an example, not a package feature

The package ships the evidence and pure functions of it. It contains no renderer on purpose. Drawing a graph is a choice of layout engine, canvas or SVG, and design system. A UI library does not belong in a package that runs in a build step.

This example draws with `@viz-js/viz` (Graphviz as WebAssembly). Its interaction calls `traceFlow`, `diffFlow` and `renderFlowText` from `data-cap/evidence`, the same functions the build uses, in a browser. Take what you need from `scripts/`.

## Limits

- The graph is static SVG, laid out once. Filtering dims and hides; it does not re-layout.
- A wrapper records the observations here, and it is told which capability field each response body came from (`src/instrumentation.ts`). The static analysis needs no such help; the runtime side always does.
- The analysis is syntactic and follows your project's own functions. The Guide's [Data flow](https://github.com/MaverickCER/data-cap/blob/main/GUIDE.md#data-flow) chapter says what it follows, and what it says when it cannot.
