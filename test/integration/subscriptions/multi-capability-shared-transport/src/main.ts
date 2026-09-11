/**
 * Client-side pattern: subscription transport sharing, field-state, and
 * processor execution are three independent concerns -- only the first is
 * ever shared. Two DIFFERENT capabilities acquiring the SAME `subscribe`
 * function identity share one underlying connection, but each still runs
 * its own processor against its own `DataStore` -- there is no shared
 * `authoritativeState`, no shared `pendingTransitions`, no shared
 * processing logic.
 *
 *     global coordinator
 *             |
 *             +-- one shared subscribe() connection
 *                   |
 *            +------+------+
 *            v             v
 *     Capability A    Capability B
 *     own state A     own state B
 *     own processor A own processor B
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildData } from "data-cap"
import { createDataStore, defaultCoordinator } from "data-cap/runtime"
import type { SubscriptionHandlers } from "data-cap/runtime"

interface PriceEvent {
  readonly rawPrice: number
}

let connectionCount = 0

// One real transport, shared by identity -- e.g. one WebSocket carrying a
// raw price feed that two unrelated capabilities both care about. The
// transport itself decides when an event fires; `handlers` here is the
// coordinator's own fan-out, so calling `handlers.onEvent` broadcasts to
// every current acquirer, regardless of how many there are.
function subscribeToPriceFeed(handlers: SubscriptionHandlers<PriceEvent>): () => void {
  connectionCount += 1
  const timer = setTimeout(() => handlers.onEvent({ rawPrice: 42.5 }), 5)
  return () => clearTimeout(timer)
}

// Capability A: tracks the raw price directly.
const capabilityA = buildData({ fields: { priceUsd: 0 } })
const storeA = createDataStore(capabilityA)

// Capability B: tracks the SAME feed, but converts to a different unit --
// its own processor, entirely independent of A's.
const capabilityB = buildData({ fields: { priceCents: 0 } })
const storeB = createDataStore(capabilityB)

const releaseA = defaultCoordinator.acquireSubscription(subscribeToPriceFeed, {
  onEvent: (event) => {
    storeA.commitAuthoritative({ priceUsd: event.rawPrice }, { priceUsd: { source: "priceFeed" } })
  },
  onStatusChange: () => undefined,
})

const releaseB = defaultCoordinator.acquireSubscription(subscribeToPriceFeed, {
  onEvent: (event) => {
    storeB.commitAuthoritative(
      { priceCents: Math.round(event.rawPrice * 100) },
      { priceCents: { source: "priceFeed" } },
    )
  },
  onStatusChange: () => undefined,
})

assert.equal(
  connectionCount,
  1,
  "two capabilities sharing one subscribe identity open only one transport",
)

// Wait for the shared transport's one simulated event to fire and reach
// both acquirers.
await new Promise((resolve) => setTimeout(resolve, 15))

assert.equal(
  storeA.getSnapshot().fields.priceUsd,
  42.5,
  "A's own processor converted the raw event its own way",
)
assert.equal(
  storeB.getSnapshot().fields.priceCents,
  4250,
  "B's own processor converted the SAME event a completely different way",
)
assert.equal(storeA.getSnapshot().info.priceUsd?.source, "priceFeed")
assert.equal(storeB.getSnapshot().info.priceCents?.source, "priceFeed")

releaseA()
releaseB()

const summary = {
  connectionCount,
  priceUsd: storeA.getSnapshot().fields.priceUsd,
  priceCents: storeB.getSnapshot().fields.priceCents,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("multi-capability-shared-transport: all assertions passed.")
