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
import { createData, fields, InvalidFieldDefaultError } from "../../dist/index.js"
import { createDataStore } from "../../dist/runtime/index.js"

test("createData resolves synchronously-readable fields with declared defaults, including nullable/optional markers, under Bun", () => {
  const capability = createData({
    fields: { name: "anon", age: fields.nullable(0), nickname: fields.optional("") },
  })
  expect(capability.fields.name).toBe("anon")
  expect(capability.fields.age).toBeNull()
  expect(capability.fields.nickname).toBeUndefined()
  expect(capability.info).toEqual({})
})

test("createData throws InvalidFieldDefaultError synchronously for a function-valued field default, under Bun", () => {
  expect(() => createData({ fields: { bad: () => "not a valid field value" } })).toThrow(
    InvalidFieldDefaultError,
  )
})

test("the initial DataState is deep-frozen under Bun -- decision 23 holds cross-runtime", () => {
  const capability = createData({ fields: { user: { name: "anon" } } })
  expect(Object.isFrozen(capability)).toBe(true)
  expect(Object.isFrozen(capability.fields)).toBe(true)
  expect(Object.isFrozen(capability.fields.user)).toBe(true)
  expect(Object.isFrozen(capability.info)).toBe(true)
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
