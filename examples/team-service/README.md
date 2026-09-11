# team-service -- Project Management Service

**Tier 2: "How do we make a service's data capabilities composable and
maintainable?"** A small engineering team's project tracker, organized by
capability -- one file per concept
(`src/capabilities/project.capability.ts`, `member.capability.ts`,
`assignments.capability.ts`), not one flat `main.ts`. The domain question
shifts from Tier 1's "what mechanisms exist" to "how do teams own data
capabilities instead of scattering data-access knowledge across features."

## Composition that stays analyzable

`project.capability.ts`'s `getProject` getter needs each task's assignee
*name*, not just an id -- so it composes directly with `member.capability.ts`:
it imports `memberData` and calls `memberData.listMembers(...)`, an ordinary
cross-file function call through application code. There is no data-cap
composition primitive here, and none is needed -- `scanDependencies` already
walks every project file looking for exactly this shape, so the dependency
is fully, statically provable. Run `npm run docs` and look at the generated
`docs/OWNERSHIP.md`'s own "Capability-to-capability dependencies" table: it
shows the real edge, `projectData -> memberData`, with the exact
`file:line:column` where the call happens -- not something this README
claims, something the report proves.

## The duplicate this example doesn't fix

`assignments.capability.ts` -- a small "my assigned tasks" widget, owned by
a *different* team (`notifications-team`, not `platform-team`) -- needs
member names too. Instead of composing with `memberData` the way
`projectData` does, it independently re-fetches the member directory and
declares its own endpoint at the exact same URL `memberData`'s own
`listMembers` getter already declares. That's deliberate: it's the everyday
situation where two people, on two different features, never realized the
data they both need is already available on the client. `checkDuplicateEndpoints`
(`src/build/structural-duplication.ts`) flags this for a human to decide
about -- `DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES` in `npm run docs`'s own
output, and visually in `docs/flow/overview.mmd`, where the shared
`members-api` endpoint node fans into two separate getters on two separate
capabilities. It's never "fixed" automatically -- consolidating it into one
composed call, the way `projectData` already does, is a judgment call for
whoever reads the report.

## Why `tasks` (array) and reordering need `createDataStore`, not `createData`

`projectData.tasks` is an array field -- `createData`'s own per-field commit
path handles its *value* directly, but never per-item reconciliation
*within* it (`info` for an array field is one flat `FieldInfo` for the whole
field, never a per-item map keyed by identity). So the project's own visual
task order -- which specifically needs "an untouched task keeps its exact
previous `info` object across a reorder" -- is tracked directly against
`createDataStore` in `main.ts`, the same manual-control primitive
`test/integration/runtime-core/array-identity-reconciliation/` uses, wired
in right alongside the `createData` capabilities above it. Both are valid,
supported patterns, used for exactly what each is actually good at -- this
is a genuine mechanism gap, not an oversight, and every one of this
session's three examples that needs per-item array reconciliation hits it
the same way.

## Run it

```sh
npm install
npm start
```

`npm start` runs real `node:assert/strict` checks against the actual
installed `@maverickcer/data-cap` build.

## What it proves

- `getProject` composes `memberData` directly to resolve assignee names --
  a real, proven `calls-getter`/`reads-field` dependency in the generated
  ownership report, not a claim this README makes on its own.
- `assignmentsData` independently duplicates `memberData`'s own endpoint --
  `DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES` fires for real, from declared
  data alone, never from tracing runtime behavior.
- `memberData`'s `runtime/cache` means a later, direct `listMembers()` call
  never re-fetches -- but `assignmentsData`'s own independent fetch path is
  never routed through that same cache, exactly the coordination gap the
  duplicate-endpoint finding surfaces.
- `createTask` composes with the real, shipped `withRetry`
  (`@maverickcer/data-cap/runtime/retry`) the same way `examples/application/`
  does.
- `toggleTask`'s optimistic value is visible immediately, before the request
  settles.
- Reordering the project's own task list keeps an untouched task's `info`
  object reference-stable across the reorder (`helpers.identity`), proven
  via `Object.is` on the same key, not just equal values.

## Generated reports (`docs/`)

```sh
npm run docs   # regenerate
npm run check  # verify committed docs match a fresh generation (no write)
```

Three capabilities, three owners (`project-team`, `platform-team`,
`notifications-team`), one real cross-capability dependency, and one real
duplicate-endpoint finding -- all in `docs/DATA.md`/`docs/OWNERSHIP.md`. See
[`specs/generated-artifacts.md`](../../specs/generated-artifacts.md) for
what every generated artifact does and doesn't claim.

## Where to go next

- `../application/` -- the first tier: one capability, the full
  individual-developer feature surface, no composition yet.
- `../enterprise-platform/` -- the third tier: many independently-owned
  capabilities/services, analyzable across organizational boundaries.
- `../../test/integration/runtime-core/array-identity-reconciliation/` --
  `helpers.identity`'s reconciliation on its own, without a `createData`
  capability alongside it.
- `../../test/integration/coordinator/coordinator-dedup/` and
  `runtime-modules/runtime-cache/` -- dedup/cache on their own.
