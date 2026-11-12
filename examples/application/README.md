# application: Task Manager

**Tier 1: "How do I define and consume application data safely?"**

One developer's task manager, built on one capability with `createData` (`data-cap/runtime`). It uses the whole single-developer feature set:

- exact field types: an array field and a nullable field;
- loading, error and success status;
- an optimistic mutation;
- `withRetry` composed onto a generated mutator method;
- `runtime/cache` in front of a getter;
- the runtime's own request dedup;
- cancellation through an `AbortSignal` the caller supplies.

`../../test/integration/runtime-core/basic-standalone/` wires the same kind of scenario by hand, with `buildData`, `createDataStore` and the coordinator. Both patterns are supported; this one uses the Stable `createData` layer ([ADR 0048](../../specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)).

## Run it

Build the package first: `npm run build` at the repository root. Then, in this directory, run `npm install` and:

| Command         | Exit code | Look for                                                                                |
| --------------- | --------- | --------------------------------------------------------------------------------------- |
| `npm start`     | 0         | `application: all assertions passed.`                                                   |
| `npm run docs`  | 0         | `0 error(s), 2 warning(s), 0 info finding(s):`                                          |
| `npm run check` | 0         | `[generate-docs check] manifest/docs/ownership/flow/evidence artifacts are up to date.` |

`npm start` runs `node:assert/strict` checks against the installed `data-cap` build. A failed assertion exits 1 and names the check. `npm run check` exits 1 and lists each stale file when `docs/` no longer matches a fresh run.

CI's `examples` job runs `npm run typecheck` here, then `npm start` and `npm run check` through `test/examples/application.test.ts`. It also runs `npm run docs` in a copy and compares the output with the root README's "See it run" block. That job does not block a merge.

## One schema, shared between `createData` and `documentData`

`taskSchema` is declared once, as a plain `const`. It is passed to both `createData(taskSchema)` and `documentData(taskSchema, docs)`. So `docs.getters`, `docs.mutators` and `docs.subscriptions` are checked against the schema's operation names. Documenting a getter that does not exist, or misspelling one, is a compile error.

## Why `tasks` and `selectedTask` are different kinds of fields

`tasks: Task[]` is an array field: the whole list, loaded once, changed by `createTask`, `toggleTask` and `deleteTask`. `selectedTask: Task | null` is a nullable field: one task's detail, filled by `getTask`.

`createData` keeps no per-item status for an array field, so there is no useful `info.tasks.status` to read. The status, timestamp and subscription checks therefore target `selectedTask`. `../team-service/` meets the same limit.

## What it checks

`npm start` asserts each of these:

- One schema with `fields`, `getters`, `mutators` and `subscriptions`, shared with `documentData`, gives a working, documented capability.
- Two concurrent `getTasks()` calls make one fetch, through the runtime's own dedup.
- `runtime/cache` serves a later, non-concurrent call without a second fetch.
- An `AbortSignal` cancels an in-flight getter call, and the rejection keeps the last good field value.
- A generated mutator composes with `withRetry` from `data-cap/runtime/retry`, because it is a plain `(params?, signal?) => Promise` function. The simulated backend fails the first `createTask` attempt, so the retry path runs.
- `toggleTask` and `deleteTask` show their optimistic values before the request settles.
- A subscription's status changes (`connecting`, `connected`, `disconnected`) touch only `info.selectedTask.subscription`, never `fields` (ADR 0029).

## Generated reports (`docs/`)

`docs/` is the output of `npm run docs`, not hand-written. Both fields are documented as `sensitivity: "internal"`. Every getter and mutator declares an `api` endpoint with a `url` and `handling: "plaintext"`.

`docs/flow/overview.mmd` draws one chain per operation: the declared endpoint, the operation, the field, and each consuming site at its `file:line:column`. `docs/OWNERSHIP.md` lists the same sites in its "Consumers per capability" table. [`specs/generated-artifacts.md`](../../specs/generated-artifacts.md) says what each artifact does and does not claim.

## Where to go next

- `../../test/integration/runtime-core/basic-standalone/`: the same kind of scenario, wired by hand instead of through `createData`.
- `../team-service/`: several capabilities, owned by a team, composing with each other and still analyzable.
- `../../test/integration/runtime-modules/runtime-cache/` and `runtime-modules/runtime-retry/`: the cache and `withRetry` on their own.
