import { describe, expect, it } from "vitest"
import { createMemorySink, observeValue } from "../../src/observe/index.js"
import type { ObservationSink, ObserveValueContext } from "../../src/observe/index.js"

const ctx: ObserveValueContext = {
  scope: "test:skips",
  capability: "userData",
  boundary: { kind: "client-response", name: "http-response" },
}

type Skip = [string, string]

function skipsOf(value: unknown, options: Parameters<typeof observeValue>[3] = {}): Skip[] {
  const skips: Skip[] = []
  observeValue(createMemorySink().sink, ctx, value, {
    ...options,
    onSkip: (reason, path) => {
      skips.push([reason, path])
    },
  })
  return skips
}

describe("observeValue onSkip", () => {
  it("reports nothing when nothing was dropped", () => {
    expect(skipsOf({ a: { b: 1 }, list: [1, 2] })).toEqual([])
  })

  it("reports a dotted key under its parent path, by name only", () => {
    expect(skipsOf({ user: { "a.b": "SECRET-VALUE", ok: 1 } })).toEqual([["dotted-key", "user"]])
  })

  it("reports a dotted key at the root as the empty path", () => {
    expect(skipsOf({ "x.y": 1 })).toEqual([["dotted-key", ""]])
  })

  it("reports an empty key as unrepresentable too", () => {
    expect(skipsOf({ "": 1 })).toEqual([["dotted-key", ""]])
  })

  it("reports each distinct (reason, path) once however many keys were dropped", () => {
    expect(skipsOf({ user: { "a.b": 1, "c.d": 2 } })).toEqual([["dotted-key", "user"]])
  })

  it("reports values below maxDepth under their parent", () => {
    expect(skipsOf({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual([["max-depth", "a.b"]])
  })

  it("does not report anything exactly at maxDepth", () => {
    expect(skipsOf({ a: { b: 1 } }, { maxDepth: 2 })).toEqual([])
  })

  it("does not report functions, symbols or undefined as skips", () => {
    expect(skipsOf({ a: { f: () => 1, s: Symbol("x"), u: undefined } }, { maxDepth: 1 })).toEqual(
      [],
    )
  })

  it("reports the path where maxNodes stopped the walk, and each ancestor that still had children", () => {
    const skips = skipsOf({ a: { b: 1, c: 2 }, d: 3 }, { maxNodes: 2 })
    expect(skips).toEqual([
      ["max-nodes", "a"],
      ["max-nodes", ""],
    ])
  })

  it("does not report max-nodes when the walk finished exactly at the limit", () => {
    expect(skipsOf({ a: 1, b: 2 }, { maxNodes: 2 })).toEqual([])
  })

  it("reports a cycle at the node that points back", () => {
    const body: Record<string, unknown> = { a: {} }
    ;(body["a"] as Record<string, unknown>)["back"] = body
    expect(skipsOf(body)).toEqual([["cycle", "a.back"]])
  })

  it("never lets a throwing onSkip break the observed program", () => {
    const body = { "a.b": 1 }
    const memory = createMemorySink()
    expect(
      observeValue(memory.sink, ctx, body, {
        onSkip: () => {
          throw new Error("boom")
        },
      }),
    ).toBe(body)
  })

  it("still records the other fields when something is skipped", () => {
    const memory = createMemorySink()
    observeValue(memory.sink, ctx, { "a.b": 1, ok: 2 })
    expect(memory.events().map((e) => e.field)).toEqual(["userData.ok"])
  })
})

describe("the sink skip channel", () => {
  it("createMemorySink exposes skips with scope, boundary and the capability-qualified path", () => {
    const memory = createMemorySink()
    observeValue(memory.sink, ctx, { user: { "a.b": 1 }, "x.y": 2 })
    expect(memory.skips()).toEqual([
      {
        scope: "test:skips",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData",
        reason: "dotted-key",
      },
      {
        scope: "test:skips",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData.user",
        reason: "dotted-key",
      },
    ])
  })

  it("calls both onSkip and the sink's skip", () => {
    const memory = createMemorySink()
    const seen: Skip[] = []
    observeValue(
      memory.sink,
      ctx,
      { "a.b": 1 },
      {
        onSkip: (reason, path) => {
          seen.push([reason, path])
        },
      },
    )
    expect(seen).toEqual([["dotted-key", ""]])
    expect(memory.skips()).toHaveLength(1)
  })

  it("resolves a scope function for the skip too", () => {
    const memory = createMemorySink()
    observeValue(memory.sink, { ...ctx, scope: () => "dyn" }, { "a.b": 1 })
    expect(memory.skips()[0]?.scope).toBe("dyn")
  })

  it("works with a sink that has no skip channel", () => {
    const events: string[] = []
    const sink: ObservationSink = { record: (event) => void events.push(event.field) }
    observeValue(sink, ctx, { "a.b": 1, ok: 1 })
    expect(events).toEqual(["userData.ok"])
  })

  it("a throwing sink.skip never propagates", () => {
    const sink: ObservationSink = {
      record: () => undefined,
      skip: () => {
        throw new Error("boom")
      },
    }
    expect(() => observeValue(sink, ctx, { "a.b": 1 })).not.toThrow()
  })

  it("skips() returns a copy", () => {
    const memory = createMemorySink()
    observeValue(memory.sink, ctx, { "a.b": 1 })
    Array.prototype.pop.call(memory.skips())
    expect(memory.skips()).toHaveLength(1)
  })
})
