/**
 * SERVER-side pattern: a Node backend service keeping state read from (and
 * written back to) a database. `queryUserById`/`updateUserEmail` below
 * stand in for real driver calls (`pg`, `mysql2`, an ORM) -- swap them for
 * real queries and everything else here is unchanged. See
 * basic-standalone/ for the equivalent CLIENT-side pattern (a getter backed
 * by a network fetch instead of a database query).
 *
 * Unlike a client showing an optimistic value before the server confirms it
 * (see optimistic-mutation-concurrency/), a server process IS the source of
 * truth -- there is nothing to be optimistic about, so the mutator here
 * commits directly via `commitAuthoritative`, with no pending transition.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildData, documentData } from "@maverickcer/data-cap"
import { createDataStore, defaultCoordinator } from "@maverickcer/data-cap/runtime"

interface UserRow {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: string
}

// Simulated database table -- an in-memory stand-in for real persistent
// rows. Every value here (and every value returned by the two functions
// below) is a plain JSON object, exactly like a real driver would hand back.
const usersTable: UserRow[] = [
  { id: "u1", name: "Grace Hopper", email: "grace@example.com", role: "admin" },
]

async function queryUserById(id: string, signal: AbortSignal): Promise<UserRow> {
  // Stands in for `await db.query("SELECT * FROM users WHERE id = $1", [id])`.
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  const row = usersTable.find((candidate) => candidate.id === id)
  if (row === undefined) throw new Error(`no user with id ${id}`)
  return row
}

async function updateUserEmail(id: string, email: string, signal: AbortSignal): Promise<UserRow> {
  // Stands in for
  // `await db.query("UPDATE users SET email = $1 WHERE id = $2 RETURNING *", [email, id])`.
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  const index = usersTable.findIndex((candidate) => candidate.id === id)
  if (index === -1) throw new Error(`no user with id ${id}`)
  const updated: UserRow = { ...usersTable[index], email }
  usersTable[index] = updated
  return updated
}

// Exported (unused by anything else in this standalone script) so
// data-cap's own build tooling can discover it -- see the "Generated
// reports" section in this example's README.
export const capability = buildData({
  fields: {
    user: { id: "", name: "", email: "", role: "member" },
  },
})

// Only one buildData()/documentData() pair exists in this file, so
// correlation happens by the "unambiguous single pair" rule -- no shared
// `fields` identifier is required (contrast with
// examples/capability-operations/, which has two pairs and needs one).
//
// No `getters`/`mutators` section here: `buildData` (unlike `createData`)
// has no operations layer at all -- this capability's reads/writes are
// wired by hand below (runGetUser/runUpdateUserEmail), so there is no real
// getter/mutator for a documented one to correlate with. Documenting a
// getter/mutator name that doesn't exist on the actual schema would be
// silently dropped by the catalog renderer (nothing to attach it to) --
// worse, it would misrepresent what this capability actually declares.
documentData(
  { fields: { user: { id: "", name: "", email: "", role: "member" } } },
  {
    name: "user",
    owner: "identity-team",
    fields: {
      user: {
        description: "The authoritative user row, read from and written back to the database.",
        sensitivity: "confidential",
        protections: "Row-level security; database-internal network only.",
      },
    },
  },
)

const store = createDataStore(capability)

async function runGetUser(id: string): Promise<void> {
  const controller = new AbortController()
  store.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const row = await defaultCoordinator.dedupe(
      (params: string, signal) => queryUserById(params, signal),
      id,
      controller.signal,
    )
    store.commitAuthoritative({ user: row }, { user: { status: "success", source: "getUser" } })
  } catch (error) {
    store.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "getUser", error } },
    })
  }
}

async function runUpdateUserEmail(id: string, email: string): Promise<void> {
  const controller = new AbortController()
  store.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const row = await updateUserEmail(id, email, controller.signal)
    store.commitAuthoritative(
      { user: row },
      { user: { status: "success", source: "updateUserEmail" } },
    )
  } catch (error) {
    store.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "updateUserEmail", error } },
    })
  }
}

let notifications = 0
const unsubscribe = store.subscribe(() => {
  notifications += 1
})

await runGetUser("u1")

const afterGet = store.getSnapshot()
assert.equal(afterGet.fields.user.name, "Grace Hopper")
assert.equal(afterGet.fields.user.email, "grace@example.com")
assert.equal(afterGet.fields.user.role, "admin")
assert.equal(afterGet.info.user?.status, "success")
assert.equal(afterGet.info.user?.source, "getUser")

await runUpdateUserEmail("u1", "grace.hopper@example.com")

const afterUpdate = store.getSnapshot()
assert.equal(afterUpdate.fields.user.email, "grace.hopper@example.com")
assert.equal(afterUpdate.info.user?.source, "updateUserEmail")
// The mutator's own commit really did land in the database, not just the
// in-memory DataState -- the server-side pattern's whole point.
assert.equal(usersTable[0]?.email, "grace.hopper@example.com")

unsubscribe()

// Four real, distinct commits: getUser's loading+success, updateUserEmail's loading+success.
assert.equal(notifications, 4, "each of the four real commits should notify exactly once")
assert.equal(Object.isFrozen(afterUpdate), true, "every published snapshot is deep-frozen")
assert.equal(Object.isFrozen(afterUpdate.fields.user), true)

const summary = {
  fields: store.getSnapshot().fields,
  info: {
    userStatus: store.getSnapshot().info.user?.status,
    userSource: store.getSnapshot().info.user?.source,
  },
  databaseRow: usersTable[0],
  notifications,
  frozen: {
    snapshot: Object.isFrozen(store.getSnapshot()),
    user: Object.isFrozen(store.getSnapshot().fields.user),
  },
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("server-database-integration: all assertions passed.")
