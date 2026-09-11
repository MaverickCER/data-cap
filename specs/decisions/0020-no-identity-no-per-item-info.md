# 0020: No `identity` declared means no per-item `DataInfo` keying — never a numeric-index fallback

## Status

Accepted. Implemented in `src/core/identity.ts` (`reconcileArrayInfo` is
only ever called when identity is configured — a schema without it never
reaches this code path at all).

## Context

An array-typed field with no declared identity configuration still needs
a defined behavior for its `info`. The obvious-seeming fallback — key
per-item metadata by array index when no explicit identity exists — would
silently reintroduce exactly the fragility ADR 0009 and ADR 0010 exist to
avoid (an index shifting under reorder, reattaching metadata to the wrong
item), just without the developer having asked for identity tracking at
all.

## Decision

An array field with no `identity` declared gets no per-item `DataInfo`
whatsoever — `info` for that field carries only whatever `FieldInfo` was
set at the array's own top level (e.g. `status`/`source` for the array as
a whole), never a synthesized per-index breakdown.

## Consequences

- There is no silent, half-working per-item metadata for an array a
  developer never opted into identity-tracking for — the absence is
  visible (no per-item info exists), not a subtly-wrong presence
  (index-keyed info that breaks on reorder).
- A developer who wants per-item metadata for an array field has one
  unambiguous way to get it: declare `identity` (ADR 0018). There is no
  implicit halfway state to reason about.
- This keeps `reconcileArrayInfo`'s own contract simple — it is only ever
  invoked once identity is known, never asked to invent one.

## Alternatives considered

- **Numeric-index fallback when no identity is declared.** Rejected — this
  is the exact failure mode identity tracking exists to prevent,
  reintroduced silently for anyone who simply didn't declare identity
  (which, for many arrays, is a perfectly reasonable choice) rather than
  reserved for cases that actually opted in.
- **Requiring identity for every array field, with no opt-out.** Rejected
  — many arrays (a small, rarely-reordered list; a value the application
  never needs per-item metadata for) don't need this machinery, and
  forcing it everywhere adds ceremony without benefit for those cases.
