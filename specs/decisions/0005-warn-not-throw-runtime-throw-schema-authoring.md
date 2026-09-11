# 0005: Warn (never throw) for runtime ownership/shape violations; throw only for schema-authoring mistakes

## Status

Accepted. Implemented in `src/core/ownership.ts`, `src/core/schema.ts`,
`src/core/errors.ts`.

## Context

Two different categories of "wrong" arise in this system, at two different
times. A **schema-authoring mistake** — a function-valued field default, a
cyclic default — is a bug in the code declaring the capability, caught
once, synchronously, at `createData()` call time, before any data has
flowed anywhere. A **runtime ownership/shape violation** — a processor
returning a field it doesn't own, or a value that doesn't match its
schema's shape — happens later, potentially in production, against live
(if malformed) data from a real getter/mutator/subscription response.
Treating both the same way (always throw, or always warn) fits neither
case well.

## Decision

Schema-authoring mistakes throw synchronously, at `createData()` call
time (`InvalidFieldDefaultError`) — these are always fixable by the
developer, before ship, and a throw is the fastest possible feedback.
Runtime ownership/shape violations never throw the whole operation:
an unowned key is dropped with a dev-mode warning identifying
`{operation, path, reason}` (never the offending value itself, so a
warning is never a place a secret leaks); an individually-invalid
processed field resets to its own schema default (ADR 0012) and the rest
of the operation's otherwise-valid output still commits.

## Consequences

- A misbehaving upstream API (a getter's raw response missing a field, or
  returning the wrong shape) degrades to "that one field resets to its
  default, with a diagnosable warning" rather than crashing the whole
  operation or corrupting `fields` with a malformed value.
- A schema-authoring mistake is caught at the earliest possible moment
  (module load, in development, via a stack trace pointing at the
  `createData()` call) rather than surfacing later as a confusing runtime
  symptom.
- A thrown _processor_ (as opposed to a shape mismatch in its otherwise-
  returned value) remains a hard, whole-operation failure (ADR 0013) —
  this decision is specifically about shape/ownership violations in a
  processor's returned value, not about the processor itself throwing.

## Alternatives considered

- **Always throw on any violation, runtime or schema-authoring.** Rejected
  — a single malformed field in an otherwise-good getter response would
  crash the whole operation, discarding valid sibling data for no benefit.
- **Always warn, even for schema-authoring mistakes.** Rejected — a
  function-valued field default is never valid under any circumstance;
  continuing past it (with some placeholder value) would hide a real bug
  behind confusing downstream symptoms instead of failing where the
  mistake actually is.
