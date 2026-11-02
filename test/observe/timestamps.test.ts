import { describe, expect, it } from "vitest"
import { createMemorySink, observeBoundary, observeValue } from "../../src/observe/index.js"

const boundary = { kind: "log" as const, name: "out" }

describe("recorder timestamps", () => {
  it("adds no `at` by default: the recorder never reads a clock of its own", () => {
    const memory = createMemorySink()
    observeBoundary(memory.sink, { scope: "s", boundary, capability: "c", fields: [["a"]] })
    expect(Object.keys(memory.events()[0] ?? {})).not.toContain("at")
  })

  it("stamps each call once from the caller's clock", () => {
    const memory = createMemorySink()
    let ticks = 1000
    const clock = () => (ticks += 5)
    observeBoundary(memory.sink, {
      scope: "s",
      boundary,
      capability: "c",
      fields: [["a"], ["b"]],
      clock,
    })
    observeBoundary(memory.sink, { scope: "s", boundary, capability: "c", fields: [["a"]], clock })
    expect(memory.events().map((event) => event.at)).toEqual([1005, 1005, 1010])
  })

  it("omits `at` when the clock throws or returns a non-finite number", () => {
    for (const clock of [
      () => {
        throw new Error("x")
      },
      () => Number.NaN,
      () => Number.POSITIVE_INFINITY,
    ]) {
      const memory = createMemorySink()
      const n = observeBoundary(memory.sink, {
        scope: "s",
        boundary,
        capability: "c",
        fields: [["a"]],
        clock,
      })
      expect(n).toBe(1)
      expect(Object.keys(memory.events()[0] ?? {})).not.toContain("at")
    }
  })

  it("observeValue takes the same clock", () => {
    const memory = createMemorySink()
    observeValue(memory.sink, { scope: "s", boundary, capability: "c", clock: () => 42 }, { a: 1 })
    expect(memory.events()).toEqual([{ scope: "s", boundary, field: "c.a", at: 42 }])
  })
})
