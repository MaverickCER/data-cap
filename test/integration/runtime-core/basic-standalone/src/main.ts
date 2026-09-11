/**
 * CLIENT-side pattern: a browser (or any fetch-capable) app reading data
 * from a REST API. `fetchUser` below stands in for
 * `fetch(url).then(r => r.json())` -- swap it for a real fetch call and
 * everything else here is unchanged. See server-database-integration/ for
 * the equivalent SERVER-side pattern (a getter backed by a database query
 * instead of a network call).
 *
 * This is the low-level, hand-wired pattern: `buildData` only declares
 * fields, and `createDataStore` only owns state (`commitAuthoritative`,
 * `addPendingTransition`, `getSnapshot`, `subscribe`) -- neither runs a
 * getter/mutator for you. Running an actual "getter" here is application
 * wiring: fetch, commit a loading status, then commit the result or an
 * error. Reach for this level when you want full control over execution;
 * `examples/capability-operations/` shows the same scenario through the
 * batteries-included `createData` (`data-cap/runtime`) instead,
 * which owns this wiring for you. This file's pattern is still meant to be
 * copied and adapted -- most other examples in `examples/` build on it.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildData, fields } from "data-cap"
import { createDataStore, defaultCoordinator } from "data-cap/runtime"

interface User {
  readonly name: string
  readonly email: string
}

const capability = buildData({
  fields: {
    user: { name: "", email: "" },
    nickname: fields.optional(""),
    role: fields.nullable("member"),
  },
})

const store = createDataStore(capability)

async function fetchUser(signal: AbortSignal): Promise<User> {
  // Stands in for `await fetch("/api/user").then(r => r.json())` -- a real
  // getter's `execute` does exactly this, against a real endpoint. The
  // response shape here (a plain JSON object) is deliberately the only kind
  // of value any example in this directory ever produces or consumes.
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (signal.aborted) throw new Error("aborted")
  return { name: "Ada Lovelace", email: "ada@example.com" }
}

async function runGetUser(): Promise<void> {
  const controller = new AbortController()
  // A getter owns `user` -- only its own field's info gets a status
  // transition, never a sibling's.
  store.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    // `defaultCoordinator.dedupe` is optional plumbing: concurrent calls to
    // THIS SAME `fetchUser` reference with canonically-equal params (here,
    // none) share one in-flight promise instead of firing the request twice.
    const raw = await defaultCoordinator.dedupe(
      (_params: undefined, signal) => fetchUser(signal),
      undefined,
      controller.signal,
    )
    store.commitAuthoritative({ user: raw }, { user: { status: "success", source: "getUser" } })
  } catch (error) {
    store.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "getUser", error } },
    })
  }
}

let notifications = 0
const unsubscribe = store.subscribe(() => {
  notifications += 1
})

await runGetUser()
unsubscribe()

const snapshot = store.getSnapshot()

// -- Real invariant checks against the actual installed package --
assert.equal(snapshot.fields.user.name, "Ada Lovelace")
assert.equal(snapshot.fields.user.email, "ada@example.com")
assert.equal(snapshot.fields.nickname, undefined, "optional() default resolves to undefined")
// The declared inner value ("member") only drives type inference -- the
// actual resolved runtime default for fields.nullable(...) is always null,
// regardless of what inner value was passed.
assert.equal(
  snapshot.fields.role,
  null,
  "nullable() resolves to null, not its declared inner value",
)
assert.equal(snapshot.info.user?.status, "success")
assert.equal(snapshot.info.user?.source, "getUser")
// Two real, distinct commits happened: the "loading" transition, then the
// "success" transition with the fetched value -- each is a genuine change,
// so each notifies once.
assert.equal(notifications, 2, "each of the two real commits should notify exactly once")
assert.equal(Object.isFrozen(snapshot), true, "every published snapshot is deep-frozen")
assert.equal(Object.isFrozen(snapshot.fields.user), true)

// A third commit, identical to the current state, is a true no-op -- must never notify.
store.commitAuthoritative({ user: snapshot.fields.user }, undefined)
assert.equal(notifications, 2, "a true no-op commit must never trigger a subscriber notification")

const summary = {
  fields: store.getSnapshot().fields,
  info: {
    userStatus: store.getSnapshot().info.user?.status,
    userSource: store.getSnapshot().info.user?.source,
  },
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

console.log("basic-standalone: all assertions passed.")
