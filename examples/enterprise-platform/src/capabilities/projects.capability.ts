/**
 * The org-wide project directory -- every department's own projects, in one
 * list. Owned by engineering-ops. This is the same "project" concept
 * `examples/team-service/`'s own `project.capability.ts` tracks for one
 * team; here it's every team's, which is exactly the scale-up this tier
 * exists to demonstrate -- multiple departments, each with their own
 * capabilities (`billing.capability.ts` is finance's own), all
 * independently analyzable together.
 */
import { documentData } from "data-cap"
import { createData } from "data-cap/runtime"
import { apiFetch } from "./api-client.js"

export interface Project {
  readonly id: string
  readonly name: string
  readonly ownerId: string
  readonly department: "engineering" | "finance" | "sales"
  readonly createdAt: string
}

const projectsSchema = {
  fields: {
    projects: [] as Project[],
  },
  getters: {
    listProjects: {
      params: {},
      execute: (_params: object, signal: AbortSignal): Promise<{ projects: Project[] }> =>
        apiFetch("/api/projects", { signal }),
      processor: (result: { projects: Project[] }): { projects: Project[] } => result,
      writes: { projects: true },
    },
  },
  mutators: {
    createProject: {
      params: { name: "", department: "engineering" as Project["department"] },
      execute: async (
        params: { name: string; department: Project["department"] },
        signal: AbortSignal,
      ): Promise<{ projects: Project[] }> => {
        await apiFetch("/api/projects", { method: "POST", body: JSON.stringify(params), signal })
        return apiFetch("/api/projects", { signal })
      },
      processor: (result: { projects: Project[] }): { projects: Project[] } => result,
      writes: { projects: true },
    },
  },
}

export const projectsData = createData(projectsSchema)

documentData(projectsSchema, {
  name: "projects",
  owner: "engineering-ops",
  purpose: "Letting every department see and open the projects they own.",
  legalBasis: "contract",
  dataResidency: "us",
  fields: {
    projects: {
      description: "Every project across every department.",
      sensitivity: "internal",
      protections: "Session-authenticated access only; TLS in transit.",
      purpose: "Cross-department project navigation.",
    },
  },
  getters: {
    listProjects: {
      description: "Fetches every project across every department.",
      source: "projects-api",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "projects-api",
          url: "https://api.example.com/v1/projects",
          handling: "plaintext",
        },
      ],
    },
  },
  mutators: {
    createProject: {
      description: "Opens a new project for a department.",
      source: "projects-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "projects-api",
          url: "https://api.example.com/v1/projects",
          handling: "plaintext",
        },
      ],
    },
  },
})
