# 0026: Subscription transport sharing is independent of field-state and processor sharing — only the transport is ever shared

## Status

Accepted. Implemented in `src/runtime/coordinator.ts`
(`acquireSubscription`). Demonstrated directly in
`test/integration/subscriptions/multi-capability-shared-transport/`.

## Context

Two capabilities might legitimately want to share one underlying
connection — e.g. one WebSocket carrying a price feed that both a "price
in USD" capability and a "price in cents" capability care about — without
that sharing implying anything about how each capability processes what
arrives, or that they should share state at all. Conflating "share the
connection" with "share the processing/state" would force an application
into an all-or-nothing choice it shouldn't have to make.

## Decision

`coordinator.acquireSubscription(subscribeFn, handlers)` ref-counts and
shares _only_ the transport, keyed by `subscribeFn`'s own function
identity: the first acquirer actually opens the connection; later
acquirers with the same identity reuse it. Each acquirer supplies its own
`handlers` (its own `onEvent`/`onStatusChange`), so each capability still
runs its own processor against its own `DataStore` — no shared
`authoritativeState`, no shared `pendingTransitions`, no shared processing
logic, ever. The one thing genuinely shared is the underlying connection
itself.

## Consequences

- Two capabilities sharing a data source (a single WebSocket, a single SSE
  stream) never open two redundant connections for it, without being
  forced to also share how they interpret the same event.
- Each capability's state remains fully independent and testable in
  isolation, even when its underlying transport happens to be shared with
  something else.
- Because sharing is scoped to `subscribeFn`'s identity alone (ADR 0028's
  same principle, applied here), two capabilities that happen to want
  _different_ transport instances (different function references, even if
  behaviorally identical) simply don't share — sharing is always explicit,
  via identity, never inferred from behavior.

## Alternatives considered

- **Sharing state alongside the transport when two capabilities acquire
  the same subscription.** Rejected — conflates two genuinely independent
  concerns (connection lifecycle vs. application state) and would force
  every transport-sharing capability into a single shared state shape,
  defeating the point of having separate capabilities in the first place.
- **No transport sharing at all — every capability opens its own
  connection.** Rejected — wastes real resources (redundant connections)
  for the common case of multiple capabilities legitimately watching one
  upstream feed.
