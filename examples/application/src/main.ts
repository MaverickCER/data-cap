/**
 * Tier 1 -- "How do I define and consume application data safely?" A single
 * developer's task manager: one capability, the batteries-included
 * `createData` (`data-cap/runtime`), demonstrating the full
 * individual-developer feature surface end to end -- exact field types
 * (an array field and a nullable field), loading/error/success status,
 * optimistic mutation, `withRetry` composed directly onto a generated
 * mutator method, `runtime/cache` fronting a getter, request dedup (the
 * runtime's own, free), and abort/cancellation via an externally-supplied
 * `AbortSignal`.
 *
 * Status/subscription checks below target `selectedTask` (nullable), never
 * `tasks` (array): an array field's own `info` is a per-item-identity-keyed
 * map, not a flat `FieldInfo`, so there's no meaningful top-level
 * `info.tasks.status`/`.subscription` to read -- the same reasoning
 * `examples/team-service/`'s own `board`-vs-`tasks` split proves first.
 *
 * `taskSchema` is declared once and passed to BOTH `createData(taskSchema)`
 * and `documentData(taskSchema, docs)` below -- not two separately-typed
 * config objects. That's what makes `docs.getters`/`docs.mutators`/
 * `docs.subscriptions` real, `keyof`-checked keys against the schema's own
 * operation names: documenting a getter that doesn't exist, or misspelling
 * one that does, is a compile error, not a silent gap.
 */
import assert from "node:assert/strict"
import { buildData, documentData, fields } from "data-cap"
import { createData } from "data-cap/runtime"
import { createDataCache } from "data-cap/runtime/cache"
import { withRetry } from "data-cap/runtime/retry"

export interface Task {
  readonly id: string
  readonly title: string
  readonly done: boolean
  readonly priority: "low" | "medium" | "high"
}

// Simulated backend state -- every "fetch"/"create"/"toggle"/"delete" below
// is an in-memory function returning a plain JSON object after a short
// simulated delay, standing in for `fetch(...).then(r => r.json())`.
const tasks: Task[] = [
  { id: "task-1", title: "Write the quarterly report", done: false, priority: "high" },
  { id: "task-2", title: "Review pull requests", done: false, priority: "medium" },
]

let fetchTasksCallCount = 0
let createAttempts = 0

async function fetchTasksRemote(signal: AbortSignal): Promise<Task[]> {
  fetchTasksCallCount += 1
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  return tasks.map((task) => ({ ...task }))
}

async function fetchTaskRemote(id: string, signal: AbortSignal): Promise<Task> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  const task = tasks.find((t) => t.id === id)
  if (task === undefined) throw new Error(`no task with id ${id}`)
  return { ...task }
}

async function createTaskRemote(
  title: string,
  priority: Task["priority"],
  signal: AbortSignal,
): Promise<Task[]> {
  createAttempts += 1
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  // The first attempt always fails -- proves withRetry (optional, separately
  // tree-shaken, runtime/retry) composes directly with a generated mutator
  // method, since it's a plain `(params?, signal?) => Promise<...>` function.
  if (createAttempts === 1) throw new Error("simulated transient failure")
  tasks.push({ id: `task-${String(tasks.length + 1)}`, title, done: false, priority })
  return tasks.map((task) => ({ ...task }))
}

async function toggleTaskRemote(id: string, signal: AbortSignal): Promise<Task[]> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  const index = tasks.findIndex((t) => t.id === id)
  if (index === -1) throw new Error(`no task with id ${id}`)
  const existing = tasks[index]!
  tasks[index] = { ...existing, done: !existing.done }
  return tasks.map((task) => ({ ...task }))
}

async function deleteTaskRemote(id: string, signal: AbortSignal): Promise<Task[]> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  const index = tasks.findIndex((t) => t.id === id)
  if (index !== -1) tasks.splice(index, 1)
  return tasks.map((task) => ({ ...task }))
}

// runtime/cache sits in front of the simulated network call, keyed by a
// single constant key (there's only ever one list) -- a cache answers
// "validated state is already available"; the runtime's own dedup (below)
// separately answers "don't start a second identical request". Both matter:
// dedup alone can't make a THIRD, later "remount" call skip the network.
const taskListCache = createDataCache<{ tasks: Task[] }>({ maxEntries: 1 })
const TASK_LIST_CACHE_KEY = "tasks"

async function getTasksThroughCache(signal: AbortSignal): Promise<Task[]> {
  const cached = taskListCache.get(TASK_LIST_CACHE_KEY)
  if (cached !== undefined) return cached.fields.tasks
  const fresh = await fetchTasksRemote(signal)
  // `buildData` computes a real, correctly-shaped `DataState` (its own
  // `.fields`/`.info` defaults) rather than this hand-authoring one --
  // an array field's own `info` is a per-item-identity-keyed map, not a
  // flat `{status: ...}`, so constructing it by hand here would be wrong.
  taskListCache.set(TASK_LIST_CACHE_KEY, buildData({ fields: { tasks: fresh } }))
  return fresh
}

const taskSchema = {
  fields: {
    tasks: [] as Task[],
    selectedTask: fields.nullable<Task>({ id: "", title: "", done: false, priority: "low" }),
  },
  getters: {
    getTasks: {
      params: {},
      execute: (_params: object, signal: AbortSignal): Promise<Task[]> =>
        getTasksThroughCache(signal),
      processor: (result: Task[]): { tasks: Task[] } => ({ tasks: result }),
      writes: { tasks: true },
    },
    getTask: {
      params: { id: "" },
      execute: (params: { id: string }, signal: AbortSignal): Promise<Task> =>
        fetchTaskRemote(params.id, signal),
      processor: (task: Task): { selectedTask: Task } => ({ selectedTask: task }),
      writes: { selectedTask: true },
    },
  },
  mutators: {
    createTask: {
      params: { title: "", priority: "medium" as Task["priority"] },
      execute: (
        params: { title: string; priority: Task["priority"] },
        signal: AbortSignal,
      ): Promise<Task[]> => createTaskRemote(params.title, params.priority, signal),
      processor: (result: Task[]): { tasks: Task[] } => ({ tasks: result }),
      writes: { tasks: true },
    },
    toggleTask: {
      params: { id: "" },
      execute: (params: { id: string }, signal: AbortSignal): Promise<Task[]> =>
        toggleTaskRemote(params.id, signal),
      processor: (result: Task[]): { tasks: Task[] } => ({ tasks: result }),
      writes: { tasks: true },
      // Cast inline, not annotated directly -- createData's own generic
      // inference widens an individual operation definition while checking
      // it against DataSchema's own bound, which would otherwise conflict
      // with a narrower parameter annotation here (a contravariant
      // position).
      optimistic: (
        authoritativeState: unknown,
        params: { id: string },
      ): { tasks: Task[] } | undefined => {
        const current = (authoritativeState as { fields: { tasks: Task[] } }).fields.tasks
        if (current.every((task) => task.id !== params.id)) return undefined
        return {
          tasks: current.map((task) =>
            task.id === params.id ? { ...task, done: !task.done } : task,
          ),
        }
      },
    },
    deleteTask: {
      params: { id: "" },
      execute: (params: { id: string }, signal: AbortSignal): Promise<Task[]> =>
        deleteTaskRemote(params.id, signal),
      processor: (result: Task[]): { tasks: Task[] } => ({ tasks: result }),
      writes: { tasks: true },
      optimistic: (
        authoritativeState: unknown,
        params: { id: string },
      ): { tasks: Task[] } | undefined => {
        const current = (authoritativeState as { fields: { tasks: Task[] } }).fields.tasks
        return { tasks: current.filter((task) => task.id !== params.id) }
      },
    },
  },
  subscriptions: {
    // Deliberately targets `selectedTask` (nullable), not `tasks` (array) --
    // an array field's own `info` is a per-item-identity-keyed map, not a
    // flat `FieldInfo`, so `info.tasks?.subscription?.status` wouldn't be
    // the connection status at all (see `examples/team-service/`'s own
    // `board`-vs-`tasks` split for the same reasoning, proven there first).
    subscribeToTask: {
      params: { id: "" },
      subscribe: (
        _params: { id: string },
        handlers: {
          onEvent(event: never): void
          onStatusChange(status: "connecting" | "connected" | "disconnected"): void
        },
      ): (() => void) => {
        handlers.onStatusChange("connecting")
        const timer = setTimeout(() => {
          handlers.onStatusChange("connected")
        }, 5)
        return () => {
          clearTimeout(timer)
          handlers.onStatusChange("disconnected")
        }
      },
      writes: { selectedTask: true },
    },
  },
}

export const taskData = createData(taskSchema)

documentData(taskSchema, {
  name: "tasks",
  owner: "productivity-team",
  purpose: "Letting an individual track and complete their own work items.",
  legalBasis: "contract",
  dataResidency: "us",
  fields: {
    tasks: {
      description: "The current user's own task list.",
      sensitivity: "internal",
      protections: "Session-authenticated access only; TLS in transit.",
      purpose: "Displaying and managing the user's own work items.",
    },
    selectedTask: {
      description: "One task's own full detail -- null until the first successful getTask().",
      sensitivity: "internal",
      protections: "Session-authenticated access only; TLS in transit.",
      purpose: "Displaying a single task's detail view.",
    },
  },
  getters: {
    getTasks: {
      description: "Fetches the full task list, cached across remounts.",
      source: "tasks-api",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "tasks-api",
          url: "https://api.example.com/v1/tasks",
          handling: "plaintext",
        },
      ],
    },
    getTask: {
      description: "Fetches one task's own full detail by id.",
      source: "tasks-api",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "tasks-api",
          url: "https://api.example.com/v1/tasks/:id",
          handling: "plaintext",
        },
      ],
    },
  },
  mutators: {
    createTask: {
      description: "Adds a new task to the list.",
      source: "tasks-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "tasks-api",
          url: "https://api.example.com/v1/tasks",
          handling: "plaintext",
        },
      ],
    },
    toggleTask: {
      description: "Marks a task complete or incomplete.",
      source: "tasks-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "tasks-api",
          url: "https://api.example.com/v1/tasks/:id/toggle",
          handling: "plaintext",
        },
      ],
    },
    deleteTask: {
      description: "Removes a task from the list.",
      source: "tasks-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "tasks-api",
          url: "https://api.example.com/v1/tasks/:id",
          handling: "plaintext",
        },
      ],
    },
  },
  subscriptions: {
    subscribeToTask: { description: "Live connection status for the currently-viewed task." },
  },
})

// =========================================================================
// The story: load the task list (cached + deduped), load one task's own
// detail (a nullable field), create/toggle/delete tasks (optimistic +
// retry), cancel an in-flight request, and hold a live subscription --
// exactly the individual-developer feature surface this tier exists to
// prove, against the real, built, installed package.
// =========================================================================

// -- Concurrent getTasks calls dedup to one real fetch -- the runtime's -- //
// -- own dedup, never application code hand-wiring it. `tasks` is an -- //
// -- array field, so (like examples/team-service/'s own `tasks` field) -- //
// -- its own `info` is a per-item-identity-keyed map, not a flat -- //
// -- FieldInfo -- status/fetchedAt/optimistic are checked on -- //
// -- `selectedTask` (nullable) below instead, where they're meaningful. -- //
const [firstLoad, secondLoad] = await Promise.all([taskData.getTasks({}), taskData.getTasks({})])
assert.equal(fetchTasksCallCount, 1, "two concurrent getTasks calls must dedup to one real fetch")
assert.equal(firstLoad.tasks?.length, 2)
assert.equal(secondLoad.tasks?.length, 2)

// -- A later, non-concurrent "remount" call hits the cache -- no new -- //
// -- network call at all. -- //
await taskData.getTasks({})
assert.equal(fetchTasksCallCount, 1, "a cache hit must never trigger a real fetch")

// -- getTask populates the nullable selectedTask field -- loading/error/ -- //
// -- success status and a fetch timestamp are both meaningful here. -- //
assert.equal(taskData.getSnapshot().fields.selectedTask, null)
await taskData.getTask({ id: "task-1" })
assert.equal(taskData.getSnapshot().fields.selectedTask?.title, "Write the quarterly report")
assert.equal(taskData.getSnapshot().info.selectedTask?.status, "success")

// -- Abort/cancellation: an externally-supplied AbortSignal cancels an -- //
// -- in-flight getter call, and the rejection carries no partial state. -- //
const abortController = new AbortController()
const abortedCall = taskData.getTask({ id: "task-2" }, abortController.signal)
abortController.abort()
await assert.rejects(abortedCall)
assert.equal(
  taskData.getSnapshot().fields.selectedTask?.title,
  "Write the quarterly report",
  "an aborted call must never overwrite the last known-good value",
)

// -- createTask, composed with the real, shipped withRetry -- the first -- //
// -- attempt fails, withRetry retries, the second attempt succeeds. -- //
const createController = new AbortController()
await withRetry(
  (signal) => taskData.createTask({ title: "Ship the release notes", priority: "high" }, signal),
  createController.signal,
  { maxAttempts: 3, delayMs: () => 1 },
)
assert.equal(createAttempts, 2, "the first attempt failed; withRetry retried once and succeeded")
assert.equal(taskData.getSnapshot().fields.tasks.length, 3)

// -- toggleTask completes optimistically, before the request settles, -- //
// -- then confirms against the real response. -- //
const togglePromise = taskData.toggleTask({ id: "task-1" })
assert.equal(
  taskData.getSnapshot().fields.tasks.find((t) => t.id === "task-1")?.done,
  true,
  "the optimistic flip is visible immediately, before the request settles",
)
await togglePromise
assert.equal(taskData.getSnapshot().fields.tasks.find((t) => t.id === "task-1")?.done, true)

// -- deleteTask removes a task optimistically too. -- //
await taskData.deleteTask({ id: "task-2" })
assert.equal(taskData.getSnapshot().fields.tasks.some((t) => t.id === "task-2"), false)

// -- subscription lifecycle -- //
const unsubscribeTask = taskData.subscribeToTask({ id: "task-1" })
await new Promise((resolve) => setTimeout(resolve, 15))
assert.equal(taskData.getSnapshot().info.selectedTask?.subscription?.status, "connected")
unsubscribeTask()
assert.equal(taskData.getSnapshot().info.selectedTask?.subscription?.status, "disconnected")

console.log("application: all assertions passed.")
