# 0028: Coordinator dedup key is function identity + canonicalized params; non-canonicalizable input degrades to no-dedup

## Status

Accepted. Implemented in `src/runtime/coordinator.ts` (`dedupe`), using
`src/core/canonicalize.ts` (ADR 0019).

## Context

Deduplicating concurrent calls requires deciding when two calls "are the
same request." Comparing by function identity alone would incorrectly
dedupe `fetchUser("1")` and `fetchUser("2")` together; comparing by
structural param equality alone (ignoring which function is being called)
would incorrectly dedupe two _different_ functions that happen to be
called with the same params. Either mistake produces a silently wrong
result — either a missed real request, or two unrelated requests
collapsed into one.

## Decision

The dedup registry is a `WeakMap<Function, Map<canonicalParamsKey,
entry>>` — keyed first by the calling function's own identity (never
structural/behavioral equality — the same principle ADR 0026 applies to
subscription sharing), then by the canonicalized params (ADR 0019). A
params value that can't be canonicalized (a function, a symbol, a cyclic
reference) simply never dedupes — the call always runs fresh, rather than
risking a false collision between two params that happen to canonicalize
identically due to a degraded fallback.

## Consequences

- Two calls to the _same_ function with the _same_ (canonicalizable)
  params reliably dedupe onto one in-flight promise, regardless of how
  complex the params object is.
- Two calls that merely _look_ similar but differ in function identity or
  in even one canonicalizable param detail never incorrectly collapse
  together.
- A caller passing a non-canonicalizable param (uncommon, but not
  prevented) gets a functioning, if less-optimized, fallback — the
  operation still runs correctly, it just doesn't benefit from dedup for
  that particular call.

## Alternatives considered

- **Structural/behavioral function equality instead of reference
  identity.** Rejected — two functions with identical source code are
  still meant to be treated as distinct call sites unless a developer
  deliberately shares one reference; inferring "these are the same" from
  behavior would be exactly the kind of implicit magic ADR 0027 avoids.
- **A hash-based key that tolerates non-canonicalizable input (e.g. via
  `String(value)` for anything that can't be canonicalized properly).**
  Rejected — risks silent false collisions (two structurally different
  functions/symbols stringifying to the same text) for a marginal dedup
  benefit; degrading to "never dedup" for that case is strictly safer.
