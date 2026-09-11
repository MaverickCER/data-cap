# 0016: `status: DataStatus` follows an explicit state machine; `"retrying"` is distinct from `"loading"`

## Status

Accepted. Implemented in `src/core/types.ts` (`DataStatus`).

## Context

`status` needs to answer more than "is this loading or not" — a consumer
building a real UI wants to distinguish "first attempt in flight" (show a
spinner) from "recovering after a failure" (perhaps show a subtler
"reconnecting…" indicator instead), and needs `success` to mean something
concrete and comparable across a field's whole lifecycle, including
refetches.

## Decision

`DataStatus = "idle" | "loading" | "success" | "error" | "retrying"`, with
an explicit, defined transition set:

```
idle → loading → success
success → loading → success                       (refetch / re-run)
loading | success → error                          (operation fails)
error → retrying → (loading | success | error)      (opt-in retry policy only)
```

`"retrying"` only ever appears as a consequence of an application's own
opt-in retry policy (`runtime/retry`, ADR 0036) — a plain failed operation
with no retry configured goes straight to `"error"` and stays there.

## Consequences

- A consumer can render "recovering from a failure" differently from "the
  very first load," a real, common UI distinction this design makes
  representable without inventing an ad hoc extra flag.
- The state machine is small enough to reason about exhaustively — every
  transition an application might observe is one of the five listed
  above, nothing implicit.
- Because `"retrying"` only appears via an explicit retry policy, a field's
  status history is a direct, honest reflection of what actually happened
  to it — no false "it's retrying" implied for an operation that simply
  hasn't been configured to retry.

## Alternatives considered

- **A simple boolean `loading`/`error` pair instead of a `status` enum.**
  Rejected — can't represent "retrying" distinctly from "loading," and
  can't represent "idle" (never yet run) distinctly from "not currently
  loading" (has run, succeeded or failed).
- **Modeling retry attempts as a numbered sub-state** (e.g.
  `"retrying-2"`). Rejected — the attempt count, when relevant, belongs in
  `runtime/retry`'s own policy configuration/callbacks, not smuggled into
  the status string itself.
