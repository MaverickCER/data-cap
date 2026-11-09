/**
 * The intended path: load the user, keep only what a profile page needs, and
 * send that. Three of the five fields go out; passwordHash and role are
 * dropped by `buildUserProfile`, and the analysis can say so field by field.
 */
import { userData } from "../features/user.capability.js"

export interface Respond {
  json(value: unknown): void
}

export function buildUserProfile(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email }
}

export function sendProfileToClient(res: Respond, profile: { id: string; name: string; email: string }) {
  res.json(profile)
}

export function profileHandler(res: Respond) {
  const user = userData.getSnapshot().fields.user
  const profile = buildUserProfile(user)
  sendProfileToClient(res, profile)
}
