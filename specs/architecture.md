# Architecture

This is the canonical current-state description of how `data-cap` is built and what guarantees its
architecture provides. [`decisions/`](decisions/) holds the reasoning trail (the ADRs). This document
is the destination those decisions arrived at, not the argument for them. For the product overview and
integration guidance, see [README.md](../README.md) and [GUIDE.md](../GUIDE.md).

**Status**: every entry point in `package.json` `exports` is implemented, tested, and shipped (listed in
[The entry points](#the-entry-points)).

- [Purpose](#purpose)
- [Core invariants](#core-invariants)
- [The entry points](#the-entry-points)
- [`core/`: the executable, analyzable contract](#core-the-executable-analyzable-contract)
- [`fields` and `info`: always present, always atomic](#fields-and-info-always-present-always-atomic)
- [`runtime/`: the optional standalone runtime](#runtime-the-optional-standalone-runtime)
- [`helpers/`: optional convenience utilities](#helpers-optional-convenience-utilities)
- [`build/`: Node-only, static-analysis-only build tooling](#build-node-only-static-analysis-only-build-tooling)
- [`eslint-plugin/`: two rules](#eslint-plugin-two-rules)
- [Cross-cutting guarantees, checked in CI](#cross-cutting-guarantees-checked-in-ci)
- [Architectural decisions](#architectural-decisions)

## Purpose

> `data-cap` defines executable, analyzable data contracts. They explicitly
> describe application data and the operations capable of acquiring,
> mutating, or continuously observing that data. They remain independent
> of databases, transports, frameworks, and state-management libraries.

`data-cap` does not fetch, store, or transport data itself. A capability declares the fields it owns
(`buildData`/`createData`). It can also declare documentation metadata describing them
(`documentData`). The runtime validates and commits state transitions against that declaration.
Separately, at build time, static analysis discovers every declared capability across a project. It
produces manifests, documentation, ownership reports, and data-flow evidence.

```mermaid
flowchart TB
    DS["DataState"]
    F["fields<br/>application data — exact user shape<br/>ordinary JS values, arrays remain arrays"]
    I["info<br/>execution metadata — mirrored structure<br/>sparse, arrays → identity-keyed maps"]
    C["one atomic snapshot per commit"]
    N["one subscriber notification (only if changed)"]

    DS --> F
    DS --> I
    F --> C
    I --> C
    C --> N
```

## Core invariants

These are the guarantees the rest of the design exists to uphold. Each links to the section that
describes its mechanics.

### `fields` and `info` are always committed as one atomic snapshot

No code path may update `fields`/`info` independently or in separate ticks. A consumer must never
observe `{newFields, oldInfo}` or `{oldFields, newInfo}`. See
[`fields` and `info`](#fields-and-info-always-present-always-atomic) and
[ADR 0008](decisions/0008-fields-info-atomic-commit.md).

### `DataInfo` is mandatory, never optional

Every `DataState` is `{ fields, info }`, both always present and populated together. The
performance mechanism is structural sparsity, never removability. See
[`fields` and `info`](#fields-and-info-always-present-always-atomic) and
[ADR 0007](decisions/0007-datainfo-mandatory-not-optional.md).

### The build tool never imports, requires, or evaluates a discovered file

Discovery and linking read a file's AST via the TypeScript Compiler API only. A capability file is
never imported, `require()`d, or `eval()`d. This preserves the safety boundary required for CI
environments and large monorepos. See
[`build/`](#build-node-only-static-analysis-only-build-tooling) and
[ADR 0002](decisions/0002-build-tooling-static-analysis-only.md).

### `./build` does not acquire filesystem access implicitly

`./build` never imports `node:fs` itself: every public options object requires a caller-supplied
`BuildFileSystem` capability. The `data-cap` CLI (`src/cli/`) is the executable boundary that
constructs the real `node:fs/promises` adapter and hands it in. A consumer running the generators
from their own Node script imports that same adapter from `data-cap/node`. This is the same
discipline `repo-contract`'s ADR-0011 established for `spawn`/`env`, and it mirrors env-cap's own
ADR 0040. See [ADR 0058](decisions/0058-library-surfaces-do-not-acquire-node-fs.md).

### No automatic rollback or conflict resolution

An optimistic mutation's pending transition is either confirmed (`commitAuthoritative`) or removed
(`removePendingTransition`). There is no invented rollback mechanism or conflict-resolution policy
beyond that. See [ADR 0023](decisions/0023-no-automatic-rollback-or-conflict-resolution.md).

### Dedup and subscription sharing are scoped to function identity, not behavioral equality

`coordinator.dedupe`/`acquireSubscription` share work across calls with the same function identity
and canonically-equal params. An inline arrow function is a fresh identity every time, and never
shares. See [`runtime/`](#runtime-the-optional-standalone-runtime) and
[ADR 0026](decisions/0026-subscription-transport-sharing-independent.md)–[ADR 0028](decisions/0028-coordinator-dedup-key-identity-plus-params.md).

### Capabilities do not self-redact `fields`/`info`

Unlike env-cap's runtime contracts, `data-cap` treats `fields`/`info` as ordinary application data,
not secrets by default. An application storing sensitive data in a field is responsible for its own
redaction at the point it logs. See [SECURITY.md](../SECURITY.md) and
[ADR 0006](decisions/0006-no-self-redaction.md).

## The entry points

```text
src/
├── core/           data-cap                 (isomorphic, zero deps)
├── runtime/        data-cap/runtime          (optional, standalone state)
│                   data-cap/runtime/cache     (optional, separately tree-shaken)
│                   data-cap/runtime/retry     (optional, separately tree-shaken)
├── helpers/        data-cap/helpers          (optional utilities)
├── build/          data-cap/build            (Node-only build tooling, never imports node:fs)
├── evidence/       data-cap/evidence         (Evidence Model projections, views and standards adapters incl. CycloneDX)
├── flow/           (internal)                 (pure flow, policy, observation, claims models and queries; no Node, no compiler)
├── observe/        data-cap/observe          (runtime observation recorder; names only, caller-supplied clock)
└── eslint-plugin/  data-cap/eslint-plugin    (lint rules)
```

`node:fs` is acquired in two places only (see
[ADR 0058](decisions/0058-library-surfaces-do-not-acquire-node-fs.md)):

- `src/cli/`: the `data-cap` bin, not a `package.json#exports` subpath;
- `src/node/`: the `data-cap/node` executable-context entry.

Convention and the tree-shaking/gzip-budget/dual-package-hazard test suite enforce the dependency
direction below (`test/*/tree-shaking.test.ts`, `ci/size-budgets.mjs`,
`test/runtime/dual-package-hazard.test.ts`):

```mermaid
flowchart LR
    subgraph ext["external"]
        fs["node:fs/promises (cli/, node/ only)"]
        ts["typescript compiler API"]
        tsutils["@typescript-eslint/utils (eslint-utils subpath only)"]
    end

    core["core<br/>(itself only — no external runtime deps;<br/>never imports runtime/build/helpers/eslint-plugin,<br/>React, TanStack Query, Socket.IO, or a DB/ORM)"]
    runtime["runtime"]
    build["build<br/>(never imports node:fs — ADR 0058)"]
    helpers["helpers<br/>(type + real value imports —<br/>identity.ts/canonicalize.ts re-export<br/>core's own implementations directly)"]
    eslint["eslint-plugin<br/>(owns its own copies of shared<br/>AST-matching utilities)"]
    clibin["cli/ + node/<br/>(the fs capability boundary)"]

    runtime --> core
    build --> core
    build -.->|"FIELD_MARKER value import<br/>for marker recognition"| core
    build --> ts
    helpers --> core
    eslint --> tsutils
    clibin --> fs
    clibin -->|"supplies BuildFileSystem"| build
```

`eslint-plugin` imports nothing from this package at all. The missing arrow from it to `core` above
is the point, not an omission. It never imports `eslint`'s own main entry either. That entry would
pull in a runtime `require("eslint")` that breaks once bundled into dependency-free ESM output.

No first-party integration/adapter packages (TanStack Query, Socket.IO, a particular database
driver, ...) ship from this repository; see
[ADR 0037](decisions/0037-no-first-party-integration-packages.md). Integration patterns are
demonstrated end-to-end in
[`test/integration/`](https://github.com/MaverickCER/data-cap/tree/main/test/integration) instead
(`adoption-patterns/tanstack-query-integration/`, `subscriptions/socket-io-subscription/`).
Application authors copy and adapt that code directly. They do not depend on an opinionated adapter
layer that this package would otherwise have to keep compatible with two moving external targets.

## `core/`: the executable, analyzable contract

`core/` is pure, synchronous and deterministic. Nothing here owns a promise, a timer, a listener, or
mutable module-level state (that's `runtime`'s job).

- **`fields.ts`**: `fields.nullable(x)`/`fields.optional(x)`. These are thin markers recognized only
  at schema-authoring time. They resolve to `null`/`undefined` defaults respectively, regardless of
  `x` (which only drives type inference). They never leak into the resolved `fields` object.
- **`types.ts`**: a pure type-only module.
  - It declares `FieldsShape`, `InferFields`, `InferFieldValue`, `FieldOwnership`,
    `DataState`/`DataInfo`/`FieldInfo`/`DataStatus`/`DataError`/`SubscriptionInfo`/`DataStore`,
    `BuildDataConfig`, `PendingTransition` and `DeepPartial`.
  - It uses the same generic-bound variance workaround env-cap's `EnvSchema`/`InferEnvValue` use.
    So `S extends FieldsShape` infers precise per-key literal types from the object literal
    actually passed to `buildData`.
  - It also declares the pure operation vocabulary the runtime's `createData` executes:
    `GetterDefinition`/`MutatorDefinition`/`SubscriptionDefinition`, `DataSchema`, and `OwnedPatch`.
    `OwnedPatch` is a mapped type narrowing `DeepPartial<T>` to exactly what a declared `writes`
    ownership permits.
  - None of it implies runtime behavior on its own. Only `runtime/capability.ts` executes anything
    (see [ADR 0048](decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)).
- **`schema.ts`**: `resolveFieldDefaults` and `checkValueAgainstSchema`. The first maps schema to
  resolved defaults, cycle-detected via a "currently visiting" stack. The second does per-field
  structural shape checking, used by `ownership.ts`'s reset-to-default path.
- **`patch.ts`**: `patchInto`/`commitState`/`project`/`deepFreezeNewNodes`. This is the single
  sanctioned way to transition a `DataState`. See "`fields` and `info`" below.
- **`ownership.ts`**: `resolveOperationPatch` walks a processor's returned patch. It enforces the
  declared field-ownership boundary (`Object.hasOwn` only, never truthiness/`in`). It resets an
  individually-invalid leaf to its own schema default without disturbing valid siblings.
- **`identity.ts`**: `computeItemIdentity`/`reconcileArrayInfo`, for array identity computation and
  reference-stable `DataInfo` reconciliation. Internal: re-exported publicly, unchanged, from
  `helpers/identity.ts`.
- **`canonicalize.ts`**: `canonicalize`, a deterministic, self-delimiting, type-tagged string
  encoding. Array identity keying and the coordinator's dedup key share it. Internal: re-exported
  publicly, unchanged, from `helpers/canonicalize.ts`.
- **`build.ts`**: `buildData(config)`.
  - It builds and deep-freezes the initial `DataState` (`{fields, info}`, both present from the
    start) from declared defaults.
  - It throws synchronously at call time for structural schema violations (a function-valued
    default, a cyclic default).
  - It never throws on ordinary field access: `data.fields.*` is always synchronously readable, a
    deliberate divergence from env-cap's `createEnv`.
  - It was renamed from `createData` (ADR 0048) and is behaviorally unchanged. The name now belongs
    to the runtime's batteries-included entry point instead (see `runtime/capability.ts` below).
- **`document.ts`**: `documentData(config, docs)`. It is inert (`void config;
void docs`) and is a pure AST marker for `build` tooling to discover. It structurally mirrors
  `DataSchema`'s own shape (fields plus optional getters/mutators/subscriptions) rather than a loose
  bag. That holds whether `config` is ultimately passed to `buildData` or the runtime's `createData`.
- **`errors.ts`**: a throw-based error hierarchy with a stable `code` discriminant (`DataCapError`,
  `InvalidFieldDefaultError`). It never embeds raw field/processed values in a message.

## `fields` and `info`: always present, always atomic

Two invariants govern every `DataState`:

1. **`DataInfo` is mandatory, never optional or separately tree-shakeable**
   ([ADR 0007](decisions/0007-datainfo-mandatory-not-optional.md)).
   `DataState<TFields> = { readonly fields: TFields; readonly info:
DataInfo<TFields> }`: both members are always present and always populated together. The
   performance mechanism is structural **sparsity** (no eagerly-allocated metadata for untouched
   fields). It is also **reference-stable reconciliation**
   ([ADR 0010](decisions/0010-datainfo-array-reconciliation-identity-diffed.md)). It is never
   removability.
2. **`fields` and `info` are always committed and published as one atomic
   snapshot** ([ADR 0008](decisions/0008-fields-info-atomic-commit.md)). No
   code path may update them independently or in separate ticks. A consumer
   must never observe `{newFields, oldInfo}` or `{oldFields, newInfo}`.

`fields` remain ordinary arrays; only `info` uses identity-keyed objects for array items
([ADR 0009](decisions/0009-fields-arrays-info-identity-keyed.md)). For example,
`data.fields.comments` is `Comment[]`, and `data.info.comments` is keyed by each item's declared
`identity`. `DataInfo` array reconciliation is identity-diffed, not a full teardown-and-rebuild. An
identity untouched by a given operation retains its previous `FieldInfo` object reference across a
`fields`-array replacement.

## `runtime/`: the optional standalone runtime

The runtime is stateful, timer/listener-owning and optional. There are two ways to use it, and
neither is "the" way (see
[ADR 0048](decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)):

- **Hand-wired**: `createDataStore` + `coordinator` directly, with application code wiring
  `execute`/`processor` functions itself. See
  `test/integration/runtime-core/basic-standalone/` for the reference pattern.
- **Batteries-included**: `createData`, below, composes the same primitives for you.

No first-party TanStack Query/Socket.IO/React adapter ships either way; see
[ADR 0037](decisions/0037-no-first-party-integration-packages.md).

- **`store.ts`**: `createDataStore(initialState)`.
  - It owns `authoritativeState` and `pendingTransitions`.
  - It exposes `getSnapshot()`/`subscribe()`, a `useSyncExternalStore`-compatible `DataStore`
    contract with no React import.
  - The visible value is always `project(authoritativeState, pendingTransitions)`, recomputed fresh
    on every read, never cached.
  - `commitAuthoritative`/`addPendingTransition`/`removePendingTransition` are the full mutation
    surface.
- **`coordinator.ts`**: `createCoordinator()`/`defaultCoordinator`.
  - `dedupe()` shares one in-flight call across concurrent calls with the same function identity and
    canonically-equal params.
  - `acquireSubscription()` ref-counts one shared transport per `subscribe` function identity.
  - `defaultCoordinator` is a module-level singleton. `createCoordinator()` gives an explicit,
    isolated domain (a multi-tenant server process, test isolation).
- **`abort.ts`**: `composeSignals`/`rejectOnAbort`, per-caller `AbortSignal` composition. One
  caller's own abort never cancels shared underlying work another caller still depends on.
- **`cache.ts`** _(own entry point: `./runtime/cache`)_: `createDataCache(options)`. This is an
  optional, bounded, LRU-evicting cache of complete `DataState` snapshots, keyed by an opaque
  caller-computed string.
- **`retry.ts`** _(own entry point: `./runtime/retry`)_: `withRetry(fn, signal, options)`/
  `isStillDefault`. This is optional, opt-in retry with abort-awareness and a documented "only
  retry a still-default field" policy.
- **`capability.ts`**: `createData(schema, options?)`, Experimental tier.
  - It composes `buildData({fields: schema.fields})` + `createDataStore(...)` + a `Coordinator`
    (default `defaultCoordinator`, overridable). It adds no new core/runtime primitive behavior;
    it is purely an orchestration layer over the ones above.
  - Per declared getter/mutator/subscription, it builds one stable dispatch closure at
    `createData()` call time (never per invocation). It passes that closure to
    `coordinator.dedupe`/`acquireSubscription`.
  - So dedup/subscription-sharing identity is inherently (this instance × this operation ×
    canonicalized params). `coordinator.ts`'s own signature does not change at all.
  - It adds a new, additive reactive `operations` namespace to its own richer `getSnapshot()`,
    keyed by operation name then canonicalized params, LRU-bounded.
  - That namespace is _not_ a duplicate of `fields`/`info`. It answers a question `info.<field>`
    structurally cannot: whether two differently-parameterized calls to the same operation are
    concurrently in flight.
  - [ADR 0048](decisions/0048-builddata-createdata-split-and-optional-operations-layer.md) holds
    the full behavioral contract: Promise rejection semantics, getter-vs-mutator stale-discard
    asymmetry, and `optimistic()` receiving authoritative-not-projected state.
  - ADR 0048 also records the two real bugs building this surfaced: cross-bundle `FIELD_MARKER`
    identity, and a capability's own subscription release never reaching its own
    `onStatusChange` callback.

## `helpers/`: optional convenience utilities

`helpers/` takes type-only _and_ real value imports from `core`. Identity/canonicalize are literal
re-exports of core's own implementations, never reimplementations. The module is entirely optional:
neither `buildData` nor the runtime (including `createData`) has any knowledge of it, and both behave
identically without it. One `./helpers` entry ships four separately tree-shakeable namespaces:

- **`processors`**: coercion helpers (`toNumber`, `toBoolean`, `toDate`, ...) for use inside a
  hand-written `processor(raw, ctx)` function. They never throw, because a processor's returned
  patch already runs through ownership/shape checking downstream.
- **`identity`**: `computeItemIdentity`/`reconcileArrayInfo`, the exact primitives the standalone
  runtime would use internally. They are exposed for application code building its own array-info
  wiring.
- **`canonicalize`**: the same canonicalization primitive `identity` and the coordinator's dedup
  key both use internally.
- **`shape`**: structural (never business-rule) type guards (`isPlainObject`, `isDate`, `isURL`,
  `isRegExp`, `isNullish`). This is deliberately not a validator system: data-cap has no per-field
  validator vocabulary (see [ADR 0039](decisions/0039-helpers-subpath-scope.md)).

## `build/`: Node-only, static-analysis-only build tooling

`build/` never imports, `require()`s, or `eval()`s a discovered file
([ADR 0002](decisions/0002-build-tooling-static-analysis-only.md)). Every discovery/linking
operation reads a file's AST via the TypeScript Compiler API and nothing else. It never imports
`node:fs` either: every public options object requires a caller-supplied `fs: BuildFileSystem`
([ADR 0058](decisions/0058-library-surfaces-do-not-acquire-node-fs.md)). The `data-cap` CLI supplies
the real `node:fs/promises` adapter, and a programmatic consumer imports the same adapter from
`data-cap/node`.

- **`discover.ts`**: `discoverCapabilityFiles(options)` recursively finds `.ts`/`.tsx` files under a
  root. It prunes `node_modules`/`.git` (and any caller-supplied exclusions) during the walk itself.
- **`parse.ts`**: `parseCapabilityFile(filePath, sourceText)` finds
  `buildData()`/`createData()`/`documentData()` calls in one file's top-level statements. It matches
  by call/property name alone (not import provenance). For a `createData()` call specifically, it
  also extracts its static getter/mutator/subscription **names** and literal `writes` shapes. It
  never extracts the operations' own function bodies (ADR 0002).
- **`literal-eval.ts`**: `evaluateLiteral`/`getStaticPropertyName`, a narrow, explicitly
  allow-listed grammar of statically-safe expression forms:
  - object/array/primitive literals;
  - `Date`/`URL`/`RegExp`/`Map`/`Set` constructor calls with literal arguments;
  - `fields.nullable`/`fields.optional` marker recognition.
- **`link.ts`**: `linkCapabilityFiles(files, options)`.
  - It resolves each `buildData()`/`createData()` call's `fields` reference to a real,
    literal-evaluated shape.
  - It follows relative imports, tsconfig path aliases, and allow-listed cross-package imports
    (`resolution/`, below).
  - It correlates `documentData()` calls with the capability they document, surfacing every
    mismatch category explicitly
    ([ADR 0040](decisions/0040-build-tooling-detects-correlation-mismatches.md)).
- **`resolution/`**: `resolve-import.ts`/`resolve-tsconfig-paths.ts`/
  `resolve-package-schema.ts`/`resolve-within-root.ts`, for specifier-to-file resolution (relative,
  tsconfig-alias, cross-package). It was copied from env-cap's own equivalent folder as a one-time
  seed; the two now evolve independently
  ([ADR 0043](decisions/0043-env-cap-resolver-relocated-and-duplicated.md)).
- **`inventory.ts`**: `buildInventory(linkResult)`, a pure function turning a `LinkResult` into the
  one authoritative `CapabilityInventory`.
  - Every report generator reads from it: `CapabilityNode`/`FieldNode`/`OperationNode`.
  - A field's `owner` is already resolved (its own, else the capability's).
  - An operation's statically-extracted `writes` shape is already resolved down to the top-level
    field paths it covers.
  - It touches no filesystem or AST itself
    ([ADR 0049](decisions/0049-capability-metadata-vocabulary.md)).
- **`findings.ts`** / **`dependency-types.ts`**: the shared `ReportFinding`/`ReportSeverity` and
  `DependencyEdge`/`DependencyRelationship` vocabulary. Every static rule and usage-scan pass emits
  into it, so "what counts as a conflict" is defined once. These are pure type-only modules; see
  "Report-generation model" below.

### Report-generation model

```mermaid
flowchart TB
    Source["Capability source files"]
    Discover["discoverCapabilityFiles"]
    Parse["parseCapabilityFile"]
    Link["linkCapabilityFiles"]
    Inventory["CapabilityInventory\n(inventory.ts)"]
    Rules["Static rules\n(exclusive-group, structural-duplication,\nownership/sensitivity checks)"]
    Scan["Usage scan\n(DependencyEdges -- proven)"]
    Findings["ReportFinding[]\n(findings.ts)"]
    Projections["Projections: manifest, docs catalog,\nownership report, data-flow diagram"]

    Source --> Discover --> Parse --> Link --> Inventory
    Inventory --> Rules --> Findings
    Inventory --> Scan --> Findings
    Inventory --> Projections
    Findings --> Projections
```

Every projection reads the same `CapabilityInventory` and the same `ReportFinding[]`. The
projections are a generated manifest, the docs catalog, an ownership report and the data-flow
diagram. No generator re-derives conflict or flow logic independently.

`Rules` and `Scan` are deliberately separate passes. `Rules` needs no file-tree scan. `Scan` is the
more expensive, optional AST walk over the whole project. A generator that only needs
ownership/sensitivity data never pays for the usage scan it doesn't need.

[`generated-artifacts.md`](generated-artifacts.md) lists exactly which artifacts this pipeline
produces today and which industry model each aligns with. It also lists which related artifacts are
explicitly deferred rather than silently unsupported: threat modeling inputs, a privacy data map,
OSCAL/PCI/SOC 2 evidence.

## `eslint-plugin/`: two rules

The plugin owns its own copies of shared AST-matching utilities rather than importing from
`core`/`build`. It imports only `@typescript-eslint/utils`'s narrow `eslint-utils` subpath and
`@typescript-eslint/types`/`@typescript-eslint/
scope-manager`. It never imports `eslint`'s own main entry, which does a runtime
`require("eslint")` that breaks once bundled into dependency-free ESM output.

- **`stable-operation-reference.ts`** flags a non-stable function assigned to a `createData()`
  call's `execute`/`processor`/`subscribe`/`optimistic` key.
  - Non-stable means an inline function literal, or a reference recreated on every call (found via
    real scope analysis, not only syntax).
  - This is the one mistake class specific enough to this package's identity-based sharing
    architecture to warrant a dedicated rule
    ([ADR 0038](decisions/0038-eslint-plugin-single-rule.md)).
  - It needed no code change for `createData` to gain this shape (ADR 0048). It already matched the
    literal name `"createData"`, dormant scaffolding for exactly this feature.
- **`no-node-fs.ts`** is the filesystem analogue of env-cap's rule of the same name. It flags any
  `import`/`require`/dynamic `import()` of `node:fs` outside an allow-listed executable boundary.
  A consuming project can then enforce the same "accept a filesystem capability, don't acquire one
  implicitly" discipline `./build` itself follows
  ([ADR 0058](decisions/0058-library-surfaces-do-not-acquire-node-fs.md)).

## Cross-cutting guarantees, checked in CI

- **Tree-shaking** (`test/helpers/tree-shaking.test.ts`,
  `test/runtime/tree-shaking.test.ts`): every optional namespace/entry point
  is provably absent from a downstream bundle that doesn't import it.
- **Gzip budgets** (`ci/size-budgets.mjs`, run in CI's `verify` job):
  every consumer-facing entry point (`core`, `runtime`, `runtime/cache`,
  `runtime/retry`, `helpers`) carries a hard size ceiling.
- **Dual-package hazard** (`test/runtime/dual-package-hazard.test.ts`): `defaultCoordinator`'s
  module-singleton design has a known, unavoidable consequence under mixed ESM/CJS resolution. It is
  checked and pinned, not only assumed
  ([ADR 0041](decisions/0041-dual-package-hazard-checked-documented.md)).
- **Cross-runtime conformance** (`test/cross-runtime/{bun,deno}.test.ts`):
  core+runtime's isomorphism claim is verified against real Bun and Deno
  engines, not only Node/vitest.
- **No ambient filesystem access** (the `AmbientCapabilities` check, run in CI's
  `verify`/`precommit` jobs): a real `npm pack` tarball is grepped for `node:fs`. The grep looks for
  `node:fs` reachable outside the CLI/`./node`/`./eslint-plugin` exceptions
  ([ADR 0058](decisions/0058-library-surfaces-do-not-acquire-node-fs.md)).
- **End-to-end examples** (`examples/*`, `test/examples/*.test.ts`): 3 audience-shaped flagship
  npm projects (`application/`, `team-service/`, `enterprise-platform/`). They exercise the
  package's adoption story against the actual built package, each with a committed golden output.
  See [`examples/README.md`](../examples/README.md).
- **Integration fixtures** (`test/integration/**`, `test/integration/*/*.test.ts`): 16 further
  real, independently-installed npm projects, each proving one specific mechanism against the
  actual built package. They were relocated out of `examples/` when it narrowed to the 3 flagships
  above, with zero coverage lost. See
  [`test/integration/README.md`](https://github.com/MaverickCER/data-cap/blob/main/test/integration/README.md).

## Architectural decisions

See [`decisions/`](decisions/) for the full, numbered ADR set (0001–0058).
[`decisions/0047-negative-guarantees-checklist.md`](decisions/0047-negative-guarantees-checklist.md)
is the consolidated list of every hard "never" invariant this design makes, each traced to its
owning test.

The table maps every ADR to the specific boundary above it documents. It is longer than env-cap's
own architecture doc table, because this package has more than double env-cap's ADR count. Start
here rather than skimming all 58 sequentially when you only care about one boundary:

| Boundary                                                                                                                                                                         | ADRs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/` contract shape (`documentData`/`buildData`, field values, warn-vs-throw, redaction)                                                                                      | [0001](decisions/0001-documentdata-mirrors-createdata-shape.md), [0002](decisions/0002-build-tooling-static-analysis-only.md), [0003](decisions/0003-fields-are-actual-application-data.md), [0004](decisions/0004-fields-always-synchronously-readable.md), [0005](decisions/0005-warn-not-throw-runtime-throw-schema-authoring.md), [0006](decisions/0006-no-self-redaction.md), [0042](decisions/0042-no-op-suppression.md), [0048](decisions/0048-builddata-createdata-split-and-optional-operations-layer.md), [0049](decisions/0049-capability-metadata-vocabulary.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `fields`/`info` shape and atomicity                                                                                                                                              | [0007](decisions/0007-datainfo-mandatory-not-optional.md), [0008](decisions/0008-fields-info-atomic-commit.md), [0009](decisions/0009-fields-arrays-info-identity-keyed.md), [0010](decisions/0010-datainfo-array-reconciliation-identity-diffed.md), [0014](decisions/0014-fieldinfo-current-metadata-not-history.md), [0015](decisions/0015-error-latest-only-never-array.md), [0016](decisions/0016-status-state-machine.md), [0017](decisions/0017-fieldinfo-optimistic-flag.md), [0018](decisions/0018-array-identity-config-object.md), [0019](decisions/0019-canonicalization-self-delimiting-encoding.md), [0020](decisions/0020-no-identity-no-per-item-info.md)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Field/operation ownership (`writes`, processor patches)                                                                                                                          | [0011](decisions/0011-getter-mutator-ownership-rules.md), [0012](decisions/0012-invalid-field-resets-to-own-default.md), [0013](decisions/0013-thrown-processor-whole-operation-failure.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `runtime/`: store, optimistic mutations, coordinator, subscriptions                                                                                                              | [0021](decisions/0021-authoritative-pending-project-model.md), [0022](decisions/0022-completing-operation-uses-current-state.md), [0023](decisions/0023-no-automatic-rollback-or-conflict-resolution.md), [0024](decisions/0024-getter-concurrency-stale-response-discard.md), [0025](decisions/0025-mutator-concurrency-completion-order.md), [0026](decisions/0026-subscription-transport-sharing-independent.md), [0027](decisions/0027-default-coordinator-singleton-plus-factory.md), [0028](decisions/0028-coordinator-dedup-key-identity-plus-params.md), [0029](decisions/0029-subscription-disconnect-never-mutates-fields.md), [0030](decisions/0030-recover-resync-runs-once-no-replay-guarantee.md), [0031](decisions/0031-abortsignal-composed-internally.md), [0034](decisions/0034-optional-runtime-features-separate-entries.md), [0035](decisions/0035-cache-persists-complete-datastate-atomically.md), [0036](decisions/0036-retry-opt-in-with-explicit-constraints.md), [0041](decisions/0041-dual-package-hazard-checked-documented.md), [0044](decisions/0044-snapshots-deep-frozen-amortized.md) |
| `helpers/` scope                                                                                                                                                                 | [0039](decisions/0039-helpers-subpath-scope.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `build/`: static analysis, resolution, correlation                                                                                                                               | [0002](decisions/0002-build-tooling-static-analysis-only.md), [0032](decisions/0032-tsconfig-path-alias-resolution-ported.md), [0033](decisions/0033-literal-eval-explicit-constructor-allowlist.md), [0040](decisions/0040-build-tooling-detects-correlation-mismatches.md), [0043](decisions/0043-env-cap-resolver-relocated-and-duplicated.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `build/`: canonical fact models (Capability/Dependency/Ownership/Finding/Change/Runtime Contract/Evidence) and reference projections                                             | [0049](decisions/0049-capability-metadata-vocabulary.md), [0050](decisions/0050-fact-model-architecture.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `build/`, `flow/`, `evidence/`, `observe/`: field-level data flow. Scan reach and its stated limits, epistemic status, observation, standards exports, redundant transformations | [0070](decisions/0070-flow-evidence-is-part-of-the-single-evidence-model.md), [0071](decisions/0071-epistemic-status-on-every-flow-fact.md), [0072](decisions/0072-runtime-observation-is-a-separate-subpath.md), [0073](decisions/0073-flow-views-standards-adapters-and-rules.md), [0074](decisions/0074-flow-scan-non-goals-and-irreducible-limits.md), [0075](decisions/0075-redundant-transformations.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `eslint-plugin/` scope                                                                                                                                                           | [0038](decisions/0038-eslint-plugin-single-rule.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Cross-cutting: integration policy, testing discipline                                                                                                                            | [0037](decisions/0037-no-first-party-integration-packages.md), [0045](decisions/0045-type-level-tests-pair-positive-negative.md), [0046](decisions/0046-property-based-tests-extend-to-patch-ownership.md), [0047](decisions/0047-negative-guarantees-checklist.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Library surfaces (`./build`) never import `node:fs`; a caller supplies a `BuildFileSystem`                                                                                       | [0058](decisions/0058-library-surfaces-do-not-acquire-node-fs.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Some ADRs appear under more than one boundary. For example, 0002 governs both the general
static-analysis-only rule and `build/`'s specific implementation of it. That's intentional: the
table optimizes for "where do I look for context on boundary X," not for a strict partition.
