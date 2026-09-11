# Integration fixtures

Answers one question: **does data-cap actually work?** Sixteen real,
standalone npm projects (the same self-contained-project shape `examples/`
uses -- each depends on the root package via `"@maverickcer/data-cap":
"file:../../../.."` and is installed/typechecked separately, never by the
root `npm ci`), each proving exactly one specific mechanism against the
real, built package. Relocated here, unmodified in substance, from what used
to be 16 of `examples/`' 17 flat directories -- see
[`examples/README.md`](../../examples/README.md) for why: `examples/` now
answers a different question ("why would I use this?"), told through three
audience-shaped flagship examples instead of a flat feature checklist, and
these fixtures keep proving every mechanism the old flat list did, with zero
coverage lost in the move.

Each fixture's own `src/main.ts` runs real `node:assert/strict` invariant
checks against the actual built, installed package -- not `src/`, the real
`dist/` output a consumer would get from npm. A thrown assertion is a
genuine, non-zero-exit regression signal. Beyond assertions, each script
also writes a normalized `output.json` summarizing key observed values,
compared byte-for-byte against a committed `expected/output.json` golden --
so a behavior change that doesn't happen to trip an assertion still shows up
as a diff a reviewer has to explicitly accept (via `npm run
examples:update-golden`, run from the repo root -- the same script that
updates the 3 flagship examples' goldens).

## Running one yourself

```sh
cd ../..                              # repo root
npm run build
cd test/integration/<category>/<name>
npm install
npm start
```

## `runtime-core/`

| Fixture                                                                           | Side   | Proves                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-standalone`](runtime-core/basic-standalone)                               | Client | `buildData` + `createDataStore` wired by hand against a simulated network fetch (the low-level path, with full manual control)                                |
| [`server-database-integration`](runtime-core/server-database-integration)         | Server | The same wiring pattern, against a simulated database query/update instead of a network fetch -- a Node backend service keeping DB-backed state               |
| [`optimistic-mutation-concurrency`](runtime-core/optimistic-mutation-concurrency) | Client | `addPendingTransition`/`removePendingTransition`, concurrent optimistic-UI mutations always folding onto _current_ authoritative state, no automatic rollback |
| [`array-identity-reconciliation`](runtime-core/array-identity-reconciliation)     | Client | `helpers.identity` malformed-input matrix (missing key, `null`, duplicate identity) and reference-stable reconciliation over a fetched list                   |

## `subscriptions/`

| Fixture                                                                                | Side   | Proves                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`subscription-lifecycle`](subscriptions/subscription-lifecycle)                       | Client | `coordinator.acquireSubscription`'s ref-counted transport sharing: first subscriber connects, later ones reuse, only the last unsubscribe disconnects |
| [`subscription-with-recover`](subscriptions/subscription-with-recover)                 | Client | An optional `recover` getter racing a live subscription event after reconnect; both settle via ordinary atomic commit ordering                        |
| [`multi-capability-shared-transport`](subscriptions/multi-capability-shared-transport) | Client | Two _different_ capabilities sharing one transport connection (same `subscribe` identity) while keeping fully independent state/processing            |
| [`socket-io-subscription`](subscriptions/socket-io-subscription)                       | Client | Wiring a real Socket.IO client into `acquireSubscription` -- an adoption pattern, not a shipped adapter                                               |

## `coordinator/`

| Fixture                                                      | Side   | Proves                                                                                                                                                                            |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`coordinator-dedup`](coordinator/coordinator-dedup)         | Client | Concurrent calls to the same function identity with canonically-equal params dedupe onto one in-flight promise; non-canonicalizable params degrade to no-dedup                    |
| [`coordinator-isolation`](coordinator/coordinator-isolation) | Server | `createCoordinator()`'s explicit, opt-in isolated domain -- a multi-tenant server process giving each tenant its own coordination domain instead of sharing the default singleton |

## `runtime-modules/`

| Fixture                                          | Side   | Proves                                                                                                           |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------- |
| [`runtime-cache`](runtime-modules/runtime-cache) | Client | The optional bounded `runtime/cache` persisting full `DataState` (fields + info) atomically, never raw responses |
| [`runtime-retry`](runtime-modules/runtime-retry) | Client | The optional opt-in `runtime/retry`, and its `isStillDefault` guard against overwriting real data                |

## `adoption-patterns/`

| Fixture                                                                      | Side   | Proves                                                                                                      |
| ---------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| [`tanstack-query-integration`](adoption-patterns/tanstack-query-integration) | Client | Wiring a `DataStore` as a TanStack Query external data source -- an adoption pattern, not a shipped adapter |

## `build-tooling/`

| Fixture                                                                | Side          | Proves                                                                                                                          |
| ---------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`tsconfig-aliases`](build-tooling/tsconfig-aliases)                   | Build tooling | `discoverCapabilityFiles`/`linkCapabilityFiles` resolving `buildData`/`documentData` calls through `tsconfig.json` path aliases |
| [`tsconfig-aliases-consumer`](build-tooling/tsconfig-aliases-consumer) | Build tooling | The same build tooling discovering a capability schema published by a _different_ package                                       |
| [`eslint-plugin-usage`](build-tooling/eslint-plugin-usage)             | Build tooling | The `stable-operation-reference` ESLint rule flagging real inline-function and recreated-per-call mistakes                      |
