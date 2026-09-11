/**
 * Client-side pattern: a live feed (WebSocket/SSE-shaped) shared across
 * multiple consumers subscribing with the SAME `subscribe` function
 * identity. `coordinator.acquireSubscription` ref-counts this: the first
 * acquirer actually opens the transport; later acquirers reuse it and
 * immediately learn its current status; the transport tears down only once
 * every acquirer has released -- not on any single consumer's own
 * unsubscribe.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { defaultCoordinator } from "@maverickcer/data-cap/runtime"
import type { SubscriptionHandlers } from "@maverickcer/data-cap/runtime"

interface FeedEvent {
  readonly message: string
}

let connectionCount = 0
let disconnectionCount = 0

// Stands in for opening a real WebSocket/SSE connection.
function subscribeToFeed(handlers: SubscriptionHandlers<FeedEvent>): () => void {
  connectionCount += 1
  handlers.onStatusChange("connecting")
  const timer = setTimeout(() => handlers.onStatusChange("connected"), 5)
  return () => {
    clearTimeout(timer)
    disconnectionCount += 1
  }
}

function makeConsumer(name: string): {
  handlers: SubscriptionHandlers<FeedEvent>
  statuses: string[]
  events: string[]
} {
  const statuses: string[] = []
  const events: string[] = []
  return {
    statuses,
    events,
    handlers: {
      onEvent: (event) => events.push(`${name}:${event.message}`),
      onStatusChange: (status) => statuses.push(status),
    },
  }
}

const consumer1 = makeConsumer("consumer1")
const release1 = defaultCoordinator.acquireSubscription(subscribeToFeed, consumer1.handlers)

assert.equal(connectionCount, 1, "the first acquirer opens the transport")
assert.deepEqual(consumer1.statuses, ["connecting"])

// A second consumer joins with the SAME subscribeToFeed reference -- reuses
// the existing transport (connectionCount stays 1) and immediately learns
// the CURRENT status, rather than waiting for the next transition.
const consumer2 = makeConsumer("consumer2")
const release2 = defaultCoordinator.acquireSubscription(subscribeToFeed, consumer2.handlers)

assert.equal(connectionCount, 1, "a second acquirer with the same identity reuses the transport")
assert.deepEqual(
  consumer2.statuses,
  ["connecting"],
  "a late joiner immediately learns the current status",
)

// Wait for the simulated connection to finish establishing.
await new Promise((resolve) => setTimeout(resolve, 10))
assert.deepEqual(consumer1.statuses, ["connecting", "connected"])
assert.deepEqual(consumer2.statuses, ["connecting", "connected"])

// The first consumer unsubscribes -- the transport stays open (consumer2 is
// still attached), so disconnectionCount stays 0.
release1()
assert.equal(disconnectionCount, 0, "the transport stays open while any acquirer remains")

// The last consumer unsubscribes -- only now does the transport tear down.
release2()
assert.equal(disconnectionCount, 1, "the transport disconnects once every acquirer has released")

const summary = {
  connectionCount,
  disconnectionCount,
  consumer1Statuses: consumer1.statuses,
  consumer2Statuses: consumer2.statuses,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("subscription-lifecycle: all assertions passed.")
