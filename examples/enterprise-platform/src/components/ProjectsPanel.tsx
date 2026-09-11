/**
 * Every department's own projects, in one list -- `projectsData` is owned
 * by engineering-ops (see `projects.capability.ts`'s own header comment),
 * but every department reads it here through the exact same capability;
 * ownership is a governance/documentation fact `documentData()` records,
 * never an access-control boundary `createData` itself enforces.
 */
import { useEffect, useState } from "react"
import { projectsData, type Project } from "../capabilities/projects.capability.js"
import { useCapability } from "../hooks/useCapability.js"

export interface ProjectsPanelProps {
  readonly onOpenProject: (projectId: string) => void
}

export function ProjectsPanel({ onOpenProject }: ProjectsPanelProps): React.JSX.Element {
  const snapshot = useCapability(projectsData)
  const [name, setName] = useState("")
  const [department, setDepartment] = useState<Project["department"]>("engineering")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void projectsData.listProjects()
  }, [])

  return (
    <section>
      <h2>Projects</h2>
      <ul>
        {snapshot.fields.projects.map((project) => (
          <li key={project.id}>
            <button type="button" onClick={() => onOpenProject(project.id)}>
              {project.name} -- {project.department}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setSubmitting(true)
          void projectsData.createProject({ name, department }).finally(() => setSubmitting(false))
          setName("")
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Project name"
          required
        />
        <select
          value={department}
          onChange={(event) => setDepartment(event.target.value as Project["department"])}
        >
          <option value="engineering">Engineering</option>
          <option value="finance">Finance</option>
          <option value="sales">Sales</option>
        </select>
        <button type="submit" disabled={submitting}>
          Open project
        </button>
      </form>
    </section>
  )
}
