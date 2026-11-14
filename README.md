# data-cap

[![CI](https://img.shields.io/github/actions/workflow/status/maverickcer/data-cap/ci.yml?branch=main&label=CI)](https://github.com/maverickcer/data-cap/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/data-cap)](https://www.npmjs.com/package/data-cap)
[![Coverage: the lowest of line, statement, function and branch coverage](https://img.shields.io/endpoint?url=https://maverickcer.github.io/data-cap/coverage-badge.json)](https://maverickcer.github.io/data-cap/coverage.json)
[![Mutation score: the share of applicable mutants the tests detect](https://img.shields.io/endpoint?url=https://maverickcer.github.io/data-cap/mutation-badge.json)](https://maverickcer.github.io/data-cap/mutation.json)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/MaverickCER/data-cap/badge)](https://scorecard.dev/viewer/?uri=github.com/MaverickCER/data-cap)
[![Bundle size: gzip size of the entry point against its budget](https://img.shields.io/endpoint?url=https://maverickcer.github.io/data-cap/size-badge.json)](https://maverickcer.github.io/data-cap/size.json)
![Socket Badge](https://badge.socket.dev/npm/package/data-cap/latest)
[![Node](https://img.shields.io/node/v/data-cap)](https://www.npmjs.com/package/data-cap)
[![License](https://img.shields.io/npm/l/data-cap)](LICENSE)

**Declare who owns your app's data and how it may be handled. Lint and build checks enforce those rules, and the data documentation regenerates from your code, so it never falls behind.**

`data-cap` is a TypeScript library. You declare each piece of data once, in a _capability_: its fields with their defaults, and the functions that load, change or watch them. `documentData()` adds the capability's `owner` and how each field may be handled: its `sensitivity`, `purpose`, `legalBasis`, `retention` and the endpoints its operations reach.

The ESLint plugin keeps network calls inside a capability's operations, and keeps a capability's whole field set from leaving the file that reads it. A build pass reads your source without running it. It warns when a field with a declared sensitivity lacks a purpose, legal basis or protections, or crosses an external boundary. Its strict flags make those warnings fail CI. The same pass writes the data documentation: a field catalog, an ownership report and an _evidence file_, one JSON model of every declaration and finding. The generator script that `npx data-cap init` scaffolds has a `--check` mode that fails CI when a committed copy no longer matches the code. The checks compare declarations with code; whether a declaration is true or sufficient stays your team's call.

At runtime the capability is the one shared state: every component reads the same snapshot, with a loading and error status per field. Your own functions still make the network calls. It works next to TanStack Query, Redux, Zustand, Apollo or plain `fetch`, and replaces none of them.

Try it in a TypeScript project: `npm install data-cap`, then `npx data-cap init` ([what it writes](#install-and-verify)). On [`examples/application`](https://github.com/MaverickCER/data-cap/tree/main/examples/application), the build pass prints:

```text
0 error(s), 2 warning(s), 0 info finding(s):
  - [warning] [SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY] [taskData] Field "tasks" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary. Verify this is intentional and adequately protected.
```

[Turn the checks on](#turn-the-checks-on) and that warning fails the build.

[Why](#why-it-exists) · [See it run](#see-it-run) · [Install](#install-and-verify) · [Fit](#fit-and-capabilities) · [Limits](#limits-and-when-not-to-use-it) · [Security](#security-and-supply-chain) · [Maturity](#maturity-versioning-and-support) · [Docs](#documentation)

## Why it exists

A field is added to an API response. A second component starts to depend on it, a mutation changes it, and a cache starts to supply it. Later, nobody can say who owns it, how it may be handled or what depends on it. The page that documented it is out of date.

Fetching libraries fetch, caches manage freshness, and stores hold state. None of them records ownership, so each component invents its own "loading", "stale" and "optimistic". The components then disagree, and the UI shows stale values as current.

`data-cap` writes that agreement down once, in the capability that owns the data. Reviewers and coding agents then read who owns a field, how it may be handled and what uses it, from documentation generated from the code. It is for teams whose data crosses component, feature, team or system boundaries.

## How it differs

| Tool            | Primary question                                                     |
| --------------- | -------------------------------------------------------------------- |
| `fetch`         | How do I retrieve this?                                              |
| TanStack Query  | How do I fetch and cache this?                                       |
| Redux / Zustand | How do I manage this state?                                          |
| Apollo          | How do I manage GraphQL data?                                        |
| **`data-cap`**  | **Who owns this data, how may it be handled, and where is it used?** |

You keep your existing tools. TanStack Query can keep fetching and caching while the capability declares who owns the result and how it may be handled ([the pattern](GUIDE.md#tanstack-query-and-socketio)). The [migration guides](specs/migrations/README.md) start from a global store, Apollo, TanStack Query alone, or manual fetch-and-state.

## What it does

- **At runtime** (`data-cap`, `data-cap/runtime`): a capability declares its fields with defaults, and every field is readable synchronously from the start. `createData` adds request dedup, per-operation status and an optimistic mutation lifecycle.
- **At build time** (`data-cap/build`, the CLI, the GitHub Action): a static pass reads your declarations and source without running them. It writes a manifest, a documentation catalog, an ownership report and the evidence file, and lists each finding as an error, a warning or info.
- **In the editor** (`data-cap/eslint-plugin`): lint rules keep I/O inside capability operations, keep fields inside the file that reads them, and keep operation functions stable.
- **Data flow** (Experimental): `--flow-evidence` traces each field through your functions and checks the rules you declare. What the scan cannot follow is recorded as an unknown, and the trace is marked incomplete.

### See it run

A capability declares its fields and the operations that write them. This excerpt is from [`examples/application/src/main.ts`](https://github.com/MaverickCER/data-cap/blob/main/examples/application/src/main.ts), which CI's `examples` job runs:

```ts
const taskSchema = {
  fields: {
    tasks: [] as Task[],
    selectedTask: fields.nullable<Task>({ id: "", title: "", done: false, priority: "low" }),
  },
  getters: {
    getTask: {
      params: { id: "" },
      execute: (params: { id: string }, signal: AbortSignal): Promise<Task> =>
        fetchTaskRemote(params.id, signal),
      processor: (task: Task): { selectedTask: Task } => ({ selectedTask: task }),
      writes: { selectedTask: true },
    },
    // ...getTasks, mutators and a subscription
  },
}

export const taskData = createData(taskSchema)
```

Then run the build pass over the whole example. `taskData` declares the two fields named in the warnings:

```text
$ npm run docs

Wrote evidence model: docs/data.evidence.json
[generate-docs] wrote src/generated/data.manifest.ts (1 active capability(ies)), docs/DATA.md, docs/OWNERSHIP.md, 4 flow file(s), and docs/data.evidence.json.

0 error(s), 2 warning(s), 0 info finding(s):
  - [warning] [SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY] [taskData] Field "tasks" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary. Verify this is intentional and adequately protected.
  - [warning] [SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY] [taskData] Field "selectedTask" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary. Verify this is intentional and adequately protected.
```

This is the real output of `npm run docs` in `examples/application`. CI's `examples` job compares the block with a fresh run. The `required` job, which a merge needs, waits for it. Nobody had declared `tasks` and `selectedTask` as crossing an external boundary on purpose. The warning comes from a mismatch: the field's declared `sensitivity` and its getter's declared endpoint disagree.

### Turn the checks on

The lint rules and the strict flags are opt-in. Turn the rules on in `eslint.config.js`:

```js
import dataCap from "data-cap/eslint-plugin"

export default [
  {
    plugins: { "data-cap": dataCap },
    rules: { "data-cap/no-raw-external-io": "error", "data-cap/no-fields-escape": "error" },
  },
]
```

Then add two CI steps. The first writes nothing and fails when the committed manifest, catalog or ownership report is stale. The second fails on an ownership, sensitivity or duplication warning, and on a capability or owned field that nothing reads:

```sh
node scripts/generate-data.mjs --check
npx data-cap --evidence docs/data.evidence.json --strict-docs --strict-ownership
```

A build script passes `strictDocs`, `strictOwnership` and `strictFlow` to `generateDataArtifacts()`; `strictFlow` turns the warning above into an error. The `--check` mode calls `checkArtifacts()`. If you commit the evidence file, `npx data-cap --evidence docs/data.evidence.json --check` fails when it is stale. The [GitHub Action](GUIDE.md#github-action) runs the same flags and annotates the pull request.

### What CI checks on every change

This repository's `contract` job runs every check below, and a merge needs it to pass.

- **Coverage:** `vitest.config.ts` sets floors of 90% branches, 100% functions, and 95% lines and statements. `contract` fails below them. They are raised in review when coverage improves; lowering one is a visible diff to `vitest.config.ts`.
- **Mutation testing:** `contract` fails unless every mutant is killed or recorded as equivalent in `.repo-contract/exceptions/mutation.json`. Code marked with a `Stryker disable` comment is not mutated.
- **Bundle size:** every entry point has a gzip budget in [`ci/size-budgets.mjs`](https://github.com/MaverickCER/data-cap/blob/main/ci/size-budgets.mjs), and the `verify` and `contract` jobs fail over it. `./build`, `./eslint-plugin` and the CLI have a 999 KB ceiling that only catches runaway growth. The budgets cover the ESM files only.
- **Dual-package hazard:** a test pins what happens when the package loads as both ESM and CommonJS ([SECURITY.md](SECURITY.md#dual-package-hazard)).

## Install and verify

**Prerequisites:** Node.js 22 or later. The runtime entries need no TypeScript. The generator parses with your TypeScript 5 or 6, and otherwise with a bundled TypeScript 6 ([requirements](GUIDE.md#requirements)).

```sh
npm install data-cap
npx data-cap init                       # writes src/data.ts and scripts/generate-data.mjs
node scripts/generate-data.mjs          # discovers the capability and writes the reports
node scripts/generate-data.mjs --check  # for CI: writes nothing, exits 1 on a stale report
```

**Verify it works:** `init` writes two files and runs nothing; it never overwrites an existing file. The generated script prints `Discovered 1 active capability(ies).` and writes the manifest, `docs/DATA.md` and `docs/DATA-OWNERSHIP.md`. `test/cli/quick-start.test.ts` runs both against the built package: `--check` exits 0 on fresh files and 1 after a capability changes.

The smallest complete capability, one getter with its `documentData()` entry, is [`member.capability.ts`](https://github.com/MaverickCER/data-cap/blob/main/examples/team-service/src/capabilities/member.capability.ts). CI's `examples` job runs it.

**Using an AI agent?** Give it [the skill](https://raw.githubusercontent.com/MaverickCER/data-cap/main/skills/data-cap/SKILL.md): a short manual generated from this package's exports, with the rules a type signature cannot state.

## Fit and capabilities

Each entry point has one reader in mind. The Guide has one chapter per row.

| Entry point                                                                                                             | Written for                                                                  | Guide chapter                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `data-cap`, `data-cap/runtime`, `data-cap/runtime/cache`, `data-cap/runtime/retry`                                      | Front-end and Node developers whose data comes from a server or another team | [Application data](GUIDE.md#application-data)                         |
| `data-cap/helpers`                                                                                                      | The same developers                                                          | [Helpers](GUIDE.md#helpers)                                           |
| `data-cap/build`, `data-cap/node`, the CLI, the GitHub Action                                                           | Platform engineers who own CI                                                | [Build tooling](GUIDE.md#build-tooling-the-cli-and-the-github-action) |
| `data-cap/evidence` (`defineEvidenceProjection` Stable, the flow views Experimental), `data-cap/observe` (Experimental) | Security and privacy reviewers                                               | [Data flow](GUIDE.md#data-flow)                                       |
| `data-cap/eslint-plugin`                                                                                                | Lint owners                                                                  | [ESLint plugin](GUIDE.md#eslint-plugin)                               |

**Use it to** name the owner of each piece of data, share one set of status values (`idle`, `loading`, `success`, `error`, `retrying`) and request dedup across components, and reason about optimistic updates. It also finds fields whose declared sensitivity and network endpoints disagree.

**Integration:** it sits under or next to your fetching and state libraries, with no transport, database or store change. Pick manual control or `createData` per capability, and add [cache and retry](GUIDE.md#cache-and-retry) where you need them.

**Runtimes:** core, runtime, cache, retry, helpers, evidence and observe import nothing and run on Node 22 or later. A test bundles each for the browser and runs it with Web globals only; no real browser runs them. Bun and Deno smoke tests, one per entry, run in a CI job `required` waits for. `./build`, `./node`, the CLI and the ESLint plugin are Node-only ([support matrix](GUIDE.md#runtime-support-matrix)).

**Package managers:** npm is fully tested. Install and import only are tested for pnpm, Yarn 1 and Yarn Berry (node-modules linker), in a job `required` waits for ([details](GUIDE.md#package-managers)).

## Limits and when not to use it

- **Skip it when** the application is small and data ownership is already obvious, or one team owns the whole data layer. A plain fetch-and-`useState` pattern is simpler there.
- **Trade-offs:** each capability needs a declaration, and the reports need a build step. There is no automatic rollback or conflict resolution ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md)).
- **Declared, not verified:** a declared `purpose`, `legalBasis` or `retention` is checked for presence, never for truth. Nothing here decides whether your data handling meets a law.
- **Opt-in gates:** the lint rules, the strict flags and the `--check` step run only where you add them to your lint config and CI.
- **Not a replacement** for a fetching or state library. `createData` adds dedup, status and an optimistic lifecycle, but you supply the transport. It is not an authorization or encryption system.
- **Data flow is syntactic:** it follows your project's own code, not packages, unless you declare what a package call does. It cannot prove a flow absent from code it cannot see ([what it follows](GUIDE.md#what-it-follows-and-what-it-says-when-it-cannot)).
- **Install weight:** the one dependency is a TypeScript 6 compiler, bundled inside the tarball. Only `./build` and the CLI load it.
- **Automation:** generated reports give coding agents context. They do not make a change correct.

## Security and supply chain

- **Runtime:** a write to a field the operation does not own is dropped. The development-mode warning names the operation and path, never the value ([runtime security model](SECURITY.md#runtime-security-model)).
- **Build time:** the build tool reads files through the TypeScript Compiler API and never imports or evaluates them. Lint bans `eval` and `new Function` in `src/`; review guards against a computed `import()` ([build-time model](SECURITY.md#build-time-security-model)).
- **Ambient access:** the `AmbientCapabilities` check scans the packed tarball. It fails if any file reaches `child_process`, or if anything but the CLI reads `process.env`. Only the CLI, `./node` and the ESLint plugin may reach `fs`.
- **Dependencies and licence:** the runtime entries import nothing. The [Adoption guide](ADOPTION.md#what-installing-it-adds) lists what installing adds, generated from `package.json`. MIT licensed.
- **Release integrity:** npm trusted publishing over OIDC with provenance. The release run fails if npm does not serve the attestation ([supply-chain posture](SECURITY.md#supply-chain-posture)). This check runs after the publish; a failure marks the run red but does not withdraw the version. Report a vulnerability through [SECURITY.md](SECURITY.md#reporting-a-vulnerability).

## Maturity, versioning and support

Pre-1.0. The runtime, helpers, build tooling, CLI flags, GitHub Action interface and ESLint rule names are Stable. The data-flow surface (the flow models, `./observe`, and the flow views in `./evidence`) is Experimental and may change in any release. Before 1.0 a minor release may still break a Stable API, so pin a version ([VERSIONING.md](VERSIONING.md)). Security fixes go to the latest `0.x` only ([supported versions](SECURITY.md#supported-versions)).

- **Upgrade:** read the [CHANGELOG](CHANGELOG.md) on every minor.
- **Release history:** the [CHANGELOG](CHANGELOG.md) and the [GitHub releases](https://github.com/MaverickCER/data-cap/releases); the process is in [RELEASING.md](RELEASING.md).
- **Bugs and requests:** [open an issue](https://github.com/MaverickCER/data-cap/issues); see [SUPPORT.md](SUPPORT.md).
- **Troubleshooting:** the [Guide's troubleshooting section](GUIDE.md#troubleshooting).

## Documentation

- **[Guide](GUIDE.md):** one chapter per entry point, plus requirements, troubleshooting and performance.
- **[Adoption guide](ADOPTION.md):** what adopting costs, what it needs, and what it refuses to do.
- **[Security policy](SECURITY.md):** the threat model and what each check covers.
- **[API reference](https://maverickcer.github.io/data-cap/api/):** every exported symbol, generated from source.
- **[Architecture](specs/architecture.md)** and **[ADRs](https://github.com/MaverickCER/data-cap/tree/main/specs/decisions):** why it is built this way.
- **[Examples](https://github.com/MaverickCER/data-cap/tree/main/examples):** complete applications, each run in CI.
- **Toolkit:** `@maverickcer/env-cap` governs configuration and `data-cap` governs application data. `repo-contract` and `internal-package-contract` check both ([toolkit overview](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md)).

## Next steps

- **Evaluate:** read the [Adoption guide](ADOPTION.md), then try `data-cap` on one feature.
- **Integrate:** follow the [Guide](GUIDE.md) and the [examples](https://github.com/MaverickCER/data-cap/tree/main/examples).
- **Verify:** read the [security model](SECURITY.md#runtime-security-model) and the [architecture](specs/architecture.md).

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) covers setup and the change workflow. License: MIT, see [LICENSE](LICENSE).
