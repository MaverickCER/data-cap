# 0035: The optional cache persists complete `DataState` (fields + info) atomically, never fields alone and never raw responses

## Status

Accepted. Implemented in `src/runtime/cache.ts` (`DataCache<TFields>`).
Demonstrated directly in `test/integration/runtime-modules/runtime-cache/`.

## Context

`runtime/cache`'s whole purpose is answering "is validated state already
available" for a given key — but if it persisted `fields` alone (or a raw,
unprocessed response), a cache hit would hand back real-looking data with
no corresponding `info`, leaving a consumer to incorrectly believe
`status` is still `"idle"`/unknown for data that's actually right there.
This is the exact same atomicity hazard ADR 0008 addresses for a live
store, applied to a persisted cache entry instead.

## Decision

`DataCache<TFields>.set(key, state)` takes a full `DataState<TFields>` —
`fields` and `info` together, exactly as produced by a real `commitState`
call — and `.get(key)` returns that same complete pair or nothing at all.
There is no API surface for storing `fields` alone, and the cache never
stores a raw, unvalidated response value (that's what a getter's
`execute`/`processor` pipeline is for, upstream of ever reaching the
cache).

## Consequences

- A cache hit is indistinguishable, from a consumer's perspective, from a
  freshly-committed real state — both are coherent `{ fields, info }`
  pairs a consumer can trust equally.
- The cache stays a genuinely separate concern from `coordinator.dedupe`
  (ADR 0028): a cache answers "validated state is already available,"
  dedup answers "don't start a second identical request" — mechanically
  distinct, even when an application uses both together for the same
  operation.
- Because the cache never stores raw responses, an application can't
  accidentally bypass its own processor/ownership validation logic by
  reading straight from the cache — everything in it already went through
  the real commit pipeline once.

## Alternatives considered

- **Caching `fields` alone (info reconstructed lazily on cache hit).**
  Rejected — reconstructing plausible `info` after the fact risks
  producing metadata that doesn't accurately reflect the real operation
  that originally produced the cached value.
- **Caching the raw, pre-processor response, re-running the processor on
  every cache hit.** Rejected — reintroduces per-hit processing cost the
  cache exists to avoid, and risks a processor's behavior changing between
  cache-write and cache-read time producing an inconsistent result.
