# server-database-integration

**Server-side pattern.** The same `buildData` + `createDataStore` shape as
`basic-standalone/`, backed by a simulated database instead of a network
fetch. `queryUserById`/`updateUserEmail` stand in for real driver calls
(`pg`, `mysql2`, an ORM); every value that flows through this example is a
plain JSON object, exactly like a real driver hands back.

A server process is its own source of truth, so the mutator here commits
directly on success with no pending/optimistic transition -- that pattern
is specifically for a client showing a value _before_ the server confirms
it (see `optimistic-mutation-concurrency/`).

## Run it

```sh
npm install
npm start
```

## What it proves

- The same wiring pattern as `basic-standalone/` works identically against
  a database-shaped `execute` function -- data-cap has no opinion about
  what's on the other end of a getter/mutator.
- A mutator's own commit really lands in the backing store (the simulated
  table), not just the in-memory `DataState`.
- `info.user.source` reflects whichever operation -- `getUser` or
  `updateUserEmail` -- most recently established the field, never a history.
- Four real, distinct commits (two per operation: loading, then
  success) each notify exactly once.

## Generated reports (`docs/`)

`docs/DATA.md` is not hand-written -- it's the real output of running the
`data-cap` CLI against `src/main.ts`:

```sh
npx data-cap --root . --include "src/**" --docs docs/DATA.md
```

Unlike [`examples/application/`](../../../../examples/application/) (a `createData` capability with a
real getters/mutators section `documentData` can attach per-operation
metadata to), this capability is built with the lower-level `buildData` --
no operations layer at all, so its `documentData` call only documents
`fields` (owner, sensitivity, protections). See
[`specs/generated-artifacts.md`](../../../../specs/generated-artifacts.md) for
what every generated artifact does and doesn't claim.
