/**
 * One project's own metadata and case tasks -- owned by the project team.
 * `getProject`'s own `execute` composes with `member.capability.ts`
 * directly: it calls `memberData.listMembers(...)` to resolve each task's
 * `assigneeId` into a real name, rather than this "backend" (`server/
 * projects.ts`) joining across the member directory itself (a real backend
 * wouldn't join across service boundaries either). This is ordinary
 * cross-file application code -- no data-cap composition primitive exists
 * or is needed -- and it stays fully analyzable: `memberData` being a real,
 * proven dependency of `projectData` shows up in this example's own
 * generated `docs/OWNERSHIP.md`.
 */
import { documentData, fields } from "data-cap"
import { createData } from "data-cap/runtime"
import type { Project, RawTask } from "../server/projects.js"
import { assignTaskRemote, createTaskRemote, fetchProjectRemote, toggleTaskRemote } from "../server/projects.js"
import { memberData } from "./member.capability.js"

export type { Project }

export interface Task {
  readonly id: string
  readonly title: string
  readonly done: boolean
  readonly assigneeId: string | null
  readonly assigneeName: string | null
}

async function withAssigneeNames(rawTasks: readonly RawTask[], signal: AbortSignal): Promise<Task[]> {
  await memberData.listMembers({}, signal)
  const members = memberData.getSnapshot().fields.members
  return rawTasks.map((task) => ({
    ...task,
    assigneeName: members.find((member) => member.id === task.assigneeId)?.name ?? null,
  }))
}

const projectSchema = {
  fields: {
    project: fields.nullable<Project>({ id: "", name: "" }),
    tasks: [] as Task[],
  },
  getters: {
    getProject: {
      params: { id: "" },
      execute: async (
        params: { id: string },
        signal: AbortSignal,
      ): Promise<{ project: Project; tasks: Task[] }> => {
        const raw = await fetchProjectRemote(params.id, signal)
        const tasks = await withAssigneeNames(raw.tasks, signal)
        return { project: raw.project, tasks }
      },
      processor: (result: {
        project: Project
        tasks: Task[]
      }): { project: Project; tasks: Task[] } => result,
      writes: { project: true, tasks: true },
    },
  },
  mutators: {
    createTask: {
      params: { projectId: "", title: "" },
      execute: async (
        params: { projectId: string; title: string },
        signal: AbortSignal,
      ): Promise<Task[]> => {
        const raw = await createTaskRemote(params.projectId, params.title, signal)
        return withAssigneeNames(raw, signal)
      },
      processor: (result: Task[]): { tasks: Task[] } => ({ tasks: result }),
      writes: { tasks: true },
    },
    toggleTask: {
      params: { projectId: "", taskId: "" },
      execute: async (
        params: { projectId: string; taskId: string },
        signal: AbortSignal,
      ): Promise<Task[]> => {
        const raw = await toggleTaskRemote(params.projectId, params.taskId, signal)
        return withAssigneeNames(raw, signal)
      },
      processor: (result: Task[]): { tasks: Task[] } => ({ tasks: result }),
      writes: { tasks: true },
      // Cast inline, not annotated directly -- createData's own generic
      // inference widens an individual operation definition while checking
      // it against DataSchema's own bound, which would otherwise conflict
      // with a narrower parameter annotation here (a contravariant
      // position).
      optimistic: (
        authoritativeState: unknown,
        params: { projectId: string; taskId: string },
      ): { tasks: Task[] } | undefined => {
        const current = (authoritativeState as { fields: { tasks: Task[] } }).fields.tasks
        if (current.every((task) => task.id !== params.taskId)) return undefined
        return {
          tasks: current.map((task) =>
            task.id === params.taskId ? { ...task, done: !task.done } : task,
          ),
        }
      },
    },
    assignTask: {
      params: { projectId: "", taskId: "", memberId: "" },
      execute: async (
        params: { projectId: string; taskId: string; memberId: string },
        signal: AbortSignal,
      ): Promise<Task[]> => {
        const raw = await assignTaskRemote(params.projectId, params.taskId, params.memberId, signal)
        return withAssigneeNames(raw, signal)
      },
      processor: (result: Task[]): { tasks: Task[] } => ({ tasks: result }),
      writes: { tasks: true },
    },
  },
  subscriptions: {
    subscribeToProject: {
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
      writes: { project: true },
    },
  },
}

export const projectData = createData(projectSchema)

documentData(projectSchema, {
  name: "project",
  owner: "project-team",
  purpose: "Tracking one project's own case tasks and their assignees.",
  legalBasis: "contract",
  dataResidency: "us",
  fields: {
    project: {
      description: "The current project's own metadata -- null until the first getProject().",
      sensitivity: "internal",
      protections: "Session-authenticated access only; TLS in transit.",
    },
    tasks: {
      description: "Every task on the current project, with assignee names resolved.",
      sensitivity: "internal",
      protections: "Session-authenticated access only; TLS in transit.",
      purpose: "Displaying and managing the project's own work items.",
    },
  },
  getters: {
    getProject: {
      description: "Fetches a project and its tasks, resolving each task's assignee name.",
      source: "projects-api",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "projects-api",
          url: "https://api.example.com/v1/projects/:id",
          handling: "plaintext",
        },
      ],
    },
  },
  mutators: {
    createTask: {
      description: "Adds a new task to the project.",
      source: "projects-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "projects-api",
          url: "https://api.example.com/v1/projects/:id/tasks",
          handling: "plaintext",
        },
      ],
    },
    toggleTask: {
      description: "Marks a task complete or incomplete.",
      source: "projects-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "projects-api",
          url: "https://api.example.com/v1/projects/:id/tasks/:taskId/toggle",
          handling: "plaintext",
        },
      ],
    },
    assignTask: {
      description: "Reassigns a task to a different team member.",
      source: "projects-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "projects-api",
          url: "https://api.example.com/v1/projects/:id/tasks/:taskId/assign",
          handling: "plaintext",
        },
      ],
    },
  },
  subscriptions: {
    subscribeToProject: { description: "Live connection status for the current project." },
  },
})
