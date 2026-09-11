# 0022: A completing operation's processor always receives current authoritative state, never a stale start-time snapshot

## Status

Accepted. Implemented in `src/runtime/store.ts`
(`commitAuthoritative` always reads the store's live `authoritativeState`
at commit time, not a value captured when the operation began).

## Context

An operation (getter or mutator) can take real time to complete, during
which the authoritative state it will eventually commit against may have
already changed — another operation may have completed first. If a
completing operation's processor received the state as it was when the
operation _started_, a slow operation finishing after a fast, unrelated
one would silently overwrite that faster operation's contribution with a
patch computed against outdated assumptions.

## Decision

Whenever an operation commits, `commitAuthoritative` folds its patch onto
whatever `authoritativeState` currently _is_, at commit time, unconditionally
— never a snapshot captured when the operation began. This applies
uniformly to getters, mutators, and subscription-driven commits; there is
no separate code path that special-cases "this operation started before
another one."

## Consequences

- Two concurrent operations against unrelated fields never clobber each
  other's contributions, regardless of which one started first or took
  longer — the concurrency scenario ADR 0021's `project()` model, applied
  to authoritative commits too, makes correct by construction.
- Two concurrent operations against the _same_ field still resolve by
  completion order (ADR 0025) — this decision doesn't invent a
  conflict-resolution policy (ADR 0023 covers that explicitly), it just
  ensures every commit is computed against reality, not against
  potentially-stale assumptions.
- An operation's own processor logic never needs to defend against "is my
  captured starting state still current" — it's a non-issue, since nothing
  captures a starting-state snapshot for this purpose in the first place.

## Alternatives considered

- **Commit against a snapshot captured when the operation started.**
  Rejected — this is exactly the bug this decision prevents: a slow
  operation's eventual commit would silently discard whatever changed
  while it was in flight.
- **Detect "the state changed since I started" and reject/retry the stale
  commit.** Rejected as unnecessary complexity — folding onto current
  state, unconditionally, already produces the correct result for
  unrelated fields without needing a conflict-detection mechanism at all.
