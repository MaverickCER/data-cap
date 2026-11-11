// Cross-runtime conformance -- see bun.test.ts's header comment for why this
// file exists and what gap it closes. Deliberately dependency-free (no
// `@std/assert` from JSR) so this smoke test never depends on network access
// in CI -- its only job is proving dist/index.js's and dist/runtime/index.js's
// actual behavior under Deno's engine, not showcasing Deno test idioms.
//
// Run via `deno test --no-check --allow-read test/cross-runtime/deno.test.ts`
// after `npm run build` (see .github/workflows/ci.yml's `cross-runtime` job).
// `--allow-read` is required only because Deno's permission model defaults
// to denying filesystem access even for `import`ing a local file.
//
// `--no-check` is required for the same reason env-cap's own deno.test.ts
// documents: Deno's type-checker does not resolve the sibling dist/*.d.ts
// for a bare relative-path `.js` import the way tsc/vitest do. Type-
// declaration correctness is already verified by `npm run typecheck`
// against source; this file's job is execution conformance, which
// `--no-check` still fully exercises.
import { fields } from "../../dist/index.js"
import { createData, createDataStore, InvalidFieldDefaultError } from "../../dist/runtime/index.js"
import { createDataCache } from "../../dist/runtime/cache.js"
import { defaultBackoff } from "../../dist/runtime/retry.js"
import { canonicalize, processors } from "../../dist/helpers.js"
import { flowNodeId } from "../../dist/evidence.js"
import { createMemorySink, observeBoundary } from "../../dist/observe.js"

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertThrows(
  fn: () => void,
  expectedConstructor: new (...args: never[]) => Error,
  message: string,
): void {
  try {
    fn()
  } catch (error) {
    if (error instanceof expectedConstructor) return
    throw new Error(`${message}: threw the wrong type (${String(error)})`)
  }
  throw new Error(`${message}: did not throw`)
}

Deno.test(
  "createData resolves synchronously-readable fields with declared defaults, including nullable/optional markers, under Deno",
  () => {
    const capability = createData({
      fields: { name: "anon", age: fields.nullable(0), nickname: fields.optional("") },
    })
    const snapshot = capability.getSnapshot()
    assertEqual(snapshot.fields.name, "anon", "name should keep its declared default")
    assertEqual(snapshot.fields.age, null, "a nullable() default should resolve to null")
    assertEqual(
      snapshot.fields.nickname,
      undefined,
      "an optional() default should resolve to undefined",
    )
    assertEqual(Object.keys(snapshot.info).length, 0, "info should start empty/sparse")
  },
)

Deno.test(
  "createData throws InvalidFieldDefaultError synchronously for a function-valued field default, under Deno",
  () => {
    assertThrows(
      () => createData({ fields: { bad: () => "not a valid field value" } }),
      InvalidFieldDefaultError,
      "a function-valued field default",
    )
  },
)

Deno.test(
  "the initial DataState is deep-frozen under Deno -- decision 23 holds cross-runtime",
  () => {
    const capability = createData({ fields: { user: { name: "anon" } } })
    const snapshot = capability.getSnapshot()
    assertEqual(Object.isFrozen(snapshot.fields), true, "fields should be frozen")
    assertEqual(
      Object.isFrozen(snapshot.fields.user),
      true,
      "a nested fields object should be frozen",
    )
    assertEqual(Object.isFrozen(snapshot.info), true, "info should be frozen")
  },
)

Deno.test(
  "createDataStore commits atomically and suppresses no-op notifications, under Deno",
  () => {
    const capability = createData({ fields: { name: "anon" } })
    const store = createDataStore(capability)
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })

    store.commitAuthoritative({ name: "changed" }, undefined)
    assertEqual(notifications, 1, "a real change should notify exactly once")
    assertEqual(store.getSnapshot().fields.name, "changed", "the committed value should be visible")

    // Same value again -- a true no-op must never notify (see negative-guarantee checklist item 10).
    store.commitAuthoritative({ name: "changed" }, undefined)
    assertEqual(
      notifications,
      1,
      "a true no-op commit must never trigger a subscriber notification",
    )
  },
)

Deno.test("helpers run under Deno: processors coerce and canonicalize is stable", () => {
  assertEqual(processors.toBoolean("yes"), true, "toBoolean")
  assertEqual(processors.toInteger("42"), 42, "toInteger")
  assertEqual(canonicalize({ b: 1, a: [2, 1] }), canonicalize({ a: [2, 1], b: 1 }), "canonicalize")
})

Deno.test("cache and retry run under Deno", () => {
  const cache = createDataCache<{ name: string }>({ maxEntries: 2 })
  // A complete DataState: fields plus their info (empty here: nothing has been fetched).
  cache.set("a", { fields: { name: "a" }, info: {} })
  assertEqual(
    JSON.stringify(cache.get("a")),
    JSON.stringify({ fields: { name: "a" }, info: {} }),
    "get a",
  )
  cache.set("b", { fields: { name: "b" }, info: {} })
  cache.set("c", { fields: { name: "c" }, info: {} })
  assertEqual(cache.size, 2, "lru size")
  if (!(defaultBackoff(1) > 0)) throw new Error("defaultBackoff(1) should be positive")
})

Deno.test("evidence helpers run under Deno: node ids are deterministic", () => {
  assertEqual(
    flowNodeId("field", "users", "email"),
    flowNodeId("field", "users", "email"),
    "flowNodeId",
  )
})

Deno.test("observe runs under Deno and records only what it was given", () => {
  const memory = createMemorySink()
  const recorded = observeBoundary(memory.sink, {
    scope: "svc",
    capability: "user",
    boundary: { kind: "http", name: "GET /me" },
    fields: [["email"], ["id"]],
    clock: () => 1,
  })
  assertEqual(recorded, 2, "recorded")
  assertEqual(
    memory
      .events()
      .map((e) => e.field)
      .join(","),
    "user.email,user.id",
    "fields",
  )
})
