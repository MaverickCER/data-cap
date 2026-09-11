import { describe, expect, it } from "vitest"
import { createDataCache } from "../../src/runtime/cache.js"
import type { DataState } from "../../src/core/types.js"

function state(count: number): DataState<{ count: number }> {
  return { fields: { count }, info: { count: { status: "success" } } }
}

describe("createDataCache", () => {
  it("stores and retrieves a complete DataState (fields + info) as one unit", () => {
    const cache = createDataCache<{ count: number }>()
    cache.set("key", state(1))
    const cached = cache.get("key")
    expect(cached?.fields.count).toBe(1)
    expect(cached?.info.count?.status).toBe("success")
  })

  it("returns undefined for a missing key", () => {
    const cache = createDataCache<{ count: number }>()
    expect(cache.get("missing")).toBeUndefined()
  })

  it("delete removes a specific entry; clear removes all", () => {
    const cache = createDataCache<{ count: number }>()
    cache.set("a", state(1))
    cache.set("b", state(2))
    cache.delete("a")
    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("b")).toBeDefined()

    cache.clear()
    expect(cache.get("b")).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it("evicts the least-recently-used entry once maxEntries is exceeded", () => {
    const cache = createDataCache<{ count: number }>({ maxEntries: 2 })
    cache.set("a", state(1))
    cache.set("b", state(2))
    cache.set("c", state(3)) // evicts "a" (least recently used)

    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("b")).toBeDefined()
    expect(cache.get("c")).toBeDefined()
    expect(cache.size).toBe(2)
  })

  it("reading an entry counts as recent use, protecting it from eviction", () => {
    const cache = createDataCache<{ count: number }>({ maxEntries: 2 })
    cache.set("a", state(1))
    cache.set("b", state(2))
    cache.get("a") // "a" is now more recently used than "b"
    cache.set("c", state(3)) // evicts "b", not "a"

    expect(cache.get("a")).toBeDefined()
    expect(cache.get("b")).toBeUndefined()
  })

  it("defaults maxEntries to 100", () => {
    const cache = createDataCache<{ count: number }>()
    for (let i = 0; i < 100; i++) {
      cache.set(`key-${i}`, state(i))
    }
    expect(cache.size).toBe(100)
    cache.set("key-100", state(100))
    expect(cache.size).toBe(100)
    expect(cache.get("key-0")).toBeUndefined()
  })

  it("rejects a non-positive or non-integer maxEntries", () => {
    expect(() => createDataCache({ maxEntries: 0 })).toThrow(RangeError)
    expect(() => createDataCache({ maxEntries: -1 })).toThrow(RangeError)
    expect(() => createDataCache({ maxEntries: 1.5 })).toThrow(RangeError)
    expect(() => createDataCache({ maxEntries: 0 })).toThrow(
      "maxEntries must be a positive integer",
    )
  })
})
