# 0025: Mutator concurrency: completion-order fold, regardless of start order

## Status

Accepted. Direct consequence of ADR 0022 (completing operations always
commit against current state) applied specifically to mutators.

## Context

Unlike a getter (which typically replaces a field wholesale with fresh
data), a mutator's concurrency story matters most when two mutations touch
either overlapping or entirely independent fields at once — the
optimistic-mutation-concurrency scenario this package's own test suite and
`test/integration/runtime-core/optimistic-mutation-concurrency/` exercise directly: mutation A
starts, mutation B starts, B completes first, A completes second.

## Decision

Mutators follow the same rule ADR 0022 establishes generally: whichever
mutation's `commitAuthoritative` call runs _last_, in real time, is what's
authoritative afterward — regardless of which one started first. For two
mutations touching unrelated fields, both contributions simply coexist
(each fold only changes the keys its own patch touches, per `patchInto`'s
structural merge). For two mutations touching the _same_ field, the later
commit's value wins — plainly, with no invented merge or precedence
beyond "later wins," matching ADR 0023's explicit rejection of a built-in
conflict-resolution policy.

## Consequences

- A slow mutation finishing after a fast, unrelated one never loses its
  own contribution — both are visible in the final state, each committed
  independently onto whatever was current at its own commit time.
- Two mutations racing on the _exact same_ field produce a predictable,
  auditable result (last commit wins) rather than a policy an application
  has to guess at or configure.
- This requires no mutator-specific code beyond what ADR 0022 and
  `commitState`'s atomicity already provide — completion-order behavior is
  the direct, automatic consequence of those two decisions, not a
  separate mechanism built specifically for mutators.

## Alternatives considered

- **Start-order-based resolution** (the first mutation to _start_ wins,
  regardless of completion order). Rejected — would require buffering or
  rejecting a later-starting mutation's result until an earlier one
  resolves, adding real complexity and latency for a guarantee ("start
  order matters") most applications don't actually need or want.
- **Locking a field for the duration of a mutation targeting it.**
  Rejected — serializes genuinely concurrent operations for a safety
  property (preventing a same-field race) that "last commit wins" already
  provides without blocking anything.
