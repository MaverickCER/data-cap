import { describe, expect, it } from "vitest"
import { createMemorySink, instrumentBoundary, observeSink } from "../../src/observe/index.js"

const ctx = {
  scope: "t",
  capability: "api",
  boundary: { kind: "client-response" as const, name: "http-response" },
}

describe("observeSink", () => {
  it("returns a pass-through that observes and returns its argument", () => {
    const memory = createMemorySink()
    const tap = observeSink(memory.sink, ctx)
    const body = { id: 1, name: "n" }
    expect(tap(body)).toBe(body)
    expect(memory.events().map((event) => event.field)).toEqual(["api.id", "api.name"])
  })

  it("forwards options to the walker", () => {
    const memory = createMemorySink()
    observeSink(memory.sink, { ...ctx, options: { maxDepth: 1 } })({ a: { b: 1 } })
    expect(memory.events().map((event) => event.field)).toEqual(["api.a"])
  })
})

describe("instrumentBoundary", () => {
  it("observes the first argument, calls through with this, args and result intact", () => {
    const memory = createMemorySink()
    const target = {
      tag: "T",
      json(this: { tag: string }, body: unknown, extra: number) {
        return `${this.tag}:${JSON.stringify(body)}:${extra}`
      },
    }
    instrumentBoundary(target, "json", ctx, memory.sink)
    expect(target.json({ a: 1 }, 2)).toBe('T:{"a":1}:2')
    expect(memory.events().map((event) => event.field)).toEqual(["api.a"])
  })

  it("observes nothing for a call without arguments but still calls through", () => {
    const memory = createMemorySink()
    const target = { ping: () => "pong" }
    instrumentBoundary(target, "ping", ctx, memory.sink)
    expect(target.ping()).toBe("pong")
    expect(memory.events()).toEqual([])
  })

  it("restore puts back the own original method", () => {
    const memory = createMemorySink()
    const original = (_x: unknown) => 1
    const target = { send: original }
    const restore = instrumentBoundary(target, "send", ctx, memory.sink)
    expect(target.send).not.toBe(original)
    restore()
    expect(target.send).toBe(original)
    target.send({ a: 1 })
    expect(memory.events()).toEqual([])
  })

  it("restore of a prototype method removes the own wrapper rather than copying the method down", () => {
    class Res {
      json(_body: unknown) {
        return 1
      }
    }
    const res = new Res()
    const restore = instrumentBoundary(res, "json", ctx, createMemorySink().sink)
    expect(Object.hasOwn(res, "json")).toBe(true)
    restore()
    expect(Object.hasOwn(res, "json")).toBe(false)
    expect(Reflect.get(res, "json")).toBe(Reflect.get(Res.prototype, "json"))
  })

  it("restore leaves a later wrapper alone and is idempotent", () => {
    const target: { send: (x: unknown) => unknown } = { send: (x) => x }
    const restore = instrumentBoundary(target, "send", ctx, createMemorySink().sink)
    const later = (x: unknown) => x
    target.send = later
    restore()
    expect(target.send).toBe(later)
  })

  it("throws a TypeError at setup when the member is not a function", () => {
    const target = { value: 1 }
    expect(() => instrumentBoundary(target, "value", ctx, createMemorySink().sink)).toThrow(
      TypeError,
    )
    expect(() => instrumentBoundary(target, "missing", ctx, createMemorySink().sink)).toThrow(
      /missing/,
    )
  })

  it("a throwing sink never breaks the instrumented call", () => {
    const angry = {
      record() {
        throw new Error("no")
      },
    }
    const target = { send: (x: unknown) => x }
    instrumentBoundary(target, "send", ctx, angry)
    expect(target.send(5)).toBe(5)
  })

  it("passes a promise-returning call through untouched", async () => {
    const target = { insert: async (row: unknown) => row }
    const memory = createMemorySink()
    instrumentBoundary(target, "insert", ctx, memory.sink)
    await expect(target.insert({ a: 1 })).resolves.toEqual({ a: 1 })
    expect(memory.events()).toHaveLength(1)
  })
})

describe("instrumentBoundary, what counts as a response", () => {
  const observeResult = (result: unknown) => {
    const memory = createMemorySink()
    const target = { send: () => result }
    instrumentBoundary(target, "send", { ...ctx, observe: "result" }, memory.sink)
    target.send()
    return memory.events().map((event) => event.field)
  }

  it("observes an object that has only clone, or only json, as the plain value it is", () => {
    expect(observeResult({ clone: () => undefined, a: 1 })).toEqual(["api.a"])
    expect(observeResult({ json: () => Promise.resolve({}), a: 1 })).toEqual(["api.a"])
  })

  it("observes an object whose clone and json are not functions as a plain value", () => {
    expect(observeResult({ clone: 1, json: 2, a: 3 })).toEqual(["api.clone", "api.json", "api.a"])
  })

  it("records nothing synchronously for a real body, which it reads from a clone", () => {
    const body = {
      clone: () => ({ clone: () => body, json: () => Promise.resolve({}) }),
      json: () => Promise.resolve({}),
    }
    expect(observeResult(body)).toEqual([])
  })

  it("observes nothing for a primitive or null result, and does not throw", () => {
    for (const result of [5, "text", null, undefined, true])
      expect(observeResult(result)).toEqual([])
  })
})
