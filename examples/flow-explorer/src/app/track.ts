/**
 * Analytics. The email goes to a third-party SDK, which is a package rather
 * than a project file: the analysis cannot see inside it. It says so, and
 * names what it could not follow and which data went in (the email only), so
 * the rules about other fields are not blocked by it.
 */
import { track } from "analytics-sdk"
import { userData } from "../features/user.capability.js"

export function trackUser() {
  track("profile_viewed", userData.getSnapshot().fields.user.email)
}
