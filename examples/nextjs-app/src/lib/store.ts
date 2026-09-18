export interface Todo {
  id: string
  userId: string
  title: string
  completed: boolean
  createdAt: string
}

export interface User {
  id: string
  displayName: string
  role: "user" | "admin"
}

// Deliberately in-memory -- this example exists to prove the user/admin
// authorization model around Todo data, not to demonstrate a real
// persistence layer.
export const users: readonly User[] = [
  { id: "alice", displayName: "Alice", role: "user" },
  { id: "bob", displayName: "Bob", role: "user" },
  { id: "carol-admin", displayName: "Carol (admin)", role: "admin" },
]

const todos = new Map<string, Todo>([
  [
    "seed-1",
    {
      id: "seed-1",
      userId: "alice",
      title: "Alice's private todo",
      completed: false,
      createdAt: new Date().toISOString(),
    },
  ],
  [
    "seed-2",
    {
      id: "seed-2",
      userId: "bob",
      title: "Bob's private todo",
      completed: false,
      createdAt: new Date().toISOString(),
    },
  ],
])

export function findUser(id: string): User | undefined {
  return users.find((user) => user.id === id)
}

/** A user's own todos only -- the default, ownership-respecting view. */
export function listOwnTodos(userId: string): Todo[] {
  return [...todos.values()]
    .filter((todo) => todo.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Every todo, regardless of owner -- callable only from the route handler's
 * explicit-admin-authorization branch (see route.ts's `?all=true` handling).
 * Named separately from `listOwnTodos`, never a mode flag on one function, so
 * the privilege escalation is visible at every call site instead of hiding
 * behind a boolean argument a future edit could flip by accident.
 */
export function listAllTodos(): Todo[] {
  return [...todos.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function addTodo(userId: string, title: string): Todo {
  const todo: Todo = {
    id: crypto.randomUUID(),
    userId,
    title,
    completed: false,
    createdAt: new Date().toISOString(),
  }
  todos.set(todo.id, todo)
  return todo
}

/** Toggles a todo -- only if `actor` owns it, or `actor` is an admin. Returns undefined for "not found" or "not authorized" alike, never distinguishing the two to a non-owner (see route.ts). */
export function toggleTodo(actor: User, id: string): Todo | undefined {
  const todo = todos.get(id)
  if (!todo) return undefined
  if (todo.userId !== actor.id && actor.role !== "admin") return undefined
  const updated: Todo = { ...todo, completed: !todo.completed }
  todos.set(id, updated)
  return updated
}

/** Deletes a todo -- only if `actor` owns it, or `actor` is an admin. */
export function deleteTodo(actor: User, id: string): boolean {
  const todo = todos.get(id)
  if (!todo) return false
  if (todo.userId !== actor.id && actor.role !== "admin") return false
  return todos.delete(id)
}
