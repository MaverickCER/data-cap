# 0010: `DataInfo` array reconciliation is identity-diffed, never a full teardown-and-rebuild

## Status

Accepted. Implemented in `src/core/identity.ts` (`reconcileArrayInfo`).
Supersedes an earlier draft that rebuilt an array field's entire `info`
map on every replacement.

## Context

A getter refetching a list (e.g. comments on a post) typically returns a
mostly-unchanged array with a handful of new/edited items. If `info` for
that array were fully rebuilt on every commit, every untouched item's
metadata object would get a new reference each time — breaking reference
equality checks a consumer (e.g. a memoized list-row component) relies on
to skip re-rendering unchanged rows, and doing real allocation work for
data that didn't actually change.

## Decision

`reconcileArrayInfo(prevInfo, nextItems, identityKeys, touchedIdentities,
makeInfoFor)` recomputes an array field's `info` map by diffing against
the previous one: an identity present in `touchedIdentities` (or when
`touchedIdentities === "all"`) gets a freshly built `FieldInfo`; every
other identity still present in `nextItems` **keeps its previous
`FieldInfo` object reference exactly** — not a structurally-equal copy,
the same reference. An identity no longer present in `nextItems` is
dropped (no orphaned entries). This is a release-blocking performance
invariant, tested directly against `next.info.comments["1"] ===
previous.info.comments["1"]` after a commit that only touches a different
item.

## Consequences

- A list re-render triggered by one item's update never forces every
  sibling row to re-render too, when the consuming framework's own
  re-render logic is keyed off reference equality (React, and most
  virtual-DOM frameworks, are).
- Reconciliation cost is proportional to the array's size (one identity
  computation per item) but allocation cost is proportional only to what
  actually changed — the same "amortize by what changed" story ADR 0044's
  freeze mechanism tells for the rest of `DataState`.
- A duplicate identity across two items is not an error: both items stay
  in `fields` untouched, but they share one `info` slot (last-encountered
  wins), recorded as a warning rather than silently ignored or thrown.

## Alternatives considered

- **Full rebuild on every commit** (the design this ADR supersedes).
  Rejected once the reference-stability requirement was identified —
  correct in isolation, but defeats memoization for every consumer keying
  render decisions off `info` object identity.
- **A separate explicit "which items changed" parameter the caller must
  compute and pass, with no default.** Rejected as the _sole_ API — an
  explicit `touchedIdentities` set already covers precise cases; `"all"`
  remains available for a genuinely full replacement (e.g. the very first
  population) without forcing every caller to hand-compute a diff it
  doesn't have yet.
