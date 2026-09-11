/**
 * Client-side pattern: after a subscription reconnects (a gap where events
 * may have been missed), an optional `recover` getter re-syncs by fetching
 * the current value once through the ordinary getter pipeline. If a live
 * event arrives around the same time, both simply commit through the
 * ordinary atomic `commitAuthoritative` path in whatever order they
 * resolve -- there is no invented ordering guarantee (a getter does not
 * "win" over a subscription event, or vice versa); each fold is onto
 * whatever is CURRENTLY authoritative, so no update is silently lost even
 * without one.
 *
 * This file demonstrates that directly, with fully deterministic timing (so
 * its golden output is reproducible): scenario A has the live event commit
 * after recover; scenario B has recover commit after the live event. In
 * both, whichever commits last is what's visible afterward -- purely
 * because it committed last, not because of what kind of operation it was.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildData } from "@maverickcer/data-cap"
import { createDataStore } from "@maverickcer/data-cap/runtime"

const capability = buildData({ fields: { price: 0, source: "" } })
const store = createDataStore(capability)

// Stands in for a getter's `execute` -- re-fetches the current price.
async function fetchCurrentPrice(delayMs: number): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
  return 100
}

async function runRecoverPrice(delayMs: number): Promise<void> {
  const price = await fetchCurrentPrice(delayMs)
  store.commitAuthoritative({ price, source: "recover" }, { price: { source: "recover" } })
}

// Stands in for a live subscription event's processor commit.
async function runLiveEvent(price: number, delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
  store.commitAuthoritative({ price, source: "liveEvent" }, { price: { source: "liveEvent" } })
}

// -- Scenario A: recover starts first but the live event resolves LAST --
await Promise.all([runRecoverPrice(5), runLiveEvent(101, 15)])
const afterScenarioA = store.getSnapshot()
assert.equal(
  afterScenarioA.fields.source,
  "liveEvent",
  "whichever commit resolves last is authoritative -- here, the live event",
)
assert.equal(afterScenarioA.fields.price, 101)

// -- Scenario B: same race, but this time recover resolves LAST --
await Promise.all([runLiveEvent(102, 5), runRecoverPrice(15)])
const afterScenarioB = store.getSnapshot()
assert.equal(
  afterScenarioB.fields.source,
  "recover",
  "no operation kind has priority -- recover wins here purely by committing last",
)
assert.equal(afterScenarioB.fields.price, 100)

const summary = {
  afterScenarioA: { price: afterScenarioA.fields.price, source: afterScenarioA.fields.source },
  afterScenarioB: { price: afterScenarioB.fields.price, source: afterScenarioB.fields.source },
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("subscription-with-recover: all assertions passed.")
