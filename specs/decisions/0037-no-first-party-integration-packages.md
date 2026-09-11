# 0037: No first-party integration/adapter packages ship — patterns live in reference projects only

## Status

Accepted. Implemented by omission (no `./tanstack`, no `./socket-io`, no
`src/integrations/` folder) and by presence
(`test/integration/adoption-patterns/tanstack-query-integration/`,
`test/integration/subscriptions/socket-io-subscription/`).

## Context

Wiring data-cap's store/coordinator to a specific transport (Socket.IO, a
raw WebSocket) or a specific state-fetching library (TanStack Query) is
exactly the kind of integration surface where different applications
reasonably want different tradeoffs — retry/caching policy already
provided by TanStack Query versus data-cap's own `runtime/retry`/`runtime/
cache`, a Socket.IO client's own reconnection behavior versus a custom
one. A single first-party adapter package would have to pick one set of
tradeoffs and impose it, or grow configuration options trying not to.

## Decision

No `./tanstack`, no `./socket-io`, and no `src/integrations/` folder ship
at all. Instead, `test/integration/` contains full, runnable reference
patterns (`adoption-patterns/tanstack-query-integration/`,
`subscriptions/socket-io-subscription/`) that an application copies and
adapts directly — explicitly designed, per the
user's own framing of this decision, so "juniors can copy the logic
directly and seniors can make their own tradeoffs on the implementation."

## Consequences

- data-cap's own dependency footprint never grows to include a specific
  transport or fetching library's SDK, keeping the core/runtime/helpers
  entries genuinely dependency-free.
- An application isn't locked into this package's own opinions about how
  TanStack Query or Socket.IO _should_ be wired — the example is a
  starting point, not an abstraction to work around when the default
  choice doesn't fit.
- The examples still get the same end-to-end regression testing every
  other example in this directory does (real installs, real assertions,
  golden output) — "not a shipped package" doesn't mean "untested," it
  means the pattern is proven correct without becoming an API surface this
  package has to maintain compatibility for indefinitely.

## Alternatives considered

- **Shipping `./tanstack` and `./socket-io` adapter packages.** Rejected —
  locks the package into specific major-version compatibility commitments
  for libraries it doesn't control, and forces every application into one
  opinionated wiring shape regardless of whether it fits their actual
  tradeoffs.
- **A generic, pluggable adapter interface applications implement
  against.** Rejected as unnecessary abstraction — the actual wiring code
  (see either example's `src/main.ts`) is short and specific enough that a
  generic interface would add indirection without saving meaningful code.
