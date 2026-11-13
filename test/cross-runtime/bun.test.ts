// Cross-runtime conformance (see CI's `cross-runtime` job): the runtime's
// core claim is isomorphism -- core/runtime are built with `platform:
// "neutral"` and never touch Node-only APIs (see tsup.config.ts) -- but
// until this file existed, only Node/vitest ever actually ran it.
//
// Deliberately imports the *built* dist/index.js and dist/runtime/index.js,
// not src/, and uses Bun's own native test runner (not vitest) so this
// genuinely proves zero reliance on Node- or vitest-specific behavior. Run
// via `bun test test/cross-runtime/bun.test.ts` after `npm run build` (see
// .github/workflows/ci.yml's `cross-runtime` job).
import { expect, test } from "bun:test"
import { fields } from "../../dist/index.js"
import { createData, createDataStore, InvalidFieldDefaultError } from "../../dist/runtime/index.js"
import { createDataCache } from "../../dist/runtime/cache.js"
import { defaultBackoff } from "../../dist/runtime/retry.js"
import { canonicalize, processors } from "../../dist/helpers.js"
import { flowNodeId } from "../../dist/evidence.js"
import { createMemorySink, observeBoundary } from "../../dist/observe.js"

test("createData resolves synchronously-readable fields with declared defaults, including nullable/optional markers, under Bun", () => {
  const capability = createData({
    fields: { name: "anon", age: fields.nullable(0), nickname: fields.optional("") },
  })
  const snapshot = capability.getSnapshot()
  expect(snapshot.fields.name).toBe("anon")
  expect(snapshot.fields.age).toBeNull()
  expect(snapshot.fields.nickname).toBeUndefined()
  expect(snapshot.info).toEqual({})
})

test("createData throws InvalidFieldDefaultError synchronously for a function-valued field default, under Bun", () => {
  expect(() => createData({ fields: { bad: () => "not a valid field value" } })).toThrow(
    InvalidFieldDefaultError,
  )
})

test("the initial DataState is deep-frozen under Bun -- decision 23 holds cross-runtime", () => {
  const capability = createData({ fields: { user: { name: "anon" } } })
  const snapshot = capability.getSnapshot()
  expect(Object.isFrozen(snapshot.fields)).toBe(true)
  expect(Object.isFrozen(snapshot.fields.user)).toBe(true)
  expect(Object.isFrozen(snapshot.info)).toBe(true)
})

test("createDataStore commits atomically and suppresses no-op notifications, under Bun", () => {
  const capability = createData({ fields: { name: "anon" } })
  const store = createDataStore(capability)
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  store.commitAuthoritative({ name: "changed" }, undefined)
  expect(notifications).toBe(1)
  expect(store.getSnapshot().fields.name).toBe("changed")

  // Same value again -- a true no-op must never notify (see negative-guarantee checklist item 10).
  store.commitAuthoritative({ name: "changed" }, undefined)
  expect(notifications).toBe(1)
})

test("helpers run under Bun: processors coerce and canonicalize is stable", () => {
  expect(processors.toBoolean("yes")).toBe(true)
  expect(processors.toInteger("42")).toBe(42)
  expect(canonicalize({ b: 1, a: [2, 1] })).toBe(canonicalize({ a: [2, 1], b: 1 }))
})

test("cache and retry run under Bun", () => {
  const cache = createDataCache<{ name: string }>({ maxEntries: 2 })
  // A complete DataState: fields plus their info (empty here: nothing has been fetched).
  cache.set("a", { fields: { name: "a" }, info: {} })
  expect(cache.get("a")).toEqual({ fields: { name: "a" }, info: {} })
  cache.set("b", { fields: { name: "b" }, info: {} })
  cache.set("c", { fields: { name: "c" }, info: {} })
  expect(cache.size).toBe(2)
  expect(defaultBackoff(1)).toBeGreaterThan(0)
})

test("evidence helpers run under Bun: node ids are deterministic", () => {
  expect(flowNodeId("field", "users", "email")).toBe(flowNodeId("field", "users", "email"))
})

test("observe runs under Bun and records only what it was given", () => {
  const memory = createMemorySink()
  const recorded = observeBoundary(memory.sink, {
    scope: "svc",
    capability: "user",
    boundary: { kind: "http", name: "GET /me" },
    fields: [["email"], ["id"]],
    clock: () => 1,
  })
  expect(recorded).toBe(2)
  expect(memory.events().map((e) => e.field)).toEqual(["user.email", "user.id"])
})
