# 0021: Authoritative/optimistic separation via `authoritativeState` + ordered `pendingTransitions` + always-recomputed `project()`

## Status

Accepted. Implemented in `src/runtime/store.ts`, `src/core/patch.ts`
(`project`).

## Context

An optimistic UI needs to show a not-yet-confirmed value immediately while
still knowing, unambiguously, what the last real, server-confirmed value
was — for correctness when a mutation fails (revert to what, exactly?) and
for concurrent mutations against overlapping or unrelated fields (which
value is "current" while more than one thing is in flight?).

## Decision

`DataStoreController` keeps two things separate: `authoritativeState` (the
last real, committed `DataState`) and an ordered list of
`pendingTransitions` (each an uncommitted optimistic patch, tagged with a
symbol id). The publicly visible `getSnapshot()` is always
`project(authoritativeState, pendingTransitions)` — folding every pending
transition, in order, onto the authoritative state via repeated
`commitState` calls — computed fresh on every call, never cached.
`getAuthoritativeState()` remains separately available for code that
specifically needs the non-optimistic view.

## Consequences

- "What's currently visible" and "what's actually confirmed" are always
  answerable independently, from the same store, without an application
  maintaining its own shadow copy of either.
- Because `project()` is always recomputed (never cached), removing a
  pending transition (success or failure) automatically produces the
  correct next visible state on the very next call — no separate
  invalidation step required.
- This is the foundation ADR 0022's "always fold onto current authoritative
  state" and ADR 0023's "no automatic rollback" build on directly — both
  fall out of `project()`'s own recompute-from-scratch design rather than
  needing separate mechanisms.

## Alternatives considered

- **A single mutable `state` with optimistic changes applied and later
  patched/reverted in place.** Rejected — makes "what's the last real
  value" a question that requires either a separate snapshot taken before
  the optimistic change (fragile under concurrent mutations) or an
  explicit undo log (more state to keep consistent than the two-state
  model requires).
- **Caching `project()`'s result and invalidating it explicitly.**
  Rejected — introduces a real class of "forgot to invalidate" bugs for a
  computation cheap enough (bounded by the number of currently-pending
  transitions, typically small) that recomputing it fresh isn't a
  meaningful cost.
