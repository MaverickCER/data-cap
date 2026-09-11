# 0030: An optional `recover` resync runs the ordinary getter pipeline once per reconnect gap; races resolve via ordinary atomic commit ordering

## Status

Accepted. Demonstrated directly in `test/integration/subscriptions/subscription-with-recover/`.

## Context

A subscription that disconnects and reconnects may have missed events
during the gap. Some applications want a way to resync after such a gap;
inventing a guaranteed-consistent "replay missed events" mechanism would
require the transport itself to support replay (most don't, and this
package has no transport-specific knowledge to build one against) and
would silently overpromise a guarantee this package can't actually keep
for an arbitrary transport.

## Decision

An optional `recover` getter (application-level, not a built-in
mechanism) runs the _ordinary_ getter pipeline exactly once per
reconnect-after-a-gap, to fetch the current value directly rather than
trying to replay what was missed. If a live subscription event arrives
around the same time as `recover`'s own response, both simply commit
through the same ordinary atomic `commitState` path (ADR 0008), in
whatever order they actually resolve — there is no invented ordering
guarantee between them, matching ADR 0023's rejection of invented
conflict-resolution generally. Because every commit always folds onto
current authoritative state (ADR 0022), no update is silently lost even
without an ordering guarantee — see the example's own deterministic
demonstration of both possible orderings producing a correct, if
order-dependent, result.

## Consequences

- An application gets a documented, working way to resync after a gap
  (re-fetch current state) without this package pretending to solve
  event-replay for transports that don't support it.
- `recover` racing a live event never corrupts state — worst case, the
  visible value is whichever of the two legitimately-current answers
  committed last, not a torn or inconsistent one.
- Because `recover` is "just another getter," it inherits every other
  getter guarantee (stale-response discard, atomic commit) for free,
  without needing subscription-specific concurrency logic.

## Alternatives considered

- **A built-in event-replay mechanism.** Rejected — most transports don't
  support replay at all, and building one that only worked for the subset
  that do would be inconsistent, transport-specific complexity this
  package's transport-independence goal doesn't allow.
- **An enforced ordering guarantee (e.g. "recover always wins" or "live
  events always win") between `recover` and a racing live event.**
  Rejected — an enforced priority is itself an invented policy (exactly
  what ADR 0023 rejects generally), and neither direction is correct for
  every application's data.
