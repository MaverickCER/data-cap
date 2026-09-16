import "server-only"

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { findUser } from "./store"
import type { User } from "./store"

// Stored on `globalThis`, not a plain module-level `const` -- confirmed
// empirically that a plain `const` produces a DIFFERENT random value per
// route (logged two different prefixes for `/api/session` and `/` in the
// same running `next start` process): Turbopack code-splits this app into
// separate chunks (the same phenomenon env-cap-nextjs's README documents for
// env-cap's own module-level "ready" state), and each chunk gets its own
// bundled copy of this module, each evaluating `randomBytes(32)` separately.
// A cookie signed by one chunk's secret would silently fail verification by
// another's, with no thrown error -- worse than env-cap-nextjs's version of
// this bug, which at least crashed loudly. `globalThis` is the one thing
// every chunk in the same process genuinely shares, so keying off it there
// is a real fix, not a workaround: this is plain, ordinary process-local
// randomness (there's no env-cap contract in this example -- that boundary
// is env-cap-nextjs's story, not data-cap's), not a declared/governed
// secret, but signing the cookie at all still matters -- an unsigned "which
// user am I" cookie would let a client simply edit it to claim admin, which
// is exactly the kind of vulnerability this example's whole point -- real
// server-side authorization -- exists to avoid modeling badly.
const SESSION_SECRET_KEY = Symbol.for("data-cap-example-nextjs.session-secret")
const globalWithSecret = globalThis as typeof globalThis & { [SESSION_SECRET_KEY]?: string }
globalWithSecret[SESSION_SECRET_KEY] ??= randomBytes(32).toString("hex")
const SESSION_SECRET = globalWithSecret[SESSION_SECRET_KEY]

function sign(userId: string): string {
  return createHmac("sha256", SESSION_SECRET).update(userId).digest("hex")
}

export function signSessionCookie(userId: string): string {
  return `${userId}.${sign(userId)}`
}

export function verifySessionCookie(cookie: string | undefined): User | undefined {
  if (!cookie) return undefined
  const separatorIndex = cookie.indexOf(".")
  if (separatorIndex === -1) return undefined
  const userId = cookie.slice(0, separatorIndex)
  const signature = cookie.slice(separatorIndex + 1)
  const expected = sign(userId)
  const actual = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actual.length !== expectedBuffer.length) return undefined
  if (!timingSafeEqual(actual, expectedBuffer)) return undefined
  return findUser(userId)
}

export const SESSION_COOKIE_NAME = "session"
