import { cookies } from "next/headers"
import { users } from "@/lib/store"
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/session"
import { TodoApp } from "./todo-app"

export default async function Page() {
  // Reading `cookies()` here makes this route dynamic automatically (Next's
  // App Router opts a route out of static generation the moment it reads a
  // request-specific API) -- no `export const dynamic = "force-dynamic"`
  // needed, unlike env-cap-nextjs, which needs it for an unrelated reason
  // (see that example's README).
  const jar = await cookies()
  const initialUser = verifySessionCookie(jar.get(SESSION_COOKIE_NAME)?.value) ?? null

  return <TodoApp initialUser={initialUser} users={users} />
}
