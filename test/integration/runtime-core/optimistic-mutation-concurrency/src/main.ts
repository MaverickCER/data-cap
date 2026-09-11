/**
 * Client-side pattern: optimistic UI. `addPendingTransition` makes a
 * mutation's not-yet-confirmed value visible immediately (`FieldInfo.
 * optimistic: true`); `removePendingTransition` removes it once the
 * operation settles, success or failure -- there is no automatic rollback,
 * and no invented conflict-resolution policy. `project()` always folds
 * every still-pending transition onto whatever is CURRENTLY authoritative,
 * never onto a stale snapshot captured when the mutation started -- that is
 * what makes the concurrency scenario below correct.
 *
 * Patches are absolute value replacements, never deltas: `{ count: n + 1 }`
 * always means "set count to exactly n + 1", computed from whatever the
 * caller read at the time it built the patch -- not "increment by 1"
 * applied later. An optimizer that wants a delta-like effect must read the
 * current visible value itself and compute the new absolute value.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildData } from "data-cap"
import { createDataStore } from "data-cap/runtime"

const capability = buildData({
  fields: {
    user: { email: "old@example.com" },
    count: 10,
    nickname: "original-nickname",
  },
})

const store = createDataStore(capability)

// ---- Concurrency scenario: A starts, B starts, B completes, A completes ----
// A: an optimistic email update (mutation A owns `user`).
const optimisticEmail = "new@example.com"
const transitionA = store.addPendingTransition(
  { user: { email: optimisticEmail } },
  { user: { optimistic: true, status: "loading" } },
)

assert.equal(
  store.getSnapshot().fields.user.email,
  optimisticEmail,
  "A's optimistic value is visible immediately, before any server confirmation",
)
assert.equal(store.getSnapshot().info.user?.optimistic, true)

// B: an optimistic count increment (mutation B owns `count`), computed from
// the CURRENT visible value -- not a delta the framework applies for you.
const currentCount = store.getSnapshot().fields.count
const optimisticCount = currentCount + 1
const transitionB = store.addPendingTransition(
  { count: optimisticCount },
  { count: { optimistic: true, status: "loading" } },
)

assert.equal(store.getSnapshot().fields.count, optimisticCount)
assert.equal(
  store.getSnapshot().fields.user.email,
  optimisticEmail,
  "adding B's pending transition must not disturb A's still-pending, unrelated contribution",
)

// B completes first. Its own commit always folds onto CURRENT authoritative
// state (here, unchanged since buildData()) -- never a snapshot captured
// when B started.
store.commitAuthoritative(
  { count: optimisticCount },
  { count: { optimistic: false, status: "success", source: "incrementCount" } },
)
store.removePendingTransition(transitionB)

const afterB = store.getSnapshot()
assert.equal(afterB.fields.count, optimisticCount, "B's confirmed value is now authoritative")
assert.equal(
  afterB.fields.user.email,
  optimisticEmail,
  "B's commit did not clobber A's still-pending, unrelated optimistic contribution",
)
assert.equal(afterB.info.user?.optimistic, true, "A is still pending")

// A completes second, regardless of start order -- completion order, not
// start order, is what determines commit order.
store.commitAuthoritative(
  { user: { email: optimisticEmail } },
  { user: { optimistic: false, status: "success", source: "updateEmail" } },
)
store.removePendingTransition(transitionA)

const afterA = store.getSnapshot()
assert.equal(afterA.fields.user.email, optimisticEmail)
assert.equal(afterA.fields.count, optimisticCount)
assert.equal(afterA.info.user?.optimistic, false)
assert.equal(afterA.info.count?.optimistic, false)

// ---- No-automatic-rollback scenario: mutation C fails ----
// An optimistic nickname change that the server will reject.
const rejectedNickname = "rejected-nickname"
const transitionC = store.addPendingTransition(
  { nickname: rejectedNickname },
  { nickname: { optimistic: true, status: "loading" } },
)
assert.equal(store.getSnapshot().fields.nickname, rejectedNickname)

// The operation fails. There is no special "rollback" API -- removing the
// pending transition is the entire mechanism. The next project() fold
// simply omits it, so the visible value reverts to whatever is still
// authoritative (the original default, since nothing ever committed it).
store.commitAuthoritative(undefined, {
  nickname: { status: "error", error: { operator: "updateNickname", error: "rejected" } },
})
store.removePendingTransition(transitionC)

const afterFailedC = store.getSnapshot()
assert.equal(
  afterFailedC.fields.nickname,
  "original-nickname",
  "removing a failed transition reverts to authoritative state -- no special rollback code involved",
)
assert.equal(afterFailedC.info.nickname?.status, "error")

const summary = {
  afterB: { count: afterB.fields.count, userEmail: afterB.fields.user.email },
  afterA: {
    userEmail: afterA.fields.user.email,
    count: afterA.fields.count,
    userOptimistic: afterA.info.user?.optimistic,
    countOptimistic: afterA.info.count?.optimistic,
  },
  afterFailedC: {
    nickname: afterFailedC.fields.nickname,
    nicknameStatus: afterFailedC.info.nickname?.status,
  },
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("optimistic-mutation-concurrency: all assertions passed.")
