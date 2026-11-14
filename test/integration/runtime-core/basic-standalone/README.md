# basic-standalone

**Client-side pattern.** The minimal end-to-end shape:

- `buildData` declares the field contract.
- `createDataStore` owns state.
- A small hand-written `runGetUser` function does the actual work the
  batteries-included `createData` (`data-cap/runtime`, see
  [`examples/application/`](../../../../examples/application/)) would otherwise do for you. It fetches, commits a loading status, then commits the result or an error.

`fetchUser` stands in for
`fetch("/api/user").then(r => r.json())`; every value that flows through this
example is a plain JSON object.

Most other fixtures in `test/integration/` reuse this same shape, adapted to
a different mechanism. Read this one first.

## Why this level of manual control, and when to reach for it instead of `createData`

`createDataStore` only ever owns two things: `authoritativeState` and
`pendingTransitions`. It has no opinion about how a value gets fetched, when
a retry happens, or how concurrent calls to the same operation should be
deduped. That's why `runGetUser` below explicitly commits a `"loading"`
status before the fetch and a `"success"`/`"error"` status after it. That
bookkeeping does not happen implicitly.

This is deliberate. An application with existing retry/caching/transport
logic (a hand-rolled fetch wrapper, a non-standard dedup key) can wire that
logic directly against `commitAuthoritative`. It does not have to fight a
higher-level runtime that assumes a different execution model.

[`examples/application/`](../../../../examples/application/)
shows the exact same user-fetching scenario through `createData` instead, where this same
loading/success/error commit sequence happens for you. Compare the two
files side by side to see precisely what `createData` adds versus what it
composes underneath.

`defaultCoordinator.dedupe` is used here even though this file only ever
calls `fetchUser` once. It's included so the pattern is copy-paste-correct
for a real application, where `runGetUser` might be triggered by two
components mounting around the same time.

## Run it

```sh
npm install
npm start
```

`npm start` runs real `node:assert/strict` checks against the actual
installed `data-cap` build and writes `output.json`. CI compares it
against `expected/output.json`.

## What it proves

- `data.fields` is synchronously readable, populated with declared defaults,
  immediately after `buildData()`, with no throw-until-ready gate.
- `fields.nullable(x)`/`fields.optional(x)` always resolve to `null`/
  `undefined` as their initial default. `x` only drives type inference;
  it is never used as the runtime default.
- A getter's own commit sets `info.<field>.status`/`source`, never a
  sibling's.
- Every published `DataState`, and every object reachable from it, is
  deep-frozen.
- Each real, distinct commit notifies subscribers exactly once. The
  "loading" transition and the later "success" transition are two separate
  real commits, so two notifications. A true no-op commit (recommitting the
  identical value) never notifies again.

## Where to go next

- [`examples/application/`](../../../../examples/application/): the same scenario through `createData`.
- [`../server-database-integration/`](../server-database-integration/): the equivalent server-side
  pattern, a getter backed by a database query instead of a network call.
- [`../optimistic-mutation-concurrency/`](../optimistic-mutation-concurrency/): this file's store, extended
  with a hand-wired optimistic mutation and the concurrent-mutation ordering
  guarantee.
