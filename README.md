# data-cap

[![CI](https://img.shields.io/github/actions/workflow/status/maverickcer/data-cap/ci.yml?branch=main&label=CI)](https://github.com/maverickcer/data-cap/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/data-cap)](https://www.npmjs.com/package/data-cap)
[![Coverage: the lowest of line, statement, function and branch coverage](https://img.shields.io/endpoint?url=https://maverickcer.github.io/data-cap/coverage-badge.json)](https://maverickcer.github.io/data-cap/coverage.json)
[![Mutation score: the share of applicable mutants the tests detect](https://img.shields.io/endpoint?url=https://maverickcer.github.io/data-cap/mutation-badge.json)](https://maverickcer.github.io/data-cap/mutation.json)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/MaverickCER/data-cap/badge)](https://scorecard.dev/viewer/?uri=github.com/MaverickCER/data-cap)
[![Bundle size: gzip size of the entry point against its budget](https://img.shields.io/endpoint?url=https://maverickcer.github.io/data-cap/size-badge.json)](https://maverickcer.github.io/data-cap/size.json)
[![Socket Badge](https://badge.socket.dev/npm/package/data-cap/latest)](https://socket.dev/npm/package/data-cap)
[![Node](https://img.shields.io/node/v/data-cap)](https://www.npmjs.com/package/data-cap)
[![License](https://img.shields.io/npm/l/data-cap)](LICENSE)

**Your application's data should have an owner.**

`data-cap` treats application data as a capability-owned contract: its fields, the operations that acquire or change them, and the code that depends on them. It does not replace TanStack Query, Redux, Zustand, Apollo, or plain `fetch` + `useState`; it gives those tools a stable contract around the data they already manage.

[Why](#why-it-exists) · [See it run](#see-it-run) · [Install](#install-and-verify) · [Fit](#fit-and-capabilities) · [Limits](#limits-and-when-not-to-use-it) · [Security](#security-and-supply-chain) · [Maturity](#maturity-versioning-and-support) · [Docs](#documentation)

## Why it exists

**Benefit:** one declared owner and one shared status vocabulary for each piece of application data, so every part of the application agrees on what the data is doing and who may change it.

**Problem:** application data outlives the code that introduced it. A field is added to an API response, a second component starts depending on it, a mutation changes it, a cache begins supplying it, and eventually nobody can say why it exists, who owns it, what can change it, or where it is used. Fetching libraries retrieve data, caches manage freshness, and state libraries manage state, but none of them record ownership, so each component works out its own idea of "loading", "stale", and "optimistic".

**Who it is for:** teams whose data crosses component, feature, team, or system boundaries, and the platform and staff engineers who need those relationships visible and reviewable.

**Why it matters:** when components disagree about what the data's status means, the result is UI that flickers, stale values presented as current, and optimistic updates that cannot be reasoned about. Ownership gives reviewers and automated contributors something concrete to check.

## How it differs

| Tool            | Primary question                                                 |
| --------------- | ---------------------------------------------------------------- |
| `fetch`         | How do I retrieve this?                                          |
| TanStack Query  | How do I fetch and cache this?                                   |
| Redux / Zustand | How do I manage this state?                                      |
| Apollo          | How do I manage GraphQL data?                                    |
| **`data-cap`**  | **Why does this data exist, who owns it, and where is it used?** |

These concerns coexist: TanStack Query can keep fetching and caching while `data-cap` defines the ownership contract around the resulting data ([TanStack Query and Socket.IO](GUIDE.md#tanstack-query-and-socketio)). The [migration guides](specs/migrations/README.md) cover adoption from a global store, Apollo, TanStack Query alone, and manual fetch-and-state.

## What it does

A capability declares its fields and the getters and mutators that touch them, and every consumer reads the same synchronously available snapshot. A build-time pass reads those declarations and your source, and writes a manifest, a documentation catalog, a dependency and ownership report, and an evidence artifact. The same Stable primitives (`buildData`, `createDataStore`, `coordinator`) give full manual control, and `createData` composes them into a batteries-included layer with dedup, per-operation status, and an optimistic mutation lifecycle ([the two paths](GUIDE.md#the-low-level-path-full-manual-control)).

### See it run

Define a capability around the data your application owns:

```ts
import { createData } from "data-cap/runtime"

const user = createData({
  fields: {
    profile: UserProfileSchema,
    preferences: UserPreferencesSchema,
  },

  getters: {
    load: {
      execute: (_params, signal) => fetchUser(signal),
      processor: (profile) => ({ profile }),
      writes: { profile: true },
    },
  },

  mutators: {
    updatePreferences: {
      execute: (preferences, signal) => updateUserPreferences(preferences, signal),
      processor: (_result, preferences) => ({ preferences }),
      writes: { preferences: true },
    },
  },
})
```

Then inspect the application as a whole. The declaration above is deliberately minimal; the output below comes from a different, larger program, [`examples/application`](https://github.com/MaverickCER/data-cap/tree/main/examples/application), whose `taskData` capability declares the two fields named in the warnings:

```text
$ npm run docs

Wrote evidence model: docs/data.evidence.json
[generate-docs] wrote src/generated/data.manifest.ts (1 active capability(ies)), docs/DATA.md, docs/OWNERSHIP.md, 4 flow file(s), and docs/data.evidence.json.

0 error(s), 2 warning(s), 0 info finding(s):
  - [warning] [SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY] [taskData] Field "tasks" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.
  - [warning] [SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY] [taskData] Field "selectedTask" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.
```

This is real output from the example's own `npm run docs` (a `data-cap --evidence` CLI step chained with its `generate-docs` script), not a mockup, including the two warnings. Nobody had declared `tasks` and `selectedTask` as crossing an external boundary on purpose; the tool found it because the field's declared `sensitivity` and its getter's declared network endpoint disagreed, not because anyone remembered to ask. The generated artifacts make the contract visible to developers, reviewers, and automated contributors.

### Evidence it works

- **Real fixtures:** the output above comes from a runnable example, and [complete applications](https://github.com/MaverickCER/data-cap/tree/main/examples) cover the model from one capability to a whole application.
- **Enforced in CI:** coverage is a ratchet that may only move up, mutation score is a gate ([CODE_REVIEW.md](CODE_REVIEW.md)), and a bundle-size budget is checked ([`ci/size-budgets.mjs`](https://github.com/MaverickCER/data-cap/blob/main/ci/size-budgets.mjs)).
- **Runtime-tested:** core, runtime, and helpers are verified against real Node, Bun, and Deno engines in CI ([support matrix](GUIDE.md#runtime-support-matrix)).
- **Known hazards tested:** the dual-package (ESM and CommonJS) hazard is pinned by a test that states its exact consequence ([SECURITY.md](SECURITY.md#dual-package-hazard)).
- **Verifiable release:** published with npm OIDC provenance and no long-lived token ([SECURITY.md](SECURITY.md#supply-chain-posture)).

## Install and verify

**Prerequisites:** Node.js `>=22`. TypeScript 5, 6, or 7 is needed only for the build-time generator (the runtime works in plain JavaScript); the [requirements](GUIDE.md#requirements) are in the Guide.

```sh
npm install data-cap
npx data-cap init                  # writes src/data.ts and scripts/generate-data.mjs
npm install --save-dev typescript # the generator parses your source with it
node scripts/generate-data.mjs
```

**Using an AI agent?** Give it [the skill](https://raw.githubusercontent.com/MaverickCER/data-cap/main/skills/data-cap/SKILL.md): a short manual written from this package's own exports, with the rules a type signature cannot say.

`init` is filesystem-only: it never runs a package manager and never edits `package.json`. **Verify it works:** the generator prints `Discovered 1 active capability(ies).` and writes the manifest, `docs/DATA.md`, and an ownership report. The smallest practical capability declares fields and one getter:

```ts
import { createData } from "data-cap/runtime"

const account = createData({
  fields: { balance: 0, status: "active" as "active" | "suspended" },
  getters: {
    load: {
      execute: (_params, signal) => getAccount(signal),
      writes: { balance: true, status: true },
    },
  },
})
```

Use the capability from your application without coupling its ownership to a particular transport, database, framework, or state library. The [Guide](GUIDE.md) has the full API and integration patterns.

## Fit and capabilities

**Use cases:** make it obvious who owns each piece of data; share one status vocabulary and request dedup across components; reason about optimistic updates; find fields whose declared sensitivity and network behavior disagree; give reviewers and coding agents an inventory of what the application's data is and where it flows.

**Core capabilities:**

- Capability-owned fields with getters, mutators, subscriptions, and a synchronously readable snapshot, with ownership enforced by warning rather than by throwing ([ownership model](SECURITY.md#runtime-security-model)).
- A manifest, documentation catalog, dependency and ownership report, and data-flow diagrams, generated by static analysis that never executes your code ([generated artifacts](GUIDE.md#generated-artifacts)).
- Governance metadata per field (`owner`, `sensitivity`, `purpose`, `retention`) that the build pass cross-references against actual reads and writes ([documented example](GUIDE.md#documented-example)).
- An [ESLint plugin](GUIDE.md#eslint-plugin) that catches an inline `execute`, `processor`, or `subscribe` function silently breaking dedup and subscription sharing, and a [GitHub Action](GUIDE.md#github-action).

**How it works:** the runtime and the build tooling are separate. The runtime coordinates fields, operations, and subscriptions; the build pass analyzes declarations and usage in development and CI ([Architecture](specs/architecture.md)).

**Integration:** it sits under or next to TanStack Query, Redux, Zustand, Apollo, or plain `fetch`, with no transport, database, or state-library change. **Runtimes:** Node.js 22+, browsers, Bun, and Deno for core, runtime, and helpers; `./build` and the ESLint plugin are Node-only ([support matrix](GUIDE.md#runtime-support-matrix)). **Configuration and extension:** pick manual control or `createData` per capability, add cache and retry policy ([Cache and retry](GUIDE.md#cache-and-retry)), and share capabilities from a [reusable package](GUIDE.md#reusable-packages).

## Limits and when not to use it

- **Skip it when** the application is small enough that data ownership, dependencies, and usage are already obvious, or one team owns the entire data layer and a conventional fetch-and-`useState` pattern is simpler. It becomes useful when data crosses component, feature, team, or system boundaries.
- **Trade-offs:** it adds a declaration per capability and a build step. There is no automatic rollback or conflict resolution: a failed optimistic update reverts by removing its pending transition ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md), [troubleshooting](GUIDE.md#my-mutations-optimistic-value-doesnt-automatically-roll-back-on-failure)).
- **Not a replacement** for a fetching or state library: on the manual path you supply execution, retry, and caching, and `createData` adds dedup, status, and an optimistic lifecycle but not your transport. It is not an authorization, encryption, or compliance system.
- **Install weight:** the build entry bundles a TypeScript 6 compiler, adding roughly 26 MB to the install, used only in development and CI.
- **Automation:** generated manifests and ownership documentation give agents repository-local context, but they do not guarantee a correct change; the automation owns its retry and validation loop.

## Security and supply chain

- **Guarantees:** an operation writing a field it does not own has that write dropped with a development-mode warning that never includes the offending value, so a warning cannot leak a secret ([runtime security model](SECURITY.md#runtime-security-model)).
- **Trust boundaries:** the build tool analyzes files statically and never imports or evaluates them, which covers the build tooling only, not your application at runtime ([build-time model](SECURITY.md#build-time-security-model), [your responsibilities](SECURITY.md#application-responsibilities)).
- **Dependencies and licence:** the runtime has no dependencies; the build entry bundles one compiler. MIT licensed.
- **Release integrity:** npm OIDC trusted publishing with provenance ([supply-chain posture](SECURITY.md#supply-chain-posture)). Report a vulnerability through [SECURITY.md](SECURITY.md#reporting-a-vulnerability).

## Maturity, versioning and support

Pre-1.0 (see the npm badge for the current version). The core runtime, build tooling, CLI, ESLint integration, and generated artifacts (including `createData`) are implemented, tested, and Stable; [VERSIONING.md](VERSIONING.md) lists the exact surface semver covers, and a `0.x` minor may still change a Stable API, so pin accordingly. Security fixes target the latest published `0.x` only until 1.0 ([Adoption guide](ADOPTION.md#versioning-stability-and-long-term-support)).

- **Upgrade and migrate:** read the [CHANGELOG](CHANGELOG.md) on every minor; [migration guides](specs/migrations/README.md) cover adoption from common data-management patterns.
- **Release history:** [CHANGELOG](CHANGELOG.md) and [GitHub releases](https://github.com/MaverickCER/data-cap/releases); the process is in [RELEASING.md](RELEASING.md).
- **Bugs and requests:** [open an issue](https://github.com/MaverickCER/data-cap/issues); see [SUPPORT.md](SUPPORT.md).
- **Troubleshooting:** the [Guide's troubleshooting section](GUIDE.md#troubleshooting).

## Documentation

- **[Guide](GUIDE.md)**: concepts, usage, integration patterns, build tooling, and the ESLint plugin.
- **[Adoption guide](ADOPTION.md)**: the decision-maker summary of security, bundle size, and versioning.
- **[API reference](https://maverickcer.github.io/data-cap/api/)**: every exported symbol, generated from source.
- **[Architecture](specs/architecture.md)** and **[ADRs](https://github.com/MaverickCER/data-cap/tree/main/specs/decisions)**: why it is designed this way.
- **[Examples](https://github.com/MaverickCER/data-cap/tree/main/examples)**: complete working applications.
- **Part of the MaverickCER toolkit:** `@maverickcer/env-cap` governs configuration and `data-cap` governs application data; `repo-contract` and `internal-package-contract` are how they are verified ([toolkit overview](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md)).

## Next steps

- **Evaluate:** read the [Adoption guide](ADOPTION.md), then try data-cap on one feature.
- **Integrate:** follow the [Guide](GUIDE.md) and the [examples](https://github.com/MaverickCER/data-cap/tree/main/examples).
- **Verify:** inspect the [security model](SECURITY.md#runtime-security-model) and the [architecture](specs/architecture.md).

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) covers setup and the change workflow. License: MIT, see [LICENSE](LICENSE).
