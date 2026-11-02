import { describe, expect, it } from "vitest"
import { createMemorySink, instrumentBoundary, observeResponse } from "../../src/observe/index.js"
import type { InstrumentContext, ObserveValueContext } from "../../src/observe/index.js"

const ctx: ObserveValueContext = {
  scope: "test:resp",
  capability: "userData",
  boundary: { kind: "external-service", name: "api" },
}

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

describe("observeResponse", () => {
  it("returns the very same response and leaves its body readable", async () => {
    const memory = createMemorySink()
    const response = json({ user: { email: "a@b.c" } })
    const back = observeResponse(memory.sink, ctx, response)
    expect(back).toBe(response)
    await tick()
    expect(response.bodyUsed).toBe(false)
    expect(await response.json()).toEqual({ user: { email: "a@b.c" } })
  })

  it("observes the clone's JSON field paths asynchronously, names only", async () => {
    const memory = createMemorySink()
    observeResponse(memory.sink, ctx, json({ user: { email: "SECRET@x.y" } }))
    expect(memory.events()).toEqual([])
    await tick()
    expect(memory.events().map((e) => e.field)).toEqual(["userData.user", "userData.user.email"])
    expect(JSON.stringify(memory.events())).not.toContain("SECRET")
  })

  it("works for a Request body as well", async () => {
    const memory = createMemorySink()
    const request = new Request("https://example.test/x", {
      method: "POST",
      body: JSON.stringify({ card: "4242" }),
    })
    expect(observeResponse(memory.sink, ctx, request)).toBe(request)
    await tick()
    expect(memory.events().map((e) => e.field)).toEqual(["userData.card"])
    expect(await request.text()).toBe('{"card":"4242"}')
  })

  it("stamps time at call time with the caller's clock, not when the body is parsed", async () => {
    const memory = createMemorySink()
    let now = 100
    observeResponse(memory.sink, { ...ctx, clock: () => now }, json({ a: 1 }))
    now = 999
    await tick()
    expect(memory.events()[0]?.at).toBe(100)
  })

  it("resolves a scope function at call time", async () => {
    const memory = createMemorySink()
    let scope = "one"
    observeResponse(memory.sink, { ...ctx, scope: () => scope }, json({ a: 1 }))
    scope = "two"
    await tick()
    expect(memory.events()[0]?.scope).toBe("one")
  })

  it("forwards walker options", async () => {
    const memory = createMemorySink()
    observeResponse(memory.sink, ctx, json({ a: { b: 1 } }), { maxDepth: 1 })
    await tick()
    expect(memory.events().map((e) => e.field)).toEqual(["userData.a"])
    expect(memory.skips().map((s) => s.reason)).toEqual(["max-depth"])
  })

  it("never throws and records nothing for a non-JSON body", async () => {
    const memory = createMemorySink()
    const response = new Response("not json")
    expect(() => observeResponse(memory.sink, ctx, response)).not.toThrow()
    await tick()
    expect(memory.events()).toEqual([])
    expect(await response.text()).toBe("not json")
  })

  it("never throws for a response whose body was already used", async () => {
    const memory = createMemorySink()
    const response = json({ a: 1 })
    await response.text()
    expect(() => observeResponse(memory.sink, ctx, response)).not.toThrow()
    await tick()
    expect(memory.events()).toEqual([])
  })

  it("passes through anything that is not response-shaped", () => {
    const memory = createMemorySink()
    const odd = { json: 1 } as unknown as Response
    expect(observeResponse(memory.sink, ctx, odd)).toBe(odd)
  })

  it("survives a clone() that throws, a json() that throws and a throwing sink", async () => {
    const memory = createMemorySink()
    const cloneThrows = {
      clone() {
        throw new Error("x")
      },
      json: () => Promise.resolve({}),
    }
    const jsonThrows = {
      clone: () => ({
        clone: () => cloneThrows,
        json() {
          throw new Error("y")
        },
      }),
      json: () => Promise.resolve({}),
    }
    expect(() => observeResponse(memory.sink, ctx, cloneThrows)).not.toThrow()
    expect(() => observeResponse(memory.sink, ctx, jsonThrows)).not.toThrow()
    const angry = {
      record() {
        throw new Error("z")
      },
    }
    observeResponse(angry, ctx, json({ a: 1 }))
    await tick()
    expect(memory.events()).toEqual([])
  })
})

describe("instrumentBoundary observe option", () => {
  const base: InstrumentContext = ctx

  it("defaults to observing the arguments only", () => {
    const memory = createMemorySink()
    const target = { query: (_sql: unknown) => ({ rows: { id: 1 } }) }
    instrumentBoundary(target, "query", base, memory.sink)
    target.query({ text: "x" })
    expect(memory.events().map((e) => e.field)).toEqual(["userData.text"])
  })

  it("observes the result with observe: result", () => {
    const memory = createMemorySink()
    const target = { query: (_sql: unknown) => ({ rows: { id: 1 } }) }
    instrumentBoundary(target, "query", { ...base, observe: "result" }, memory.sink)
    const out = target.query({ text: "x" })
    expect(out).toEqual({ rows: { id: 1 } })
    expect(memory.events().map((e) => e.field)).toEqual(["userData.rows", "userData.rows.id"])
  })

  it("observes both, arguments first", () => {
    const memory = createMemorySink()
    const target = { query: (_sql: unknown) => ({ rows: 1 }) }
    instrumentBoundary(target, "query", { ...base, observe: "both" }, memory.sink)
    target.query({ text: "x" })
    expect(memory.events().map((e) => e.field)).toEqual(["userData.text", "userData.rows"])
  })

  it("observes a native promise's resolved value without changing the promise", async () => {
    const memory = createMemorySink()
    const promise = Promise.resolve({ rows: 1 })
    const target = { query: () => promise }
    instrumentBoundary(target, "query", { ...base, observe: "result" }, memory.sink)
    const out = target.query()
    expect(out).toBe(promise)
    await out
    await tick()
    expect(memory.events().map((e) => e.field)).toEqual(["userData.rows"])
  })

  it("does not call then on a non-native thenable (a query builder would execute)", async () => {
    const memory = createMemorySink()
    let thens = 0
    const builder = {
      then() {
        thens += 1
      },
    }
    const target = { query: () => builder }
    instrumentBoundary(target, "query", { ...base, observe: "result" }, memory.sink)
    expect(target.query()).toBe(builder)
    await tick()
    expect(thens).toBe(0)
  })

  it("a rejected promise is left to the caller and never becomes an unhandled rejection of ours", async () => {
    const memory = createMemorySink()
    const target = { query: () => Promise.reject(new Error("db down")) }
    instrumentBoundary(target, "query", { ...base, observe: "result" }, memory.sink)
    await expect(target.query()).rejects.toThrow("db down")
    await tick()
    expect(memory.events()).toEqual([])
  })

  it("observes a fetch Response result via observeResponse, leaving the body readable", async () => {
    const memory = createMemorySink()
    const target = { fetch: () => Promise.resolve(json({ token: "t" })) }
    instrumentBoundary(target, "fetch", { ...base, observe: "result" }, memory.sink)
    const response = await target.fetch()
    await tick()
    expect(memory.events().map((e) => e.field)).toEqual(["userData.token"])
    expect(await response.json()).toEqual({ token: "t" })
  })

  it("observes a synchronous Response result too", async () => {
    const memory = createMemorySink()
    const target = { get: () => json({ k: 1 }) }
    instrumentBoundary(target, "get", { ...base, observe: "result" }, memory.sink)
    const response = target.get()
    await tick()
    expect(memory.events().map((e) => e.field)).toEqual(["userData.k"])
    expect(await response.json()).toEqual({ k: 1 })
  })

  it("resolves a scope function at call time for a promised result", async () => {
    const memory = createMemorySink()
    let scope = "one"
    const target = { q: () => Promise.resolve({ a: 1 }) }
    instrumentBoundary(target, "q", { ...base, scope: () => scope, observe: "result" }, memory.sink)
    const pending = target.q()
    scope = "two"
    await pending
    await tick()
    expect(memory.events()[0]?.scope).toBe("one")
  })

  it("a throwing method still throws and observes only the arguments", () => {
    const memory = createMemorySink()
    const target = {
      q(_arg: unknown): unknown {
        throw new Error("sync fail")
      },
    }
    instrumentBoundary(target, "q", { ...base, observe: "both" }, memory.sink)
    expect(() => target.q({ a: 1 })).toThrow("sync fail")
    expect(memory.events().map((e) => e.field)).toEqual(["userData.a"])
  })
})
