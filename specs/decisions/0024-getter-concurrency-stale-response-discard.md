# 0024: Getter concurrency: stale-response discard scoped to per-getter-function-identity start sequence, applied atomically

## Status

Accepted. Design decision governing how an application wires a getter's
own re-fetch handling (see `test/integration/runtime-core/basic-standalone/`'s `runGetUser`
pattern); the atomicity half is enforced by `commitState` (ADR 0008).

## Context

A getter can be re-triggered before its previous call has resolved (a
user navigating away and back quickly, a rapid refetch). If the _older_
call resolves after the newer one, committing its (now-stale) result would
overwrite the newer, more-current data with something older — a real,
easy-to-hit bug in naive fetch-and-commit code.

## Decision

Stale-response discard is scoped to a per-getter-function-identity start
sequence: each new call to the same getter (the same `execute` function
reference) increments a sequence number; a call's result is only committed
if its sequence number is still the most recent one issued for that
identity at the time it resolves. Because every commit goes through
`commitState` (ADR 0008), this protects the _entire_ atomic snapshot
(`fields` and `info` together) — a stale getter's commit is simply never
made at all, once a newer call for that identity has already committed;
there is no separate special case needed for `info` alone.

## Consequences

- A rapid double-navigation (or any other rapid re-trigger) can never
  result in older data winning over newer data, regardless of which
  network response happens to arrive last.
- The discard check is local to one getter's own call sequence — it never
  needs to reason about unrelated getters or mutators, keeping the
  mechanism simple to reason about and implement per operation.
- Because stale-discard is a "just don't commit" decision, it composes for
  free with everything else built on top of `commitState`'s atomicity —
  no separate mechanism was needed to make it apply to `info` too.

## Alternatives considered

- **Cancelling the older in-flight request instead of discarding its
  result.** Rejected as the _sole_ mechanism — cancellation (via
  `AbortSignal`, which this design does support for other reasons) is a
  real optimization but doesn't by itself guarantee correctness if a
  cancellation races the response; discard-by-sequence-number is the
  correctness guarantee, with cancellation as an available efficiency
  layer on top.
- **A global "only ever one in-flight getter at a time" lock.** Rejected —
  unnecessarily serializes genuinely independent getters (different
  fields, different function identities) that have no correctness reason
  to wait on each other.
