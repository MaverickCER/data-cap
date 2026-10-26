# flow-explorer -- Data flow explorer

**Tier 4: "For any one piece of data, can I see every function that touches it and
everywhere it goes -- and does the page tell me when it could not tell?"**

One file, `docs/data.evidence.json`, is the only input. Everything else in `docs/`
is a pure projection of it, and none of it reads a source file.

| File                    | What it is                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `data.evidence.json`    | The Evidence Model: the flow, the declared policy and its results, the observations, and the claims.        |
| `explorer.html`         | The interactive page. Open it. Self-contained: no network, works without JavaScript for reading.            |
| `flow.md`               | The same facts as text (and a Mermaid diagram), for a pull request or a screen reader.                      |
| `flow.dot`, `flow.svg`  | Graphviz DOT, and the SVG a devDependency (`@viz-js/viz`) draws from it.                                    |
| `flow.mmd`              | Mermaid.                                                                                                    |
| `flow.graph-view.json`  | The stable graph model any renderer reads (per-function inputs, reads, forwards, discards, callers, ...).   |
| `flow.prov.json`        | W3C PROV-JSON lineage.                                                                                      |
| `flow.sarif.json`       | SARIF 2.1.0: the leak anchored at the exact line, with the path the data took.                              |
| `flow.oscal.json`       | NIST OSCAL assessment-results, with control ids _you_ supply.                                               |
| `flow.otlp.json`        | OpenTelemetry (OTLP/JSON) spans, one per observation: names, never values.                                  |
| `observations.json`     | What `data-cap/observe` recorded while the handlers ran.                                                    |

## The scenario

A profile service reading one capability, `userData.user` (a database row: `id`, `name`,
`email`, `passwordHash`, `role`), with two rules declared next to the data:

- `src/app/profile.ts` -- the intended path. `buildUserProfile` keeps three fields and
  **discards** `passwordHash` and `role`; the analysis says so, field by field.
- `src/app/export.ts` -- a debug endpoint left in by mistake. `res.json(user)` sends the whole
  record, `passwordHash` included. No single line looks wrong; the rule
  `no-password-to-client` catches it, as a blocking error.
- `src/app/track.ts` -- an analytics call into a third-party SDK. The analysis cannot see
  inside a package, so it records exactly that: **one unknown, at this line, and it only ever
  received `email`**. The rule about `role` is still decided (and holds); a trace of `email` is
  marked not complete.

## Run it

```sh
npm install
npm run docs    # regenerate everything under docs/ (needs the root package built: `npm run build` at the repo root)
open docs/explorer.html
```

In the page: choose `userData.user`, type `passwordHash` as the path, and the one route it takes
(to the debug endpoint, and out to the client) lights up in red while everything else dims. Press
**T** on any node to trace from it. Tab moves between nodes; Enter inspects. The page opens
already comparing with the revision before the debug endpoint existed, and names the rule that
revision newly violates. The URL records the trace, so a link shares it.

## What is tested

```sh
npm start         # the real assertions: the facts above, from the real source and real recorded observations
npm run check     # every committed file under docs/ matches a fresh generation
npm test          # the explorer in jsdom (keyboard, ARIA, live regions, filters, deep links, diff), axe-core,
                  # WCAG contrast from the very palette the CSS is built from, and every export against
                  # its standard's own tools: Graphviz lays out the DOT, the real Mermaid parser parses
                  # the diagram, SARIF and OSCAL validate against the official JSON Schemas
npm run typecheck
```

## Why this is an example, not a package feature

The package ships the evidence and pure functions of it. It deliberately contains no
renderer: drawing a graph is a choice (layout engine, canvas or SVG, your design system), and a
UI library does not belong in a package that runs in a build step. This example draws with
`@viz-js/viz` (Graphviz as WebAssembly) and does its interaction with `traceFlow`, `diffFlow` and
`renderFlowText` from `data-cap/evidence` itself -- the same functions the build uses, running in
a browser. Take what you need from `scripts/`.

## Honest limits

- The page's graph is static SVG, laid out once. It does not re-layout when you filter; it dims
  and hides.
- Observations here are recorded by a wrapper that is told which capability field a response
  body was built from (`src/instrumentation.ts`). The static analysis needs no such help; the
  runtime side always does.
- The analysis is syntactic and follows your project's own functions. See the GUIDE's
  [Data flow](https://github.com/MaverickCER/data-cap/blob/main/GUIDE.md#data-flow) chapter for exactly what it follows, and what it says when it cannot.
