# 0044: Published snapshots are deep-frozen, amortized via structural sharing, enforced unconditionally in every environment

## Status

Accepted. Implemented in `src/core/patch.ts` (`deepFreezeNewNodes`),
called from both `createData()` (the very first snapshot, frozen in full
once) and `commitState` (every subsequent commit).

## Context

A consumer must never be able to mutate a published `DataState` in place —
doing so would corrupt structural-sharing's own correctness guarantee
(ADR 0010's reference-stable reconciliation depends on a branch, once
published, never silently changing underneath a reference someone else
still holds) and would let one part of an application accidentally break
another's assumptions about `fields`/`info` being stable between renders.
Freezing the _entire_ tree on every commit, though, would cost work
proportional to total state size on every single change, however small.

## Decision

Every published `DataState` is immutable via `Object.freeze` on every
reachable object/array node — but because structural sharing (`patchInto`,
ADR 0010) already reuses unchanged branches by reference, `deepFreezeNewNodes`
only needs to freeze _newly-created_ nodes on a given commit's changed
path; a branch that's already frozen (because it was created by a prior
commit, or is the reused, unchanged part of this one) is skipped —
`Object.isFrozen()` on it is already `true`, cheaply detectable. The very
first `DataState`, built by `createData()`, is deep-frozen in full once,
since nothing about it is "reused from a prior commit" yet. This applies
unconditionally, in every environment (not gated behind a development-only
flag) — it's a correctness invariant the store/`useSyncExternalStore`
contract depends on, not merely a debugging aid.

## Consequences

- Freeze cost is proportional to what actually changed in a given commit,
  not to total state size — a commit touching one leaf field doesn't
  re-freeze (or even re-visit) the rest of an otherwise-large state tree.
- A consumer attempting to mutate a published snapshot either throws (in
  strict mode) or silently no-ops (non-strict) — in both cases, the
  snapshot itself is protected, matching what `useSyncExternalStore`-style
  consumption patterns already assume about published state.
- **Explicit, documented caveat**: `Object.freeze` only blocks property
  reassignment/addition/deletion on the frozen object itself — it does
  _not_ block mutation performed through a built-in's own methods on
  internal slots (`Map.prototype.set`, `Set.prototype.add`,
  `Date.prototype.setFullYear` all still work on a frozen instance). For
  those types, immutability of a published snapshot is a
  discipline-level guarantee (never mutate a value you were handed), not
  a runtime-enforced one — stated plainly here and in SECURITY.md/
  ADOPTION.md rather than implied to be covered uniformly.

## Alternatives considered

- **Development-only freeze enforcement** (a common React-ecosystem
  pattern). Rejected — "no mutation of published snapshots" is load-
  bearing for this design's own correctness (structural sharing, no-op
  suppression), not just a helpful development-time check to catch bugs
  early; disabling it in production would silently remove a real
  guarantee the design depends on.
- **Full-tree freeze on every commit, accepting the cost.** Rejected —
  makes freeze cost scale with total state size instead of with what
  actually changed, undermining the whole performance story structural
  sharing exists to provide elsewhere in this design.
