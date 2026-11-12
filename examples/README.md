# Examples

Five standalone npm projects, each depending on the root package through `"data-cap": "file:../.."`. npm installs a `file:` dependency as a symlink to the directory, not as a packed copy. So each example runs against whatever `npm run build` at the repository root last produced. After a source change, run `npm run build` again; installed examples pick it up without reinstalling.

`npm ci` at the root does **not** install these. CI's `examples` job does, one at a time, after building the root package. That job does not block a merge.

## Three questions, three places to look

This directory answers one question: **why would I use `data-cap`?** Two other questions have their own places:

- **`examples/`** (here): for a person deciding whether and how to adopt `data-cap`. Three examples tell one story that grows, and a fourth and fifth are of a different kind (below).
- **[`test/integration/`](https://github.com/MaverickCER/data-cap/blob/main/test/integration/README.md)**: does `data-cap` work? Focused regression fixtures, each checking one mechanism (dedup, cache, retry, subscription sharing, path-alias resolution) against the built package.
- **`test/core/`, `test/build/`, `test/runtime/`**: are the individual mechanisms correct? Unit tests, independent of any end-to-end story.

## One system, growing

The first three examples are the same kind of work-management system at three scales, in the order an organization grows into them:

| Tier | Directory | Scale | The question it answers |
| --- | --- | --- | --- |
| 1 | [`application/`](https://github.com/MaverickCER/data-cap/tree/main/examples/application): Task Manager | One developer | Is my data access correct? Status, optimistic updates, retry, dedup and caching on one capability. |
| 2 | [`team-service/`](https://github.com/MaverickCER/data-cap/tree/main/examples/team-service): Project Management Service | One team | Do our capabilities compose without duplicating work? One file per capability, a cross-capability dependency the scan records, and a duplicate-fetch finding. |
| 3 | [`enterprise-platform/`](https://github.com/MaverickCER/data-cap/tree/main/examples/enterprise-platform): Atlas | An organization | Can we show someone who wasn't in the room what data exists, how it is handled, and where the declarations have gaps? Three separately owned capabilities, a running service, and two generated reports. |
| 4 | [`flow-explorer/`](https://github.com/MaverickCER/data-cap/tree/main/examples/flow-explorer): Data flow explorer | Anyone who has to trust the picture | For one field, can I see every function that touches it and where it goes? Does the page say when it could not tell? One evidence file in; a keyboard-operable explorer and every standards export out. |

Tier 2 is Tier 1 once a second developer and a second capability join. Tier 3 is Tier 2 once that team's service becomes one of several departments' services. `team-service`'s "project" concept is `enterprise-platform`'s `projectsData`, now one capability among several. Each tier keeps what the previous tier used and adds only what its scale needs.

Tier 4 is not the next chapter of that story. It takes the evidence file any of the others produces and shows what can be built outside the package: an explorer drawn with a devDependency renderer, every standards export, and the end-to-end test of the data-flow analysis.

The fifth project, [`nextjs-app/`](https://github.com/MaverickCER/data-cap/tree/main/examples/nextjs-app), is a framework integration, described [below](#framework-integration).

## Not an ORM

Each example talks to something underneath: a simulated fetch in Tiers 1 and 2, a MongoDB, HTTP and SSE service in Tier 3. None of that is what `data-cap` is. `data-cap` has no query language, no schema migrations and no opinion about your database. It sits above whatever moves your data and describes the contract your code depends on:

```text
        ┌─────────────────────────────────────────┐
        │   fields / getters / mutators /          │
        │   subscriptions  +  documentData()        │   <- what data-cap is
        │   (the declared contract + governance)    │
        └─────────────────────────────────────────┘
               ▲              ▲              ▲
               │              │              │
        ┌──────┴──────┐┌──────┴──────┐┌──────┴──────┐
        │  fetch/REST ││  MongoDB /  ││  SSE / Socket │      <- implementation
        │  (Tier 1-2) ││  Mongoose   ││  .IO (real-   │         detail, always
        │             ││  (Tier 3)   ││  time, Tier 3)│         swappable
        └─────────────┘└─────────────┘└─────────────┘
```

The same layers as a list, top to bottom:

1. What `data-cap` is: fields, getters, mutators, subscriptions and `documentData()`, the declared contract and its governance.
2. What sits underneath, and can be swapped: fetch or REST (Tiers 1 and 2), MongoDB with Mongoose (Tier 3), and SSE or Socket.IO for real-time updates (Tier 3).

Swap Tier 3's MongoDB for Postgres, or its SSE for Socket.IO (see [`test/integration/subscriptions/socket-io-subscription/`](https://github.com/MaverickCER/data-cap/tree/main/test/integration/subscriptions/socket-io-subscription)). No `*.capability.ts` file changes. Each example keeps its backend in its own module for this reason. The subject of these examples is the declared contract above the fetch, and what it lets a tool check.

## Generated documentation, committed next to the source

Every example commits documentation `data-cap` generated: `docs/DATA.md`, `docs/OWNERSHIP.md`, `docs/flow/*.mmd` and `docs/data.evidence.json`. The evidence file is the composed `EvidenceModel` that everything else projects from ([ADR 0054](https://github.com/MaverickCER/data-cap/blob/main/specs/decisions/0054-evidence-model-as-orchestrator-backbone.md)). Tier 3 also commits `reports/data-handling-record.md` and `audit-prep.md`, which read that same model.

Each example gives two separate regression signals:

```sh
npm start      # node:assert/strict checks against the built package
npm run check  # the committed docs and reports match a fresh generation
```

`npm start` catches a behaviour change that trips an assertion. `npm run check` catches a quiet change in what `data-cap` generates, such as a dropped `handling` or a field's consumption status flipping. When you change observed behaviour on purpose, regenerate every installed example's output:

```sh
npm run examples:update-golden
```

A person runs this, and reviews the diff before committing. It is not part of `npm run verify` or CI. The same script regenerates each `test/integration/` fixture's `output.json`. Those fixtures use a synthetic summary on purpose ([`test/integration/README.md`](https://github.com/MaverickCER/data-cap/blob/main/test/integration/README.md)), because each checks one mechanism in isolation.

## Running one yourself

```sh
cd ../..            # repo root
npm run build
cd examples/<name>
npm install
npm start
```

`npm start` exits 0 and its last line is `<name>: all assertions passed`; the Next.js example starts a server instead. `npm run check` exits 0 when the committed `docs/` matches a fresh run, and 1 with a list of stale files when it does not. Each example's README lists its own commands and the line to look for.

CI's `examples` job runs `npm ci` and `npm run typecheck` in Tiers 1 to 4. `test/examples/` then runs `npm start` and `npm run check` in each, and also `npm test` in `flow-explorer`. In `nextjs-app` it runs `npm run build`. That job does not block a merge.

## Client vs. server

`data-cap` does not depend on a framework or environment. The same `buildData` and `createDataStore` pair, or `createData`, runs in a browser talking to a REST API and in a Node server talking to a database. `application/` and `team-service/` are client-side, with a simulated network. `enterprise-platform/` is a running server with an embedded MongoDB, because Tier 3 shows `data-cap` inside a full service.

## Index

| Example | Side | Demonstrates |
| --- | --- | --- |
| [`application`](https://github.com/MaverickCER/data-cap/tree/main/examples/application) | Client | `createData` with fields, getters, mutators and subscriptions in one type-checked schema shared with `documentData`; dedup, an optimistic mutation with `withRetry`, cancellation and caching. |
| [`team-service`](https://github.com/MaverickCER/data-cap/tree/main/examples/team-service) | Client | One file per capability; `projectData` composing `memberData`, a dependency the scan records; `assignmentsData` duplicating the same endpoint, reported as `DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES`; identity-stable array reconciliation with `createDataStore`. |
| [`enterprise-platform`](https://github.com/MaverickCER/data-cap/tree/main/examples/enterprise-platform) | Server | Atlas: a TanStack Start and MongoDB service with three separately owned capabilities. Declared per-endpoint `handling` feeds a field-lifecycle table; two reports (`data-handling-record`, `audit-prep`); a `--strict-docs` and `--strict-flow` CI guard tested on a synthetic gap. |
| [`flow-explorer`](https://github.com/MaverickCER/data-cap/tree/main/examples/flow-explorer) | Both | One evidence file projected into an interactive explorer and every standards export, with a comparison of two revisions. |
| [`nextjs-app`](https://github.com/MaverickCER/data-cap/tree/main/examples/nextjs-app) | Both | `createData` on the client of a Next.js app, behind a server-side user and admin authorization boundary. |

[`test/integration/README.md`](https://github.com/MaverickCER/data-cap/blob/main/test/integration/README.md) describes the mechanism-level fixtures. Each example's own README has its full walkthrough.

## Framework integration

[**nextjs-app**](https://github.com/MaverickCER/data-cap/tree/main/examples/nextjs-app) is a minimal Next.js todo app, not a tier in the story above. It runs `data-cap`'s client-side `createData()` inside a real Next.js app, wired to a server-side user and admin authorization boundary. It also documents two bugs found while building it. Both had one cause: Turbopack splits a module with module-level state into several independently evaluated copies. See its README.
