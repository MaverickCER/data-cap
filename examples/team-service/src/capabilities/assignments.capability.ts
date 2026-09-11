/**
 * "My assigned tasks" -- a small, standalone widget capability, owned by a
 * DIFFERENT team than `member.capability.ts`'s own platform team. Its
 * `getMyTasks` getter independently re-fetches the member directory
 * (`fetchMembersRemoteForAssignments`, `server/members.ts`) to resolve a
 * name for display, rather than composing with `memberData` the way
 * `project.capability.ts` does.
 *
 * This is deliberate, not an oversight this example forgot to fix: it's
 * exactly the realistic situation `checkDuplicateEndpoints` (ADR-pending;
 * see `src/build/structural-duplication.ts`) exists to catch -- two
 * capabilities, built by two different people who never coordinated, both
 * declaring an endpoint at the same `url`. The generated report (`docs/
 * OWNERSHIP.md`'s findings, or `docs/DATA.md`) flags this for a human to
 * decide whether it's worth consolidating into one composed call -- it
 * never "fixes" it automatically, and never claims the two calls are
 * provably identical at runtime, only that both DECLARE the same URL.
 */
import { documentData } from "@maverickcer/data-cap"
import { createData } from "@maverickcer/data-cap/runtime"
import { fetchMembersRemoteForAssignments } from "../server/members.js"

export interface AssignedTask {
  readonly taskId: string
  readonly taskTitle: string
  readonly memberName: string
}

// A tiny, separate "my tasks" projection -- standing in for a real backend
// endpoint that joins tasks to their assignee's name server-side, the same
// way `project.capability.ts`'s own getter does client-side by composing
// `memberData`. Two independent implementations of the same join.
const myTaskAssignments: { readonly taskId: string; readonly taskTitle: string; readonly memberId: string }[] = [
  { taskId: "task-1", taskTitle: "Draft the migration plan", memberId: "member-1" },
]

async function fetchMyTasksRemote(memberId: string, signal: AbortSignal): Promise<AssignedTask[]> {
  const members = await fetchMembersRemoteForAssignments(signal)
  const memberName = members.find((member) => member.id === memberId)?.name ?? "Unknown"
  return myTaskAssignments
    .filter((assignment) => assignment.memberId === memberId)
    .map((assignment) => ({
      taskId: assignment.taskId,
      taskTitle: assignment.taskTitle,
      memberName,
    }))
}

const assignmentsSchema = {
  fields: {
    myTasks: [] as AssignedTask[],
  },
  getters: {
    getMyTasks: {
      params: { memberId: "" },
      execute: (params: { memberId: string }, signal: AbortSignal): Promise<AssignedTask[]> =>
        fetchMyTasksRemote(params.memberId, signal),
      processor: (result: AssignedTask[]): { myTasks: AssignedTask[] } => ({ myTasks: result }),
      writes: { myTasks: true },
    },
  },
}

export const assignmentsData = createData(assignmentsSchema)

documentData(assignmentsSchema, {
  name: "assignments",
  owner: "notifications-team",
  purpose: "Showing one team member their own currently-assigned tasks.",
  legalBasis: "contract",
  dataResidency: "us",
  fields: {
    myTasks: {
      description: "The current member's own assigned tasks, with names resolved for display.",
      sensitivity: "internal",
      protections: "Session-authenticated access only; TLS in transit.",
    },
  },
  getters: {
    getMyTasks: {
      description: "Fetches one member's own assigned tasks.",
      source: "assignments-api",
      // Two declared endpoints: the assignments lookup itself, and --
      // deliberately -- the SAME members-api url member.capability.ts's
      // own listMembers getter already declares. That match is exactly
      // what makes checkDuplicateEndpoints fire for real.
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "assignments-api",
          url: "https://api.example.com/v1/my-tasks",
          handling: "plaintext",
        },
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
