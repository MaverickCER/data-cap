# 0023: No automatic rollback, no invented universal conflict-resolution policy

## Status

Accepted. Implemented in `src/runtime/store.ts`
(`removePendingTransition` has no "restore a prior value" logic — it only
removes the entry).

## Context

A failed optimistic mutation and a genuine write conflict (two mutations
touching the same field) both raise the question "what should the
framework do about it automatically." Every generic answer to that
question (last-write-wins, first-write-wins, an automatic merge) is wrong
for some real application, since the correct resolution is inherently
domain-specific — a chat app's "last message wins" is not a shopping
cart's "quantities should sum," and a framework guessing wrong silently is
worse than a framework that doesn't guess.

## Decision

`removePendingTransition(id)` does exactly one thing: removes that pending
transition from the list. There is no "restore the value it optimistically
overwrote" logic — the correct visible value after removal falls out
automatically from `project()`'s always-fresh recompute (ADR 0021):
whatever is still authoritative, plus whatever transitions are still
pending, with nothing invented in between. Likewise, no code path in this
package resolves a same-field write conflict by policy — whichever
operation's `commitAuthoritative` call runs last is what's visible
afterward (ADR 0025's completion-order fold), and that is the _entire_
extent of this package's conflict handling.

## Consequences

- A failed mutation's optimistic value disappearing is not special-cased
  code — it's the direct, automatic consequence of `project()` no longer
  folding a transition that no longer exists.
- An application that needs a specific conflict-resolution policy (e.g.
  "the newer edit wins based on a version field the response carries")
  implements it in its own processor, which has full access to both the
  current authoritative state and the raw operation result to decide with.
- This keeps the package's behavior honest and predictable under
  concurrency: "whatever committed last is what's visible" is a simple,
  auditable rule, not a black-box heuristic.

## Alternatives considered

- **An automatic rollback mechanism that restores a captured
  pre-optimistic-update value.** Rejected — "restore to what" is
  genuinely ambiguous once other operations may have committed in the
  meantime; the always-fresh `project()` fold already produces the
  correct answer without needing a captured snapshot to restore from.
- **A built-in conflict-resolution policy (e.g. last-write-wins with a
  timestamp, or an automatic merge).** Rejected — no single policy is
  correct for every application's data; inventing one risks silently
  wrong behavior for use cases this package has no visibility into.
