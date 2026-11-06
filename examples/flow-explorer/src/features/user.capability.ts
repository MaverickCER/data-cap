/**
 * The user record, as one capability: five fields fetched from one database
 * row, a declared source, and two declared data-flow rules.
 *
 * The rules are the point of this example. `flowPolicy` says, in the code that
 * owns the data, where that data must never go; `data-cap --flow-evidence`
 * then checks every function in the project against it, field by field, and
 * records the answer in the one evidence file. Nothing here runs at runtime.
 */
import { documentData } from "data-cap"
import { createData } from "data-cap/runtime"
import { queryUser } from "../server/users.js"
import type { UserRow } from "../server/users.js"

const userSchema = {
  fields: {
    user: { id: "", name: "", email: "", passwordHash: "", role: "" },
  },
  getters: {
    getUser: {
      params: {} as { id: string },
      execute: (params: { id: string }): Promise<UserRow> => queryUser(params.id),
      processor: (row: UserRow): { user: UserRow } => ({ user: row }),
      writes: { user: true },
    },
  },
}

export const userData = createData(userSchema)

documentData(userSchema, {
  name: "user",
  owner: "identity-team",
  sensitivity: "confidential",
  purpose: "Showing a signed-in person their own profile.",
  legalBasis: "contract",
  protections: "Session-authenticated access only; passwordHash is never selected for display.",
  dataResidency: "us",
  fields: {
    user: {
      description: "The signed-in user's account row.",
      retention: "Deleted within 30 days of account closure.",
    },
  },
  getters: {
    getUser: {
      description: "Loads the account row for one user.",
      endpoints: [{ direction: "input", kind: "database", name: "postgres:users" }],
    },
  },
  flowPolicy: [
    {
      id: "no-password-to-client",
      description: "A password hash never reaches a client response.",
      appliesTo: { field: "user", path: ["passwordHash"] },
      forbidDestinations: ["client-response"],
    },
    {
      id: "no-role-to-log",
      description: "A role is authorization data and does not belong in logs.",
      appliesTo: { field: "user", path: ["role"] },
      forbidDestinations: ["log"],
    },
  ],
})
