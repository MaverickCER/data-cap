# 0048: `buildData`/`createData` split — an optional, Experimental-tier operations layer, composed entirely from existing Stable primitives

## Status

Accepted. Implemented in `src/core/build.ts` (renamed from `create.ts`),
`src/core/types.ts` (new operation vocabulary), `src/core/document.ts`
(extended `CapabilityDocs`), `src/runtime/capability.ts` (new), and
`src/build/parse.ts`/`link.ts` (extended recognition). Experimental tier
(`VERSIONING.md`) — the module's shape may still change in a minor,
pre-1.0 release as real usage reveals a better one.

**Note:** `examples/desired-use-case.tsx`/`examples/actual-use-case.tsx`,
referenced throughout this record as the acceptance test that drove and
validated this decision, no longer exist in the repository and were not
recreated (`examples/tsconfig.spec.json`, which typechecked them, was
removed along with `typecheck:examples-spec`). The decision and behavioral
contract described below remain in effect and are otherwise fully verified
by `examples/application/` and the rest of the test suite; the
narrative below is left as originally written for historical accuracy.

## Context

`examples/desired-use-case.tsx` is an architectural acceptance test written
against the intended consumer experience: schemas declaring
`getters`/`mutators`/`subscriptions` as first-class operations, with the
runtime executing them (`capability.getUser(...)`, `capability.
runGetters(...)`, `capability.subscribeToUser(...)`), owning dedup, status,
and optimistic lifecycle automatically — `const userData =
createData(userSchema)`, one call.

That collided with a repeatedly, explicitly documented **permanent**
decision, not a stale TODO: AGENTS.md's Avoid list ("Adding a built-in
getter/mutator/subscription execution loop to `runtime/`"),
`skills/data-cap/SKILL.md` (same statement), and `ADOPTION.md` ("This is a
deliberate scope decision, not a missing feature" — listed under permanent
architectural guarantees, not open questions). Meanwhile, stale comments in
`core/types.ts`/`document.ts`/`canonicalize.ts` referenced operation types
being "added in a later phase" — leftovers from an early scaffolding plan
`specs/architecture.md` already contradicted ("all five entry points ...
implemented, tested, and shipped"). The codebase's own comments disagreed
with its own docs about whether this was deferred or rejected.

## Decision

**Narrow the permanent decision, don't reverse it — and split naming to
match the two distinct roles it now needs to describe.**

`createData()` (the existing fields-only, pure, synchronous primitive) is
renamed **`buildData()`**. `buildData` is completely behaviorally
unchanged — same implementation, same file (now `src/core/build.ts`), same
Stable-tier semver coverage — only its name and file changed, plus its
returned type `DataCapability<T>` is renamed `BuiltData<T>`.

**`createData()`** is reclaimed for a new, batteries-included, stateful
entry point exported from `data-cap/runtime` (never from
core — core must stay synchronous/stateless, the one half of the original
"no execution loop" invariant that was never actually in question). It
composes `buildData` + `createDataStore` + a `Coordinator` internally — no
new core/runtime _primitive_ behavior, a pure orchestration layer over the
existing Stable ones (`createDataStore`, `coordinator.dedupe`/
`acquireSubscription`, `resolveOperationPatch`, `patchInto`, `canonicalize`
are all completely unchanged). `createData({fields})` alone (no
operations) still works, behaving exactly like today's
`createDataStore(buildData({fields}))` two-step, now optionally one call.

This reclaims "capability" as a name for what it always informally meant in
this project's own docs ("data-cap gives each capability ... an
executable, analyzable data contract") — a `Capability` is really the
operational runtime form of a data definition, not a third abstraction
needing its own noun (`createCapability` was considered and rejected — see
Alternatives).

Concretely, `createData(schema)` where `schema = {fields, getters?,
mutators?, subscriptions?}`:

- Exposes one bound method per declared getter/mutator/subscription name.
- `runGetters(calls, options?)` runs the requested getters concurrently via
  `Promise.allSettled`, returning a structured per-operation outcome
  (`{status: "success", value}` / `{status: "error", error}`); it never
  rejects itself.
- `getSnapshot()` returns a `DataCapabilitySnapshot` — a strict superset of
  `DataState<TFields>` (still fully `useSyncExternalStore`-compatible)
  adding a reactive `operations` namespace, keyed by operation name then
  by `canonicalize()`d params — the only way to answer "is `getUser({id:
1})` specifically still loading while `getUser({id: 2})` has already
  succeeded," which field-level `info.<field>` (one slot per field) cannot
  express and was never designed to.
- `describe()` exposes static, non-reactive operation metadata (name,
  kind, declared `writes`, whether a `processor`/`optimistic` is present)
  — deliberately not shaped like the reactive `operations` snapshot key,
  so "what can this operation do" (fixed) is never confused with "what is
  it doing right now" (live, per-params).
- Deliberately **no top-level `.fields`/`.info` shortcut** on the returned
  capability — a same-named-but-frozen property would silently never
  update, unlike `buildData()`'s own genuinely-static `.fields`. Declared
  shape stays available via the schema object the caller already holds;
  every live read has exactly one spelling, `getSnapshot().fields`.

### Non-negotiable behavioral contract

Established across two rounds of review before implementation; each is a
hard constraint the test suite enforces, not a suggestion:

1. **Getter and mutator methods reject on failure — normal Promise
   semantics.** Recording a `DataError` into state never converts a
   failed operation into a fulfilled Promise. Fire-and-forget is achieved
   by not awaiting, never by the runtime swallowing a rejection.
2. **`runGetters` never rejects itself**, even though the individual
   getters it calls do — it absorbs their rejections via `Promise.
allSettled` into the structured outcome map.
3. **Operation parameter types are independent of field nullability.** A
   `fields.nullable(...)` declaration never forces an operation's `params`
   type to inherit `| null`/`| undefined` — params are typed from the
   operation's own `params` value, never derived through `InferFieldValue`
   against the capability's `fields` shape.
4. **`processor`/`optimistic` return types are compile-time constrained to
   the operation's declared `writes` ownership** via a new `OwnedPatch<
TFields, TWrites>` mapped type (`core/types.ts`) — a processor for
   `writes: {user: {email: true}}` cannot type-check while returning
   `{post: ...}}` or even `{user: {name: ...}}`, a sibling it doesn't own.
   Runtime enforcement via `resolveOperationPatch` stays mandatory
   regardless — the type system narrows the legal shape, it doesn't
   replace the runtime boundary check.
5. **`processor` always returns a full patch keyed by field name**, never
   a bare field value, for both getters and mutators — one convention, no
   ambiguity.
6. **`optimistic()` receives current AUTHORITATIVE state
   (`getAuthoritativeState()`), never the visible/projected state.** A
   second concurrent optimistic transition must never compute against a
   first transition's still-pending, unconfirmed value.
7. **Operation identity for dedup/subscription-sharing is (capability
   instance × operation name × canonicalized params) — never bare function
   identity.** `createData` constructs one stable dispatch closure per
   (instance, operation name), once, at `createData()` call time, never
   per invocation, and passes _that_ to `coordinator.dedupe`/
   `acquireSubscription` — never the raw schema-authored `execute`/
   `subscribe` directly. This makes the sharing domain correct by
   construction without changing `coordinator.ts`'s signature at all:
   different operations get different closures (never collide), a fresh
   `createData()` call gets fresh closures (never collides across
   instances), identical canonicalized params still share as expected.
   Subscriptions additionally memoize one closure per canonicalized-params
   key so `subscribeToUser({id:"1"})` twice shares a transport while
   `subscribeToUser({id:"2"})` gets an independent one.
8. **Exactly one authoritative `DataStoreController` per `createData()`
   instance.** The new per-operation `operations` state is genuinely
   _additive_ (no field/info analogue exists today), co-committed
   atomically with every store update the layer makes, so `getSnapshot()`
   still returns one consistent, reference-stable object per real change.
9. **Getter stale-response discard is scoped to per-getter-identity start
   sequence (ADR 0024), applied ONLY to the field-level commit** — a
   newer call to the same getter invalidates an older in-flight call's
   field-level commit once it resolves later, but that older call's own
   per-params `operations` entry still reflects its own true outcome.
   **Mutators get no such discard** (ADR 0025 is deliberately different:
   last commit always wins, regardless of start order) — applying getter
   discard logic to mutators would have been a real bug.
10. **Subscription disconnect never touches `fields`** (ADR 0029,
    unchanged) — only `info.<field>.subscription`.
11. **Unsubscribe is idempotent** and, distinctly, **a capability commits
    its own subscription status as `"disconnected"` unconditionally on its
    own release** — see the bug writeup below; this is not the same
    property as idempotency and was not obvious in advance.
12. **No React-specific code ships.** `getSnapshot`/`subscribe` stay
    `useSyncExternalStore`-compatible; a `useDataStore` wrapper is a
    3-line snippet in `examples/application/`'s and
    `examples/desired-use-case.tsx`'s own code, never exported package
    code (ADR 0037's precedent for TanStack/Socket.IO applies equally
    here).
13. **No competing coordinator abstraction** — `createData` accepts an
    existing `Coordinator` (default `defaultCoordinator`, overridable per
    ADR 0027) and calls its unmodified `dedupe`/`acquireSubscription`.

### Two real bugs this surfaced (not merely designed around)

Implementation, not just design, is what actually found these — both are
now regression-tested:

1. **Cross-bundle `FIELD_MARKER` identity.** `core` and `runtime` are
   separate tsup entries, each independently bundled — a bare `Symbol()`
   for `FIELD_MARKER` (`core/fields.ts`) created a genuinely different
   symbol identity in each bundle's own inlined copy of that module.
   `runtime`'s `createData` is the first code ever to call core's
   `resolveOperationPatch` against a schema built with core's own
   `fields.nullable`/`fields.optional` — `isFieldMarker` silently returned
   false for every marker, misclassifying it as an ordinary nested object
   and causing `resolveOperationPatch` to reject every one of that
   field's own real keys as "not declared in the capability schema." Fixed
   by using `Symbol.for("data-cap.field-marker")` (the global symbol
   registry) instead of a bare `Symbol(...)` — the standard mechanism for
   exactly this class of problem. This is **not** the same risk class ADR
   0041 accepts for `defaultCoordinator`: that hazard degrades gracefully
   (each duplicated instance stays internally correct, they just stop
   sharing an optimization) and only manifests under genuine dual-package
   ESM/CJS resolution; a duplicated `FIELD_MARKER` corrupted every
   operation deterministically, for every consumer, with no ESM/CJS
   mismatch required at all — a correctness bug, not a documented,
   acceptable degradation. See `test/runtime/cross-bundle-field-marker.
test.ts` (loads the real built `dist/index.js` + `dist/runtime/
index.js`, the same technique `dual-package-hazard.test.ts` already
   established) and `test/core/fields.test.ts`.
2. **Self-releasing subscriptions never heard their own disconnect.**
   `coordinator.acquireSubscription`'s release function removes a
   consumer from the shared transport's fan-out _before_ invoking the
   transport's own teardown (so a still-attached sibling consumer, if any,
   is the one that would normally hear a status change) — a capability
   that released its own subscription therefore never received
   `onStatusChange("disconnected")` for its own release, since it had
   already been removed from the fan-out `consumers` set by the time
   teardown ran. This was never previously exercised:
   `test/integration/subscriptions/subscription-lifecycle/`'s own hand-wired pattern only tracks a raw
   `disconnectionCount` from the transport's own teardown closure, never
   asserting on `info.<field>.subscription.status` after a self-release.
   Fixed in `createData`'s subscription wiring, not `coordinator.ts` (the
   coordinator's behavior is arguably correct for its own purpose —
   ref-counted transport sharing across independent consumers, not
   necessarily "tell every releaser about their own release"): the
   generated `unsubscribe` function now commits `{status: "disconnected"}`
   to its own capability unconditionally, immediately after calling
   `coordinator.acquireSubscription`'s release — independent of whether
   the underlying transport actually tears down (another consumer may
   still be attached). See `test/runtime/capability.test.ts`.

## Naming migration

No deprecated compatibility alias ships for the renamed `buildData` — the
package has never been published to npm (README's own badge block is
still commented out pending "the first successful `npm publish`"), so
there is no real external consumer to break. This is a clean pre-1.0
rename per `VERSIONING.md`'s own "Stable tier can change shape in a minor
release before 1.0" allowance, not a deprecation cycle. A changeset
records the rename + new API as one coherent `minor` pre-1.0 change.

This is intended to become the _primary_ way most applications use
data-cap, not a secondary convenience path — README.md/AGENTS.md/
`skills/data-cap/SKILL.md` are restructured to lead with `createData
(schema)` accordingly, with `buildData` + hand-wiring introduced
afterward as the low-level path for applications that want full manual
control over execution, retry, and caching policy.

## Consequences

- Zero risk to the Stable-tier surface: `buildData`, `createDataStore`,
  `coordinator`, `runtime/cache`, `runtime/retry` are byte-for-byte
  behaviorally unchanged. All 15 pre-existing examples still pass,
  mechanically renamed (`createData` → `buildData` at their own call
  sites) with no logic changes.
- `data-cap/runtime`'s gzip budget (`scripts/check-size.mjs`)
  rose from 4 KB to 6 KB (measured ~5.5 KB) to accommodate `createData`'s
  real code, landing in the same entry as `createDataStore`/`coordinator`
  rather than a separate tree-shaken sub-path the way `runtime/cache`/
  `runtime/retry` do — a deliberate tradeoff, not an oversight: an
  application that only ever hand-wires `createDataStore`/`coordinator`
  directly still pays for `createData`'s code, in exchange for `createData`
  being reachable from the one entry point most consumers import first
  rather than a second, easy-to-miss import path for what's meant to be
  the primary API. See `PERFORMANCE.md`.
- `stable-operation-reference` (the ESLint rule) needed **no code
  change** — it already matched the literal name `"createData"` and
  already had a comprehensive test suite exercising
  `createData({getters/mutators/subscriptions})` shapes (25 cases,
  including factory functions, block scopes, shorthand properties) that
  could never previously fire against the real package, since the real
  `createData` never had this shape before. It was dormant, pre-wired
  scaffolding for precisely this feature.
- `build/parse.ts`/`link.ts` recognize both `buildData(...)` and
  `createData(...)` for `fields` extraction (identical logic), and
  additionally extract a `createData` call's static operation catalog
  (getter/mutator/subscription **names**, and their `writes` shape where
  it's a literal — never their `execute`/`processor`/`subscribe`/
  `optimistic` function bodies, staying inside ADR 0002's never-eval
  rule).
- `examples/desired-use-case.tsx` is fixed in place rather than treated
  as permanently aspirational: its concrete syntax/logic errors (a
  duplicated `loadDashboard`, a malformed destructuring in
  `subscriptions.subscribeToUser.subscribe`, a fictional `Response<T>`
  envelope, mismatched `updateUser` parameter shapes, `UserFields['user']
['id']` being invalid once `user` is nullable) are resolved, and it now
  compiles (`npm run typecheck:examples-spec`, a new root devDependency-
  only `react`/`@types/react` + `examples/tsconfig.spec.json` scaffolding
  that maps the package's own public entry points directly to `src/`,
  proving the real public types compile without an install/build step
  first). `examples/application/` is the real, executed,
  Node-only counterpart following every other example's established
  convention (own `package.json`, real `node:assert/strict` checks,
  golden `output.json`) — same scenario, same operation names, actually
  run end-to-end in CI, since a React component file can't be executed
  the way the other 15 examples are.

## Alternatives considered

- **Naming the new function `createCapability`, leaving `createData`
  meaning only the fields-only primitive.** Rejected on reconsideration —
  it introduces a third noun ("Capability") for what is really just the
  operational runtime form of the same data definition the project's own
  docs already call a capability everywhere else, and it doesn't let
  `desired-use-case.tsx`'s own `createData(userSchema)` call site work as
  literally written. `buildData`/`createData` reads as a natural verb
  pair (declare, then run) and keeps exactly two names instead of three.
- **Keeping `createData` as the fields-only primitive's name and adding
  the operations layer under a different name (e.g. as an overload).**
  Rejected — `createData`'s config would need to conditionally return a
  plain `DataState` or a stateful capability depending on whether
  `getters`/`mutators`/`subscriptions` were present, which either forces
  the operations-aware path into core (violating core's synchronous/
  stateless invariant, the one part of the original decision that was
  never in question) or requires two entry points behind one name anyway
  — strictly worse than one clear rename.
- **Attempting to prevent the `FIELD_MARKER` cross-bundle hazard via a
  build-pipeline change (shared chunks across tsup entries) instead of
  `Symbol.for`.** Rejected — `Symbol.for` is the standard, minimal,
  purpose-built tool for exactly this problem; a build-pipeline change to
  force shared chunks across `core`/`runtime`/`build`/`helpers`/
  `eslint-plugin`'s independently-bundled tsup entries would be a much
  larger, riskier change to an already mature, tested build pipeline, for
  a problem `Symbol.for` already solves completely.
- **Fixing the self-release subscription-status gap inside
  `coordinator.ts` instead of `createData`'s own wiring.** Rejected —
  `coordinator.acquireSubscription`'s existing fan-out-then-teardown
  ordering has a coherent purpose for its own contract (ref-counted
  transport sharing across independent, symmetric consumers); special-
  casing "also notify the releasing consumer" inside the coordinator
  would conflate two different concerns. A capability's own subscription
  lifecycle status is knowable unconditionally, locally, the moment it
  releases — solving it at that layer needed no coordinator change at
  all.

## Related

- ADR 0002 (build tooling static-analysis-only), ADR 0011 (getter/mutator
  ownership rules), ADR 0021–0023 (authoritative/pending/project model, no
  automatic rollback), ADR 0024/0025 (getter stale-discard vs. mutator
  completion-order), ADR 0026–0030 (subscription sharing/lifecycle), ADR
  0027 (coordinator singleton + factory), ADR 0037 (no first-party
  integration packages — still holds; this is still not a TanStack/
  Socket.IO adapter), ADR 0041 (dual-package hazard is a _different_,
  accepted risk class from the cross-bundle marker bug this ADR fixes),
  ADR 0045/0046 (type-level and property-based test discipline, both
  extended for this change), ADR 0047 (negative guarantees checklist,
  extended with this ADR's new hard invariants).
