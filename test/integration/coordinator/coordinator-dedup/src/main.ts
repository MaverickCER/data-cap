/**
 * Client-side pattern: several parts of an app independently requesting the
 * same data at once (e.g. two components both rendering the current user).
 * `coordinator.dedupe` shares one in-flight call across concurrent
 * requests with the SAME function identity and canonically-equal params --
 * `fetchUserById("u1", ...)` called three times concurrently only actually
 * runs once. Non-canonicalizable params (a function, a symbol, ...) simply
 * never dedupe -- availability degrades gracefully rather than risking a
 * false collision between two unrelated calls.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { defaultCoordinator } from "data-cap/runtime"

interface User {
  readonly id: string
  readonly name: string
}

let fetchCallCount = 0

// Stands in for `await fetch(`/api/users/${id}`).then(r => r.json())`.
async function fetchUserById(id: string, signal: AbortSignal): Promise<User> {
  fetchCallCount += 1
  await new Promise((resolve) => setTimeout(resolve, 10))
  if (signal.aborted) throw new Error("aborted")
  return { id, name: `User ${id}` }
}

// -- Scenario 1: identical params dedupe onto one underlying call --
const controller = new AbortController()
const [fromCallerA, fromCallerB, fromCallerC] = await Promise.all([
  defaultCoordinator.dedupe(fetchUserById, "u1", controller.signal),
  defaultCoordinator.dedupe(fetchUserById, "u1", controller.signal),
  defaultCoordinator.dedupe(fetchUserById, "u2", controller.signal),
])

assert.equal(
  fetchCallCount,
  2,
  "two DISTINCT params ('u1', 'u2') means two real calls -- not three",
)
assert.equal(
  fromCallerA,
  fromCallerB,
  "both callers requesting 'u1' concurrently receive the exact same resolved value -- one shared call",
)
assert.equal(fromCallerC.id, "u2")
assert.notEqual(fromCallerC, fromCallerA)

// -- Scenario 2: a non-canonicalizable param never dedupes --
fetchCallCount = 0
async function fetchWithCallback(handler: () => void, signal: AbortSignal): Promise<number> {
  fetchCallCount += 1
  await new Promise((resolve) => setTimeout(resolve, 10))
  if (signal.aborted) throw new Error("aborted")
  handler()
  return fetchCallCount
}
const sameCallbackReference = (): void => undefined
await Promise.all([
  defaultCoordinator.dedupe(fetchWithCallback, sameCallbackReference, controller.signal),
  defaultCoordinator.dedupe(fetchWithCallback, sameCallbackReference, controller.signal),
])
assert.equal(
  fetchCallCount,
  2,
  "a function-valued param can't be canonicalized -- dedup never applies, even with the identical reference twice",
)

// -- Scenario 3: a per-caller abort never cancels the shared underlying work --
fetchCallCount = 0
const controllerD = new AbortController()
const controllerE = new AbortController()
const promiseD = defaultCoordinator.dedupe(fetchUserById, "u3", controllerD.signal)
const promiseE = defaultCoordinator.dedupe(fetchUserById, "u3", controllerE.signal)
controllerD.abort() // caller D gives up...

const [dResult, eResult] = await Promise.allSettled([promiseD, promiseE])
assert.equal(
  dResult.status,
  "rejected",
  "caller D's own abort rejects only ITS OWN returned promise",
)
assert.equal(
  eResult.status,
  "fulfilled",
  "caller E, sharing the same underlying call, is unaffected by D's abort",
)
assert.equal(
  fetchCallCount,
  1,
  "the shared underlying fetchUserById('u3', ...) still only ran once",
)

const summary = {
  scenario1: { fetchCallCount: 2, fromCallerAEqualsCallerB: fromCallerA === fromCallerB },
  scenario2: { fetchCallCount: 2 },
  scenario3: {
    dRejected: dResult.status === "rejected",
    eFulfilled: eResult.status === "fulfilled",
    sharedCallCount: fetchCallCount,
  },
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("coordinator-dedup: all assertions passed.")
