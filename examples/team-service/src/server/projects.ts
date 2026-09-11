/**
 * Simulated backend state for projects and their own case tasks -- shared,
 * in-memory state standing in for a real database/API, imported by
 * `capabilities/project.capability.ts`.
 */
export interface Project {
  readonly id: string
  readonly name: string
}

/** The raw task shape this "backend" returns -- `assigneeId` only, never a
 * name. Resolving `assigneeId` to a real name is `project.capability.ts`'s
 * own job, composing with `member.capability.ts` to do it -- never this
 * simulated backend's concern (a real backend wouldn't join across service
 * boundaries either). */
export interface RawTask {
  readonly id: string
  readonly title: string
  readonly done: boolean
  readonly assigneeId: string | null
}

const projects: Record<string, Project> = {
  "project-1": { id: "project-1", name: "Q3 Platform Migration" },
}
const tasksByProject: Record<string, RawTask[]> = {
  "project-1": [
    { id: "task-1", title: "Draft the migration plan", done: false, assigneeId: "member-1" },
    { id: "task-2", title: "Review security implications", done: false, assigneeId: "member-2" },
  ],
}

let createTaskAttempts = 0

export function resetCreateTaskAttempts(): void {
  createTaskAttempts = 0
}

export async function fetchProjectRemote(
  id: string,
  signal: AbortSignal,
): Promise<{ project: Project; tasks: RawTask[] }> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  const project = projects[id]
  if (project === undefined) throw new Error(`no project with id ${id}`)
  return { project, tasks: (tasksByProject[id] ?? []).map((task) => ({ ...task })) }
}

export async function createTaskRemote(
  projectId: string,
  title: string,
  signal: AbortSignal,
): Promise<RawTask[]> {
  createTaskAttempts += 1
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  // The first attempt always fails -- proves withRetry composes directly
  // with a generated mutator method, same demonstration as examples/application/.
  if (createTaskAttempts === 1) throw new Error("simulated transient failure")
  const existing = tasksByProject[projectId] ?? []
  const created: RawTask = {
    id: `task-${String(existing.length + 1)}`,
    title,
    done: false,
    assigneeId: null,
  }
  tasksByProject[projectId] = [...existing, created]
  return tasksByProject[projectId]!.map((task) => ({ ...task }))
}

export async function toggleTaskRemote(
  projectId: string,
  taskId: string,
  signal: AbortSignal,
): Promise<RawTask[]> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  const tasks = tasksByProject[projectId] ?? []
  const index = tasks.findIndex((t) => t.id === taskId)
  if (index === -1) throw new Error(`no task with id ${taskId} on project ${projectId}`)
  const existing = tasks[index]!
  tasks[index] = { ...existing, done: !existing.done }
  tasksByProject[projectId] = tasks
  return tasks.map((task) => ({ ...task }))
}

export async function assignTaskRemote(
  projectId: string,
  taskId: string,
  memberId: string,
  signal: AbortSignal,
): Promise<RawTask[]> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  const tasks = tasksByProject[projectId] ?? []
  const index = tasks.findIndex((t) => t.id === taskId)
  if (index === -1) throw new Error(`no task with id ${taskId} on project ${projectId}`)
  const existing = tasks[index]!
  tasks[index] = { ...existing, assigneeId: memberId }
  tasksByProject[projectId] = tasks
  return tasks.map((task) => ({ ...task }))
}
