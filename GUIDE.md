# data-cap Guide

One chapter per entry point, each written for the reader who imports it. Start with the chapter for your role.

| Chapter                                                                                      | Entry points                                                                       | Written for                                                         |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Application data](#application-data)                                                        | `data-cap`, `data-cap/runtime`, `data-cap/runtime/cache`, `data-cap/runtime/retry` | Front-end and Node developers modelling data they do not own        |
| [Helpers](#helpers)                                                                          | `data-cap/helpers`                                                                 | The same developers                                                 |
| [Build tooling, the CLI and the GitHub Action](#build-tooling-the-cli-and-the-github-action) | `data-cap/build`, `data-cap/node`, the `data-cap` CLI, the Action                  | Platform engineers who own CI                                       |
| [Data flow](#data-flow) (Experimental)                                                       | `data-cap/evidence`, `data-cap/observe`, the flow options of `data-cap/build`      | Security and privacy reviewers, and anyone asked where a field goes |
| [ESLint plugin](#eslint-plugin)                                                              | `data-cap/eslint-plugin`                                                           | Lint owners                                                         |

[Requirements](#requirements-and-runtimes), [Troubleshooting](#troubleshooting) and [Performance](#performance-characteristics) apply to all of them. For why the package is built this way, read [specs/architecture.md](specs/architecture.md) and the [ADRs](specs/decisions/).

## Requirements and runtimes

### Requirements

- **Node.js 22 or later.** `package.json` `engines` says so, and CI runs the tests on Node 22 and 24.
- **TypeScript is optional.** The runtime entries work in plain JavaScript.
- **The generator** parses with your project's TypeScript when it is version 5 or 6. Otherwise, with TypeScript 7 or none installed, it uses the TypeScript 6 compiler bundled inside this package. Your `tsc` stays your own.
- **TypeScript 5, 6 and 7** are tested in CI's `typescript-compat` job. The flow scan runs under each and must produce identical evidence. It runs on the flow-explorer example's source, with the latest 5, 6 and 7 releases; the 5.0 floor is not tested. That job does not block a merge.
- **Type declarations** type-check with full library checking under TypeScript 5, 6 and 7 for every entry point but `./eslint-plugin`. That check runs in the same job, with `moduleResolution: nodenext` only.
- **`moduleResolution`** must be `node16`, `nodenext` or `bundler`. The legacy `node10` resolver cannot see the subpath exports.
- **`data-cap/eslint-plugin`** also needs `eslint` and `@typescript-eslint/utils`, both optional peers.

### Runtime support matrix

| Entry point                                       | Node                       | Browser         | Bun and Deno   | Edge runtimes |
| ------------------------------------------------- | -------------------------- | --------------- | -------------- | ------------- |
| `.` (core)                                        | Tested                     | Bundle tested ¹ | Smoke-tested ² | Not tested    |
| `./runtime`, `./runtime/cache`, `./runtime/retry` | Tested                     | Bundle tested ¹ | Smoke-tested ² | Not tested    |
| `./helpers`                                       | Tested                     | Bundle tested ¹ | Smoke-tested ² | Not tested    |
| `./evidence`                                      | Tested                     | Bundle tested ¹ | Smoke-tested ² | Not tested    |
| `./observe` (Experimental)                        | Tested                     | Bundle tested ¹ | Smoke-tested ² | Not tested    |
| `./build`                                         | Node only                  | No              | Not tested     | No            |
| `./node`, the CLI                                 | Node only (uses `node:fs`) | No              | Not tested     | No            |
| `./eslint-plugin`                                 | Node only (inside ESLint)  | No              | No             | No            |

1. `test/runtime/browser-bundle.test.ts` bundles the entry for the browser and runs it in a V8 context with Web globals only. No real browser runs it.
2. `test/cross-runtime/` runs one smoke test per entry under Bun and Deno. The job uses the latest Bun and does not block a merge.

### Package managers

npm is the fully tested package manager: every other CI job installs with it. CI's `package-managers` job tests pnpm, Yarn 1 and Yarn Berry with the `node-modules` linker for one thing. The packed tarball installs, and every entry point imports as ESM and as CommonJS. That job does not block a merge. Yarn Plug'n'Play and pnpm's `pnp` linker are unsupported.

## Application data

For the front-end or Node developer who reads data an API, a database or a socket owns. You declare the fields once, with defaults, and every consumer reads the same frozen snapshot. Cache and retry are separate entries, so you import them only when you use them.

### Your first capability

`createData` is the shortest path. It owns request dedup, per-operation status, the optimistic mutation lifecycle and concurrent getters. This capability is copied from `examples/team-service/src/capabilities/member.capability.ts`, which CI's `examples` job runs:

```ts
import { createData } from "data-cap/runtime"

const memberSchema = {
  fields: {
    members: [] as Member[],
  },
  getters: {
    listMembers: {
      params: {},
      execute: (_params: object, signal: AbortSignal): Promise<Member[]> =>
        listMembersThroughCache(signal),
      processor: (result: Member[]): { members: Member[] } => ({ members: result }),
      writes: { members: true },
    },
  },
}

export const memberData = createData(memberSchema)

// In examples/team-service/src/main.ts:
await memberData.listMembers({})
```

Read a field with `memberData.getSnapshot().fields.members`.

What the tests in `test/runtime/capability.test.ts` hold it to:

- Fields are readable synchronously, with their defaults, from the moment `createData()` returns. There is no throw-until-ready gate ([ADR 0004](specs/decisions/0004-fields-always-synchronously-readable.md)).
- A newer getter call discards an older in-flight getter's commit. A mutator's commit is never discarded.
- Operation methods reject like ordinary Promises. `runGetters` runs several getters at once and never rejects; it returns one outcome per operation.
- `getSnapshot().operations` tracks each call by its canonicalized params, so two calls with different params stay separate.
- `getSnapshot()` and `subscribe()` work with React's `useSyncExternalStore` without a hook. The Next.js example builds with this pattern in CI's `examples` job, which does not block a merge.

[ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md) is the full behavioural contract. `examples/application/` uses every feature on one capability.

### Fields and info

Every `DataState` is `{ fields, info }`. Both are always present and are committed together as one snapshot (`test/core/patch.test.ts`, `test/runtime/store.test.ts`).

```ts
import { buildData, fields } from "data-cap"

const capability = buildData({
  fields: {
    user: { name: "", email: "" },
    role: fields.nullable("member"),
    nickname: fields.optional(""),
  },
})

capability.fields.role // null: nullable() starts as null
capability.fields.nickname // undefined: optional() starts as undefined
capability.info // {}: sparse until something runs
```

`fields` has exactly the shape you declared: plain values, no wrapper, no proxy. `info` mirrors that shape but gains an entry only for a field something ran against: `status`, `source`, `error`, `optimistic`. `0`, `false`, `""`, `null` and `[]` are real values; presence is checked with `Object.hasOwn`, never truthiness. See [ADR 0007](specs/decisions/0007-datainfo-mandatory-not-optional.md) and [ADR 0008](specs/decisions/0008-fields-info-atomic-commit.md).

`createData`'s capability has no top-level `.fields` shortcut. A frozen property there would never update, so every live read goes through `getSnapshot().fields`.

Every published snapshot is deep-frozen. `Object.freeze` does not stop `Map.prototype.set`, `Set.prototype.add` or `Date` setters, so never mutate a value you were handed ([SECURITY.md](SECURITY.md#runtime-security-model)).

### Optimistic mutations

`createData`'s `optimistic()` makes a mutation's unconfirmed value visible at once. By hand, the same mechanism is a pending transition on the store:

```ts
const optimisticEmail = "new@example.com"
const transitionId = store.addPendingTransition(
  { user: { email: optimisticEmail } },
  { user: { optimistic: true, status: "loading" } },
)

store.getSnapshot().fields.user.email // "new@example.com", visible at once

// On success:
store.commitAuthoritative(
  { user: { email: optimisticEmail } },
  { user: { optimistic: false, status: "success" } },
)
store.removePendingTransition(transitionId)

// On failure: remove the transition. The visible value reverts because
// project() no longer folds a transition that does not exist.
store.removePendingTransition(transitionId)
```

There is no rollback call and no conflict policy such as last-write-wins ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md)). Each commit folds onto the current authoritative state, never a snapshot taken when the mutation started. `optimistic()` receives authoritative state, not the projected one, so a second optimistic update never builds on the first one's pending value. The fixture `test/integration/runtime-core/optimistic-mutation-concurrency/` runs two overlapping mutations end to end, in a job that does not block a merge.

### Subscriptions

`createData`'s `subscriptions` section opens and releases a transport for you. By hand, `coordinator.acquireSubscription` shares one transport per `subscribe` function identity. The first caller opens it, later callers reuse it, and it closes after the last one releases:

```ts
import { defaultCoordinator } from "data-cap/runtime"

const release = defaultCoordinator.acquireSubscription(subscribeToFeed, {
  onEvent: (event) =>
    store.commitAuthoritative({ price: event.price }, { price: { status: "success" } }),
  onStatusChange: (status) =>
    store.commitAuthoritative(undefined, { price: { subscription: { status } } }),
})
```

A status change (`connecting`, `connected`, `disconnected`) touches only `info.<field>.subscription`, never `fields`. A disconnect keeps the last good value. The fixtures under `test/integration/subscriptions/` cover the lifecycle, a `recover` resync and two capabilities sharing one transport. They run in CI's `integration-fixtures` job, which does not block a merge; the unit tests in `test/runtime/coordinator.test.ts` do.

### Coordinator: dedup and isolation

`coordinator.dedupe` shares one in-flight call between concurrent calls with the same function and canonically equal params. Params that cannot be canonicalized are never deduplicated and never throw (`test/core/canonicalize.test.ts`). `defaultCoordinator` is one per module instance. `createCoordinator()` gives an isolated domain, for a multi-tenant server or a test:

```ts
import { createCoordinator } from "data-cap/runtime"

const tenantA = createCoordinator()
const tenantB = createCoordinator()
// tenantA and tenantB never share dedup or subscription work.
```

`createData(schema, { coordinator: tenantA })` uses an explicit coordinator; the default is `defaultCoordinator`. Sharing is by function identity: an inline arrow is a new function on every call, so it never dedupes. The [ESLint plugin](#eslint-plugin) flags that case. See [ADR 0027](specs/decisions/0027-default-coordinator-singleton-plus-factory.md) and [ADR 0028](specs/decisions/0028-coordinator-dedup-key-identity-plus-params.md).

### The low-level path: full manual control

Use `buildData`, `createDataStore` and the coordinator directly when you want to own execution, retry and caching. They are the same Stable primitives `createData` is built from:

```ts
import { buildData, fields } from "data-cap"
import { createDataStore, defaultCoordinator } from "data-cap/runtime"

const capability = buildData({
  fields: {
    user: { name: "", email: "" },
    nickname: fields.optional(""),
  },
})
const store = createDataStore(capability)

async function fetchUser(signal: AbortSignal) {
  return fetch("/api/user", { signal }).then((r) => r.json())
}

// A module-level function: dedupe shares work by function identity,
// so an inline arrow here would never share a call.
function executeFetchUser(_params: undefined, signal: AbortSignal) {
  return fetchUser(signal)
}

async function loadUser(): Promise<void> {
  const controller = new AbortController()
  store.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const raw = await defaultCoordinator.dedupe(executeFetchUser, undefined, controller.signal)
    store.commitAuthoritative({ user: raw }, { user: { status: "success", source: "loadUser" } })
  } catch (error) {
    store.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "loadUser", error } },
    })
  }
}
```

The fixture `test/integration/runtime-core/basic-standalone/` runs this pattern, including a concurrent call that checks the dedup, in a job that does not block a merge. Pick a path per capability, not per application.

### Cache and retry

Both are separate entries. `test/runtime/tree-shaking.test.ts` checks that each tree-shakes on its own. `./runtime/cache` stores complete `DataState` snapshots, `fields` and `info` together, never raw responses:

```ts
import { createDataCache } from "data-cap/runtime/cache"

const cache = createDataCache<UserFields>({ maxEntries: 100 })
cache.set(cacheKey, capability) // a full DataState, not just fields
```

`./runtime/retry` is opt-in and abort-aware. It composes with a `createData` operation method, because those are plain `(params?, signal?) => Promise` functions:

```ts
import { withRetry, isStillDefault } from "data-cap/runtime/retry"

await withRetry((signal) => userData.getUser({ id: "1" }, signal), controller.signal, {
  maxAttempts: 3,
  shouldRetry: (error) => isStillDefault(userData.getSnapshot().fields.user, defaultUser),
})
```

`examples/application/` composes `withRetry` with a mutator. See [ADR 0034](specs/decisions/0034-optional-runtime-features-separate-entries.md) to [ADR 0036](specs/decisions/0036-retry-opt-in-with-explicit-constraints.md).

### TanStack Query and Socket.IO

No adapter package ships, and no React package either ([ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md)). Two fixtures show the patterns to copy. They run in a job that does not block a merge:

- `test/integration/adoption-patterns/tanstack-query-integration/`: TanStack Query fetches and caches, and its results flow into a `data-cap` store.
- `test/integration/subscriptions/socket-io-subscription/`: a local Socket.IO server and client wired into `coordinator.acquireSubscription`.

A React hook is one line: `useSyncExternalStore(store.subscribe, store.getSnapshot)`.

## Helpers

For the same developers. `data-cap/helpers` holds four namespaces, each tree-shaken on its own (`test/helpers/tree-shaking.test.ts`). It stays under a 3 KB gzip budget. Neither `buildData` nor `createData` depends on it.

```ts
import { processors, identity, canonicalize, shape } from "data-cap/helpers"

processors.toNumber(raw.age) // coercion helpers for a processor
identity.computeItemIdentity(item, ["id"], [], warnings)
canonicalize({ id: 1, tags: ["a"] }) // deterministic, type-tagged string
shape.isPlainObject(raw) // structural guards only
```

- `canonicalize` and `identity` re-export core's own functions; they are not copies (`test/helpers/index.test.ts`).
- `canonicalize` never throws, including on cycles.
- `shape` has structural guards only (`isPlainObject`, `isDate`, `isURL`, `isRegExp`, `isNullish`). It is not a validator system ([ADR 0039](specs/decisions/0039-helpers-subpath-scope.md)).

### Array identity

Arrays stay plain arrays in `fields`. `info` tracks each item by a declared identity, never by index, which shifts on insert and reorder:

```ts
import { identity } from "data-cap/helpers"

const { info, warnings } = identity.reconcileArrayInfo(
  previousInfo,
  nextComments,
  ["id"],
  new Set([touchedId]),
  (item, key) => ({ status: "success", source: "listComments" }),
)
```

An item a refetch did not touch keeps its exact `FieldInfo` object: `next.info.comments["1"] === previous.info.comments["1"]`. A missing key, an explicit `null` or a duplicate identity is reported in `warnings`. `createData` does not reconcile arrays this way; call this helper against a store, as `examples/team-service/` does. See [ADR 0009](specs/decisions/0009-fields-arrays-info-identity-keyed.md) and [ADR 0010](specs/decisions/0010-datainfo-array-reconciliation-identity-diffed.md).

## Build tooling, the CLI and the GitHub Action

For the platform engineer who owns CI. The build pass reads your declarations and source, never runs them, and writes the reports. In CI, `--check` turns a stale report into a failed pull request. Every artifact is evidence that can support a review; none of it says a review was done.

### Documenting a capability

`documentData` takes the same schema `buildData` and `createData` take, plus governance metadata:

```ts
import { buildData, documentData } from "data-cap"

const userFields = { name: "", email: "" }

export const userCapability = buildData({ fields: userFields })

documentData(
  { fields: userFields },
  {
    owner: "identity-team",
    purpose: "Core account identity used across the product.",
    fields: {
      name: { description: "The user's display name." },
      email: {
        description: "The user's primary email address.",
        // A field's own owner, sensitivity, purpose and retention override
        // the capability-level value for that field only.
        owner: "identity-team",
        sensitivity: "restricted",
        purpose: "Account recovery and transactional notifications.",
        retention: "Deleted with the account.",
      },
    },
  },
)
```

`documentData` does nothing at runtime. The build pass matches each call to the capability it documents. It reports an undocumented capability, orphaned documentation, duplicate documentation and a documented field that does not exist ([ADR 0040](specs/decisions/0040-build-tooling-detects-correlation-mismatches.md)). The full vocabulary is on `FieldDocs` and `CapabilityDocs` in the [API reference](https://maverickcer.github.io/data-cap/api/). For a `createData` capability it also accepts `getters`, `mutators` and `subscriptions` sections.

### Discovery and linking

`data-cap/build` finds `buildData`, `createData` and `documentData` calls through the TypeScript Compiler API. It never imports, requires or evaluates a discovered file, including operation bodies ([ADR 0002](specs/decisions/0002-build-tooling-static-analysis-only.md)). From a `createData` call it reads operation names and literal `writes` shapes only.

`./build` never imports `node:fs`. Every options object takes a filesystem you supply; `data-cap/node` exports the Node one ([ADR 0058](specs/decisions/0058-library-surfaces-do-not-acquire-node-fs.md)):

```ts
import { discoverCapabilityFiles, linkCapabilityFiles } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"

const files = await discoverCapabilityFiles({ fs: nodeBuildFileSystem, root: "." })
const { capabilities, warnings } = await linkCapabilityFiles(files, {
  fs: nodeBuildFileSystem,
  root: ".",
})
```

A `fields` reference is followed through relative imports and `tsconfig.json` path aliases. With a `packages` allowlist, it also follows a bare import from an installed package that declares `package.json#dataCap.schema`. See [Reusable packages](#reusable-packages) and [ADR 0032](specs/decisions/0032-tsconfig-path-alias-resolution-ported.md).

### The capability inventory

Every generator reads one model, `buildInventory`'s `CapabilityInventory`. What counts as a conflict, or as sensitive, is defined once:

```ts
import { buildInventory } from "data-cap/build"

const inventory = buildInventory(
  await linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root: "." }),
)
```

### Generated artifacts

`generateDataArtifacts()` and `checkArtifacts()` produce these from your own build script:

| Artifact                        | Option              | What it is                                                                                                                   |
| ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Manifest                        | `location: <path>`  | A deterministic `.ts` file re-exporting every active capability, with a "changes since last report" diff.                    |
| Documentation catalog           | `docs: <path>`      | A Markdown catalog of every field and operation, with sensitivity and documented protections.                                |
| Dependency and ownership report | `ownership: <path>` | The owner-to-capability matrix, and the consumer graph the scan proved from the AST.                                         |
| Data-flow diagrams              | `flow: <directory>` | Mermaid diagrams in OWASP data-flow vocabulary, and a findings review led by sensitive fields crossing an external boundary. |

None of these is a CLI flag ([ADR 0066](specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md)). Call the orchestrator, or the single generators `generateManifest`, `generateDocumentation`, `generateUsage` and `generateFlow`. [`examples/application/scripts/generate-docs`](https://github.com/MaverickCER/data-cap/tree/main/examples/application/scripts/generate-docs) is a worked script.

Every report separates two kinds of fact. **Declared** facts are what an author wrote (`owner`, `sensitivity`, `protections`, `endpoints`); their presence is checked, never their truth. **Proven** facts come from the AST (`writes`, a dependency edge). An ambiguous case becomes an `info` or `indeterminate` finding, never a guessed `error`. `test/build/negative-guarantees.test.ts` holds this, and checks that finding messages never claim adequacy or verification. [specs/generated-artifacts.md](specs/generated-artifacts.md) lists what is generated, and what is deliberately not.

### Programmatic orchestration

The CLI is a thin wrapper; `generateDataArtifacts` and `checkArtifacts` work on their own. Every artifact is computed, and every finding judged, before any file is written. A blocking finding throws `DataProjectGenerationError` and writes nothing (`test/build/generate-data-artifacts.test.ts`):

```ts
import { generateDataArtifacts } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"

await generateDataArtifacts({
  fs: nodeBuildFileSystem,
  root: ".",
  location: "src/generated/data.manifest.ts",
  flow: "docs/flow",
  strictFlow: true,
})
```

Outside Node, pass your own `BuildFileSystem`; `data-cap/build` exports the type.

### Reusable packages

An installable package can ship its own capability declaration. Discovery is opt-in, by an explicit allowlist (`packages`, or `--package` on the CLI):

```ts
await generateDataArtifacts({
  fs: nodeBuildFileSystem,
  root: ".",
  location: "src/generated/data.manifest.ts",
  packages: ["@acme/payments-sdk"],
})
```

The publishing package declares `"dataCap": { "schema": "./src/payments.capability.ts" }` in its `package.json`. It ships that `.ts` source next to its compiled `dist/`. Resolution reads one `package.json` per allow-listed package, then one declared file; it never walks `node_modules` (`test/build/resolution/resolve-package-schema.test.ts`). An allow-listed package's own directory is also scanned as consumer source.

### The CLI

The CLI writes one file, the Evidence Model, with `--evidence` ([ADR 0050](specs/decisions/0050-fact-model-architecture.md)). Other flags change what goes into that file and how it is judged:

```bash
npx data-cap --evidence docs/data.evidence.json
npx data-cap --help
```

| Flag                         | Meaning                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--evidence <path>`          | Required. Write the composed Evidence Model as JSON at this path.                                                                                  |
| `--root <path>`              | Directory the globs resolve from. Default: the current directory.                                                                                  |
| `--include <glob>`           | Discovery glob. Repeatable. Default: every `.ts` and `.tsx` file.                                                                                  |
| `--exclude <glob>`           | Glob to exclude from discovery. Repeatable.                                                                                                        |
| `--package <name>`           | Also discover a capability from an installed package's `dataCap.schema` field. Repeatable.                                                         |
| `--tsconfig <path>`          | `tsconfig.json`, relative to the root, whose `paths` and `baseUrl` resolve aliased imports. Default: the one at the root.                          |
| `--no-tsconfig`              | Turn path-alias resolution off.                                                                                                                    |
| `--expiring-within-days <n>` | How many days out counts as "expiring soon" in the Lifecycle Model. Default: 30.                                                                   |
| `--strict`                   | Treat every warning as an error. Info findings never escalate.                                                                                     |
| `--strict-docs`              | Escalate static findings only: ownership, sensitivity, duplication.                                                                                |
| `--strict-ownership`         | Escalate proven usage findings only: abandoned capabilities, unconsumed owned fields.                                                              |
| `--strict-flow`              | Escalate data-flow warnings: a sensitive field crossing a boundary, an undecided policy, a field sent whole to a client, an unused sensitive path. |
| `--flow-evidence`            | Trace each field through your functions, evaluate the `flowPolicy` rules, and add the result to the evidence. Experimental.                        |
| `--observations <path>`      | Runtime observations from `data-cap/observe`, added to the evidence and compared with the static findings. Experimental.                           |
| `--rules <path>`             | A JSON file of rules over the evidence. Exits 1 if one is violated. A rule whose analysis did not run counts as violated. Experimental.            |
| `--json`                     | Print a machine-readable report instead of text.                                                                                                   |
| `--check`                    | Write nothing. Exit 1 if the evidence file is stale or missing.                                                                                    |
| `--help`, `-h`               | Show the help text.                                                                                                                                |

`test/docs-cli-flags.test.ts` fails when a flag in `src/cli/index.ts` is missing from this Guide. `--check` and the `--strict*` flags are covered by `test/cli/index.test.ts`.

`npx data-cap init` scaffolds `src/data.ts` and `scripts/generate-data.mjs`. It never overwrites a file and runs nothing (`test/cli/init.test.ts`).

### Using the CLI in any CI system

The GitHub Action wraps the CLI; every other CI system gets the same gate from the CLI alone.

1. Install `data-cap` as a devDependency, then run it in the pipeline:

   ```bash
   npx data-cap --evidence docs/data.evidence.json --flow-evidence --rules data-cap.rules.json --check --json > data-cap.json
   ```

2. Fail the job on the exit code:

   | Exit code | Meaning                                                                                                                                                                                                                        |
   | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `0`       | The evidence is current and no rule is violated.                                                                                                                                                                               |
   | `1`       | The evidence is stale, a rule is violated, or the run failed. On a failed run the JSON report has an `error`. On stale evidence `checkResult.stale` lists the files, and on a violated rule `evidenceRules` holds the verdict. |
   | `2`       | Only from the GitHub Action's wrapper: `data-cap` is not installed and no `version` was given, or `version` is not a plain version or dist-tag.                                                                                |

3. Read `data-cap.json`. `checkResult.stale` names each stale artifact, and `evidenceRules` holds the rule verdict. On failed generation, `error.findings` lists each issue with its `severity`, `message`, `file` and `position`.

The report validates against the published JSON Schema, `data-cap/schema` (`test/build/json-schema.test.ts`). An unreadable `--rules` or `--observations` file exits 1 with nothing on stdout, so treat an empty `data-cap.json` as a failure. For a SARIF upload, project the evidence with `buildSarifLog` from `data-cap/build`. The CLI reads no GitHub-specific environment variable today; no check enforces that.

### GitHub Action

The Action runs `data-cap --json` and turns the result into pull request annotations and one summary comment.

```yaml
# .github/workflows/data-cap.yml
name: data-cap

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  report:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - run: npm ci # the action runs the data-cap your project installs

      - uses: maverickcer/data-cap@v0
        with:
          args: "--evidence docs/data.evidence.json --strict-docs --strict-ownership"
```

| Input               | Default               | Purpose                                                                                                                                                 |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `args`              | _(required)_          | Arguments for `data-cap --json`, such as `--evidence`, `--flow-evidence`, `--rules` and the `--strict*` flags.                                          |
| `working-directory` | `.`                   | Directory to run `data-cap` from.                                                                                                                       |
| `version`           | _(none)_              | Version to run through `npx` when `data-cap` is not installed locally. Pin an exact version: a dist-tag such as `latest` is accepted and runs unpinned. |
| `comment`           | `true`                | Create or update one summary comment on the pull request.                                                                                               |
| `annotations`       | `true`                | Emit workflow annotations for the findings.                                                                                                             |
| `report-key`        | _(working-directory)_ | Names this report, so two runs on one pull request do not overwrite each other's comment.                                                               |
| `github-token`      | `github.token`        | Token for the comment calls.                                                                                                                            |

The Action has no policy of its own: the job passes or fails on the CLI's exit code. Without a local install and without `version`, it exits 2 rather than run an unpinned build. Inputs reach its script as environment variables, never interpolated (`test/scripts/github-action-run-cli.test.ts`). With `--flow-evidence`, the comment adds a data-flow section; with `--rules`, the rule verdict. The comment and annotation rendering is tested in `test/scripts/github-action-report.test.ts`; the call that posts the comment to GitHub is not.

In a monorepo, give each run its own `report-key`.

## Data flow

Experimental. For the security or privacy reviewer, and for the engineer asked "where does this field go?". `--flow-evidence` (or `flowEvidence: true` on `generateDataArtifacts`) traces each field of each capability through your functions. The result goes into the one evidence file; every diagram and export below is a projection of that file. [`examples/flow-explorer/`](https://github.com/MaverickCER/data-cap/tree/main/examples/flow-explorer) runs all of it.

```bash
npx data-cap --evidence docs/data.evidence.json --flow-evidence
```

The pieces, in the order they run:

1. The scan reads your source and records where each field goes, with a status on every fact.
2. Your `flowPolicy` rules are evaluated per field.
3. Optional runtime observations from `data-cap/observe` are joined to the static facts as claims.
4. `--rules` turns the result into a CI verdict.
5. `data-cap/evidence` projects the file into views and standards formats.

### What it follows, and what it says when it cannot

The scan reads your source; it never runs it. It follows a field through variables, destructuring, spreads, literals, parameters, return values, closures, callbacks, `await`, `.then`, JSX props and calls into your project, across files. Each function is evaluated for the data it receives, so a helper shared by two fields does not mix them. Per function it records what it reads, returns, passes on, sends across a boundary, and receives and discards.

Boundaries are the endpoints you declare in `documentData()`, plus code it recognises as leaving the program. `res.json` and `res.send` are a `client-response`; `console.*` and `logger.*` are a `log`. Add your own with the `flowSinks` option.

Every fact has one of five statuses, never blended:

| Status     | Meaning                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `declared` | An author asserted it in `documentData()`. Not checked against code.      |
| `static`   | Established by the analyzed code.                                         |
| `observed` | Seen in a specific execution or test.                                     |
| `inferred` | Plausible, not established: data assumed to pass through unfollowed code. |
| `unknown`  | Not analyzable: dynamic behaviour, missing source, a limit reached.       |

What it cannot follow is recorded, not dropped. Examples are a call into a package, a computed key on tracked data, or a chain past its depth limit. Each becomes an `unknown` with a `file:line:column` and the exact data that went in. The data is assumed to pass through (an `inferred` edge), and the trace is marked not complete. An unknown that only received `email` makes questions about `email` incomplete, not questions about `passwordHash`. A missing flow in an incomplete trace means nothing. In a complete trace it means none of the forms the scan follows carried the data; the 343-form catalog checks those forms only.

#### What the scan follows

Beyond the cases above, it follows classes (`this`, fields, inheritance, `super`), default and barrel re-exports, and `import("literal")`. It also follows generators, `Map`, `Set`, `Promise`, `Reflect`, `bind`, `Object.groupBy`, prototypes, CommonJS and decorators. Aliasing is followed through allocation sites, so a write through one name is seen through another. Where a model approximates, it adds a flow rather than drops one ([ADR 0074](https://github.com/MaverickCER/data-cap/blob/main/specs/decisions/0074-flow-scan-non-goals-and-irreducible-limits.md)).

`test/flow/never-silently-safe.test.ts` checks that promise on a catalog of 343 ways to leak one field of a record. A property test also swaps the field for its sibling. Each case must end followed to the sink, as an `unknown` that names the data, or as the whole record sent. A complete trace that misses the leak fails the suite. The check covers the catalogued forms.

These rules always apply:

- A whole capability value handed to a sink or an unknown takes every field.
- A closure nothing calls, but that returns tracked data, is an `unanalyzed-function` unknown.
- Module-state chains get at most 6 rounds (`test/build/flow-reach-limits.test.ts`). A project still moving data at the cap gets an unknown that makes every trace incomplete.
- `test/build/flow-scale.test.ts` analyzes a 600-file, 3000-function project inside a 30-second budget. It also checks that a second run is byte-identical.

#### What it deliberately does not follow

The scan is a data-flow analysis, not an information-flow one. Branching on tracked data moves none of it. A comparison, `!`, `typeof`, `instanceof`, `in` or `delete` yields a value that carries no data: `res.json(user.email === "a@b.c")` sends a boolean. Object keys are field names, which the report already shows. Each of these decisions is pinned by a test.

Some forms cannot be followed by reading source: `eval`, `new Function`, `new Proxy`, `with`, `setTimeout(string)`, and `import()` or `require()` of a computed specifier. When tracked data reaches one, the result is an `unknown` and the trace is incomplete. Operation bodies inside `createData` and `buildData` stay opaque. There is no type checker, so a call whose target depends on a value's type is unresolved. ADR 0074 lists the remaining limits.

### Declaring package behaviour

The scan reads your project only, so a package call that receives tracked data is an `unresolved-call` unknown. `flowSummaries` is how you say what the call does:

```ts
await generateDataArtifacts({
  // ...
  flowEvidence: true,
  flowSummaries: [
    { module: "lodash", export: "cloneDeep", effect: "pass-through" },
    { module: "lodash", export: "pick", effect: "returns-arg", arg: 0, approximate: true },
    {
      module: "@acme/analytics",
      export: "track",
      effect: "sink",
      boundary: { kind: "external-service", name: "analytics" },
    },
    { module: "validator", export: "escape", effect: "sanitizes" },
  ],
})
```

| Effect         | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| `pass-through` | The result holds everything the arguments hold.                   |
| `returns-arg`  | The result holds what argument `arg` holds.                       |
| `sink`         | The arguments leave through `boundary`, with optional `handling`. |
| `sanitizes`    | The result holds none of it.                                      |
| `ignores`      | The call neither carries nor sends data.                          |

`approximate: true` marks a `pass-through` or `returns-arg` as an over-approximation. `export` is the imported name, `default`, or a dotted member such as `z.object`. The first matching summary wins, and a function your project defines is never replaced (`test/build/flow-reach-summaries.test.ts`).

A fact learned from a summary is `declared` on every later hop, because it is your word about code the scan has not read. No summaries ship with the package, since a wrong one errs in the dangerous direction. Summaries are part of the evidence cache key, so changing one makes the evidence stale. A summary describes a function, not an object it returns, so `createClient().send(user)` stays unknown.

### Declaring where data must never go

```ts
documentData(schema, {
  sensitivity: "confidential",
  flowPolicy: [
    {
      id: "no-password-to-client",
      appliesTo: { field: "user", path: ["passwordHash"] },
      forbidDestinations: ["client-response"],
    },
  ],
})
```

`appliesTo` selects fields by `classification` (their resolved `sensitivity`), by `field`, or both, optionally narrowed to a `path`. A rule constrains with `forbidDestinations`, an `allowedDestinations` list, or `requireHandling`. `allowedHandling` exempts a crossing that is, for example, hashed. A malformed rule is dropped with a warning that names it. Each rule is judged per field:

| Result          | Finding                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `violated`      | An `error` when `static` or `declared` evidence establishes it; a `warning` when it rests on an `inferred` edge. |
| `satisfied`     | Every path was followed and the rule holds.                                                                      |
| `indeterminate` | The analysis could not decide. A `warning`, never a pass; `--strict-flow` fails the build on it.                 |

### Least data

The same evidence answers "what do we hold that nothing uses?":

- `LEAST_DATA_UNUSED_PATH`: a path of a field's declared shape that no function reads, forwards or sends. It is a warning when the field is sensitive.
- `LEAST_DATA_WHOLE_FIELD_TO_CLIENT`: a whole multi-key field sent to a client response.
- Per function, what it received and discarded.

A path counts as used only by evidence specific to it, or by the whole value reaching a boundary. A key an unknown concerns is reported as not assessed.

### Recording runtime observations

Static analysis says what the code can do; observation says what one execution did. `data-cap/observe` records which field names crossed which boundary. It records names, never values, does no I/O of its own, and never throws into the code it observes (`test/observe/`).

1. **Record** in your tests. Wrap the call that crosses a boundary, and give it a scope and a `clock`:

   ```ts
   // vitest.setup.ts
   import { afterAll, beforeAll, expect } from "vitest"
   import { writeFileSync } from "node:fs"
   import { createMemorySink, instrumentBoundary } from "data-cap/observe"

   const memory = createMemorySink()
   let restore = () => {}
   beforeAll(() => {
     restore = instrumentBoundary(
       httpClient, // the object that owns the method
       "respond",
       {
         scope: () => expect.getState().currentTestName ?? "unknown",
         boundary: { kind: "client-response", name: "http-response" },
         capability: "userData",
         observe: "args",
         clock: Date.now, // yours: the recorder never reads a clock itself
       },
       memory.sink,
     )
   })
   afterAll(() => {
     restore()
     writeFileSync(
       "observations.json",
       JSON.stringify({ events: memory.events(), skips: memory.skips() }),
     )
   })
   ```

   The same shape works in Jest (`afterAll`) and `node:test` (`after`).

2. **Join** the file: `data-cap --evidence docs/data.evidence.json --flow-evidence --observations observations.json`. The file is a JSON array of events, or `{ "events": [...], "skips": [...] }` to include what the recorder left out.

3. **Gate** on it with the [CI rules](#enforcing-it-in-ci).

| Function                                             | Records                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observeBoundary(sink, input)`                       | The field paths you list, once each. The others call it.                                                                                                        |
| `observeValue(sink, context, value, options?)`       | Every path in a JSON-like value. Returns `value`, so it wraps a call: `res.json(observeValue(sink, ctx, body))`.                                                |
| `observeSink(sink, context)`                         | A one-argument pass-through that observes and returns its argument.                                                                                             |
| `instrumentBoundary(target, method, context, sink)`  | Wraps `target[method]` and observes its argument, its result, or both. Returns a function that restores it. It throws at setup if the member is not a function. |
| `observeResponse(sink, context, response, options?)` | The JSON body of a web `Response` or `Request`, read from a clone; the caller's body is not consumed.                                                           |

The walker is bounded by `maxDepth` and `maxNodes`. It skips keys that are empty or contain a dot, cycles, and anything past its bounds. Each skip (`dotted-key`, `max-depth`, `max-nodes`, `cycle`) goes to `options.onSkip` and to `sink.skip`, never silently. A key that looks like a value is still recorded as a name. Time comes only from the `clock` you pass, so `ObservationEvent.at` exists only then.

The events are joined to the static facts as **claims**:

| Verification    | Meaning                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `verified`      | A static, declared or inferred fact that an observation corroborates.              |
| `inferred`      | Rests on an inferred edge and was not observed.                                    |
| `unobserved`    | Static or declared, and no observation covers it.                                  |
| `contradicted`  | An observation conflicts with a complete static trace, or a policy is violated.    |
| `observed-only` | Seen at runtime with no static counterpart, where the static trace was incomplete. |
| `indeterminate` | A policy could not be decided, or the evidence near the field was truncated.       |

A claim also lists `observedPaths`, a `pathCoverage` (`whole` or `partial`) and `lastObservedAt`. Observing `email` says nothing about a claim scoped to `passwordHash`. A claim that would be `verified` becomes `indeterminate` when a contributing scope was truncated near its field. Observations cover the executions that ran; `unobserved` is the normal state for most of a real system.

### Enforcing it in CI

`--rules rules.json` checks the evidence against your rules and exits 1 if any is violated:

```json
{
  "noPolicyViolations": true,
  "noIndeterminatePolicies": true,
  "maxContradictedClaims": 0,
  "maxUnknowns": 3,
  "maxUnusedSensitivePaths": 0,
  "requireVerified": ["userData/no-password-to-client"]
}
```

| Rule                      | Fails when                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `noPolicyViolations`      | A declared policy rule is violated.                                                                             |
| `noIndeterminatePolicies` | A declared policy rule could not be decided.                                                                    |
| `maxContradictedClaims`   | More claims are contradicted than allowed.                                                                      |
| `maxUnknowns`             | There are more unknowns than allowed.                                                                           |
| `requireComplete`         | Anything was left unfollowed.                                                                                   |
| `maxUnusedSensitivePaths` | More sensitive paths are unused than allowed.                                                                   |
| `maxWholeFieldToClient`   | More multi-key fields are sent whole to a client than allowed.                                                  |
| `requireObservations`     | No observations were ingested.                                                                                  |
| `minVerifiedClaims`       | Fewer claims are verified than required.                                                                        |
| `requireVerified`         | A named policy rule (`capability/rule`) has a claim that is not verified.                                       |
| `maxRedundantTransforms`  | There are more [redundant transformations](#redundant-transformations) than allowed.                            |
| `maxObservationAgeDays`   | A verified claim's `lastObservedAt` is older than this, counted back from `provenance.generatedAt`, or missing. |

The rules fail closed: a rule that needs an analysis that did not run is a violation that says so (`test/evidence/evidence-rules.test.ts`). A misspelled or mistyped rule, or a file with no rules, is rejected by name before anything runs. `maxObservationAgeDays` compares against the evidence's own generation time and never reads a clock. The evaluator is exported as `evaluateEvidenceRules`, so a dashboard can apply the same rules to a stored file.

### Your own projections (Stable)

`defineEvidenceProjection` is the Stable part of `data-cap/evidence`. You give it one pure projector function per output key, and it returns a function from the Evidence Model to your output shape. `.project()` also returns which evidence paths fed each output key. Each projector reads the evidence through a read-only membrane, so a write, a delete or `defineProperty` throws a `TypeError` (`test/evidence/define-evidence-projection.test.ts`). The membrane cannot stop a projector doing I/O; keep projectors pure. `examples/enterprise-platform/reports/data-handling-record.ts` uses it.

### Standards exports and views

Everything else in this section is Experimental.

Each function here is a pure function of the evidence, exported from `data-cap/evidence`. That entry imports nothing, has a 32 KB gzip budget, and `./build` re-exports it. The package draws nothing interactive; you choose the renderer.

| Function                                                                  | Produces                                                                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `traceFlow`, `traceFlowBetween`, `filterFlow`, `diffFlow`, `observedFlow` | A field traced up or down, a filtered flow, two revisions compared, and the part an execution witnessed.                                |
| `buildFlowGraphView`                                                      | A library-independent graph model: inputs, reads, forwards, side effects, discards and callers per function.                            |
| `renderFlowText`                                                          | The graph as Markdown text, for a screen reader or a code review.                                                                       |
| `renderFlowDot`, `renderFlowMermaid`                                      | Graphviz DOT and Mermaid. Status is in text as well as colour; unknowns are nodes.                                                      |
| `buildProvDocument`                                                       | W3C PROV-JSON lineage, with the path and status on every relation.                                                                      |
| `buildSarifLog` (`data-cap/build`)                                        | SARIF 2.1.0 results anchored at the code, with a `codeFlow` for a policy violation.                                                     |
| `buildOscalAssessmentResults`                                             | NIST OSCAL assessment-results. You supply the control ids; `strict: true` refuses to build without `assessmentPlan` and `evidenceHref`. |
| `observationsToOtlp`, `observationsFromOtlp`                              | OpenTelemetry OTLP/JSON spans with `data_cap.*` attributes, and back. No OpenTelemetry dependency.                                      |
| `buildCycloneDxBom`, `renderFlowCycloneDx`                                | CycloneDX 1.6 with deterministic ids. `undefined` when no flow was computed.                                                            |
| `analyzeLeastData`                                                        | The [least-data](#least-data) analysis.                                                                                                 |
| `analyzeRedundantTransforms`, `redundantTransformFindings`                | The [redundant-transformation](#redundant-transformations) analysis.                                                                    |

SARIF, OSCAL and CycloneDX output is validated against the official schemas in the tests that [specs/generated-artifacts.md](specs/generated-artifacts.md#data-flow-evidence-projections-experimental) names; PROV is checked for referential closure. A valid document is well formed; it does not mean the facts in it are complete. Each data-flow projection carries a disclaimer: it can support a review and does not establish compliance. `test/evidence/flow-disclaimer.test.ts` holds that text.

To put the graph in generated documentation, write the text and a diagram into one Markdown file:

```ts
import { renderFlowMermaid, renderFlowText } from "data-cap/build"

const text = renderFlowText(evidence, { headingLevel: 2 })
const diagram = renderFlowMermaid(evidence, { field: "userData.user" })
await fs.writeFile("docs/FLOW.md", `${text}\n\`\`\`mermaid\n${diagram}\`\`\`\n`)
```

Every finding carries `evidence` references, so a reader can go from a finding to the analysis behind it.

### Redundant transformations

Data handled more than it needs to be. `analyzeRedundantTransforms(flow)` reports three kinds:

- `round-trip`: `JSON.parse(JSON.stringify(x))`, `Object.fromEntries(Object.entries(x))`, or a copy of a value that is already a fresh copy. One defensive copy is not reported.
- `forwarding-hop`: a chain of at least `MIN_FORWARDING_HOPS` functions that only receive a path and hand it on.
- `dead-derivation`: a value computed from a field and bound to a name nothing reads.

`redundantTransformFindings` turns them into `LEAST_DATA_REDUNDANT_TRANSFORM` findings. They are `info`, and `--strict-flow` never escalates them. A finding is withheld when an unknown concerns the same data, so silence does not prove nothing is redundant. See [ADR 0075](https://github.com/MaverickCER/data-cap/blob/main/specs/decisions/0075-redundant-transformations.md).

### The explorer

[`examples/flow-explorer/`](https://github.com/MaverickCER/data-cap/tree/main/examples/flow-explorer) turns one evidence file into an interactive page. Pick a field, trace it, filter it, compare two revisions, and read the same facts as text. It draws with a devDependency (`@viz-js/viz`) and calls `traceFlow`, `diffFlow` and `renderFlowText` itself. Its tests run in jsdom with axe-core and a contrast check; no real browser or screen reader runs them. The page says on screen when the analysis is incomplete. CI's `examples` job runs those tests, plus a scan over all four consumer examples; that job does not block a merge.

## ESLint plugin

For lint owners. The four rules catch mistakes specific to this package that general rules miss:

```js
// eslint.config.js
import dataCapPlugin from "data-cap/eslint-plugin"

export default [
  {
    plugins: { "data-cap": dataCapPlugin },
    rules: {
      "data-cap/stable-operation-reference": "warn",
      "data-cap/no-fields-escape": "warn",
      "data-cap/no-raw-external-io": "warn",
      "data-cap/no-node-fs": "warn",
    },
  },
]
```

| Rule                         | Flags                                                                                                                                                                                                          | Options                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `stable-operation-reference` | An `execute`, `processor`, `subscribe` or `optimistic` inside `createData()` that is inline or re-created per call, found by scope analysis. Such a function silently defeats dedup.                           | none                                                                                  |
| `no-raw-external-io`         | A direct global I/O call (`fetch` by default) outside an operation's `execute` or `subscribe`, where it has no owner and no declared endpoint.                                                                 | `functions` adds names such as `WebSocket`; `allow` (globs) exempts a transport layer |
| `no-fields-escape`           | A whole `.fields` or `getSnapshot()` result escaping the file: spread or rest, a bare call argument, one named JSX prop, or an export. Each shape has its own message id. A plain local alias is out of scope. | `allow` (globs)                                                                       |
| `no-node-fs`                 | An `import`, `require` or dynamic `import()` of `node:fs`, so a module takes its filesystem from its caller.                                                                                                   | none                                                                                  |

Each rule has its own test under `test/eslint-plugin/`. Rule names and message ids are Stable ([VERSIONING.md](VERSIONING.md#stable)). The unit tests run on ESLint 10. A fixture runs the plugin under ESLint 9 in a job that does not block a merge. ESLint 8.57 is in the peer range but untested. See [ADR 0063](specs/decisions/0063-eslint-plugin-multiple-rules-and-no-fields-spread.md) and [ADR 0064](specs/decisions/0064-no-fields-escape-export-argument-and-prop.md).

## Troubleshooting

### Error classes

Every error the package throws extends `DataCapError` and carries a stable `code`. Switch on the `code`: `instanceof` can fail across bundle boundaries (`test/core/errors.test.ts`).

| Error                                                               | Thrown by                       | Common cause                                        | Fix                                                      |
| ------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `InvalidFieldDefaultError` (`DATA_CAP_INVALID_FIELD_DEFAULT`)       | `buildData()`, `documentData()` | A field default is a function or contains a cycle.  | Declare a plain, acyclic default value.                  |
| `UnknownGetterError` (`DATA_CAP_UNKNOWN_GETTER`)                    | `runGetters()`                  | A getter name that the capability does not declare. | Fix the name at the call site.                           |
| `DataProjectGenerationError` (`DATA_CAP_PROJECT_GENERATION_FAILED`) | `data-cap/build` generators     | The run found at least one `error` finding.         | Read the listed findings; each names its fix. Run again. |

### Reading a field does not wait for data

That is intentional ([ADR 0004](specs/decisions/0004-fields-always-synchronously-readable.md)). Every field has its declared default from the start. Build "is it ready?" logic from `info.<field>.status`.

### My optimistic value does not roll back on failure

Removing the pending transition is the whole mechanism. The visible value reverts because `project()` no longer folds that transition ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md)). `createData`'s mutators do this in a `finally`.

### Two capabilities do not share a subscription or a dedup

Sharing is by function identity. An inline arrow is a new function every time it is created. Run the `stable-operation-reference` rule. For `createData`, keep the schema's `execute` and `subscribe` at module level, not rebuilt inside a component or factory.

### There is no `./tanstack` or `./socket-io` package

By design ([ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md)). Copy the [tested patterns](#tanstack-query-and-socketio) instead.

## Performance characteristics

Updates share structure. A commit reuses unchanged branches by reference and freezes only the new nodes. A commit that changes nothing returns the previous snapshot and notifies nobody (`test/core/patch.test.ts`). The tests assert these by reference, not by timing ([ADR 0044](specs/decisions/0044-snapshots-deep-frozen-amortized.md)).

The table states the cost each operation is designed to have:

| Operation                                     | Designed cost                     | Compared with a naive full-state replace                     |
| --------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `buildData()` init                            | O(fields)                         | Same order: both walk the declared shape once.               |
| `getSnapshot().fields.<path>` read            | O(1)                              | Same: a plain property read.                                 |
| `commitAuthoritative` or an optimistic commit | O(changed leaves + ancestor path) | A root spread re-allocates every sibling branch.             |
| `identity.reconcileArrayInfo`                 | One pass over the items           | A full rebuild loses the object identity of unchanged items. |
| `coordinator.dedupe` lookup                   | O(1) amortized, one map lookup    | A scan of in-flight requests is O(in-flight calls).          |

The benchmarks fit a growth class to each function. A run fails on a growth class two or more classes off, a class worse than at the last release without a recorded exception, or overhead growth ([PERFORMANCE.md](PERFORMANCE.md#what-fails-a-run)). A failed `benchmark-pr` skips `lint`, `verify` and `contract`, and GitHub counts a skipped required check as passing, so check it by hand. The release still needs a successful `contract` run. Every entry point also has a gzip budget, which `verify` and `contract` enforce.

## Further reading

| Document                                                                                    | For                                                                   |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [API reference](https://maverickcer.github.io/data-cap/api/)                                | Every exported symbol, generated from the source.                     |
| [`specs/architecture.md`](specs/architecture.md) and [`specs/decisions/`](specs/decisions/) | Why the package is shaped this way.                                   |
| [`specs/migrations/`](specs/migrations/)                                                    | Adopting from Apollo, TanStack Query, a global store or manual fetch. |
| [`ADOPTION.md`](ADOPTION.md)                                                                | What adopting costs, needs and refuses to do.                         |
| [`SECURITY.md`](SECURITY.md)                                                                | The threat model, and what each check covers.                         |
| [`VERSIONING.md`](VERSIONING.md)                                                            | What semver covers, entry point by entry point.                       |
| [`PERFORMANCE.md`](PERFORMANCE.md)                                                          | Size budgets and benchmark gates.                                     |
| [`AGENTS.md`](AGENTS.md) and [`skills/data-cap/SKILL.md`](skills/data-cap/SKILL.md)         | Rules for coding agents.                                              |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_REVIEW.md`](CODE_REVIEW.md)                 | Making and reviewing a change.                                        |
