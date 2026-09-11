/**
 * The team member directory -- owned by the platform team, since "who's on
 * the team" is a cross-project concern, not any one project's own. Cached
 * (`runtime/cache`): the directory rarely changes within a session, so a
 * remount should never re-fetch it.
 *
 * `project.capability.ts` composes with this capability directly (imports
 * `memberData`, calls `memberData.listMembers(...)`) to resolve task
 * assignee names -- an ordinary cross-file call through application code,
 * needing no data-cap composition primitive, and fully traceable by
 * data-cap's own dependency scan as a real `calls-getter` edge from one
 * capability's file to another's (see this example's own generated
 * `docs/OWNERSHIP.md` "Capability-to-capability dependencies" section).
 */
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

documentData(memberSchema, {
  name: "members",
  owner: "platform-team",
  purpose: "Letting any project resolve who's on the team, by id.",
  legalBasis: "contract",
  dataResidency: "us",
  fields: {
    members: {
      description: "The full team member directory.",
      sensitivity: "internal",
      protections: "Session-authenticated access only; TLS in transit.",
      purpose: "Resolving assignee names for display across every project.",
    },
  },
  getters: {
    listMembers: {
      description: "Fetches the full team member directory, cached across remounts.",
      source: "members-api",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "members-api",
          url: "https://api.example.com/v1/members",
          handling: "plaintext",
        },
      ],
    },
  },
})
