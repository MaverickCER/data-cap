---
name: data-cap
description: Load when a task creates or edits a data-cap capability (a schema with fields, getters, mutators or subscriptions), calls createData or buildData, or generates data-cap manifests, docs or reports. Skip it for state that does not use data-cap.
---

# data-cap

data-cap gives each capability (a feature or package) an analyzable data contract: the fields it owns and the getters, mutators and subscriptions that acquire, change or observe them.

Not for: fetching data or holding UI state. It declares and checks ownership; your own functions do the I/O.

## Use it

```ts
import { buildData, documentData } from "data-cap"
import { createData } from "data-cap/runtime"
import { createDataCache } from "data-cap/runtime/cache"
import type { Member } from "../server/members.js"
import { fetchMembersRemote } from "../server/members.js"

export type { Member }

const memberListCache = createDataCache<{ members: Member[] }>({ maxEntries: 1 })
const MEMBER_LIST_CACHE_KEY = "members"

async function listMembersThroughCache(signal: AbortSignal): Promise<Member[]> {
  const cached = memberListCache.get(MEMBER_LIST_CACHE_KEY)
  if (cached !== undefined) return cached.fields.members
  const fresh = await fetchMembersRemote(signal)
  memberListCache.set(MEMBER_LIST_CACHE_KEY, buildData({ fields: { members: fresh } }))
  return fresh
}

const memberSchema = {
  fields: {
    members: [] as Member[],
  },
  getters: {
    listMembers: {
      params: {},
      execute: (_params: object, signal: AbortSignal): Promise<Member[]> =>
        listMembersThroughCache(signal),
      processor: (result: Member[]): { members: Member[] } => ({ members: result }),
      writes: { members: true },
    },
  },
}

export const memberData = createData(memberSchema)
```

From `examples/team-service/src/capabilities/member.capability.ts`.

## Import from

| Import | For |
| --- | --- |
| `data-cap` | `buildData`, `documentData`, `fields.nullable` and `fields.optional`, the state types |
| `data-cap/runtime` | `createData`, `createDataStore`, `createCoordinator` |
| `data-cap/runtime/cache` | `createDataCache`, optional |
| `data-cap/runtime/retry` | `withRetry`, `isStillDefault`, optional |
| `data-cap/helpers` | `processors`, `identity`, `canonicalize`, `shape` |
| `data-cap/build` | Node only: discovery, the models, and generating manifests, docs and reports |
| `data-cap/node` | Node only: `nodeBuildFileSystem`, the file system a build script hands to `/build` |
| `data-cap/evidence` | `defineEvidenceProjection`, projections over the evidence model |
| `data-cap/eslint-plugin` | Lint rules: `stable-operation-reference`, `no-raw-external-io`, `no-fields-escape`, `no-node-fs` |
| `data-cap/schema` | The JSON Schemas for `data-cap --json` output |

## Rules

- Declare the schema once as a literal and pass that object to `createData(schema)` and `documentData(schema, docs)`, which follows it in the example's file.
- Give every getter and subscription a `writes` map naming the fields it may write. A mutator without one may write the whole declared schema.
- Keep `execute` and `subscribe` references stable. Sharing and dedupe are by function identity, so a fresh arrow per render defeats them.
- Import only from the exports in package.json; `/build` and `/node` are Node-only.

## Rely on

- A newer getter call discards an older in-flight getter commit. A mutator commit is never discarded: each folds onto the current authoritative state as it finishes.
- A thrown processor fails the whole operation; one invalid field resets to its default and its valid siblings survive.

## Common mistakes

| Instead of | Do this |
| --- | --- |
| Checking a field's presence with truthiness | Use `Object.hasOwn`: `0`, `false`, `""`, `null` and `[]` are real values. |
| Reading `info.tasks.status` on an array field | Array `info` is keyed by item identity; read status from a scalar field. |

## Verify

1. Run the type check and tests.
2. Update the `documentData()` entry, run the project's data-cap script, and commit generated files only if the project does.

Report any check you could not run, and any assumption you made.

## Go deeper

- [Every option of the generators and the CLI](https://github.com/MaverickCER/data-cap/blob/main/GUIDE.md)
- [Every public signature](https://github.com/MaverickCER/data-cap/blob/main/skills/data-cap/references/api.md)

## Authority

Target `data-cap@0.8.3`. The installed package's exports and type declarations are the API: do not invent exports, options or return values. Behaviour is established by its tests and examples. If this skill and the code disagree, say so rather than guessing.
