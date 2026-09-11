/**
 * Server-side pattern: a multi-tenant Node process handling requests for
 * several tenants in one running instance. The default coordinator is a
 * module-level singleton, shared implicitly by everything using it -- fine
 * for a single-tenant app, but wrong here: two tenants happening to call
 * the exact same function with the exact same params must never dedupe or
 * share a subscription with each other, even though the SAME process, the
 * SAME module instance, and the SAME underlying function reference are
 * involved. `createCoordinator()` gives each tenant its own explicit,
 * isolated coordination domain -- isolation is always requested this way,
 * never inferred from function identity/syntax (that remains solely the
 * INTRA-coordinator sharing boundary, unchanged).
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { createCoordinator, defaultCoordinator } from "@maverickcer/data-cap/runtime"

interface Resource {
  readonly id: string
  readonly fetchedBy: number
}

let fetchCallCount = 0

// Stands in for a query against a resource multiple tenants might share the
// exact same identifier for (e.g. a plan/tier lookup keyed by a common id).
async function fetchResource(id: string, signal: AbortSignal): Promise<Resource> {
  fetchCallCount += 1
  const fetchedBy = fetchCallCount
  await new Promise((resolve) => setTimeout(resolve, 10))
  if (signal.aborted) throw new Error("aborted")
  return { id, fetchedBy }
}

const tenantACoordinator = createCoordinator()
const tenantBCoordinator = createCoordinator()

// -- Isolation: the SAME params, through DIFFERENT tenants' coordinators, never dedupe --
const controller = new AbortController()
const [fromTenantA, fromTenantB] = await Promise.all([
  tenantACoordinator.dedupe(fetchResource, "shared-plan-id", controller.signal),
  tenantBCoordinator.dedupe(fetchResource, "shared-plan-id", controller.signal),
])
assert.equal(
  fetchCallCount,
  2,
  "two isolated coordinators never share work, even for identical params",
)
assert.notEqual(
  fromTenantA.fetchedBy,
  fromTenantB.fetchedBy,
  "each tenant's request was served by a genuinely separate underlying call",
)

// -- Sharing still works WITHIN one tenant's own coordinator --
fetchCallCount = 0
const [firstWithinA, secondWithinA] = await Promise.all([
  tenantACoordinator.dedupe(fetchResource, "shared-plan-id", controller.signal),
  tenantACoordinator.dedupe(fetchResource, "shared-plan-id", controller.signal),
])
assert.equal(
  fetchCallCount,
  1,
  "within ONE tenant's coordinator, identical params still dedupe normally",
)
assert.equal(firstWithinA.fetchedBy, secondWithinA.fetchedBy)

// -- The default singleton is a THIRD, independent domain from either tenant's explicit one --
fetchCallCount = 0
await Promise.all([
  tenantACoordinator.dedupe(fetchResource, "shared-plan-id", controller.signal),
  defaultCoordinator.dedupe(fetchResource, "shared-plan-id", controller.signal),
])
assert.equal(
  fetchCallCount,
  2,
  "a tenant's explicit coordinator never shares work with the default singleton either",
)

const summary = {
  crossTenantCallCount: 2,
  withinTenantCallCount: 1,
  tenantVsDefaultCallCount: 2,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("coordinator-isolation: all assertions passed.")
