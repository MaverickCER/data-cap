# data-cap Guide

The reference manual: the documented example, fields & info, optimistic mutations, array identity, subscriptions, the coordinator, cache & retry, helpers, TanStack Query/Socket.IO patterns, build tooling & the CLI, the ESLint plugin, the GitHub Action, architecture, migration, the security model, troubleshooting, and performance characteristics.

For the pitch, quick start, and adoption reasoning, see [README.md](README.md). For why the package is built the way it is, see [specs/architecture.md](specs/architecture.md) and the [ADRs](specs/decisions/).

- [Runtime support matrix](#runtime-support-matrix)
- [AI-Assisted Integration](#ai-assisted-integration)
- [The low-level path: full manual control](#the-low-level-path-full-manual-control)
- [Documented example](#documented-example)
- [Fields and info](#fields-and-info)
- [Optimistic mutations](#optimistic-mutations)
- [Array identity](#array-identity)
- [Subscriptions](#subscriptions)
- [Coordinator: dedup and isolation](#coordinator-dedup-and-isolation)
- [Cache and retry](#cache-and-retry)
- [Helpers](#helpers)
- [TanStack Query and Socket.IO](#tanstack-query-and-socketio)
- [Build tooling, generated reports, and the CLI](#build-tooling-generated-reports-and-the-cli)
- [ESLint plugin](#eslint-plugin)
- [GitHub Action](#github-action)
- [Architecture](#architecture)
- [Migration](#migration)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Performance characteristics](#performance-characteristics)

## Runtime support matrix

| Entry point                                       | Node                                                                                                                                                | Browser | Bun                                      | Deno | Edge/serverless |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------- | ---- | --------------- |
| `.` (core)                                        | ✅                                                                                                                                                  | ✅      | ✅                                       | ✅   | ✅              |
| `./runtime`, `./runtime/cache`, `./runtime/retry` | ✅                                                                                                                                                  | ✅      | ✅                                       | ✅   | ✅              |
| `./helpers`                                       | ✅                                                                                                                                                  | ✅      | ✅                                       | ✅   | ✅              |
| `./build`                                         | ✅ (Node-only — uses the TypeScript Compiler API; never `node:fs`, see [ADR 0058](specs/decisions/0058-library-surfaces-do-not-acquire-node-fs.md)) | ❌      | ✅                                       | ✅   | ❌              |
| `./evidence`                                      | ✅                                                                                                                                                  | ✅      | ✅                                       | ✅   | ✅              |
| `./eslint-plugin`                                 | ✅ (Node-only — runs inside ESLint)                                                                                                                 | ❌      | ❌ (ESLint itself doesn't run under Bun) | ❌   | ❌              |

Bun/Deno rows for `core`/`runtime`/`helpers` are verified directly against real Bun and Deno engines in CI (`test/cross-runtime/`), not just claimed by analogy to Node. See the further reading below for the full architectural model, and [the docs site's comparison and FAQ sections](https://maverickcer.github.io/data-cap/#comparison) for more on how this compares to conventional fetch-and-`useState`/global-store patterns.

## AI-Assisted Integration

`data-cap` is designed to provide a clear architectural boundary that can also be understood and analyzed by AI coding assistants.

When integrating `data-cap` into an existing repository, the repository's existing architecture, persistence model, transport layer, and ownership boundaries should be analyzed before introducing contracts.

For AI-agent-specific guidance, see:

- [`AGENTS.md`](AGENTS.md)
- [`skills/data-cap/SKILL.md`](skills/data-cap/SKILL.md)

The canonical architectural specification remains [`specs/architecture.md`](specs/architecture.md); Architecture Decision Records remain authoritative for decisions that have been explicitly recorded in [`specs/decisions/`](specs/decisions/).

## The low-level path: full manual control

For applications that want to own execution, retry, and caching policy
themselves instead of the batteries-included default, `buildData` +
`createDataStore` + `coordinator` are the same Stable primitives
`createData` is built from, usable directly:

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

async function loadUser(): Promise<void> {
  const controller = new AbortController()
  store.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const raw = await defaultCoordinator.dedupe(
      (_params, signal) => fetchUser(signal),
      undefined,
      controller.signal,
    )
    store.commitAuthoritative({ user: raw }, { user: { status: "success", source: "loadUser" } })
  } catch (error) {
    store.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "loadUser", error } },
    })
  }
}
```

This is the exact pattern `test/integration/runtime-core/basic-standalone/` demonstrates end to
end, with real assertions — most other examples in `examples/` build on
this same shape. Both paths compose the same underlying primitives; neither
is "the" way — pick per capability based on how much control you need over
that specific operation's execution.

Fields are synchronously readable immediately — unlike `env-cap`,
`data-cap` does not use a throw-until-ready gate for ordinary field access.
`data.info` is always present too (never optional), just structurally
sparse until something has actually executed; `getSnapshot().operations`
additionally tracks each getter/mutator/subscription call by its own
canonicalized params, so two differently-parameterized concurrent calls to
the same operation stay independently observable. `getUser`/`updateUser`
methods reject on failure like ordinary Promises (fire-and-forget is `void
userData.getUser(...)`, not a different Promise contract); `runGetters`
runs several getters concurrently and never rejects itself, returning a
structured per-operation outcome instead. `getSnapshot()`/`subscribe()` are
directly `useSyncExternalStore`-compatible, no data-cap-specific hook
required. See `examples/application/` for this worked fully, and
[ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)
for the complete behavioral contract.

## Documented example

`documentData` structurally mirrors the same schema shape both `buildData`
and `createData` accept — documentation augments the same capability
graph, never a loose bag:

```ts
import { buildData, documentData } from "data-cap"

const userFields = { name: "", email: "" }

export const userCapability = buildData({ fields: userFields })

documentData(
  { fields: userFields },
  {
    fields: {
      name: { description: "The user's display name." },
      email: { description: "The user's primary email address." },
    },
  },
)
```

`documentData` is inert at runtime (`void config; void docs`) — its only
consumer is `data-cap/build`'s static analysis, which
correlates a `documentData` call with the `buildData`/`createData`
capability it documents and reports every mismatch category explicitly
(undocumented capability, orphaned documentation, duplicate documentation,
a documented field that doesn't exist) — see
[ADR 0040](specs/decisions/0040-build-tooling-detects-correlation-mismatches.md).
For a `createData` capability, `documentData` also accepts `getters`/
`mutators`/`subscriptions` sections — see `examples/application/`.

## Fields and info

Every `DataState` is `{ fields, info }` — both always present, always
committed together as one atomic snapshot. `buildData`'s own return value
is exactly this shape, directly and statically:

```ts
const capability = buildData({
  fields: {
    user: { name: "", email: "" },
    role: fields.nullable("member"),
    nickname: fields.optional(""),
  },
})

capability.fields.role // null    -- nullable() always resolves to null initially
capability.fields.nickname // undefined -- optional() always resolves to undefined initially
capability.info // {}      -- sparse; nothing has executed yet
```

`fields` are exactly the shape you declared — ordinary JS values, no
wrapper, no proxy, no dot-notation access. `info` mirrors that same
structure, but only ever grows entries for fields something has actually
executed against — `info.user.status`, `info.user.source`,
`info.user.error`, `info.user.optimistic`. See
[ADR 0007](specs/decisions/0007-datainfo-mandatory-not-optional.md) and
[ADR 0008](specs/decisions/0008-fields-info-atomic-commit.md).

`createData`'s own returned capability deliberately has no equivalent
top-level `.fields`/`.info` shortcut — a same-named-but-frozen property
would silently never update the way `buildData()`'s genuinely-static one
does. Every live read goes through `getSnapshot().fields`/`.info`
instead — one unambiguous spelling.

## Optimistic mutations

`createData`'s own `optimistic()` (shown in the [Quick start](README.md#quick-start))
handles this for you. The same mechanism, by hand, via
`addPendingTransition`/`removePendingTransition` — makes a mutation's
not-yet-confirmed value visible immediately, with no automatic rollback and
no invented conflict-resolution policy:

```ts
const optimisticEmail = "new@example.com"
const transitionId = store.addPendingTransition(
  { user: { email: optimisticEmail } },
  { user: { optimistic: true, status: "loading" } },
)

store.getSnapshot().fields.user.email // "new@example.com" -- visible immediately

// On success:
store.commitAuthoritative(
  { user: { email: optimisticEmail } },
  { user: { optimistic: false, status: "success" } },
)
store.removePendingTransition(transitionId)

// On failure: just remove the transition -- no separate "rollback" call.
// The visible value automatically reverts, because project() no longer
// folds a transition that no longer exists.
store.removePendingTransition(transitionId)
```

Every commit always folds onto whatever is _currently_ authoritative, never
a snapshot captured when the mutation started — see
`test/integration/runtime-core/optimistic-mutation-concurrency/` for the full concurrent-mutation
scenario (A starts, B starts, B completes, A completes) worked end to end,
and [ADR 0021](specs/decisions/0021-authoritative-pending-project-model.md)–[ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md).
`createData`'s own `optimistic()` callback receives current authoritative
state specifically (never the visible/projected state), so a second
concurrent optimistic transition never computes against a first
transition's still-pending value.

## Array identity

Arrays stay ordinary arrays in `fields`; `info` tracks each item by a
declared identity, never by array index (which shifts under insertion/
removal/reorder):

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

An item's `FieldInfo` object reference is preserved exactly across a
refetch that doesn't touch it — `next.info.comments["1"] ===
previous.info.comments["1"]` — a reconciliation diff, never a full rebuild.
See `test/integration/runtime-core/array-identity-reconciliation/` for the full malformed-input
matrix (missing key, explicit `null`, duplicate identity) and
[ADR 0009](specs/decisions/0009-fields-arrays-info-identity-keyed.md)–[ADR 0010](specs/decisions/0010-datainfo-array-reconciliation-identity-diffed.md).

## Subscriptions

`createData`'s own `subscriptions` section (see `examples/application/`)
handles this for you, including committing its
own `"disconnected"` status on release. The same mechanism, by hand, via
`coordinator.acquireSubscription`, ref-counts a shared transport by
`subscribe` function identity — the first acquirer opens it, later
acquirers with the same identity reuse it, and it tears down only once
every acquirer has released:

```ts
import { defaultCoordinator } from "data-cap/runtime"

const release = defaultCoordinator.acquireSubscription(subscribeToFeed, {
  onEvent: (event) =>
    store.commitAuthoritative({ price: event.price }, { price: { status: "success" } }),
  onStatusChange: (status) =>
    store.commitAuthoritative(undefined, { price: { subscription: { status } } }),
})
```

A status transition alone (`connecting`/`connected`/`disconnected`) never
touches `fields`, only `info.<field>.subscription` — a disconnect never
discards the last known-good value. See `test/integration/subscriptions/subscription-lifecycle/`,
`test/integration/subscriptions/subscription-with-recover/`, and
`test/integration/subscriptions/multi-capability-shared-transport/` for the full lifecycle
matrix, an optional `recover` resync pattern, and two capabilities sharing
one transport while keeping fully independent state — and
[ADR 0026](specs/decisions/0026-subscription-transport-sharing-independent.md)–[ADR 0030](specs/decisions/0030-recover-resync-runs-once-no-replay-guarantee.md).

## Coordinator: dedup and isolation

`coordinator.dedupe` shares one in-flight call across concurrent calls with
the same function identity and canonically-equal params — non-
canonicalizable params degrade to no-dedup rather than risk a false
collision. `defaultCoordinator` is a module-level singleton;
`createCoordinator()` gives an explicit, isolated domain (a multi-tenant
server process, test isolation):

```ts
import { createCoordinator } from "data-cap/runtime"

const tenantACoordinator = createCoordinator()
const tenantBCoordinator = createCoordinator()
// tenantACoordinator and tenantBCoordinator never share dedup/subscription
// work, even for byte-identical calls.
```

`createData` accepts an explicit coordinator too (`createData(schema, {
coordinator: tenantACoordinator })`) — it defaults to `defaultCoordinator`
otherwise. See `test/integration/coordinator/coordinator-dedup/` and
`test/integration/coordinator/coordinator-isolation/`, and
[ADR 0027](specs/decisions/0027-default-coordinator-singleton-plus-factory.md)–[ADR 0028](specs/decisions/0028-coordinator-dedup-key-identity-plus-params.md).

## Cache and retry

Two separately-tree-shaken optional entry points. `runtime/cache` persists
complete `DataState` (`fields` + `info`) atomically, never raw responses:

```ts
import { createDataCache } from "data-cap/runtime/cache"

const cache = createDataCache<UserFields>({ maxEntries: 100 })
cache.set(cacheKey, capability) // a full DataState, not just fields
```

`runtime/retry` is opt-in retry with abort-awareness and a documented
"only retry a still-default field" policy — it composes directly with a
`createData`-generated operation method too, since those are plain
`(params?, signal?) => Promise<...>` functions:

```ts
import { withRetry, isStillDefault } from "data-cap/runtime/retry"

await withRetry((signal) => userData.getUser({ id: "1" }, signal), controller.signal, {
  maxAttempts: 3,
  shouldRetry: (error) => isStillDefault(userData.getSnapshot().fields.user, defaultUser),
})
```

See `test/integration/runtime-modules/runtime-cache/`, `test/integration/runtime-modules/runtime-retry/`, and
`examples/application/` (which composes `withRetry` with a
`createData` mutator directly), and
[ADR 0034](specs/decisions/0034-optional-runtime-features-separate-entries.md)–[ADR 0036](specs/decisions/0036-retry-opt-in-with-explicit-constraints.md).

## Helpers

`data-cap/helpers` ships four separately tree-shakeable
namespaces — entirely optional, neither `buildData` nor `createData` has
any knowledge of this module:

```ts
import { processors, identity, canonicalize, shape } from "data-cap/helpers"

processors.toNumber(raw.age) // coercion helpers for a processor
identity.computeItemIdentity(item, ["id"], [], warnings)
canonicalize({ id: 1, tags: ["a"] }) // deterministic, type-tagged string
shape.isPlainObject(raw) // structural, never business-rule guards
```

No per-field validator vocabulary exists in `data-cap` — `shape`'s guards
are structural only (`isPlainObject`, `isDate`, `isURL`, `isRegExp`,
`isNullish`), deliberately not a validator system. See
[ADR 0039](specs/decisions/0039-helpers-subpath-scope.md).

## TanStack Query and Socket.IO

No `./tanstack` or `./socket-io` adapter ships, and no React package ships
either (`createData`'s `getSnapshot`/`subscribe` are already
`useSyncExternalStore`-compatible) — see
[ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md).
Full, real, end-to-end-tested reference patterns live in `test/integration/`
instead:

- `test/integration/adoption-patterns/tanstack-query-integration/` — TanStack Query drives fetching/
  caching/dedup; its results flow into a `data-cap` `DataStore`.
- `test/integration/subscriptions/socket-io-subscription/` — a real local Socket.IO server +
  client pair wired into `coordinator.acquireSubscription`.

Copy the pattern directly; there is no package to import instead. A
`useDataStore` React wrapper is a few lines against
`useSyncExternalStore(store.subscribe, store.getSnapshot)` — see the
`useSyncExternalStore` documentation for the hook's own contract; no
first-party example currently demonstrates it end-to-end.

## Build tooling, generated reports, and the CLI

`data-cap` turns your application's data contracts into continuously
generated, machine-readable data inventory, ownership, dependency, and
data-flow **evidence** — evidence that supports a security, privacy, or
platform review, never a claim that the review has already been done.

### Discovery and linking

`data-cap/build` statically discovers and links
`buildData`/`createData`/`documentData` calls across a project — using the
TypeScript Compiler API to read each file's AST, never `import()`ing,
`require()`ing, or `eval()`ing a discovered file
([ADR 0002](specs/decisions/0002-build-tooling-static-analysis-only.md)).
For a `createData` call specifically, it additionally extracts static
getter/mutator/subscription **names** and literal `writes` shapes — never
the operations' own `execute`/`processor`/`subscribe`/`optimistic` function
bodies. `./build` never imports `node:fs` itself — every public options
object requires a caller-supplied `fs: BuildFileSystem`, which the CLI
supplies automatically:

```ts
import { discoverCapabilityFiles, linkCapabilityFiles } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"

const files = await discoverCapabilityFiles({ fs: nodeBuildFileSystem, root: "." })
const { capabilities, warnings } = await linkCapabilityFiles(files, {
  fs: nodeBuildFileSystem,
  root: ".",
})
```

A `fields` reference is followed through relative imports, `tsconfig.json`
path aliases, and — with an explicit `packages` allowlist — a bare import
from a _different_, installed package that declares its own schema via
`package.json#dataCap.schema`:

```ts
await linkCapabilityFiles(files, {
  fs: nodeBuildFileSystem,
  root: ".",
  packages: ["shared-schema-package"],
})
```

See `test/integration/build-tooling/tsconfig-aliases/` and `test/integration/build-tooling/tsconfig-aliases-consumer/`
for both patterns fully worked, and
[ADR 0032](specs/decisions/0032-tsconfig-path-alias-resolution-ported.md).
For the filesystem-capability injection pattern itself, see
[ADR 0058](specs/decisions/0058-library-surfaces-do-not-acquire-node-fs.md).

### The capability inventory

Every generator below reads from one shared model, `buildInventory`'s
`CapabilityInventory` — so "what counts as a conflict" or "what's
sensitive" is defined once, not re-derived per report:

```ts
import { buildInventory } from "data-cap/build"

const inventory = buildInventory(
  await linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root: "." }),
)
```

### Generated artifacts

The CLI (or `generateDataArtifacts()` directly) can produce:

| Artifact                                      | Flag                 | What it is                                                                                                                                                                    |
| --------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest                                      | `--location <path>`  | A deterministic `.ts` file re-exporting every active capability, with a "changes since last report" diff.                                                                     |
| Documentation catalog                         | `--docs <path>`      | A Markdown catalog of every field/getter/mutator/subscription, including sensitivity and documented protections.                                                              |
| Dependency & Ownership report                 | `--ownership <path>` | The owner → {capabilities, fields} matrix, plus a real, AST-proven consumer graph (never guessed at).                                                                         |
| Data Flow Diagram + Security Data-Flow Review | `--flow <directory>` | A Mermaid diagram set using OWASP's data-flow-diagram vocabulary, plus a severity-grouped findings review headlined by any sensitive field that crosses an external boundary. |

Every one of these draws a hard line between **declared** facts (author
metadata — `owner`, `sensitivity`, `protections`, `endpoints` — presence is
checked, correctness never is) and **proven** facts (AST-derived — `writes`,
a `DependencyEdge`). See
[`specs/generated-artifacts.md`](specs/generated-artifacts.md) for the full
list of what's generated today, which industry model (OWASP, NIST Privacy
Framework) each aligns with, and — just as importantly — what's explicitly
deferred and why, so nothing here is assumed silently.

### The CLI

```bash
npx data-cap --location src/generated/data.manifest.ts --docs docs/DATA.md --ownership docs/OWNERSHIP.md --flow docs/flow
```

```bash
npx data-cap --help
```

`--check` verifies every requested artifact is up to date without writing
anything (exit `1` if stale — a CI freshness gate); `--json` emits the full
machine-readable `ReportResult` instead of formatted text;
`--strict`/`--strict-docs`/`--strict-ownership`/`--strict-flow` escalate
that pass's `warning` findings to hard errors (never `info`). See `--help`
for the complete flag reference, including `--include`/`--exclude` globs and
the `--package`/`--tsconfig` cross-package/path-alias options.

### Programmatic orchestration

The CLI is a thin wrapper — `generateDataArtifacts`/`checkArtifacts` are
fully usable directly from an npm script, a bundler plugin, or a CI step
without it. Every requested artifact is computed and every finding
evaluated _before_ any file is written — a partially-written artifact set
is treated as worse than none, so a blocking finding throws
`DataProjectGenerationError` instead of writing partial output. As with
every `./build` entry point, `fs` is required:

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

A non-Node consumer supplies its own `BuildFileSystem` (`data-cap/build` exports the type) instead of importing `./node`.

## ESLint plugin

`stable-operation-reference` flags an `execute`/`processor`/`subscribe`/
`optimistic` value inside a `createData()` call that isn't a stable,
module-level function reference — an inline arrow function, or a reference
recreated on every call (via real scope analysis, not just syntax) — since
the coordinator's identity-based sharing (dedup/subscription reuse)
silently stops applying otherwise:

```js
// eslint.config.js
import dataCapPlugin from "data-cap/eslint-plugin"

export default [
  {
    plugins: { "data-cap": dataCapPlugin },
    rules: { "data-cap/stable-operation-reference": "warn" },
  },
]
```

See `test/integration/build-tooling/eslint-plugin-usage/` and
[ADR 0038](specs/decisions/0038-eslint-plugin-single-rule.md).

The plugin also ships `no-node-fs`, the filesystem analogue of `env-cap`'s rule of the same name: it flags any `import`, `require`, or dynamic `import()` of `node:fs` so a module accepts a filesystem capability from its caller instead of acquiring one implicitly — the discipline `data-cap`'s own `./build` surface follows. See [ADR 0058](specs/decisions/0058-library-surfaces-do-not-acquire-node-fs.md).

## GitHub Action

The first-party GitHub Action runs `data-cap --json` and turns the result
into pull request annotations and a summary comment — including a rendered
Data Flow Diagram when `--flow` is requested (GitHub renders fenced
` ```mermaid ` blocks natively, so the diagram appears directly in the job
summary and PR comment, no image generation involved).

Example:

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

      - uses: maverickcer/data-cap@v1
        with:
          args: "--docs docs/DATA.md --ownership docs/OWNERSHIP.md --flow docs/flow --strict-flow"
```

| Input               | Default               | Purpose                                                                                                 |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `args`              | _(required)_          | Arguments passed to `data-cap --json`, such as `--docs`, `--ownership`, `--flow`, and `--strict*` flags |
| `working-directory` | `.`                   | Directory where `data-cap` executes                                                                     |
| `version`           | _(latest)_            | Version to execute through `npx` when `data-cap` is not installed locally                               |
| `comment`           | `true`                | Creates or updates a sticky pull request summary comment                                                |
| `annotations`       | `true`                | Emits GitHub workflow annotations for detected findings                                                 |
| `report-key`        | _(working-directory)_ | Identifies this report when multiple workflows run against the same pull request                        |

The Action does not create its own policy layer. Pass/fail behavior always
follows the CLI exit code and configured flags such as `--strict`,
`--strict-docs`, `--strict-ownership`, and `--strict-flow`.

### Monorepos

For monorepos running multiple `data-cap` checks in parallel, provide a
unique `report-key` for each invocation. This prevents separate jobs from
overwriting each other's pull request comments.

## Architecture

See [`specs/architecture.md`](specs/architecture.md) for the complete
structural specification: what each of the six entry points
(`core`/`runtime`/`helpers`/`build`/`evidence`/`eslint-plugin`) owns, the enforced
dependency direction between them, and every cross-cutting guarantee
(tree-shaking, gzip budgets, the dual-package-hazard risk class,
cross-runtime conformance) checked in CI.

The 55 Architecture Decision Records in
[`specs/decisions/`](specs/decisions/) document the reasoning — including
rejected alternatives — behind every significant design choice, and
[`specs/decisions/0047-negative-guarantees-checklist.md`](specs/decisions/0047-negative-guarantees-checklist.md)
consolidates every hard "never" invariant this design makes into one
traceable list. The [docs site's architecture section](https://maverickcer.github.io/data-cap/#architecture)
covers the same model in a more visual, narrative form for a first read;
this Guide and `specs/` stay the precise, versioned reference.

## Migration

`data-cap` supports incremental adoption — nothing requires replacing your
fetching library, state manager, or transport in one pass. See
[`specs/migrations/`](specs/migrations/) for guided paths:

- [From manual fetch-and-state](specs/migrations/from-manual-fetch-state.md)
- [From a global store](specs/migrations/from-a-global-store.md) (Redux, Zustand, ...)
- [From TanStack Query alone](specs/migrations/from-tanstack-query-alone.md)

## Security model

`data-cap` defines data contracts; it does not automatically make an
application secure. See [`SECURITY.md`](SECURITY.md) for the full policy,
including the dual-package-hazard risk class
([ADR 0041](specs/decisions/0041-dual-package-hazard-checked-documented.md))
and the `Object.freeze`/`Map`/`Set` mutation caveat
([ADR 0044](specs/decisions/0044-snapshots-deep-frozen-amortized.md)).
Capabilities do not self-redact `fields`/`info` — this is ordinary
application data, not secrets by default
([ADR 0006](specs/decisions/0006-no-self-redaction.md)); an application
storing genuinely sensitive data in a field is responsible for its own
redaction at the point it logs.

## Troubleshooting

### Error classes

Every thrown error extends `DataCapError` (`data-cap`) and
carries a stable, non-`instanceof`-dependent `code` — safe to switch on
across bundling/module-federation boundaries where `instanceof` can fail.

| Error                                                         | Thrown by                        | Common cause                                                           | Fix                                                                   |
| ------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `InvalidFieldDefaultError` (`DATA_CAP_INVALID_FIELD_DEFAULT`) | `buildData()` / `documentData()` | A declared field default is a function, or contains a cyclic reference | Declare a plain, non-function, non-cyclic default value for the field |

This table grows as more of the build tooling (report generators, CLI) lands
— see [`specs/decisions/`](specs/decisions/) for the ADR behind each error
class as it's added.

### "Why doesn't reading a field throw until data is ready?"

That behavior is intentional
([ADR 0004](specs/decisions/0004-fields-always-synchronously-readable.md)).
`data-cap` does not model ordinary field access as an initialization gate
— every field has a real, declared default from the moment
`buildData()`/`createData()` returns. Build "is this ready yet" logic from
`info.<field>.status` instead.

### "Does `data-cap` ship a built-in getter/mutator execution loop?"

Optionally, yes — `createData` (`data-cap/runtime`,
Experimental tier) owns dedup, per-operation status, optimistic mutation
lifecycle, and concurrent-getter execution, composed entirely from the
Stable primitives (`createDataStore`, `coordinator.dedupe`/
`acquireSubscription`). Different applications reasonably want different
tradeoffs for how a getter/mutator actually runs (retry policy, caching,
transport), so the primitives themselves stay directly usable too — a full
worked pattern lives in `test/integration/runtime-core/basic-standalone/` to copy and adapt when
you want that level of control instead. See
[ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md).

### "Why no `./tanstack` or `./socket-io` package?"

See [ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md)
— test/integration/ contains full, tested reference patterns instead.

### "My mutation's optimistic value doesn't automatically roll back on failure."

That's intentional — see
[ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md).
Removing the pending transition (`removePendingTransition`) is the entire
mechanism; the visible value reverts automatically because `project()` no
longer folds a transition that no longer exists. `createData`'s own
mutators follow this exactly.

### "Two capabilities aren't sharing a subscription/dedup I expected them to share."

Sharing is scoped to function _identity_, not behavioral equality — an
inline arrow function is a fresh identity every time it's created. Run
`eslint-plugin`'s `stable-operation-reference` rule against your code, or
see [ADR 0026](specs/decisions/0026-subscription-transport-sharing-independent.md)/[ADR 0028](specs/decisions/0028-coordinator-dedup-key-identity-plus-params.md).
For `createData`, this means the schema-authored `execute`/`subscribe`
reference itself needs to be stable (module-level, not recreated inside a
factory/component) — `createData` already builds its own stable dispatch
closure per operation internally, but that doesn't help if the schema
object itself is rebuilt from scratch on every call.

## Performance characteristics

`fields`/`info` updates use structural sharing — an update to one leaf
field never re-allocates unrelated branches, and every published snapshot
is deep-frozen at a cost proportional to what actually changed, not to
total state size (see
[ADR 0044](specs/decisions/0044-snapshots-deep-frozen-amortized.md)).
Every consumer-facing entry point carries a hard gzip budget, enforced in
CI (`scripts/check-size.mjs`) — see [`PERFORMANCE.md`](PERFORMANCE.md) for
current numbers and methodology. `benchmarks/performance-runtime` and
`benchmarks/performance-buildtime` (run via `npm run benchmark`, and on
every PR via `.github/workflows/benchmarks.yml`) produce highlighting-only
micro-benchmark numbers — never a merge gate.

| Operation                                     | Cost                                                       | Contrast with a naive full-state-replace pattern                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildData()` init                            | O(fields)                                                  | Same order — both must walk the declared shape once                                                                                                                  |
| `getSnapshot().fields.<path>` read            | O(1)                                                       | Same — a plain property read either way                                                                                                                              |
| `commitAuthoritative`/optimistic patch commit | O(changed leaves + ancestor path), not O(total state size) | A naive `{ ...prev, ...patch }` spread at the root re-allocates every sibling branch too, and repeated shallow spreads at each nesting level are O(depth × siblings) |
| `identity.reconcileArrayInfo`                 | O(items) per call, one pass                                | A full-rebuild pattern is also O(items), but discards every unchanged item's object identity — this preserves reference equality for untouched items                 |
| `coordinator.dedupe` lookup                   | O(1) amortized (canonicalized-key map lookup)              | A naive in-flight-request check via array `.find()`/manual comparison is O(in-flight calls)                                                                          |

See [ADR 0044](specs/decisions/0044-snapshots-deep-frozen-amortized.md) for
the structural-sharing mechanism these figures describe, and
[`PERFORMANCE.md`](PERFORMANCE.md) for measured wall-clock numbers (these
are asymptotic complexity, not benchmark results).

## Documentation index

| Doc                                                                                       | For                                                                                    |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| This Guide + the [docs site](https://maverickcer.github.io/data-cap/)                     | Using `data-cap` in an application                                                     |
| [API reference](https://maverickcer.github.io/data-cap/api/)                              | Every exported symbol, generated from the types                                        |
| [`specs/architecture.md`](specs/architecture.md) + [`specs/decisions/`](specs/decisions/) | Why the package is shaped the way it is (ADRs)                                         |
| [`specs/migrations/`](specs/migrations/)                                                  | Adopting `data-cap` from Apollo / TanStack Query / a global store / manual fetch state |
| [`ADOPTION.md`](ADOPTION.md)                                                              | Decision-maker summary: security, size, LTS                                            |
| [`PERFORMANCE.md`](PERFORMANCE.md)                                                        | Bundle-size budgets, what's benchmarked and why                                        |
| [`SECURITY.md`](SECURITY.md)                                                              | Full threat model, dual-package hazard, supply-chain posture                           |
| [`VERSIONING.md`](VERSIONING.md)                                                          | What semver covers; Stable / Experimental / Private tiers                              |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                                                      | Making a change                                                                        |
| [`CODE_REVIEW.md`](CODE_REVIEW.md)                                                        | What a reviewer checks before merging                                                  |
| [`RELEASING.md`](RELEASING.md)                                                            | Maintainer release process                                                             |
| [`SUPPORT.md`](SUPPORT.md)                                                                | Where to ask questions and file bugs                                                   |
