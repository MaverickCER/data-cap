"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { todoData } from "@/features/todos/data.schema"
import type { User } from "@/lib/store"

interface TodoAppProps {
  initialUser: User | null
  users: readonly User[]
}

export function TodoApp({ initialUser, users }: TodoAppProps) {
  const [user, setUser] = useState<User | null>(initialUser)
  const [title, setTitle] = useState("")
  const [showAll, setShowAll] = useState(false)

  // The idiomatic data-cap read: `todoData.getSnapshot().fields.todos` is a
  // real, statically-detectable field read (unlike destructuring a getter's
  // own return value, which `npm run docs`'s dependency scan does NOT credit
  // as a read -- confirmed directly: without this, `docs/OWNERSHIP.md` flags
  // a genuine UNCONSUMED_FIELD finding on `todos`). `subscribe`/`getSnapshot`
  // are exactly `useSyncExternalStore`'s shape, so this component re-renders
  // on every optimistic update and settled response without any manual
  // `useState` mirroring.
  // Third argument (getServerSnapshot) is required for a "use client"
  // component that's actually server-rendered (confirmed empirically:
  // omitting it throws "Missing getServerSnapshot" and silently falls back
  // to client-only rendering under `next start`). `todoData.getSnapshot`
  // works identically server- or client-side -- it reads the capability's
  // own in-memory state, never `window`/`document` -- so the same function
  // is correct for both arguments, unlike a typical browser-API-backed store.
  const snapshot = useSyncExternalStore(
    todoData.subscribe,
    todoData.getSnapshot,
    todoData.getSnapshot,
  )
  const todos = snapshot.fields.todos

  useEffect(() => {
    if (user) void todoData.getTodos({ all: showAll })
  }, [user, showAll])

  async function switchUser(userId: string): Promise<void> {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    })
    const data = (await res.json()) as { user: User }
    setShowAll(false)
    setUser(data.user)
  }

  async function signOut(): Promise<void> {
    await fetch("/api/session", { method: "DELETE" })
    setShowAll(false)
    setUser(null)
  }

  async function handleAdd(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!title.trim()) return
    await todoData.createTodo({ title, all: showAll })
    setTitle("")
  }

  if (!user) {
    return (
      <main>
        <h1>data-cap todos</h1>
        <p>Sign in as:</p>
        <ul>
          {users.map((candidate) => (
            <li key={candidate.id}>
              <button type="button" onClick={() => void switchUser(candidate.id)}>
                {candidate.displayName}
              </button>
            </li>
          ))}
        </ul>
      </main>
    )
  }

  return (
    <main>
      <h1>data-cap todos</h1>
      <p>
        Signed in as {user.displayName} ({user.role}) --{" "}
        <button type="button" onClick={() => void signOut()}>
          switch user
        </button>
      </p>
      {user.role === "admin" && (
        <label>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          Show every user&apos;s todos (explicit admin view)
        </label>
      )}
      <form onSubmit={handleAdd}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a todo"
        />
        <button type="submit">Add</button>
      </form>
      <ul>
        {(todos ?? []).map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => void todoData.toggleTodo({ id: todo.id, all: showAll })}
              />
              {todo.title}
              {showAll && ` (owner: ${todo.userId})`}
            </label>
            <button
              type="button"
              onClick={() => void todoData.deleteTodo({ id: todo.id, all: showAll })}
            >
              delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
