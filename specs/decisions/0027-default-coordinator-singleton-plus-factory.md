# 0027: The default coordinator is a module-level singleton; explicit isolation is available via `createCoordinator()`

## Status

Accepted. Implemented in `src/runtime/coordinator.ts`
(`defaultCoordinator`, `createCoordinator()`). Demonstrated directly in
`test/integration/coordinator/coordinator-dedup/` (the singleton) and
`test/integration/coordinator/coordinator-isolation/` (the factory, in a server-side
multi-tenant pattern).

## Context

Sharing dedup/subscription work across independently-created `DataStore`s
that logically belong to the same application only works if they actually
agree on a coordinator instance — but some applications (multi-tenant
server processes, test isolation) need the _opposite_: two logical domains
that must never accidentally share work, even if they happen to call the
exact same function with the exact same parameters.

## Decision

`defaultCoordinator` is a module-level singleton, used implicitly by
anything that doesn't request otherwise — this is what lets independently
created stores within one application share dedup/subscription work
without every call site having to explicitly wire a coordinator through.
`createCoordinator()` is an explicit, opt-in factory for an isolated
coordination domain, passed in wherever an application specifically needs
one (see `test/integration/coordinator/coordinator-isolation/`'s multi-tenant pattern).
Isolation is always requested this way — explicitly, via the factory —
never inferred from function identity or syntax, which remains solely the
_intra_-coordinator sharing boundary (ADR 0028), unrelated to this
decision.

## Consequences

- The common case (one application, implicit sharing) requires zero
  coordinator-wiring boilerplate — `defaultCoordinator` is used
  automatically.
- A multi-tenant server can give each tenant its own coordination domain
  explicitly, with a one-line `createCoordinator()` call per tenant,
  without that isolation being accidentally bypassable by two tenants
  happening to call the same underlying function.
- The dual-package hazard (ADR 0041) is a direct, understood consequence
  of this decision's module-singleton half — the tradeoff is deliberate,
  not overlooked.

## Alternatives considered

- **No default singleton — every `DataStore` requires an explicit
  coordinator.** Rejected — adds boilerplate to the common single-tenant
  case for a safety property (explicit isolation) that case doesn't need.
- **Isolation inferred from some other signal** (e.g. a naming convention,
  or automatic per-request isolation in a server context). Rejected —
  implicit isolation is exactly the kind of "magic" this design avoids
  elsewhere (ADR 0002's static-analysis-only stance, ADR 0023's no-
  invented-policy stance); an application that needs isolation should
  state that explicitly.
