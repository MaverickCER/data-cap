# 0008: `fields` and `info` are always committed and published as one atomic snapshot

## Status

Accepted. Implemented in `src/core/patch.ts` (`commitState`),
`src/runtime/store.ts`.

## Context

With `info` mandatory (ADR 0007), a real hazard opens up: if `fields` and
`info` could ever be updated through two separate calls or in two separate
ticks, a subscriber could observe `{ newFields, oldInfo }` — a real,
successfully-fetched value paired with a stale `status: "loading"` — or
the reverse. This is worse than either half being wrong alone, since it
actively misleads a consumer about whether a value is trustworthy yet.

## Decision

`commitState(prev, fieldsPatch, infoPatch)` is the single sanctioned way to
transition a `DataState`, and it always produces the next `{ fields, info
}` pair as one atomic object in one call. No runtime code path (`store.ts`,
the initial `createData()` build) may update `fields` and `info`
independently. If the resulting `fields` and `info` are both
reference-equal to `prev`'s own (nothing actually changed), `commitState`
returns `prev` itself unchanged — see ADR 0042's no-op suppression, which
this atomicity makes a single reference comparison instead of two.

## Consequences

- A subscriber can never observe a torn/inconsistent snapshot — every
  `getSnapshot()` call returns a `{ fields, info }` pair that was
  published together, by construction, not by convention.
- Getter/mutator/subscription concurrency correctness (stale-response
  discard, ADR 0024) falls out of this for free: a stale operation's
  `commitState` call is simply never made once a newer one has already
  committed, protecting both halves of the snapshot together automatically
  rather than needing a separate special case for `info`.
- Every other atomicity-adjacent guarantee in this design (structural
  sharing, ADR 0044's amortized freeze) is built on top of `commitState`
  being the one chokepoint — a new code path that bypasses it would need
  its own atomicity proof from scratch.

## Alternatives considered

- **Two separate commit calls, one per half, in immediate succession.**
  Rejected — "immediate succession" is not atomic; a subscriber notified
  between the two calls (or an implementation that later becomes async)
  would see exactly the torn state this decision exists to prevent.
- **A transaction/batching API a caller must remember to use correctly.**
  Rejected — correctness should not depend on every call site
  remembering to opt into atomicity; making the single commit primitive
  the _only_ way to transition state removes the possibility of forgetting.
