/**
 * The mistake: a debug endpoint that was meant to be removed. It hands the
 * whole record to the client, passwordHash included. No single line looks
 * wrong, which is exactly why the rule in `user.capability.ts` exists.
 */
import { userData } from "../features/user.capability.js"
import type { Respond } from "./profile.js"

export function exportEverything(res: Respond) {
  res.json(userData.getSnapshot().fields.user)
}
