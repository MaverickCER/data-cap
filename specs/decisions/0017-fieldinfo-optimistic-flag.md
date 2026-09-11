# 0017: `FieldInfo.optimistic` distinguishes a currently-optimistic value from a server-authoritative one

## Status

Accepted. Implemented in `src/core/types.ts` (`FieldInfo.optimistic?:
boolean`), `src/runtime/store.ts` (`addPendingTransition`/
`removePendingTransition`).

## Context

`project()` folds pending optimistic transitions on top of authoritative
state (ADR 0021), so the _value_ a consumer sees while a mutation is
in-flight is indistinguishable, at the `fields` level, from a real,
committed value — by design, that's what makes an optimistic UI feel
instant. But some UI treatments (a subtle "saving…" indicator, a
different color/opacity for not-yet-confirmed data) legitimately need to
know the difference, and `fields` alone can't answer it.

## Decision

`FieldInfo.optimistic?: boolean` is `true` while a pending optimistic
transition is contributing to that field's currently-visible value, and
cleared once the corresponding operation commits (moving the value from
pending to authoritative) or is removed (on failure, with no automatic
rollback — ADR 0023). It's computed as part of the same `project()` fold
that produces the optimistic `fields` value itself, so it's never out of
sync with what's actually being shown.

## Consequences

- An application can render an "unsaved"/"saving" treatment for exactly
  the fields currently carrying optimistic contributions, without
  maintaining that bookkeeping itself.
- The flag is derived, not separately tracked state — it can never drift
  from whether a pending transition genuinely still exists for that field.
- Combined with `source` (ADR 0014), a consumer can tell not just _that_ a
  field is optimistic, but _which_ in-flight operation is responsible.

## Alternatives considered

- **No optimistic-tracking flag at all — let applications diff `fields`
  against `getAuthoritativeState()` themselves.** Rejected — pushes a
  common, easy-to-get-wrong computation onto every consumer, when the
  store already knows the answer precisely at fold time.
- **A separate, parallel "optimistic state" object instead of a flag on
  `FieldInfo`.** Rejected — splits state a consumer needs together (is
  this field optimistic, and what's its status/source) across two
  different places to look, instead of one coherent `info` tree.
