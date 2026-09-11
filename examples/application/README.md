# application -- Task Manager

**Tier 1: "How do I define and consume application data safely?"** A single
developer's task manager -- one capability, the batteries-included
`createData` (`data-cap/runtime`), demonstrating the full
individual-developer feature surface end to end: exact field types (an array
field and a nullable field), loading/error/success status, optimistic
mutation, `withRetry` composed directly onto a generated mutator method,
`runtime/cache` fronting a getter, request dedup (the runtime's own, free),
and abort/cancellation via an externally-supplied `AbortSignal`.

Compare with `../../test/integration/runtime-core/basic-standalone/`, which
wires the exact same kind of scenario by hand against `buildData` +
`createDataStore` + `coordinator` directly -- both are valid, supported
patterns. This one is the opt-in, Experimental-tier convenience layer (see
[`specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md`](../../specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)).

## One schema, shared between `createData` and `documentData`

`taskSchema` is declared once, as a plain `const`, and passed to *both*
`createData(taskSchema)` and `documentData(taskSchema, docs)` -- not two
separately-typed config objects. That's what makes `docs.getters`/
`docs.mutators`/`docs.subscriptions` real, `keyof`-checked keys against the
schema's own operation names: documenting a getter that doesn't exist, or
misspelling one that does, is a compile error, not a silent gap that only
shows up (if ever) as a build-tool warning.

## Why `tasks` and `selectedTask` are different kinds of fields

`tasks: Task[]` is an array field -- the whole list, loaded once, mutated in
place by `createTask`/`toggleTask`/`deleteTask`. `selectedTask: Task | null`
is a nullable field -- one task's own full detail, populated by `getTask`.
This split isn't arbitrary: an array field's own `info` is a per-item-
identity-keyed map, not a flat `FieldInfo`, so there's no meaningful
`info.tasks.status`/`.subscription` to read at the top level (`info.tasks`
would need `createData`'s per-item array-identity reconciliation, which it
doesn't have -- see `../team-service/`'s own README for the same limitation
proven independently). Status/fetch-timestamp/subscription-lifecycle checks
below all target `selectedTask` instead, where they're real.

## Run it

```sh
npm install
npm start
```

`npm start` runs real `node:assert/strict` checks against the actual
installed `data-cap` build -- a thrown assertion is a genuine
regression signal, not just a diff.

## What it proves

- A schema declaring `fields`/`getters`/`mutators`/`subscriptions` together,
  shared with `documentData`, produces a fully working, fully documented
  capability from one pair of calls.
- Two concurrent `getTasks()` calls dedup to one real fetch -- the runtime's
  own dedup, never hand-wired.
- `runtime/cache` fronts the same getter: a later, non-concurrent "remount"
  call hits the cache instead of fetching again.
- An externally-supplied `AbortSignal` cancels an in-flight getter call, and
  the rejection never overwrites the last known-good field value.
- A generated mutator method composes directly with the real, shipped
  `withRetry` (`data-cap/runtime/retry`), since it's a plain
  `(params?, signal?) => Promise<...>` function -- the example's simulated
  backend deliberately fails the first `createTask` attempt so the retry
  path is exercised for real, not just asserted about.
- `toggleTask`/`deleteTask`'s optimistic values are visible immediately,
  before the request settles.
- A subscription's status transitions (`connecting` -> `connected` ->
  `disconnected`) never touch `fields`, only `info.selectedTask.subscription`
  (ADR 0029).

## Generated reports (`docs/`)

`docs/` in this example is not hand-written -- it's the real output of
running the `data-cap` CLI against `src/main.ts`:

```sh
npm run docs   # regenerate
npm run check  # verify committed docs match a fresh generation (no write)
```

Both `tasks` and `selectedTask` are documented `sensitivity: "internal"`, and
every getter/mutator declares an `api` endpoint with a real `url` and a
declared `handling` state (`plaintext`) -- exactly the combination
`docs/flow/overview.mmd`'s diagram renders as a real, per-operation chain:
declared endpoint -> the specific getter/mutator that touches it -> the
field -> every proven consumption site, at its exact `file:line:column`
(see `docs/OWNERSHIP.md`'s own "Consumers per capability" table for the same
positions in tabular form). See
[`specs/generated-artifacts.md`](../../specs/generated-artifacts.md) for
what every generated artifact does and doesn't claim.

## Where to go next

- `../../test/integration/runtime-core/basic-standalone/` -- the same kind
  of scenario, hand-wired instead of through `createData`.
- `../team-service/` -- multiple capabilities, owned separately by a team,
  composing with each other while staying independently analyzable.
- `../../test/integration/runtime-modules/runtime-cache/` and
  `runtime-modules/runtime-retry/` -- `runtime/cache`/`withRetry` on their
  own, without a `createData` capability wrapping them.
