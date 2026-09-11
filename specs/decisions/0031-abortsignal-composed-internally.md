# 0031: `AbortSignal` is composed internally and always supplied to `execute`; the runtime never auto-aborts by default

## Status

Accepted. Implemented in `src/runtime/abort.ts` (`composeSignals`,
`rejectOnAbort`).

## Context

Cancellation in this system has two different scopes that must not be
conflated: a single _caller's_ own wait for a result (which they may
legitimately want to give up on, e.g. a component unmounting) versus the
_shared underlying work_ a coordinator-deduped call represents (which
other callers may still be waiting on, and shouldn't be cancelled just
because one caller gave up — see ADR 0028's dedup design, and
`test/integration/coordinator/coordinator-dedup/`'s explicit demonstration of this).

## Decision

Every `execute`/`subscribe` function always receives a real `AbortSignal`,
composed internally from whatever cancellation sources are actually in
play for that call (`composeSignals`), so application code never has to
construct its own. `rejectOnAbort` wraps a caller's own wait so that
_their_ abort rejects _their_ returned promise without touching the
underlying execution any other caller might still depend on. The runtime
itself never aborts an operation automatically by default — cancellation
is always something an application (or a caller's own explicit signal)
initiates, never something this package decides to do on the
application's behalf (e.g. on a timeout it invented).

## Consequences

- `execute`/`subscribe` implementations can always assume a real signal is
  present and wire it straight into whatever underlying API they call
  (`fetch(url, { signal })`, a database driver's own cancellation token).
- One caller aborting never silently cancels work another caller is still
  relying on — the exact property `test/integration/coordinator/coordinator-dedup/`'s
  "per-caller abort never cancels the shared underlying work" scenario
  demonstrates directly.
- No surprise auto-cancellation (e.g. an undocumented default timeout) can
  ever explain an operation failing — if something aborted, an
  application (or its own explicitly-passed signal) did it.

## Alternatives considered

- **A default timeout that auto-aborts a slow operation.** Rejected — an
  invented default timeout is itself a policy this package has no basis
  to choose correctly for every application (exactly the class of
  decision ADR 0023 avoids elsewhere); an application that wants a
  timeout composes it itself via its own signal.
- **Requiring application code to construct its own `AbortController` for
  every operation, with no internal composition.** Rejected — would push
  the coordinator-sharing-safe composition logic (per-caller vs. shared
  scope) onto every call site instead of providing it once, correctly,
  centrally.
