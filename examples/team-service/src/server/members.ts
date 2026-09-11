/**
 * Simulated backend state for the team member directory -- shared, in-
 * memory state standing in for a real database/API, imported by BOTH
 * `capabilities/member.capability.ts` (the directory's own capability) and
 * `capabilities/assignments.capability.ts` (a different feature, built by a
 * different team, that independently re-fetches the same member data
 * instead of composing with `memberData` -- see that capability's own
 * header comment for why this is deliberate, not an oversight).
 */
export interface Member {
  readonly id: string
  readonly name: string
  readonly email: string
}

const members: Member[] = [
  { id: "member-1", name: "Ada Lovelace", email: "ada@example.com" },
  { id: "member-2", name: "Grace Hopper", email: "grace@example.com" },
]

export let listMembersCallCount = 0
export let myTasksMembersCallCount = 0

export async function fetchMembersRemote(signal: AbortSignal): Promise<Member[]> {
  listMembersCallCount += 1
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  return members.map((member) => ({ ...member }))
}

/**
 * A second, independent "fetch the member directory" call -- same
 * conceptual endpoint, same data, a SEPARATE call count. This is the
 * duplicate `assignments.capability.ts` makes: not a bug in this simulated
 * backend, the whole point.
 */
export async function fetchMembersRemoteForAssignments(signal: AbortSignal): Promise<Member[]> {
  myTasksMembersCallCount += 1
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  return members.map((member) => ({ ...member }))
}
