# 0015: `error` is the latest relevant error only, never a history/array

## Status

Accepted. Implemented in `src/core/types.ts` (`FieldInfo.error: DataError
| undefined`).

## Context

Following directly from ADR 0014's "current metadata, not history"
principle, `error` specifically needs its own stated rule, since errors
are the one piece of `FieldInfo` most tempting to accumulate (each retry
attempt, each failed operation) for debugging purposes.

## Decision

`info.<field>.error` is `DataError | undefined`, never `DataError[]`. It
clears (`undefined`) on the next successful operation that establishes
that field — unless a still-newer operation has since set a _different_
error, following the same "most recent transition wins" rule ADR 0014
states generally. `DataError` itself is `{ operator: string; error:
unknown }` — the operation key that failed, plus the raw error value —
never a formatted message string, so an application can still inspect the
real underlying error object.

## Consequences

- `info.<field>.error !== undefined` is always a reliable, current signal
  — "this field's most recent relevant operation failed" — never stale
  evidence of a since-resolved problem.
- No unbounded growth from repeated failures (e.g. a flaky network
  connection retried many times over a session).
- An application wanting error _history_ for logging/telemetry purposes
  must capture it itself, at the point an operation's commit sets the
  error — the same boundary ADR 0014 draws for `FieldInfo` generally.

## Alternatives considered

- **An array of every error since the capability was created.** Rejected
  — same unbounded-growth and "which one matters" problems ADR 0014
  rejects for `FieldInfo` generally, and error objects in particular can
  be large (stack traces, response bodies).
- **Clearing `error` unconditionally on ANY subsequent commit, success or
  not.** Rejected — would incorrectly clear a real, still-current error if
  an unrelated operation happens to commit against the same field's info
  branch afterward without actually resolving the failure.
