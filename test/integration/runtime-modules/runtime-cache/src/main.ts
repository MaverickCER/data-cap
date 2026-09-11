/**
 * Client-side pattern: `runtime/cache` is an optional, bounded cache of
 * complete `DataState` snapshots -- `fields` AND `info` together, atomically,
 * never `fields` alone and never a raw unvalidated response. Rehydrating
 * `fields` without `info` would let a consumer see a real value while
 * incorrectly believing its `status` is still unknown/idle. It's a separate
 * concern from `coordinator.dedupe` (which answers "a request is already in
 * progress"): a cache answers "validated state is already available".
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildData } from "data-cap"
import { createDataCache } from "data-cap/runtime/cache"
import { canonicalize } from "data-cap/helpers"

interface UserFields {
  readonly user: { readonly id: string; readonly name: string }
}

let fetchCallCount = 0

// Stands in for `await fetch(`/api/users/${id}`).then(r => r.json())`.
async function fetchUser(id: string): Promise<{ id: string; name: string }> {
  fetchCallCount += 1
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { id, name: `User ${id}` }
}

const cache = createDataCache<UserFields>({ maxEntries: 2 })

async function getUserThroughCache(id: string): Promise<UserFields> {
  // The cache key is an integration concern the cache itself has no
  // opinion about -- canonicalize mirrors the same scheme the coordinator's
  // own dedup key uses.
  const key = canonicalize(id)
  assert.ok(key !== undefined)

  const cached = cache.get(key)
  if (cached !== undefined) return cached.fields

  const raw = await fetchUser(id)
  const capability = buildData({ fields: { user: raw } })
  cache.set(key, capability)
  return capability.fields
}

// -- Cache hit avoids a real fetch --
const first = await getUserThroughCache("u1")
assert.equal(fetchCallCount, 1)
const second = await getUserThroughCache("u1")
assert.equal(fetchCallCount, 1, "a cache hit never triggers a second fetch")
assert.deepEqual(second, first)

// -- A genuinely different key still fetches --
await getUserThroughCache("u2")
assert.equal(fetchCallCount, 2)

// -- Bounded LRU eviction: maxEntries is 2, so a third distinct key evicts the least-recently-used one --
assert.equal(cache.size, 2)
await getUserThroughCache("u3")
assert.equal(cache.size, 2, "the cache never grows past maxEntries")
assert.equal(
  cache.get(canonicalize("u1") ?? ""),
  undefined,
  "u1 was the least-recently-used entry and was evicted to make room for u3",
)
assert.notEqual(cache.get(canonicalize("u3") ?? ""), undefined)

const summary = {
  fetchCallCountAfterCacheHit: 1,
  fetchCallCountAfterSecondKey: 2,
  cacheSizeAfterThirdKey: cache.size,
  u1EvictedAfterThirdKey: cache.get(canonicalize("u1") ?? "") === undefined,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("runtime-cache: all assertions passed.")
