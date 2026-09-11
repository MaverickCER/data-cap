# 0013: A thrown processor is a hard, whole-operation failure — never conflated with per-field shape validation

## Status

Accepted. Implemented conceptually in `src/core/ownership.ts`'s design
(the operation-wiring layer that calls a processor and catches its throw
is application-level — see `test/integration/runtime-core/basic-standalone/`).

## Context

A processor can fail in two structurally different ways: it can _throw_
(a genuine, unrecoverable error — a malformed response the processor
can't even begin to interpret, a thrown assertion), or it can _return_ a
value that's individually wrong in a recoverable way (ADR 0012's
per-field shape mismatch). These need different handling — a thrown
processor has produced no patch at all, so there is nothing to
partially salvage; a returned-but-partially-wrong patch has real, usable
data sitting right next to the bad part.

## Decision

A thrown processor is always evaluated first and is always a whole-
operation failure — the operation's `info` reflects an error status
(ADR 0016's state machine), and no patch is applied at all. It is never
conflated with the leaf-level reset-to-default handling ADR 0012
describes for a processor's _returned_ value; those two failure modes
stay categorically separate at every layer that touches them.

## Consequences

- An application wiring a getter/mutator (see `test/integration/runtime-core/basic-standalone/`
  for the pattern) can rely on a simple two-branch shape: catch the
  processor's throw for a whole-operation error commit; otherwise, trust
  that a returned patch has already had its individual fields validated
  and defaulted per ADR 0012.
- A thrown processor never partially applies — there is no risk of a
  half-committed patch from an operation that failed outright.
- Distinguishing these two failure modes keeps error messages honest: "the
  processor itself failed" reads differently from "the processor
  succeeded, but one field it returned was shaped wrong."

## Alternatives considered

- **Treating a thrown processor the same as a per-field shape mismatch**
  (i.e. reset whatever fields it was _supposed_ to own to their defaults,
  as if it had returned an empty/invalid patch). Rejected — a thrown
  processor has produced no evidence about which specific fields would
  have been affected; guessing "reset everything it might have touched"
  risks silently discarding fields the processor never actually intended
  to touch this time.
- **Swallowing the throw and treating it as a no-op.** Rejected — a
  genuine processor failure should be visible (via `info`'s error state),
  not silently absorbed as if nothing happened.
