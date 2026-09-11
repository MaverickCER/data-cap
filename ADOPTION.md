# Adoption guide

A direct, honest assessment for evaluating `data-cap` for real adoption —
what it solves, what it costs, and what's still an open question.

## What problem this solves

Multiple consumers of the same piece of data (several components, a client
and a server, several teams) tend to independently invent their own
loading/error/status bookkeeping around it — a `userLoading` boolean here,
a `userError` string there, each slightly different, none of them shared.
`data-cap` gives every consumer of a capability the same typed
`fields`/`info` shape, regardless of what actually fetches or mutates the
underlying data (a REST call, a database query, a WebSocket event, or a
mix of all three over a capability's lifetime).

Most data-fetching/state tooling solves an adjacent but different problem.
TanStack Query, SWR, RTK Query, and Apollo Client solve _fetching_ — request
dedup, caching, refetch/invalidation policy. Redux, Zustand, Recoil, and
Jotai solve _state distribution_ — getting a value from wherever it lives to
wherever it's read, efficiently. `data-cap` solves neither of those; it
solves _shape agreement_ — what does "this data, plus its current execution
status" look like, so every consumer, regardless of which fetching/state
tool produced it, reads the same `fields`/`info` structure instead of each
inventing its own booleans. That's why it composes with all of the above
rather than replacing any of them — see
`test/integration/adoption-patterns/tanstack-query-integration/` and `test/integration/subscriptions/socket-io-subscription/`
for two of them wired in directly.

It is not a fetching library, a state manager, or a database abstraction —
see the README's "Framework independence"/"State-management independence"
framing. It composes with your existing ones.

## Security & threat model

See [`SECURITY.md`](SECURITY.md) for the full policy. The short version:
`data-cap` is not an authorization/encryption/compliance system; ownership
enforcement at runtime is warn-not-throw (an unowned write is dropped, not
a hard failure); build tooling is static-analysis-only (never executes a
discovered file); and the dual-package hazard (two coordinator instances
under mixed ESM/CJS resolution) is a checked, documented, gracefully-
degrading risk class, not a silently unstated one.

## Versioning, stability, and long-term support

Pre-`1.0` — see [`VERSIONING.md`](VERSIONING.md) for the three-tier
Stable/Experimental/Private API classification. Before `1.0`, any minor
release may change a Stable API; there is no LTS branch and no extended
security-support window beyond the latest published `0.x` (see
[`SECURITY.md`](SECURITY.md)'s "Supported versions"). This is the honest
gap for an organization evaluating adoption at scale today: there is
currently no forward commitment about post-`1.0` backport policy. If that
gap is a blocker for your evaluation, wait for a `1.0` release or track
[`specs/decisions/`](specs/decisions/) for when that commitment is made.

## Bundle size and performance

Every consumer-facing entry point carries a hard gzip budget, enforced in
CI (`scripts/check-size.mjs`) — see [`PERFORMANCE.md`](PERFORMANCE.md) for
current numbers and methodology. `core` and `helpers` are each single-digit
KB gzipped; `runtime`'s cache/retry features are separate, independently
tree-shaken entry points so importing `./runtime` alone never pays for
either. `build` and `eslint-plugin` are Node-only, dev-time-only, and
carry no budget (they never ship to a browser bundle).

## Architectural guarantees worth knowing before you adopt

| Guarantee                                                                                                                                                                                                                                                                                                                             | Why it matters                                                                                               | ADR                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `fields` are always synchronously readable — no throw-until-ready gate. Every declared field has a real default from the moment `buildData()`/`createData()` returns.                                                                                                                                                                 | No initialization-race UI code (`if (!data) return null` guards, suspense boundaries just to read a default) | [ADR 0004](specs/decisions/0004-fields-always-synchronously-readable.md)                     |
| `info` is mandatory, never optional — every `DataState` has the same shape, always, with no branching on whether metadata exists.                                                                                                                                                                                                     | Consumers never special-case "metadata hasn't been allocated yet"                                            | [ADR 0007](specs/decisions/0007-datainfo-mandatory-not-optional.md)                          |
| A built-in getter/mutator/subscription execution loop is available, but optional. `createData(schema)` (Experimental tier) owns dedup, per-operation status, optimistic mutation lifecycle, and `runGetters` concurrency; `buildData` + `createDataStore` gives full manual control instead — both compose the exact same primitives. | Pick the level of control per capability, not per app                                                        | [ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md) |
| No first-party TanStack Query/Socket.IO adapter ships — full, tested reference patterns live in `examples/` instead.                                                                                                                                                                                                                  | No adapter package to track for breakage against upstream releases                                           | [ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md)                      |
| No automatic rollback or conflict resolution for optimistic mutations or concurrent same-field writes — the framework never guesses at a domain-specific policy; you implement one in your own processor if you need one.                                                                                                             | No surprise "magic" merge/rollback behavior to reverse-engineer when it doesn't match your domain's needs    | [ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md)             |

## Migration cost from what you likely have today

See [`specs/migrations/`](specs/migrations/) for guided, incremental paths.
Every guide includes an explicit "when to keep what you have" section —
migrating is not assumed to be the right call for every application.

| Coming from                                 | Guide                                                                      | One-line take                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual `useState`/`useEffect` fetch triples | [From manual fetch-and-state](specs/migrations/from-manual-fetch-state.md) | Replace scattered loading/error/data booleans with one typed `DataState`; lowest-effort migration since there's no existing library to reconcile with.                 |
| A Redux/Zustand-style global store          | [From a global store](specs/migrations/from-a-global-store.md)             | Keep the store for client-only UI state; move server-derived data into capability-owned contracts instead of store slices.                                             |
| TanStack Query used directly                | [From TanStack Query alone](specs/migrations/from-tanstack-query-alone.md) | Keep TanStack Query doing fetching/caching/refetch policy; let its results flow into a `data-cap` `DataStore` for a consistent shape across every data source.         |
| Apollo Client / a GraphQL-normalized cache  | [From Apollo Client](specs/migrations/from-apollo-client.md)               | Keep Apollo (or drop it) for the GraphQL transport itself; capability fields become the shape components actually read, instead of `useQuery`'s per-call result shape. |

All four migrations are designed to be adopted one capability at a time —
nothing requires a big-bang rewrite, and your existing fetching/caching/
state-management tooling keeps doing what it already does underneath.

## Questions this document doesn't answer

- **What does a post-`1.0` backport/LTS policy look like?** Not yet
  decided — see "Versioning, stability, and long-term support" above.
- **Is there a first-party adapter for [some other library]?** No, and
  none are planned — see
  [ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md).
  If your library of choice isn't TanStack Query or Socket.IO, the two
  existing examples are still the closest reference pattern to adapt from.
- **What are real-world production performance numbers?**
  `benchmarks/performance-runtime`/`performance-buildtime`'s output is
  highlighting-only micro-benchmark data (see
  [`PERFORMANCE.md`](PERFORMANCE.md)), not a production-workload claim —
  this package has no deployed-at-scale track record yet to cite.
