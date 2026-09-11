# 0042: No-op operations never publish a new snapshot or notify subscribers; real info-only changes still do

## Status

Accepted. Implemented in `src/core/patch.ts` (`patchInto`/`commitState`'s
reference-equality short-circuit), `src/runtime/store.ts`
(`recomputeVisibleState`'s `next !== visibleState` check).

## Context

A commit that produces a value identical to what's already there —
recommitting the same fetched value, or an operation whose patch happens
to touch nothing that actually changes — shouldn't cost a subscriber a
re-render or an application a redundant reaction. But the boundary matters:
a _real_ change to `info` alone (a bare status transition, with no field
value change) is still a genuine, meaningful transition a subscriber may
care about, and must not be swallowed by an overly broad "nothing changed"
check.

## Decision

`patchInto` returns the original `prev` reference, unchanged, whenever a
patch produces no actual difference (checked per-key, not by a blanket
assumption). `commitState` returns `prev` itself only when _both_
`fields` and `info` come back reference-equal to `prev`'s own — so a
change to either half alone still produces a new object and a real commit.
`store.ts`'s `recomputeVisibleState` compares the newly `project()`-ed
state against the currently-visible one by reference, and only calls
`notify()` when they actually differ.

## Consequences

- Recommitting an already-current value (e.g. a getter's response
  happening to match what's already there) never triggers a spurious
  subscriber notification or a wasted re-render.
- A pure status transition (`"loading"` → `"success"` with the same
  underlying value, or a subscription's `"connecting"` → `"connected"`)
  still notifies correctly, since that's a real `info` change even when
  `fields` didn't move.
- This is what makes `===` a safe, cheap way for any consumer (or this
  package's own store) to detect "did anything actually happen" — the
  reference itself carries that meaning, not just the object's contents.

## Alternatives considered

- **Deep-equality checking instead of structural-sharing-based reference
  equality.** Rejected — more expensive per commit (a full deep compare,
  proportional to state size, versus a reference check that's free once
  structural sharing (ADR 0010, `patchInto`'s own design) already
  produces the right reference automatically for unchanged branches).
- **Suppressing notification whenever `fields` doesn't change, regardless
  of `info`.** Rejected — this is exactly the "swallow a real `info`-only
  change" mistake this decision explicitly avoids; a status transition
  alone is meaningful and must notify.
