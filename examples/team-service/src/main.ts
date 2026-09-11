/**
 * Tier 2 -- "How do we make a service's data capabilities composable and
 * maintainable?" A small engineering team's project tracker, organized by
 * CAPABILITY, one file per concept (`capabilities/project.capability.ts`,
 * `member.capability.ts`, `assignments.capability.ts`), not one flat
 * `main.ts` -- the domain question shifts from "what mechanisms exist" (Tier
 * 1) to "how do teams own data capabilities instead of scattering data-
 * access knowledge across features."
 *
 * `projectData` composes with `memberData` directly (an ordinary cross-file
 * call, no data-cap primitive involved) to resolve task assignee names --
 * and stays fully analyzable doing it: this example's own generated
 * `docs/OWNERSHIP.md` shows the real, proven `projectData -> memberData`
 * dependency. `assignmentsData`, built by a different team, independently
 * re-declares the SAME `members-api` endpoint instead of composing --
 * exactly what the generated report's `DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES`
 * finding exists to surface for a human to decide about.
 *
 * `runtime/cache`, dedup, optimistic mutation, and `helpers.identity`
 * reconciliation all appear below because THIS app's own story needs them,
 * not as a feature checklist -- see each mechanism's own inline comment for
 * exactly what problem it solves here.
 */
import assert from "node:assert/strict"
import type { FieldInfo } from "data-cap"
import { buildData } from "data-cap"
import { createDataStore } from "data-cap/runtime"
import { withRetry } from "data-cap/runtime/retry"
import { canonicalize, identity } from "data-cap/helpers"
import type { IdentityWarning } from "data-cap/helpers"
import { assignmentsData } from "./capabilities/assignments.capability.js"
import { memberData } from "./capabilities/member.capability.js"
import { projectData } from "./capabilities/project.capability.js"
import type { Task } from "./capabilities/project.capability.js"
import { listMembersCallCount, myTasksMembersCallCount } from "./server/members.js"
import { resetCreateTaskAttempts } from "./server/projects.js"

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// The project's own visual task order: tracked directly against
// createDataStore, reconciled by identity on reorder. `tasks` (on
// projectData) is an array field -- createData's own per-field commit path
// handles the array's VALUE, but never per-item reconciliation *within* it
// (`info` for an array field is one flat FieldInfo for the whole field, not
// a per-item map keyed by identity). So "an untouched task keeps its exact
// previous info object across a reorder" needs createDataStore directly, the
// same manual-control primitive
// test/integration/runtime-core/array-identity-reconciliation/ uses.
// ---------------------------------------------------------------------------
const taskOrderCapability = buildData({ fields: { taskOrder: [] as Task[] } })
const taskOrderStore = createDataStore(taskOrderCapability)
const taskOrderWarnings: IdentityWarning[] = []

function commitTaskOrder(nextOrder: readonly Task[], touched: ReadonlySet<string> | "all"): void {
  const previousInfo = taskOrderStore.getSnapshot().info.taskOrder
  const { info, warnings } = identity.reconcileArrayInfo<Task, FieldInfo>(
    previousInfo,
    nextOrder,
    ["id"],
    touched,
    () => ({ status: "success", source: "taskOrdering" }),
  )
  taskOrderWarnings.push(...warnings)
  taskOrderStore.commitAuthoritative({ taskOrder: nextOrder }, { taskOrder: info })
}

// =========================================================================
// The story: load a project (composing the member directory for assignee
// names), a teammate's "my tasks" widget independently re-fetches that same
// member directory, a task is created (with retry) and toggled
// optimistically, and the project's own visual task order gets rearranged.
// =========================================================================

// -- getProject composes memberData directly -- a real, proven -- //
// -- cross-capability dependency, not a data-cap primitive. -- //
await projectData.getProject({ id: "project-1" })
assert.equal(projectData.getSnapshot().fields.project?.name, "Q3 Platform Migration")
assert.equal(projectData.getSnapshot().fields.tasks.length, 2)
assert.equal(
  projectData.getSnapshot().fields.tasks.find((t) => t.id === "task-1")?.assigneeName,
  "Ada Lovelace",
  "getProject resolved task-1's assigneeId into a real name by composing memberData",
)
assert.equal(listMembersCallCount, 1, "memberData's own listMembers ran exactly once so far")

// -- A different team's "my tasks" widget independently re-fetches the -- //
// -- same conceptual member directory -- the duplicate this example's -- //
// -- own generated report flags, not something main.ts works around. -- //
await assignmentsData.getMyTasks({ memberId: "member-1" })
assert.equal(assignmentsData.getSnapshot().fields.myTasks[0]?.memberName, "Ada Lovelace")
assert.equal(
  myTasksMembersCallCount,
  1,
  "assignmentsData made its OWN independent members fetch -- never routed through memberData's cache",
)

// -- memberData's own cache means a direct, later call still doesn't -- //
// -- re-fetch -- unlike assignmentsData's separate, uncoordinated path. -- //
await memberData.listMembers({})
assert.equal(listMembersCallCount, 1, "a cache hit must never trigger a real fetch")

// -- createTask, composed with the real, shipped withRetry. -- //
resetCreateTaskAttempts()
const createController = new AbortController()
await withRetry(
  (signal) => projectData.createTask({ projectId: "project-1", title: "Update the runbook" }, signal),
  createController.signal,
  { maxAttempts: 3, delayMs: () => 1 },
)
assert.equal(projectData.getSnapshot().fields.tasks.length, 3)

// -- toggleTask completes optimistically, before the request settles. -- //
const togglePromise = projectData.toggleTask({ projectId: "project-1", taskId: "task-1" })
assert.equal(
  projectData.getSnapshot().fields.tasks.find((t) => t.id === "task-1")?.done,
  true,
  "the optimistic flip is visible immediately, before the request settles",
)
await togglePromise
assert.equal(projectData.getSnapshot().fields.tasks.find((t) => t.id === "task-1")?.done, true)

// -- assignTask reassigns a task -- another real composition beneficiary: -- //
// -- the new assignee's name is resolved the same way, through -- //
// -- memberData, on the very next getProject/mutator response. -- //
await projectData.assignTask({ projectId: "project-1", taskId: "task-2", memberId: "member-1" })
assert.equal(
  projectData.getSnapshot().fields.tasks.find((t) => t.id === "task-2")?.assigneeName,
  "Ada Lovelace",
)

// -- subscription lifecycle -- //
const unsubscribeProject = projectData.subscribeToProject({ id: "project-1" })
await sleep(15)
assert.equal(projectData.getSnapshot().info.project?.subscription?.status, "connected")
unsubscribeProject()
assert.equal(projectData.getSnapshot().info.project?.subscription?.status, "disconnected")

// -- Reordering the project's own visual task list keeps untouched -- //
// -- tasks' own info object reference-stable -- reconciled by identity, -- //
// -- not recomputed from scratch. -- //
const initialOrder = projectData.getSnapshot().fields.tasks
commitTaskOrder(initialOrder, "all")
const task3Key = identity.computeItemIdentity<Task>(
  { id: "task-3", title: "", done: false, assigneeId: null, assigneeName: null },
  ["id"],
  [],
  [],
)
const task3InfoBefore = taskOrderStore.getSnapshot().info.taskOrder?.[task3Key]

const reordered = [...initialOrder].reverse()
commitTaskOrder(reordered, new Set([initialOrder[0]!.id]))
const task3InfoAfter = taskOrderStore.getSnapshot().info.taskOrder?.[task3Key]

assert.equal(
  task3InfoBefore,
  task3InfoAfter,
  "an untouched task's own info object must survive a reorder by reference, not just by value",
)
assert.equal(taskOrderStore.getSnapshot().fields.taskOrder[0]?.id, reordered[0]?.id)
assert.equal(canonicalize(taskOrderWarnings), canonicalize([]), "no reconciliation warnings expected")

console.log("team-service: all assertions passed.")
