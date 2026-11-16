---
name: data-cap
description: Load when a task creates or edits a data-cap capability (a schema of fields and operations), calls createData or buildData, or generates data-cap manifests, docs or reports.
---

# data-cap

Declare who owns your app's data and how it may be handled. Lint and build checks enforce those rules, and the data documentation regenerates from your code, so it never falls behind. Each declaration is a capability, documented with `documentData()`.

Not for: fetching data or holding UI state. Your own functions do the I/O.

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
| `data-cap/build` | Node only: discovery, models, and generating manifests, docs and reports |
| `data-cap/node` | Node only: `nodeBuildFileSystem`, for `/build` |
| `data-cap/evidence` | `defineEvidenceProjection`; experimental flow views |
| `data-cap/observe` | Experimental: `observeBoundary` records field names, never values |
| `data-cap/eslint-plugin` | Lint rules: `stable-operation-reference`, `no-raw-external-io`, `no-fields-escape`, `no-node-fs` |
| `data-cap/schema` | JSON Schemas for `data-cap --json` output |

## Rules

- Declare the schema once as a literal and pass it to `createData(schema)` and `documentData(schema, docs)`, as the example does.
- Give every getter and subscription a `writes` map naming the fields it may write; a mutator without one may write the whole schema.
- Keep `execute` and `subscribe` references stable: sharing and dedupe go by function identity.
- Import only from package.json exports; `/build` and `/node` are Node-only.
- In `documentData`, give each field with a `sensitivity` a `purpose`, `legalBasis` and `protections`; add `flowPolicy` to govern where it may go (`--flow-evidence` checks it).

## Rely on

- A newer getter call discards an older in-flight getter commit. A mutator commit is never discarded.
- A thrown processor fails the whole operation; an invalid field resets to its default and valid siblings survive.

## Common mistakes

| Instead of | Do this |
| --- | --- |
| Checking a field's presence with truthiness | Use `Object.hasOwn`: `0`, `false`, `""`, `null` and `[]` are real values. |
| Reading `info.tasks.status` on an array field | Array `info` is keyed by item identity; read status from a scalar field. |

## Verify

1. Run the type check and tests; both pass.
2. Update the `documentData()` entry and run the project's data-cap generate script; it exits 0.

Report any check you could not run, and any assumption you made.

## Go deeper

- [Every option of the generators and CLI, and flow policies](https://github.com/MaverickCER/data-cap/blob/main/GUIDE.md)
- [Every public signature](https://github.com/MaverickCER/data-cap/blob/main/skills/data-cap/references/api.md)

## Authority

Target `data-cap@0.10.2`. The installed package's exports and type declarations are the API: use only what they declare. Its tests and examples establish its behaviour. When this skill and the code disagree, report the disagreement before acting on either.
