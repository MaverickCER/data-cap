# 0047: A named "negative guarantees" checklist enumerates every hard "never" invariant, each traced to a passing test

## Status

Accepted. The checklist itself lives here; each item is traced to its
owning test file below rather than duplicated as a separate document.

## Context

This design makes many individually-important "never" promises, scattered
across ADRs 0002 through 0044 above — no unowned field write, no truthiness
checks where presence must be checked precisely, no stale overwrite, no
automatic rollback, and more. Each one is real and tested somewhere, but
without a single, explicit, traceable list, "is this actually guaranteed,
and is it actually tested" is a question a reviewer (or a future
contributor considering a change) has to re-derive by reading every ADR
individually.

## Decision

The following checklist collects every hard "never" invariant this design
establishes, each traced to the test file(s) that verify it. An item on
this list without a passing, identifiable test is treated as a gap to
close, not an acceptable omission.

1. No operation may write a field it does not own — `test/core/ownership.test.ts` (ADR 0011).
2. `0`/`false`/`""`/`null`/explicit `undefined`/`[]` are never treated as "absent" anywhere presence is checked (`Object.hasOwn` only, never truthiness, never `in`) — `test/core/ownership.test.ts`, `test/core/patch.test.ts`, `test/core/identity.test.ts`.
3. A stale (superseded) getter response never overwrites newer already-committed state, for either `fields` or `info` — governed by ADR 0024; enforced by `commitState`'s atomicity, `test/core/patch.test.ts`.
4. A failed optimistic mutation is never automatically rolled back by the framework — `test/runtime/store.test.ts`, `test/integration/runtime-core/optimistic-mutation-concurrency/` (ADR 0023).
5. The framework never invents a conflict-resolution policy — `test/runtime/store.test.ts` (ADR 0023, ADR 0025).
6. A subscription disconnect never clears or mutates `fields` — governed by ADR 0029 (application-level; demonstrated in `test/integration/subscriptions/socket-io-subscription/`).
7. Subscription reconnection never implies an assumed-consistent replay of missed events — ADR 0030; demonstrated in `test/integration/subscriptions/subscription-with-recover/`.
8. Canonicalization never silently collides distinct values and never throws on non-canonicalizable input — `test/core/canonicalize.test.ts` (ADR 0019).
9. The coordinator never leaks a timer, promise, listener, or registry entry after a full acquire→release cycle — `test/runtime/coordinator.test.ts`.
10. A true no-op commit never triggers a subscriber notification — `test/core/patch.test.ts`, `test/runtime/store.test.ts` (ADR 0042).
11. Two coordinators never silently duplicate shared work unless isolation was explicitly requested via `createCoordinator()` — `test/runtime/coordinator.test.ts`, `test/integration/coordinator/coordinator-isolation/` (ADR 0027).
12. Build tooling never imports, `require()`s, or `eval()`s a discovered schema file — `test/build/*.test.ts` (ADR 0002).
13. The optional cache never stores a raw unvalidated response, and never stores `fields` without its corresponding `info` — `test/runtime/cache.test.ts` (ADR 0035).
14. Retry never duplicates a subscription/dedup entry, never overwrites newer data, never fires after abort, and never loops indefinitely against a permanent error — `test/runtime/retry.test.ts`, `test/integration/runtime-modules/runtime-retry/` (ADR 0036).
15. A previously published snapshot is never mutated in place (subject to the `Map`/`Set` method-mutation caveat) — `test/core/patch.test.ts` (ADR 0044).
16. A thrown processor is never treated as a per-field validation/sanitization case — it is always a whole-operation failure — `test/core/ownership.test.ts` (ADR 0013).
17. `createData`'s getter/mutator methods never swallow a failure into a fulfilled Promise — recording a `DataError` into state never converts a rejection into a resolution — `test/runtime/capability.test.ts` (ADR 0048).
18. `runGetters` never rejects itself, and one getter's failure never erases or blocks another's already-committed success — `test/runtime/capability.test.ts` (ADR 0048).
19. `createData`'s dedup/subscription-sharing domain never collapses across different operations or different `createData()` instances — only (capability instance × operation name × canonicalized params) shares — `test/runtime/capability.test.ts` (ADR 0048).
20. A getter's stale-response discard (ADR 0024) is never applied to a mutator, and never applied to that call's own per-params `operations` entry (only to the aggregate field-level commit) — `test/runtime/capability.test.ts` (ADR 0048).
21. `optimistic()` never receives the visible/projected state — only current authoritative state, so one pending transition never computes against another's still-unconfirmed value — `test/runtime/capability.test.ts` (ADR 0048).
22. A capability's per-operation `operations` state never grows unboundedly — bounded by `maxOperationHistory`, LRU-evicted — `test/runtime/capability.test.ts` (ADR 0048).
23. A field marker (`fields.nullable`/`fields.optional`) is never misrecognized across `core`'s and `runtime`'s independently-bundled dist output — `FIELD_MARKER` uses the global symbol registry (`Symbol.for`), never a bare `Symbol()` — `test/core/fields.test.ts`, `test/runtime/cross-bundle-field-marker.test.ts` (ADR 0048).
24. A capability releasing its own subscription always commits its own `info.<field>.subscription.status` as `"disconnected"`, never depending on `acquireSubscription`'s fan-out (which cannot deliver that callback to a consumer already removed from its own release) — `test/runtime/capability.test.ts` (ADR 0048).

## Consequences

- Every hard invariant this design makes has one canonical place it's
  listed, independent of which ADR originally established it — a reviewer
  can audit the whole list in one pass instead of reconstructing it from
  47 separate documents.
- An untraced item (a "never" claim with no test backing it) is
  immediately visible as a gap here, rather than being an implicit,
  undiscovered risk.
- Adding a new hard invariant to the design should mean adding it here too
  — this list is meant to stay complete, not to be a one-time snapshot.

## Alternatives considered

- **Leaving each guarantee as incidental coverage inside whichever
  module's test happens to touch it, with no consolidated list.**
  Rejected — this is the state that made the list worth writing in the
  first place; without it, "is this actually guaranteed and tested" has
  no single place to check.
- **A separate `test/negative-guarantees.md` document instead of an ADR.**
  Considered, but folded into this ADR instead — the list's own rationale
  (why a consolidated, traceable checklist matters) belongs with the list
  itself, in the same format every other architectural decision in this
  package is recorded in.
