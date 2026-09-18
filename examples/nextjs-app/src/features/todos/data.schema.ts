import { documentData } from "data-cap"
import { createData } from "data-cap/runtime"

export interface Todo {
  readonly id: string
  readonly userId: string
  readonly title: string
  readonly completed: boolean
  readonly createdAt: string
}

async function fetchTodos(all: boolean, signal: AbortSignal): Promise<Todo[]> {
  const res = await fetch(`/api/todos${all ? "?all=true" : ""}`, { signal })
  if (!res.ok) throw new Error(`GET /api/todos failed: ${String(res.status)}`)
  const body = (await res.json()) as { todos: Todo[] }
  return body.todos
}

async function createTodoRemote(title: string, all: boolean, signal: AbortSignal): Promise<Todo[]> {
  const res = await fetch("/api/todos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
    signal,
  })
  if (!res.ok) throw new Error(`POST /api/todos failed: ${String(res.status)}`)
  return fetchTodos(all, signal)
}

async function toggleTodoRemote(id: string, all: boolean, signal: AbortSignal): Promise<Todo[]> {
  const res = await fetch("/api/todos", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
    signal,
  })
  if (!res.ok) throw new Error(`PATCH /api/todos failed: ${String(res.status)}`)
  return fetchTodos(all, signal)
}

async function deleteTodoRemote(id: string, all: boolean, signal: AbortSignal): Promise<Todo[]> {
  const res = await fetch("/api/todos", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
    signal,
  })
  if (!res.ok) throw new Error(`DELETE /api/todos failed: ${String(res.status)}`)
  return fetchTodos(all, signal)
}

// One schema, passed to both createData (the client-side capability) and
// documentData (its governance metadata) -- not two separately-typed config
// objects, matching examples/application's own convention. `todos` is an
// array field: the ownership/isolation enforcement below is entirely
// server-side (see ../../app/api/todos/route.ts) -- this client capability
// only ever sees the slice of data the server already decided this session
// is allowed to see.
const todoSchema = {
  fields: {
    todos: [] as Todo[],
  },
  getters: {
    // `all` (default false): the regular own-todos-only view. An admin
    // passes `{ all: true }` to explicitly request every user's todos --
    // see route.ts's identical reasoning for why this is a param, not a
    // silent default.
    getTodos: {
      params: { all: false },
      execute: (params: { all: boolean }, signal: AbortSignal): Promise<Todo[]> =>
        fetchTodos(params.all, signal),
      processor: (result: Todo[]): { todos: Todo[] } => ({ todos: result }),
      writes: { todos: true },
    },
  },
  mutators: {
    createTodo: {
      params: { title: "", all: false },
      execute: (params: { title: string; all: boolean }, signal: AbortSignal): Promise<Todo[]> =>
        createTodoRemote(params.title, params.all, signal),
      processor: (result: Todo[]): { todos: Todo[] } => ({ todos: result }),
      writes: { todos: true },
    },
    toggleTodo: {
      params: { id: "", all: false },
      execute: (params: { id: string; all: boolean }, signal: AbortSignal): Promise<Todo[]> =>
        toggleTodoRemote(params.id, params.all, signal),
      processor: (result: Todo[]): { todos: Todo[] } => ({ todos: result }),
      writes: { todos: true },
      // Cast inline (not annotated directly) -- same reason as
      // examples/application's identical pattern: createData's own generic
      // inference would otherwise conflict with a narrower parameter
      // annotation in this contravariant position.
      optimistic: (
        authoritativeState: unknown,
        params: { id: string },
      ): { todos: Todo[] } | undefined => {
        const current = (authoritativeState as { fields: { todos: Todo[] } }).fields.todos
        if (current.every((todo) => todo.id !== params.id)) return undefined
        return {
          todos: current.map((todo) =>
            todo.id === params.id ? { ...todo, completed: !todo.completed } : todo,
          ),
        }
      },
    },
    deleteTodo: {
      params: { id: "", all: false },
      execute: (params: { id: string; all: boolean }, signal: AbortSignal): Promise<Todo[]> =>
        deleteTodoRemote(params.id, params.all, signal),
      processor: (result: Todo[]): { todos: Todo[] } => ({ todos: result }),
      writes: { todos: true },
      optimistic: (
        authoritativeState: unknown,
        params: { id: string },
      ): { todos: Todo[] } | undefined => {
        const current = (authoritativeState as { fields: { todos: Todo[] } }).fields.todos
        return { todos: current.filter((todo) => todo.id !== params.id) }
      },
    },
  },
}

export const todoData = createData(todoSchema)

documentData(todoSchema, {
  name: "todos",
  owner: "productivity-team",
  purpose: "Letting a signed-in user track and complete their own work items.",
  legalBasis: "contract",
  dataResidency: "us",
  fields: {
    todos: {
      description:
        "The current session's own todos -- a regular user's own list, or, for an admin who explicitly requested it (?all=true), every user's todos. Server-side authorization (src/app/api/todos/route.ts), not this client capability, is what decides which rows a given response actually contains.",
      sensitivity: "internal",
      protections:
        "Session-authenticated access only; the server enforces per-user ownership and admin-only cross-user access -- this field never receives data the requesting session isn't authorized to see.",
      retention: "Deleted when the owning user deletes the todo, or deletes their account.",
      purpose: "Displaying and managing work items in the todo list UI.",
    },
  },
  getters: {
    getTodos: {
      description: "Fetches the current session's todos (own-only for a user; all, only if explicitly requested, for an admin).",
      source: "todos-api",
      endpoints: [
        { direction: "input", kind: "api", name: "todos-api", url: "/api/todos", handling: "plaintext" },
      ],
    },
  },
  mutators: {
    createTodo: {
      description: "Adds a new todo, owned by the current session's user.",
      source: "todos-api",
      endpoints: [
        { direction: "output", kind: "api", name: "todos-api", url: "/api/todos", handling: "plaintext" },
      ],
    },
    toggleTodo: {
      description: "Marks a todo complete or incomplete -- the owner, or an admin.",
      source: "todos-api",
      endpoints: [
        { direction: "output", kind: "api", name: "todos-api", url: "/api/todos", handling: "plaintext" },
      ],
    },
    deleteTodo: {
      description: "Removes a todo -- the owner, or an admin.",
      source: "todos-api",
      endpoints: [
        { direction: "output", kind: "api", name: "todos-api", url: "/api/todos", handling: "plaintext" },
      ],
    },
  },
})
