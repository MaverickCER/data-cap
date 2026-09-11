---
name: data-cap
description: Guidance for AI coding agents using or extending @maverickcer/data-cap. Load before creating or editing data-cap capability files, core/runtime/build APIs, getters, mutators, subscriptions, processors, or field/identity declarations.
---

## Purpose

`data-cap` gives each capability (a feature folder or an installable package) an
executable, analyzable data contract: the fields it owns, and the getters/mutators/
subscriptions that acquire, mutate, or observe them — independent of databases,
transports, frameworks, and state-management libraries. It composes with TanStack
Query, a custom application state manager, or Socket.IO/WebSocket subscriptions, or
runs entirely standalone.

**Current implementation status**: all five entry points are implemented, tested, and
shipped — `core` (`.`), `runtime` (`./runtime`, `./runtime/cache`, `./runtime/retry`),
`helpers` (`./helpers`), `build` (`./build`), and `eslint-plugin`
(`./eslint-plugin`). The primary way to use a capability is `createData(schema)`
(`@maverickcer/data-cap/runtime`, Experimental tier), which composes the low-level
primitives (`buildData` + `createDataStore` + a `Coordinator`) into one batteries-
included call owning dedup, per-operation status, optimistic mutation lifecycle, and
`runGetters` concurrency (see ADR 0048 for the full behavioral contract). For full
manual control, the low-level primitives are still there: `buildData` (fields only,
pure/synchronous) + `createDataStore` (state) + `coordinator.dedupe`/
`acquireSubscription` (sharing), wired by hand — see `test/integration/runtime-core/basic-standalone/` for
that pattern, and `examples/application/` for the same scenario through
`createData`.

## Core principles

1. **Fields are the actual application data shape.** No `.value` wrappers, no
   proxies, no symbols for metadata access, no dot-notation string field access, no
   second runtime representation of field values. `data.fields.user.email` is a plain
   string, always.
2. **Fields are always synchronously readable.** `buildData()` (and `createData()`,
   which composes it internally) returns a state populated with declared defaults
   immediately — never a throw-until-validated gate. This is the single largest
   structural divergence from `@maverickcer/env-cap`'s `createEnv`, which throws on
   access until `validateEnv()` resolves.
3. **`DataInfo` is a mandatory half of `DataState`, never optional or separately
   tree-shakeable.** `{ fields, info }` are always present together, and always
   committed and published as one atomic snapshot (`core/patch.ts`'s `commitState`) —
   a consumer can never observe `{newFields, oldInfo}` or the reverse. `info`'s
   performance story is structural sparsity (no eagerly-allocated metadata for
   untouched fields) and reference-stable reconciliation for arrays, not removability.
   `createData`'s own richer snapshot _adds_ a reactive `operations` namespace
   (keyed by operation name, then by canonicalized params) alongside `fields`/`info`,
   never replacing either — see principle 11.
4. **Presence is checked with `Object.hasOwn`, never truthiness.** `0`, `false`, `""`,
   `null`, an explicit `undefined` on an optional field, and `[]` are all real,
   intentional values — never treated as "absent" anywhere field ownership or
   processor-output presence is evaluated.
5. **Getters acquire, mutators perform side effects, subscriptions observe** — three
   semantically distinct operation kinds, not naming conventions. A getter declares
   explicit typed field ownership; a mutator defaults to full-capability-tree ownership
   (still safety-checked, still bounded to the declared schema) unless narrowed. A
   subscription's `writes` is required and explicit, same rationale as a getter's.
6. **A thrown processor is a whole-operation failure, never conflated with per-field
   validation.** An individually-invalid processed field resets to its own declared
   schema default; the ownership walk (`core/ownership.ts`'s `resolveOperationPatch`)
   descends to the smallest invalid leaf/subtree so valid siblings survive. This
   applies identically whether the processor is called by hand-wired application code
   or by `createData`'s own generated operation methods.
7. **No automatic rollback, no invented conflict-resolution policy.** A completing
   operation's commit always folds onto the current authoritative state (never a
   stale start-time snapshot); only the operation's own processor decides how to
   interpret its result. A failed optimistic mutation reverts purely because
   `removePendingTransition` removed its entry — there is no separate rollback path.
   `createData`'s generated mutators follow this exactly: the pending transition is
   removed in a `finally`, regardless of success or failure.
8. **Build tooling is static-analysis-only.** `src/build/` parses discovered files as
   an AST via the TypeScript Compiler API — never `import()`s, `require()`s, or
   `eval()`s them. This includes `createData`'s own `execute`/`processor`/`subscribe`/
   `optimistic` function bodies — build tooling extracts operation _names_ and literal
   `writes` shapes only, never evaluates the functions themselves.
9. **Capabilities do not self-redact.** Unlike `env-cap`'s redacted contracts,
   `data.fields`/`data.info` print normally in `console.log`/`util.inspect` — this is
   ordinary application data, not secrets.
10. **Sharing is scoped to function identity, never behavioral equality.**
    `coordinator.dedupe`/`acquireSubscription` share work only when the exact same
    `execute`/`subscribe` function reference is used — an inline arrow function is a
    fresh identity every time. `createData` resolves this for you by constructing one
    stable dispatch closure per (capability instance, operation name), once, at
    `createData()` call time — the schema-authored `execute`/`subscribe` reference
    itself still needs to be stable across renders/calls for the SAME reason
    hand-wired code does (a fresh schema object literal every render would defeat
    even `createData`'s own closure-stability trick, since it'd rebuild fresh
    closures too). The `eslint-plugin`'s `stable-operation-reference` rule matches
    both hand-wired `createDataStore`/`coordinator` calls and `createData(...)`'s
    `execute`/`processor`/`subscribe`/`optimistic` keys.
11. **`createData`'s per-operation state (`getSnapshot().operations.<name>.
<canonicalizedParams>`) is additive, never a duplicate of `fields`/`info`.**
    Field-level `info.<field>` stays the aggregate, last-committed-wins view (exactly
    what it's always been); `operations` exists specifically because that single slot
    can't distinguish `getUser({id:1})` from a concurrently in-flight `getUser
({id:2})`. `createData` still owns exactly one `DataStoreController` internally —
    `operations` is a second, genuinely new kind of reactive state (execution
    diagnostics, keyed by params), not a second copy of the same field data.
12. **Getter stale-response discard (ADR 0024) and mutator no-discard (ADR 0025) are
    deliberately asymmetric — never apply one's rule to the other.** A newer call to
    the same getter invalidates an older in-flight call's field-level commit; a
    mutator's last commit always wins regardless of start order. `createData`'s own
    getter/mutator wiring implements this precisely; getting it backwards is a subtle,
    easy-to-introduce regression (see `test/runtime/capability.test.ts`'s dedicated
    cases for both directions).
13. **`FIELD_MARKER` (`core/fields.ts`) uses the global symbol registry
    (`Symbol.for`), never a bare `Symbol()`.** `core` and `runtime` are independently
    bundled tsup entries — a bare `Symbol()` creates a different identity in each
    bundle's own inlined copy of the module, which silently broke `isFieldMarker`
    the moment `runtime`'s `createData` needed to recognize a marker built via core's
    own `fields.nullable`/`fields.optional` (see ADR 0048's bug writeup). This is
    unrelated to, and more severe than, the dual-package hazard ADR 0041 documents —
    it corrupts every operation deterministically, with no ESM/CJS mismatch required.

## Avoid

- Wrapping a field value, proxying `data.fields`, or supporting a dot-notation string
  path for typed field access.
- Making `DataInfo` optional, lazily-constructed-only-on-demand, or its own separately
  importable/tree-shakeable entry point.
- Publishing `fields` and `info` through two separate calls, ticks, or notifications —
  always go through `core/patch.ts`'s `commitState`. `createData`'s own `operations`
  state is co-committed atomically alongside every store update it makes, for the
  same reason.
- Falling back to a numeric-index key for array `DataInfo` when no `identity` is
  declared — that reintroduces exactly the array-index-as-key fragility the identity
  system exists to avoid. No `identity` means no per-item `DataInfo` at all.
- Fully rebuilding array `DataInfo` on every `fields`-array replacement — reconciliation
  is identity-diffed (`core/identity.ts`'s `reconcileArrayInfo`); an untouched identity
  keeps its previous `FieldInfo` object reference.
- A per-field validator vocabulary (`{default, processor, validator}` per key, the way
  `env-cap`'s `EnvDefinition` works) — a field's own runtime type is its shape
  descriptor; a processor is the only escape hatch for custom logic. `helpers/shape.ts`'s
  guards are structural only (`isPlainObject`, `isDate`, ...), never business-rule
  validators.
- An exclusive-group/compatibility-conflict concept — getters/mutators are expected to
  have overlapping field reach by design; there is nothing analogous to `env-cap`'s
  `exclusiveGroup` to detect.
- Shipping a first-party TanStack Query, Socket.IO, React, or other adapter/integration
  package — integration patterns are demonstrated in
  `test/integration/adoption-patterns/tanstack-query-integration/` and `test/integration/subscriptions/socket-io-subscription/` only,
  by explicit design decision (ADR 0037), so application authors copy and adapt code
  directly. `getSnapshot`/`subscribe` are already `useSyncExternalStore`-compatible;
  no first-party example currently demonstrates a `useDataStore` React wrapper
  end-to-end.
- Putting stateful/async execution logic into `core/` — `buildData`, `documentData`,
  and everything else under `src/core/` must stay synchronous and stateless, even
  though `runtime/capability.ts`'s `createData` is now a real execution loop; that
  loop lives in `runtime/` specifically so `core` never has to stop being pure.
- Inferring coordinator isolation from function syntax/identity (arrow function vs.
  named function) — function identity is solely the intra-coordinator _sharing_
  boundary; isolation (a separate coordination domain) is always requested explicitly
  through `createCoordinator()` (see `test/integration/coordinator/coordinator-isolation/`, or
  `createData`'s own `options.coordinator`).
- Reimplementing `identity`/`canonicalize` logic in `helpers/` instead of re-exporting
  `core`'s own implementation directly.
- Matching a whole operation definition against the full `GetterDefinition<...>`/
  `MutatorDefinition<...>`/`SubscriptionDefinition<...>` generic interface when
  writing a mapped type over `createData`'s schema — its own generic inference widens
  an individual operation definition while checking it against `DataSchema`'s bound,
  defeating a conditional type keyed on the full interface. Extract one declared
  property at a time instead (`runtime/capability.ts`'s `DeclaredParams`/
  `DeclaredWrites`).

## AI workflow

1. Read the capability's existing `fields` declaration (and any `getters`/`mutators`/
   `subscriptions` sections, or application-level hand-wiring around a `buildData`
   capability) before adding to it.
2. Identify field ownership precisely: which getter/mutator/subscription may write
   which fields. Never let a processor return a field outside its declared ownership
   — for `createData`, this is compile-time constrained too (`OwnedPatch<TFields,
TWrites>`), but the runtime boundary check still applies regardless.
3. Prefer existing helpers (`core/fields.ts`'s `nullable`/`optional`,
   `helpers/processors.ts`'s coercion functions) over hand-rolling equivalent logic.
4. Keep field defaults literal, ordinary JavaScript values — no functions, no cyclic
   structures.
5. When adding a type with public surface, pair a positive `expectTypeOf` inference
   test with a `// @ts-expect-error` negative test for the construct it should reject
   (ADR 0045).
6. When wiring a new getter/mutator/subscription pattern, check whether an existing
   example in `examples/` already demonstrates it before inventing a new shape —
   `examples/application/` for the `createData` path,
   `test/integration/runtime-core/basic-standalone/` (and its siblings) for hand-wired `buildData`.
7. Run the Validation Checklist below before finishing.

## Never assume

- That a mutator without a declared `fields` map has no ownership enforcement at all —
  it defaults to the _full declared capability schema_, not "anything goes."
- That `info` for a given field exists — it's sparse; check with optional chaining.
- That two operations sharing an endpoint may return overlapping fields freely —
  ownership is derived from the declared contract, not inferred from behavior.
- That reconnecting a subscription implies missed-event consistency — there is no
  invented replay guarantee; an optional `recover` getter re-syncs by fetching current
  state once, not by replaying missed events (see `test/integration/subscriptions/subscription-with-recover/`).
- That two capabilities/calls sharing a coordinator will dedupe/share a transport just
  because they're "similar" — sharing requires the literal same function reference
  (or, for `createData`, the same operation on the same capability instance with
  canonically-equal params).
- That a `createData` getter/mutator method swallows its own failure — it rejects like
  a normal Promise; only `runGetters` (which calls getters internally) absorbs
  individual rejections into a structured per-operation outcome and never rejects
  itself.
- That `optimistic()` sees the same state a concurrently-pending sibling transition
  has already optimistically applied — it always receives current AUTHORITATIVE
  state, never the visible/projected snapshot.
- That a capability releasing its own subscription will be told "disconnected" by the
  coordinator's own fan-out — it structurally can't be (the releasing consumer is
  already removed from the fan-out by the time transport teardown runs); `createData`
  commits its own `"disconnected"` status unconditionally on release instead.

## Architecture overview

See [`specs/architecture.md`](../../specs/architecture.md) for the full structural
document (dependency direction, the `fields`/`info` atomicity model, every entry
point's ownership) and [`specs/decisions/`](../../specs/decisions/) for the complete
ADR trail — ADR 0048 specifically for the `buildData`/`createData` split and
the full `createData` behavioral contract.

## Validation checklist

- `npm run verify` passes (typecheck, lint, format:check, build, schema,
  test:coverage, size).
- Every new public type has both a positive and (where applicable) a negative
  type-level test.
- No thrown error or warning embeds a raw field or processed value.
- No new export was added without being a deliberate, justified addition to the public
  API map in `AGENTS.md`.
- If `examples/` was touched, that example's own `npm start`/`npm run typecheck` passes
  (it's a separate npm project — root `npm run verify` doesn't run it), and its golden
  was regenerated via `npm run examples:update-golden` if the change was intentional.
- If `runtime/capability.ts` or `core/fields.ts` was touched, `test/runtime/
capability.test.ts` and `test/runtime/cross-bundle-field-marker.test.ts` (the latter
  against a fresh `npm run build`) still pass.

## Mental model

```
                    buildData(schema)
                           │
                    BuiltData { fields, info }
                           │
              ┌────────────┴─────────────┐
              │                           │
    createDataStore(state)          createData(schema)
    (manual wiring, full            (batteries included:
     control -- see                  dedup, status, optimistic
     test/integration/runtime-core/basic-standalone/)      lifecycle, runGetters --
              │                       see examples/
    application-level               application/)
    commitAuthoritative/                      │
    addPendingTransition            one call, same primitives
              │                       underneath, nothing new
              └────────────┬─────────────┘
                           │
                 DataState { fields, info }
                 (+ operations, for createData)
                           │
                 one atomic snapshot per commit
                           │
              useSyncExternalStore-compatible
                getSnapshot() / subscribe()
```
