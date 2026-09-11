/**
 * Client-side pattern: `runtime/retry` is optional, opt-in retry -- never
 * applied automatically to any failure. The caller's own `shouldRetry`
 * predicate decides what's worth retrying; `withRetry` itself has no
 * knowledge of data-cap's own operation-failure taxonomy. It never retries
 * after the signal aborts (including mid-delay) and never exceeds
 * `maxAttempts`. `isStillDefault` is one documented, ready-made policy:
 * retry a getter only when the target field currently holds nothing but its
 * declared schema default -- never risk overwriting already-real data with
 * an ambiguous retry.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { withRetry, isStillDefault } from "data-cap/runtime/retry"

// -- withRetry: succeeds after two transient failures --
let attemptCount = 0
async function flakyFetch(): Promise<string> {
  attemptCount += 1
  if (attemptCount < 3) throw new Error(`transient failure #${attemptCount}`)
  return "ok"
}

const controller = new AbortController()
const result = await withRetry(() => flakyFetch(), controller.signal, {
  maxAttempts: 5,
  delayMs: () => 1,
})
assert.equal(result, "ok")
assert.equal(attemptCount, 3, "the first two attempts failed, the third succeeded")

// -- withRetry: gives up once shouldRetry says no --
attemptCount = 0
async function alwaysFails(): Promise<never> {
  attemptCount += 1
  throw new Error("permanent failure")
}
let permanentFailureRejected = false
try {
  await withRetry(() => alwaysFails(), controller.signal, {
    maxAttempts: 5,
    delayMs: () => 1,
    shouldRetry: () => false,
  })
} catch {
  permanentFailureRejected = true
}
assert.equal(permanentFailureRejected, true)
assert.equal(
  attemptCount,
  1,
  "shouldRetry() returning false on the first failure stops retrying immediately",
)

// -- withRetry: never retries after the signal aborts mid-delay --
attemptCount = 0
const abortController = new AbortController()
async function failsOnce(): Promise<never> {
  attemptCount += 1
  throw new Error("will retry, but the caller aborts during the delay")
}
const retryPromise = withRetry(() => failsOnce(), abortController.signal, {
  maxAttempts: 5,
  delayMs: () => 50,
})
// Abort while withRetry is still inside its inter-attempt delay.
setTimeout(() => abortController.abort(), 5)
let abortedBeforeRetry = false
try {
  await retryPromise
} catch {
  abortedBeforeRetry = true
}
assert.equal(abortedBeforeRetry, true)
assert.equal(attemptCount, 1, "aborting mid-delay prevents the second attempt from ever firing")

// -- isStillDefault: the documented "only retry a still-default field" policy --
const declaredDefault = { status: "idle" }
assert.equal(
  isStillDefault(declaredDefault, declaredDefault),
  true,
  "the exact same reference is trivially still the default",
)
assert.equal(
  isStillDefault({ status: "idle" }, declaredDefault),
  true,
  "a structurally-equal value (via canonicalize) is still considered the default",
)
assert.equal(
  isStillDefault({ status: "success" }, declaredDefault),
  false,
  "real data must never look like it's still the default",
)
// A non-canonicalizable value (e.g. containing a function) is conservatively
// treated as "not the default" -- never retried, to avoid a false positive.
assert.equal(isStillDefault({ handler: () => undefined }, declaredDefault), false)

const summary = {
  succeedsAfterRetries: { result, attempts: 3 },
  givesUpWhenShouldRetryIsFalse: { rejected: permanentFailureRejected, attempts: 1 },
  neverRetriesAfterAbort: { rejected: abortedBeforeRetry, attempts: 1 },
  isStillDefault: {
    sameReference: true,
    structurallyEqual: true,
    realData: false,
    nonCanonicalizable: false,
  },
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("runtime-retry: all assertions passed.")
