# AGENTS.md

Guidance for AI coding agents (Codex, Cursor, Copilot, Continue, and others reading this
convention) working in `data-cap`'s own source, or in an application that consumes
`@maverickcer/data-cap`. Claude Code reads the fuller, more detailed version of this same
guidance from [`skills/data-cap/SKILL.md`](skills/data-cap/SKILL.md) — read that file
instead if your tooling supports it; this file is a self-contained distillation for
agents that don't.

## What this package is

`data-cap` gives each capability (a feature folder or an installable package) an
executable, analyzable data contract: the fields it owns, and the getters/mutators/
subscriptions that acquire, mutate, or observe them — independent of databases,
transports, frameworks, and state-management libraries. All six entry points are
implemented: `core` (`.`), `runtime` (`./runtime`, `./runtime/cache`, `./runtime/retry`),
`helpers` (`./helpers`), `build` (`./build`), `evidence` (`./evidence`), and
`eslint-plugin` (`./eslint-plugin`).

The primary way to use a capability is one call:

```ts
import { createData } from "@maverickcer/data-cap/runtime"

const userData = createData({
  fields: { user: { name: "", email: "" } },
  getters: {
    getUser: {
      execute: (params: { id: string }, signal) =>
        fetch(`/api/user/${params.id}`, { signal }).then((r) => r.json()),
      processor: (raw) => ({ user: raw }),
      writes: { user: true },
    },
  },
})

await userData.getUser({ id: "1" })
userData.getSnapshot().fields.user.name
```

`createData` owns dedup, per-operation status, optimistic mutation lifecycle, and
`runGetters` concurrency for you — see ADR 0048 for the full behavioral contract
(getter/mutator rejection semantics, `optimistic()` receiving authoritative-not-projected
state, dedup identity scoping, getter-vs-mutator stale-discard asymmetry). It's
**Experimental tier** (see `VERSIONING.md`) and composed entirely out of the Stable
primitives below — nothing about it changes their own behavior.

For full manual control over execution, retry, and caching policy, the low-level
primitives are still there: `buildData` (fields only, pure/synchronous) +
`createDataStore` (state) + `coordinator.dedupe`/`acquireSubscription` (sharing), wired by
hand. See `test/integration/runtime-core/basic-standalone/` for the canonical hand-wired pattern, and
`examples/application/` for the same kind of scenario through `createData`.

## Non-negotiable invariants

1. **Fields are the actual application data shape.** No `.value` wrappers, no proxies,
   no symbols, no dot-notation string access. `data.fields.user.email` is a plain
   string. Functions are never valid field values.
2. **Fields are always synchronously readable.** `buildData()` (and `createData()`,
   which composes it) returns a state populated with declared defaults immediately —
   there is no throw-until-validated gate (a deliberate divergence from
   `@maverickcer/env-cap`'s `createEnv`).
3. **`DataInfo` is mandatory, never optional or separately tree-shakeable.** Every
   `DataState` has both `fields` and `info`, always committed and published together as
   one atomic snapshot (`core/patch.ts`'s `commitState`) — never `{newFields, oldInfo}`
   or vice versa. `info` is kept small via structural sparsity (no eagerly-allocated
   metadata for untouched fields), not via making the feature removable.
4. **Presence, never truthiness.** `0`/`false`/`""`/`null`/explicit `undefined`/`[]` are
   all real, intentional field values — ownership/presence checks always use
   `Object.hasOwn`, never `in` or a truthiness check.
5. **Getters acquire, mutators perform side effects, subscriptions observe.** These are
   semantically distinct, not naming conventions.
6. **Build tooling is static-analysis-only.** `src/build/` parses discovered files as an
   AST via the TypeScript Compiler API; it never `import()`s, `require()`s, or `eval()`s
   them — including `createData`'s `execute`/`processor`/`subscribe`/`optimistic`
   function bodies, whose contents stay opaque; only operation _names_ and literal
   `writes` shapes are statically extracted. Capability discoverability depends only on
   whether a `buildData(...)`/`createData(...)` call expression is written at
   module-top-level in a file's source — never on whether that code actually runs.
   `data-cap` has no runtime capability registry of any kind (see ADR 0055) — do not
   reintroduce one, and do not assume one exists when reasoning about discovery.
7. **Capabilities do not self-redact.** Unlike `env-cap`'s redacted contracts,
   `data.fields`/`data.info` print normally — this is ordinary application data, not
   secrets.
8. **Sharing (coordinator dedup/subscription reuse) is scoped to function identity,
   never behavioral equality.** An inline arrow function passed as `execute`/`subscribe`
   is a fresh identity every time — the `eslint-plugin`'s `stable-operation-reference`
   rule exists specifically to catch this (it also matches `createData(...)`'s
   `execute`/`processor`/`subscribe`/`optimistic` keys, not just hand-wired code).
9. **No automatic rollback, no invented conflict-resolution policy.** A failed
   optimistic mutation reverts purely because its pending transition was removed
   (`removePendingTransition`) — there is no separate "restore the prior value" code
   path, and no built-in last/first-write-wins or merge policy for concurrent writes.
   `createData`'s own generated mutators follow this exactly — `optimistic()`'s pending
   transition is removed in a `finally`, never rolled back by special-cased logic.
10. **`FIELD_MARKER` (`core/fields.ts`) uses the global symbol registry
    (`Symbol.for`), never a bare `Symbol()`.** `core` and `runtime` are independently
    bundled tsup entries — a bare `Symbol()` would create a different identity in each
    bundle's own inlined copy, silently breaking marker recognition across the
    `createData`/`buildData` boundary. See ADR 0048 for the bug this was.
11. **Static analysis may prove a relationship; it must never infer one from
    insufficient evidence.** `src/build/`'s report-generation layer (`inventory.ts`,
    the usage-scan pass) only ever records a fact it can actually establish from the
    AST — an ambiguous case becomes an `info`/`indeterminate`-flavored
    `ReportFinding`, never a guessed `error`. See `specs/decisions/0049-capability-metadata-vocabulary.md`.
12. **A report must never present a declared fact as a proven one.** Metadata the
    author wrote (`source`, `credentials`, `protections`, `retention`, `endpoints`,
    and the lifecycle vocabulary `expiresAt`/`deprecated`/`removeBy`/`renamedFrom`)
    is never statically verified against runtime behavior; a fact derived by AST
    analysis (`writes`, a `DependencyEdge`) is. Every rendered fact in a generated
    report is labeled "declared" or "proven," never blended, never implied to be
    verified. Nothing expires, deprecates, or is removed at runtime -- the
    Lifecycle Model only restates what an author wrote, plus arithmetic on a
    declared date.
13. **Every path a canonical model publishes is root-relative.** Absolute paths
    originate once (`discover.ts`, for real filesystem work) and are converted at
    the single model-construction boundary (`buildInventory`, and
    `scanDependencies`'s own return) via `display-path.ts`'s `displayPath`. A
    generated artifact must never contain a machine-specific absolute path;
    anything needing a real path back re-derives it with `absolutePathFrom(root,
file)`.

## Avoid

- Introducing a `.value` wrapper, a proxy, or a dot-notation string path for field
  access — the field system's whole point is that `data.fields.*` is the real,
  ordinary application value.
- Making `DataInfo` optional, lazily-constructed-only-on-demand, or a separate
  tree-shakeable entry point — it is a mandatory half of `DataState`.
- Committing `fields` and `info` through two separate calls/ticks — always go through
  the single atomic commit primitive (`core/patch.ts`'s `commitState`).
- Treating a falsy field value as "absent" anywhere ownership/presence is checked.
- Inventing automatic rollback for a failed optimistic mutation, or a universal
  conflict-resolution policy (first/last-write-wins, merge) — only the operation's own
  processor interprets a result against the latest authoritative state.
- Adding a per-field validator vocabulary — a field's own runtime type (via `typeof`/
  `Array.isArray`/`instanceof`) is its shape descriptor; a processor is the only escape
  hatch for custom logic. `helpers/shape.ts`'s guards are structural only, never
  business-rule validators.
- Shipping a first-party TanStack Query or Socket.IO adapter package, or any React
  package — those patterns live in `examples/` only, by explicit design decision
  (ADR 0037), and `createData`'s own `getSnapshot`/`subscribe` staying
  `useSyncExternalStore`-compatible is enough; no hook ships.
- Putting stateful/async execution logic into `core/` — `buildData`, `documentData`,
  and everything else under `src/core/` must stay synchronous and stateless.
  `createData`'s execution loop lives in `runtime/` for exactly this reason.
- Reimplementing `identity`/`canonicalize` logic in `helpers/` instead of re-exporting
  `core`'s own implementation — `helpers/identity.ts`/`helpers/canonicalize.ts` must stay
  literal re-exports, never parallel copies that could drift.
- Matching a whole operation definition against the full `GetterDefinition<...>`/
  `MutatorDefinition<...>`/`SubscriptionDefinition<...>` generic interface inside
  `runtime/capability.ts`'s own mapped types — `createData`'s generic inference widens
  an individual operation definition while checking it against `DataSchema`'s own
  bound, which defeats a conditional type keyed on the full interface. Extract one
  declared property at a time instead (see `DeclaredParams`/`DeclaredWrites`'s own
  comment).

## Migrating an existing app onto data-cap

If you're an agent asked to introduce `data-cap` into an application that
already fetches/mutates/observes data some other way (manual `useState`/
`useEffect`, a global store, TanStack Query alone), follow
[`specs/migrations/README.md`](specs/migrations/README.md)'s five-step
incremental strategy — pick one piece of data, declare it, wire the
existing fetch/mutate/subscribe logic into it, replace the ad hoc read
sites, repeat. Do not attempt a single big-bang rewrite; nothing about
`data-cap`'s design requires migrating more than one capability at a time,
and a large diff touching many unrelated read sites at once is harder to
review and easier to get subtly wrong (a missed `Object.hasOwn` presence
check, a `writes` shape narrower than what a processor actually returns).

Before making any changes:

1. Read the app's existing data-fetching/state-management code to find
   natural capability boundaries — a boundary is a set of fields plus the
   operations that acquire/mutate/observe them, not necessarily a single
   file or component today.
2. Check whether the target field/operation shape already matches one of
   `specs/migrations/`'s named guides (manual fetch-and-state, a global
   store, TanStack Query alone) — reuse that guide's specific before/after
   pattern rather than inventing a new one.
3. Decide `buildData` + hand-wiring vs. `createData` per capability, based
   on how much control that specific capability's execution needs (see
   "The low-level path" in `README.md`) — this is a per-capability choice,
   not an app-wide one.
4. Prefer small, reviewable PRs — one capability migrated per PR is the
   default; do not bundle an unrelated refactor into the same change.

After migrating a capability: run the checklist in "Before finishing a
change" below, and confirm the capability's prior consumers (components,
server routes) read `fields`/`info` and nothing else changed observably
for them.

## Public API map

| Export                                | Source                 | Environment           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@maverickcer/data-cap`               | `src/core/`            | isomorphic, zero deps | `buildData`, `documentData`, `fields.nullable`/`fields.optional`, `DataState`/`DataInfo`/`FieldInfo` types, error types                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@maverickcer/data-cap/runtime`       | `src/runtime/`         | isomorphic, zero deps | `createData` (Experimental), `createDataStore`, `defaultCoordinator`/`createCoordinator`, `composeSignals`/`rejectOnAbort`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `@maverickcer/data-cap/runtime/cache` | `src/runtime/cache.ts` | isomorphic            | `createDataCache` (optional, separately tree-shaken)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@maverickcer/data-cap/runtime/retry` | `src/runtime/retry.ts` | isomorphic            | `withRetry`, `isStillDefault` (optional, separately tree-shaken)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@maverickcer/data-cap/helpers`       | `src/helpers/`         | isomorphic            | `processors`, `identity`, `canonicalize`, `shape` namespaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@maverickcer/data-cap/build`         | `src/build/`           | Node-only             | `discoverCapabilityFiles`/`parseCapabilityFile`/`linkCapabilityFiles`/`evaluateLiteral` (discovery), `buildInventory` (the `CapabilityInventory` model), the other canonical models (`buildLifecycleModel`/`buildDependencyModel`/`buildOwnershipModel`/`buildFindingModel`/`buildChangeModel`/`buildEvidenceModel`), the evidence cache (`getEvidenceModel`/`computeSourceFingerprint`), the report generators (`generateManifest`/`generateDocumentation`/`generateUsage`/`generateFlow`), and the orchestrator (`generateDataArtifacts`/`checkArtifacts`) |
| `@maverickcer/data-cap/evidence`      | `src/evidence/`        | isomorphic, zero deps | `defineEvidenceProjection` — the schema-object projection definer with a read-only membrane and per-output-field provenance. Imports `EvidenceModel` with `import type` only, so it never pulls in `node:fs` or the TypeScript compiler API; `./build` re-exports it for backward compatibility.                                                                                                                                                                                                                                                             |
| `@maverickcer/data-cap/eslint-plugin` | `src/eslint-plugin/`   | Node-only (ESLint)    | `stable-operation-reference`, `no-raw-external-io` rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Before finishing a change

- Run `npm run typecheck`, `npm run lint`, and `npm run test:coverage` (or
  `npm run verify` for the full gate, including
  `format:check`/`build`/`schema`/`size`).
- If you touched a type with public surface, confirm it has both a positive
  `expectTypeOf` test and, where a genuinely invalid construct exists, a
  `// @ts-expect-error` negative test (ADR 0045).
- If you touched `core/patch.ts` or `core/ownership.ts`, confirm the property-based
  tests in their respective `test/core/*.test.ts` still cover the change (ADR 0046).
- If you touched `runtime/capability.ts`, confirm `test/runtime/capability.test.ts`
  still covers the behavioral contract listed in ADR 0048 — especially getter-vs-
  mutator stale-discard asymmetry, dedup/subscription identity scoping, and
  `optimistic()` receiving authoritative (not projected) state. If you touched
  anything `core/fields.ts`'s `FIELD_MARKER` depends on, re-run
  `test/runtime/cross-bundle-field-marker.test.ts` against a fresh `npm run build`.
- Confirm no secret/raw value appears in a thrown error or warning message.
- If you touched `examples/`, run that example's own `npm start`/`npm run typecheck`
  directly (each is a separate npm project — the root's own `npm run verify` does not
  install or run them; CI's `examples` job does) and regenerate its golden with
  `npm run examples:update-golden` if the change was intentional.
- If public exports changed, confirm it's intentional and justified — otherwise revert
  the export.

## Full reference

For architecture rationale and the complete decision history, see
[`specs/architecture.md`](specs/architecture.md), [`specs/decisions/`](specs/decisions/)
(55 ADRs), and [`skills/data-cap/SKILL.md`](skills/data-cap/SKILL.md).
