# 0014: `FieldInfo` represents current authoritative execution metadata, never an event history; `source` is the operation key

## Status

Accepted. Implemented in `src/core/types.ts` (`FieldInfo`).

## Context

Multiple operations can establish the same field's value over its
lifetime — a `getUser` getter populates `user`, later an `updateUser`
mutator changes it, later a subscription event updates it again. A design
that accumulated a log of every past transition would grow unboundedly
and force every consumer to decide for themselves "which entry is the
current one" — exactly the question `FieldInfo` exists to answer directly.

## Decision

`FieldInfo.status`/`source`/`error`/`fetchedAt`/`updatedAt` always reflect
only the _most recent_ relevant transition — never an array or log of past
operations. `source` is formally the operation key (the getter/mutator/
subscription name as declared in `createData`'s config, e.g. `"getUser"`)
that most recently established the field's current value — provider-level
detail (which upstream endpoint, which table) is a `documentData`/
documentation concern, never conflated with this execution-source field.

## Consequences

- Reading `info.<field>.status` never requires reducing over a history —
  it's always already the answer to "what's the current state of this
  field."
- Memory usage for `info` stays bounded regardless of how many times a
  field has been re-fetched or re-mutated over an application's lifetime.
- An application that _does_ want a history (e.g. an audit log) builds it
  itself, from its own subscription to state changes — this package
  deliberately doesn't attempt to be that history's source of truth.

## Alternatives considered

- **An array of past transitions per field.** Rejected — unbounded growth,
  and pushes the "which one is current" question onto every consumer
  instead of answering it once, centrally.
- **`source` naming the upstream provider/endpoint instead of the local
  operation key.** Rejected — conflates two different kinds of
  information (which of _this capability's own_ declared operations ran,
  versus which external system it happened to call) and duplicates what
  `documentData` already exists to record about a getter/mutator/
  subscription's own provider details.
