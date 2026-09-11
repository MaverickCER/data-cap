/**
 * Client-side pattern: data-cap ships no `./tanstack` adapter -- this is
 * the wiring an application writes itself. TanStack Query owns fetching,
 * in-flight request dedup, and time-based caching (its own core
 * competency); its settled results flow into a data-cap `DataStore`, so
 * application code reads the SAME `DataState`/`info` shape every other
 * example in this directory uses, regardless of what actually drives the
 * fetch underneath.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { QueryClient } from "@tanstack/query-core"
import { buildData } from "data-cap"
import { createDataStore } from "data-cap/runtime"

interface User {
  readonly name: string
  readonly email: string
}

let fetchCallCount = 0

// Stands in for `await fetch("/api/user").then(r => r.json())`.
async function fetchUser(): Promise<User> {
  fetchCallCount += 1
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { name: "Ada Lovelace", email: "ada@example.com" }
}

const capability = buildData({ fields: { user: { name: "", email: "" } } })
const store = createDataStore(capability)

async function runGetUser(queryClient: QueryClient): Promise<void> {
  store.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const raw = await queryClient.fetchQuery({ queryKey: ["user"], queryFn: fetchUser })
    store.commitAuthoritative(
      { user: raw },
      { user: { status: "success", source: "tanstack-query" } },
    )
  } catch (error) {
    store.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "getUser", error } },
    })
  }
}

// -- TanStack Query's own in-flight dedup: two concurrent fetchQuery calls
// for the same key share one underlying queryFn call, mirroring what
// coordinator.dedupe does for data-cap's own standalone wiring. --
const queryClient = new QueryClient()
await Promise.all([runGetUser(queryClient), runGetUser(queryClient)])
assert.equal(fetchCallCount, 1, "two concurrent identical queries dedupe onto one fetchUser call")
assert.equal(store.getSnapshot().fields.user.name, "Ada Lovelace")
assert.equal(store.getSnapshot().info.user?.source, "tanstack-query")

// -- Default staleTime is 0: a later, sequential call refetches -- --
fetchCallCount = 0
await runGetUser(queryClient)
assert.equal(
  fetchCallCount,
  1,
  "with the default staleTime, a later call refetches rather than reusing cache",
)

// -- An explicit staleTime keeps a later call from refetching at all -- --
fetchCallCount = 0
const cachingQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
})
async function runGetUserCached(): Promise<User> {
  return cachingQueryClient.fetchQuery({ queryKey: ["cached-user"], queryFn: fetchUser })
}
await runGetUserCached()
await runGetUserCached()
assert.equal(
  fetchCallCount,
  1,
  "with staleTime: Infinity, a later call reuses the cached result instead of refetching",
)

const summary = {
  concurrentDedupCallCount: 1,
  defaultStaleTimeRefetchCallCount: 1,
  infiniteStaleTimeCallCount: 1,
  finalUser: store.getSnapshot().fields.user,
  finalSource: store.getSnapshot().info.user?.source,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("tanstack-query-integration: all assertions passed.")
