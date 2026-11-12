# team-service: Project Management Service

**Tier 2: "How do we make a service's data capabilities composable and maintainable?"**

A small team's project tracker, organized as one file per capability: `src/capabilities/project.capability.ts`, `member.capability.ts` and `assignments.capability.ts`. Tier 1 asked which mechanisms exist. This tier asks how teams own data capabilities instead of scattering data access across features.

## Run it

Build the package first: `npm run build` at the repository root. Then, in this directory, run `npm install` and:

| Command         | Exit code | Look for                                                                                |
| --------------- | --------- | --------------------------------------------------------------------------------------- |
| `npm start`     | 0         | `team-service: all assertions passed.`                                                  |
| `npm run docs`  | 0         | a `[info] [DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES]` line                                |
| `npm run check` | 0         | `[generate-docs check] manifest/docs/ownership/flow/evidence artifacts are up to date.` |

A failed assertion in `npm start` exits 1. `npm run check` exits 1 and lists each stale file.

CI's `examples` job runs `npm run typecheck` here, then `npm start` and `npm run check` through `test/examples/team-service.test.ts`. That job does not block a merge.

## Composition that stays analyzable

`project.capability.ts`'s `getProject` getter needs each task's assignee name, not only an id. So it imports `memberData` and calls `memberData.listMembers(...)`, an ordinary cross-file call. No `data-cap` composition primitive is involved.

`scanDependencies` reads every project file for this shape, so the build pass records the dependency from the source. After `npm run docs`, `docs/OWNERSHIP.md`'s "Capability-to-capability dependencies" table shows `projectData -> memberData`, with the `file:line:column` of the call.

## The duplicate this example leaves in place

`assignments.capability.ts` is a small "my assigned tasks" widget, owned by a different team (`notifications-team`). It needs member names too. Instead of composing with `memberData`, it fetches the member directory again and declares an endpoint at the same URL `listMembers` declares.

That is deliberate: two people on two features often miss that the data they need is already on the client. `checkDuplicateEndpoints` (`src/build/structural-duplication.ts`) reports it as an `info` finding, `DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES`. `docs/flow/overview.mmd` shows the shared `members-api` endpoint feeding two getters on two capabilities. Nothing fixes it automatically; merging the two calls is the reader's decision.

## Why task reordering uses `createDataStore`

`projectData.tasks` is an array field. `createData` commits its value, but does not reconcile the items inside it by identity. The task order needs an untouched task to keep its exact `info` object across a reorder. So `main.ts` tracks the order with `createDataStore` and `helpers.identity`, next to the `createData` capabilities. `test/integration/runtime-core/array-identity-reconciliation/` uses the same primitive. This is a known gap in `createData`.

## What it checks

`npm start` asserts each of these:

- `getProject` resolves assignee names through `memberData`. The generated ownership report records that `calls-getter` and `reads-field` dependency.
- `assignmentsData` duplicates `memberData`'s endpoint, and `DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES` is reported from the declarations alone.
- `memberData`'s `runtime/cache` serves a later, direct `listMembers()` call without a second fetch. `assignmentsData`'s own fetch never goes through that cache, which is the gap the finding points at.
- `createTask` composes with `withRetry` from `data-cap/runtime/retry`, as in `../application/`.
- `toggleTask` shows its optimistic value before the request settles.
- After a reorder, an untouched task keeps the same `info` object, compared with `Object.is` on its key.

## Generated reports (`docs/`)

Three capabilities with three owners (`project-team`, `platform-team`, `notifications-team`), one cross-capability dependency and one duplicate-endpoint finding. All of it is in `docs/DATA.md` and `docs/OWNERSHIP.md`. [`specs/generated-artifacts.md`](../../specs/generated-artifacts.md) says what each artifact does and does not claim.

## Where to go next

- `../application/`: the first tier, one capability with the whole single-developer feature set.
- `../enterprise-platform/`: the third tier, several independently owned capabilities behind one service.
- `../../test/integration/runtime-core/array-identity-reconciliation/`: `helpers.identity` reconciliation on its own.
- `../../test/integration/coordinator/coordinator-dedup/` and `runtime-modules/runtime-cache/`: dedup and the cache on their own.
