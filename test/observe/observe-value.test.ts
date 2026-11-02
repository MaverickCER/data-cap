import { describe, expect, it } from "vitest"
import { createMemorySink, observeValue } from "../../src/observe/index.js"
import type { ObserveValueContext } from "../../src/observe/index.js"

const ctx: ObserveValueContext = {
  scope: "test:walk",
  capability: "userData",
  boundary: { kind: "client-response", name: "http-response" },
}

function fieldsOf(value: unknown, options?: Parameters<typeof observeValue>[3]): string[] {
  const memory = createMemorySink()
  observeValue(memory.sink, ctx, value, options)
  return memory.events().map((event) => event.field)
}

describe("observeValue", () => {
  it("returns the very same value it was given", () => {
    const memory = createMemorySink()
    const body = { a: 1 }
    expect(observeValue(memory.sink, ctx, body)).toBe(body)
    expect(observeValue(memory.sink, ctx, "text")).toBe("text")
    const nothing = observeValue<unknown>(memory.sink, ctx, undefined)
    expect(nothing).toBeUndefined()
  })

  it("records every object and leaf path, capability-qualified, parents before children", () => {
    expect(fieldsOf({ user: { id: 1, email: "x", nested: { deep: true } }, ok: null })).toEqual([
      "userData.user",
      "userData.user.id",
      "userData.user.email",
      "userData.user.nested",
      "userData.user.nested.deep",
      "userData.ok",
    ])
  })

  it("carries scope, boundary and handling on every event", () => {
    const memory = createMemorySink()
    observeValue(memory.sink, { ...ctx, handling: "masked" }, { a: 1 })
    expect(memory.events()).toEqual([
      {
        scope: "test:walk",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData.a",
        handling: "masked",
      },
    ])
  })

  it("collapses array elements into the element marker, once per call", () => {
    expect(fieldsOf({ items: [{ name: "a" }, { name: "b", tag: "t" }, 3] })).toEqual([
      "userData.items",
      "userData.items.[]",
      "userData.items.[].name",
      "userData.items.[].tag",
    ])
  })

  it("records an empty array as the array only", () => {
    expect(fieldsOf({ items: [] })).toEqual(["userData.items"])
  })

  it("records a root array through the element marker", () => {
    expect(fieldsOf([{ id: 1 }])).toEqual(["userData.[]", "userData.[].id"])
  })

  it("records nothing for a root primitive, null, undefined, function or symbol", () => {
    for (const value of ["s", 1, true, null, undefined, () => 1, Symbol("x"), 10n])
      expect(fieldsOf(value)).toEqual([])
  })

  it("ignores functions, symbols and undefined members but keeps null and bigint", () => {
    expect(
      fieldsOf({
        fn: () => 1,
        sym: Symbol("s"),
        gone: undefined,
        nul: null,
        big: 5n,
        [Symbol("k")]: 1,
      }),
    ).toEqual(["userData.nul", "userData.big"])
  })

  it("is cycle-safe: a back-reference's name is recorded, but it is not walked again", () => {
    const loop: Record<string, unknown> = { id: 1 }
    loop["self"] = loop
    loop["list"] = [loop]
    expect(fieldsOf({ loop })).toEqual([
      "userData.loop",
      "userData.loop.id",
      "userData.loop.self",
      "userData.loop.list",
      "userData.loop.list.[]",
    ])
  })

  it("walks a shared (non-cyclic) reference everywhere it appears", () => {
    const shared = { x: 1 }
    expect(fieldsOf({ a: shared, b: shared })).toEqual([
      "userData.a",
      "userData.a.x",
      "userData.b",
      "userData.b.x",
    ])
  })

  it("stops at maxDepth (default 8) and says nothing about what is deeper", () => {
    let deep: unknown = { leaf: 1 }
    for (let i = 0; i < 12; i += 1) deep = { n: deep }
    const fields = fieldsOf(deep)
    expect(fields).toHaveLength(8)
    expect(fields[7]).toBe("userData.n.n.n.n.n.n.n.n")
    expect(fieldsOf({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual([
      "userData.a",
      "userData.a.b",
    ])
    expect(fieldsOf({ a: { b: 1 } }, { maxDepth: 0 })).toEqual([])
  })

  it("stops after maxNodes visited values (default 1000)", () => {
    const wide: Record<string, number> = {}
    for (let i = 0; i < 1500; i += 1) wide[`k${i}`] = i
    expect(fieldsOf(wide)).toHaveLength(1000)
    expect(fieldsOf(wide, { maxNodes: 3 })).toEqual(["userData.k0", "userData.k1", "userData.k2"])
  })

  it("treats Map and Set as leaves by default and Date, RegExp, typed arrays as leaves always", () => {
    expect(
      fieldsOf({
        m: new Map([["secret-key", { a: 1 }]]),
        s: new Set([{ a: 1 }]),
        d: new Date(0),
        r: /x/,
        t: new Uint8Array(2),
      }),
    ).toEqual(["userData.m", "userData.s", "userData.d", "userData.r", "userData.t"])
  })

  it("walks Map values and Set members under the element marker when collections is on, never Map keys", () => {
    const fields = fieldsOf(
      { m: new Map([["secret-key-123", { a: 1 }]]), s: new Set([{ b: 2 }]) },
      { collections: true },
    )
    expect(fields).toEqual([
      "userData.m",
      "userData.m.[]",
      "userData.m.[].a",
      "userData.s",
      "userData.s.[]",
      "userData.s.[].b",
    ])
    expect(fields.join()).not.toContain("secret-key")
  })

  it("walks class instances by their own enumerable data properties", () => {
    class Row {
      id = 1
      get computed(): number {
        throw new Error("getter must not run")
      }
    }
    Object.defineProperty(Row.prototype, "computed", { enumerable: true })
    const row = new Row()
    Object.defineProperty(row, "lazy", {
      enumerable: true,
      get() {
        throw new Error("getter must not run")
      },
    })
    expect(fieldsOf({ row })).toEqual(["userData.row", "userData.row.id"])
  })

  it("walks null-prototype objects", () => {
    const bare = Object.create(null) as Record<string, unknown>
    bare["a"] = 1
    expect(fieldsOf(bare)).toEqual(["userData.a"])
  })

  it("skips keys that cannot be a path segment: empty or containing a dot", () => {
    expect(fieldsOf({ "": 1, "a.b": 2, ok: 3 })).toEqual(["userData.ok"])
  })

  it("never throws: a hostile proxy or a throwing sink leaves the value returned untouched", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom")
        },
      },
    )
    const memory = createMemorySink()
    expect(observeValue(memory.sink, ctx, hostile)).toBe(hostile)
    const angry = {
      record() {
        throw new Error("sink")
      },
    }
    const body = { a: 1 }
    expect(observeValue(angry, ctx, body)).toBe(body)
  })

  it("records nothing for an invalid context, but still returns the value", () => {
    const memory = createMemorySink()
    const body = { a: 1 }
    expect(observeValue(memory.sink, { ...ctx, scope: "" }, body)).toBe(body)
    expect(observeValue(memory.sink, { ...ctx, capability: "" }, body)).toBe(body)
    expect(memory.events()).toEqual([])
  })

  it("accepts a scope function evaluated at call time", () => {
    const memory = createMemorySink()
    let current = "one"
    const live = { ...ctx, scope: () => current }
    observeValue(memory.sink, live, { a: 1 })
    current = "two"
    observeValue(memory.sink, live, { a: 1 })
    expect(memory.events().map((event) => event.scope)).toEqual(["one", "two"])
    const broken = {
      ...ctx,
      scope: () => {
        throw new Error("x")
      },
    }
    expect(observeValue(memory.sink, broken, { a: 1 })).toEqual({ a: 1 })
    expect(memory.events()).toHaveLength(2)
  })

  it("does not mutate the value it walks", () => {
    const frozen = Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) })
    expect(() => observeValue(createMemorySink().sink, ctx, frozen)).not.toThrow()
    expect(frozen).toEqual({ a: [{ b: 1 }] })
  })
})

describe("observeValue, the paths it keeps apart and the properties it leaves out", () => {
  it("keeps the path a.b apart from the one key ab", () => {
    expect(fieldsOf({ a: { b: 1 }, ab: 2 })).toEqual(["userData.a", "userData.a.b", "userData.ab"])
  })

  it("leaves out a property that is not enumerable, as it leaves out a getter", () => {
    const body: Record<string, unknown> = { shown: 1 }
    Object.defineProperty(body, "hidden", { value: 2, enumerable: false })
    Object.defineProperty(body, "computed", { get: () => 3, enumerable: true })
    expect(fieldsOf(body)).toEqual(["userData.shown"])
  })

  it("records nothing for a root that is not an object, and nothing below a leaf", () => {
    for (const root of [5, "text", true, null, undefined, 10n, Symbol("s")]) {
      expect(fieldsOf(root)).toEqual([])
    }
    expect(fieldsOf({ n: 1, s: "x", b: false, z: null })).toEqual([
      "userData.n",
      "userData.s",
      "userData.b",
      "userData.z",
    ])
  })

  it("stops at the node bound, reporting what it left out", () => {
    const skipped: string[] = []
    const events = fieldsOf(
      { a: 1, b: 2, c: 3, d: 4, e: 5 },
      {
        maxNodes: 2,
        onSkip: (reason) => skipped.push(reason),
      },
    )
    expect(events).toEqual(["userData.a", "userData.b"])
    expect(skipped).toEqual(["max-nodes"])
  })
})

describe("observeValue, the skips it reports", () => {
  const dotted = { "a.b": 1, ok: 2 }
  const run = (context: ObserveValueContext) => {
    const memory = createMemorySink()
    const told: string[] = []
    observeValue(memory.sink, context, dotted, { onSkip: (reason) => told.push(reason) })
    return { told, skips: memory.skips() }
  }

  it("reports a skip to the callback and the sink when the context names everything", () => {
    const { told, skips } = run(ctx)
    expect(told).toEqual(["dotted-key"])
    expect(skips).toEqual([
      {
        scope: "test:walk",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData",
        reason: "dotted-key",
      },
    ])
  })

  it.each([
    ["a scope that is not a name", { ...ctx, scope: "" }],
    ["a capability that is not a name", { ...ctx, capability: "" }],
    ["a boundary that has no name", { ...ctx, boundary: { kind: ctx.boundary.kind, name: "" } }],
  ])("reports nothing to the callback or the sink for %s", (_label, context) => {
    const { told, skips } = run(context)
    expect(told).toEqual([])
    expect(skips).toEqual([])
  })

  it("keeps going when the callback or the sink throws", () => {
    const memory = createMemorySink()
    const throwing = {
      record: memory.sink.record.bind(memory.sink),
      skip: () => {
        throw new Error("sink")
      },
    }
    expect(() =>
      observeValue(throwing, ctx, dotted, {
        onSkip: () => {
          throw new Error("callback")
        },
      }),
    ).not.toThrow()
    expect(memory.events().map((event) => event.field)).toEqual(["userData.ok"])
  })
})
