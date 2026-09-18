import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { addTodo, deleteTodo, listAllTodos, listOwnTodos, toggleTodo } from "@/lib/store"
import type { User } from "@/lib/store"
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/session"

async function requireUser(): Promise<User | undefined> {
  const jar = await cookies()
  return verifySessionCookie(jar.get(SESSION_COOKIE_NAME)?.value)
}

/**
 * The real authorization model this example exists to prove: a regular user
 * always sees only their own todos; an admin sees every user's todos ONLY
 * when they explicitly ask for it (`?all=true`), never by default. The query
 * param is what makes the admin's elevated view an explicit, visible action
 * at the call site rather than a silent default a future change could widen
 * by accident -- the same reasoning `listAllTodos` (see store.ts) is a
 * separately named function rather than a boolean flag on `listOwnTodos`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 })

  const wantsAll = new URL(request.url).searchParams.get("all") === "true"
  if (wantsAll && user.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 })
  }

  const todos = wantsAll ? listAllTodos() : listOwnTodos(user.id)
  return NextResponse.json({ todos })
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 })

  const body = (await request.json()) as { title?: unknown }
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 })
  }
  return NextResponse.json({ todo: addTodo(user.id, body.title.trim()) }, { status: 201 })
}

/** The owner, or an admin -- store.ts's own toggleTodo() enforces this, not this handler; a non-owner, non-admin gets 404, not 403, so a user can never learn a todo id exists just by trying to toggle it. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 })

  const body = (await request.json()) as { id?: unknown }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }
  const todo = toggleTodo(user, body.id)
  if (!todo) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ todo })
}

/** The owner, or an admin -- same not-found-not-forbidden reasoning as PATCH above. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 })

  const body = (await request.json()) as { id?: unknown }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }
  const deleted = deleteTodo(user, body.id)
  if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
