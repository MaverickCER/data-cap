/**
 * Hand-rolled session auth -- deliberately not a library, and deliberately
 * not what secures the SSE endpoint's own subscription semantics (that's
 * `sse.ts`'s job, see its own header comment). `data-cap` has no
 * authentication concept of its own; this is the boundary a real deployment
 * has to bring itself, same as the database and email provider below it.
 *
 * `node:crypto`'s `scrypt` (never a fast general-purpose hash) for password
 * storage, and a random, unguessable session token stored server-side in
 * `sessions` (an in-memory Map here -- a real deployment would use a
 * database-backed or Redis-backed store instead; swapping it doesn't change
 * anything above this module).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

export interface Session {
  readonly userId: string
  readonly email: string
  readonly role: "admin" | "member"
}

const sessions = new Map<string, Session>()

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const derived = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${derived}`
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, derived] = storedHash.split(":")
  if (salt === undefined || derived === undefined) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(derived, "hex")
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function createSession(session: Session): string {
  const token = randomBytes(32).toString("hex")
  sessions.set(token, session)
  return token
}

export function getSession(token: string | undefined): Session | undefined {
  if (token === undefined) return undefined
  return sessions.get(token)
}

export function destroySession(token: string): void {
  sessions.delete(token)
}
