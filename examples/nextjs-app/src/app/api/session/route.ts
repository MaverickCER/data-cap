import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { findUser, users } from "@/lib/store"
import { SESSION_COOKIE_NAME, signSessionCookie, verifySessionCookie } from "@/lib/session"

export async function GET(): Promise<NextResponse> {
  const jar = await cookies()
  const user = verifySessionCookie(jar.get(SESSION_COOKIE_NAME)?.value)
  return NextResponse.json({ user: user ?? null, users })
}

/** Demo login switcher -- picks one of the three seeded users, no password. Real authentication is out of scope; real, server-enforced AUTHORIZATION once a session exists is the point (see api/todos/route.ts). */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { userId?: unknown }
  if (typeof body.userId !== "string" || !findUser(body.userId)) {
    return NextResponse.json({ error: "unknown userId" }, { status: 400 })
  }
  const jar = await cookies()
  jar.set(SESSION_COOKIE_NAME, signSessionCookie(body.userId), { httpOnly: true, sameSite: "lax" })
  return NextResponse.json({ user: findUser(body.userId) })
}

export async function DELETE(): Promise<NextResponse> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE_NAME)
  return NextResponse.json({ user: null })
}
