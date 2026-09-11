# 0009: `fields` stay ordinary arrays; only `info` represents array items as identity-keyed maps

## Status

Accepted. Implemented in `src/core/types.ts` (`DataInfo<T>`'s array
branch), `src/core/identity.ts`.

## Context

`info` needs to track per-item metadata for an array field (e.g. each
comment's own `status`/`source`), but an array's own natural
representation (index-ordered) is exactly the wrong key for metadata that
must survive insertion, removal, and reordering — an index shifts, so
index-keyed metadata silently reattaches to the wrong item the moment the
array changes shape. `fields` itself, though, has no such problem: it's
ordinary application data an array-typed field, and consumers already
expect to iterate/map/index it like any other JS array.

## Decision

`data.fields.comments` stays a plain `Comment[]` — ordinary array
semantics, no wrapper. `data.info.comments`, by contrast, is `Partial<
Record<IdentityKey, DataInfo<Comment> & FieldInfo>>` — a map keyed by each
item's declared identity (ADR 0018), not by array index. `info`'s
structure only needs to mirror `fields`' _logical_ structure (one info
slot per array item), not its runtime representation.

## Consequences

- Application code reading `fields.comments` never needs to know
  data-cap's identity scheme exists — it's exactly the array the
  application declared.
- Metadata for one specific comment survives reference-stably (ADR 0010)
  across a refetch that reorders or partially updates the list, because
  the metadata's key is the comment's own identity, not its position.
- An array field with no declared identity gets no per-item `info` at all
  (ADR 0020) — this decision only applies once identity is declared;
  otherwise there is nothing yet to key by.

## Alternatives considered

- **Index-keyed `info` for arrays.** Rejected — the exact fragility this
  decision exists to avoid: any insertion/removal/reorder silently
  reattaches metadata to the wrong item, an easy-to-miss bug class.
- **Wrapping `fields` array items in an identity-aware structure too** (so
  `fields` and `info` share one representation). Rejected — this would
  leak data-cap's own bookkeeping into `fields`, breaking ADR 0003's
  "fields are the actual application data shape, no wrapper" guarantee for
  every array-typed field.
