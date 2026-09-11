/**
 * The current user's own profile -- owned by platform-security, since
 * "who's signed in and what can they do" is an org-wide concern, not any
 * one department's own. Registration/login themselves happen via a raw
 * `fetch` in `main-headless.ts`, the same way establishing a session isn't
 * itself "application data" in any of this session's three examples --
 * `identityData` is what every OTHER capability implicitly depends on once
 * a session exists, fetched here for real display use (e.g. "signed in as").
 */
import { documentData, fields } from "@maverickcer/data-cap"
import { createData } from "@maverickcer/data-cap/runtime"
import { apiFetch } from "./api-client.js"

export interface CurrentUser {
  readonly id: string
  readonly email: string
  readonly role: "admin" | "member"
}

const identitySchema = {
  fields: {
    currentUser: fields.nullable<CurrentUser>({ id: "", email: "", role: "member" }),
  },
  getters: {
    getCurrentUser: {
      params: {},
      execute: (_params: object, signal: AbortSignal): Promise<CurrentUser> =>
        apiFetch("/api/me", { signal }),
      processor: (user: CurrentUser): { currentUser: CurrentUser } => ({ currentUser: user }),
      writes: { currentUser: true },
    },
  },
}

export const identityData = createData(identitySchema)

documentData(identitySchema, {
  name: "identity",
  owner: "platform-security",
  purpose: "Identifying which staff member is signed in and what they're authorized to do.",
  legalBasis: "contract",
  dataResidency: "us",
  auditRequired: true,
  fields: {
    currentUser: {
      description: "The signed-in staff member's own profile -- null until the first getCurrentUser().",
      sensitivity: "confidential",
      protections: "Session-authenticated access only; TLS in transit; password never leaves the server.",
      purpose: "Authorizing access to every other capability in this platform.",
      auditRequired: true,
    },
  },
  getters: {
    getCurrentUser: {
      description: "Fetches the currently signed-in staff member's own profile.",
      source: "identity-api",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "identity-api",
          url: "https://api.example.com/v1/me",
          handling: "plaintext",
        },
      ],
    },
  },
})
