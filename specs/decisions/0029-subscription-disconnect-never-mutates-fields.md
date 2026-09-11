# 0029: A subscription disconnect never mutates `fields`, only `info.<field>.subscription`

## Status

Accepted. Design decision governing subscription-status commits (see
`test/integration/subscriptions/socket-io-subscription/`'s `onStatusChange` handler, which
commits only an `info` patch, never a `fields` patch, for a status
transition).

## Context

A subscription losing its connection is a transport-level event, not a
data event — the last known value a subscription delivered is still the
last known value; a disconnect doesn't mean that value became wrong or
stale in a way that should be represented by clearing or resetting it.
Committing `fields` to some placeholder on disconnect would actively
discard real, still-valid data for no reason connected to the data itself.

## Decision

A `connecting`/`connected`/`reconnecting`/`disconnected`/`error` status
transition, on its own, commits only against `info.<field>.subscription`
(a `SubscriptionInfo`) — never against `fields`. `fields` only ever
changes in response to an actual event carrying real data, processed
through the ordinary getter/mutator/subscription pipeline.

## Consequences

- A brief network blip never causes a consumer-visible "the data
  disappeared" flash — the last good value stays exactly where it was,
  with only the connection-status metadata reflecting the disconnect.
- An application can render connection health (a "reconnecting…" banner)
  entirely from `info.<field>.subscription`, independently of whatever the
  current `fields` value happens to be.
- This is exactly why decision ADR 0007 needed `info` to be mandatory in
  the first place — a transport-status-only commit is a real, meaningful
  state transition with nowhere else to live if `info` were optional or
  absent.

## Alternatives considered

- **Resetting the field to its schema default on disconnect.** Rejected —
  discards real, still-potentially-valid data for a transport-level event
  that says nothing about whether the last known value is actually wrong.
- **Marking the field's data as stale (a boolean) automatically on
  disconnect.** Considered, but left as an existing `FieldInfo.stale?:
boolean` property an application (or a future `recover` mechanism, ADR 0030) can set deliberately — not something this decision mandates
  happen automatically on every disconnect, since not every disconnect
  actually implies the data is now stale (e.g. a fast reconnect might
  never have missed anything).
