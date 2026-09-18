import { describe, expect, it } from "vitest"
import { canonicalize } from "../../src/core/canonicalize.js"

describe("canonicalize -- exact canonical encoding (the collision-freeness contract)", () => {
  // `atom(tag, payload)` == `${tag}${payload.length}:${payload}`. Pinning the
  // exact form is what actually proves the type tags and length prefixes carry
  // their weight -- relational `not.toBe` checks pass no matter what the tag is.
  it.each<[string, unknown, string]>([
    ["undefined", undefined, "u0:"],
    ["null", null, "z0:"],
    ["empty string", "", "s0:"],
    ["string", "hello", "s5:hello"],
    ["true", true, "b1:1"],
    ["false", false, "b1:0"],
    ["bigint", 1n, "i1:1"],
    ["negative bigint", -5n, "i2:-5"],
    ["number", 42, "n2:42"],
    ["zero", 0, "n1:0"],
    ["negative zero (shares the +0 form)", -0, "n1:0"],
    ["NaN", NaN, "N0:"],
    ["+Infinity", Number.POSITIVE_INFINITY, "P0:"],
    ["-Infinity", Number.NEGATIVE_INFINITY, "M0:"],
    ["Date", new Date("2024-01-01T00:00:00.000Z"), "d24:2024-01-01T00:00:00.000Z"],
    ["URL", new URL("https://example.com/a"), "l21:https://example.com/a"],
    ["RegExp", /abc/u, "r6:/abc/u"],
    ["empty array", [], "a0:"],
    ["one-element array", [1], "a4:n1:1"],
    ["empty object", {}, "o0:"],
    ["one-key object", { a: 1 }, "o8:k1:an1:1"],
    ["multi-key object, sorted", { b: "x", a: 1 }, "o16:k1:an1:1k1:bs1:x"],
  ])("encodes %s as %s", (_label, value, expected) => {
    expect(canonicalize(value)).toBe(expected)
  })

  it("tags a URL distinctly from its own href string (so they can never collide)", () => {
    const url = new URL("https://example.com/a")
    expect(canonicalize(url)).not.toBe(canonicalize(url.href))
  })

  it("canonicalizes a null-prototype object as a plain object, identically to its literal twin", () => {
    const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, { x: 1 })
    expect(canonicalize(nullProto)).toBe(canonicalize({ x: 1 }))
    expect(canonicalize(Object.create(null))).toBe(canonicalize({}))
  })
})

describe("canonicalize -- example-based", () => {
  it("is deterministic for equal primitive inputs", () => {
    expect(canonicalize("hello")).toBe(canonicalize("hello"))
    expect(canonicalize(42)).toBe(canonicalize(42))
    expect(canonicalize(true)).toBe(canonicalize(true))
    expect(canonicalize(null)).toBe(canonicalize(null))
    expect(canonicalize(undefined)).toBe(canonicalize(undefined))
  })

  it("never confuses a number and its string representation", () => {
    expect(canonicalize(1)).not.toBe(canonicalize("1"))
    expect(canonicalize(0)).not.toBe(canonicalize("0"))
    expect(canonicalize(true)).not.toBe(canonicalize("true"))
  })

  it("never confuses NaN with any real number, and NaN canonicalizes to itself", () => {
    expect(canonicalize(NaN)).toBe(canonicalize(NaN))
    expect(canonicalize(NaN)).not.toBe(canonicalize(0))
    expect(canonicalize(NaN)).not.toBe(canonicalize(undefined))
  })

  it("distinguishes +Infinity/-Infinity from each other and from finite numbers", () => {
    expect(canonicalize(Infinity)).toBe(canonicalize(Infinity))
    expect(canonicalize(-Infinity)).toBe(canonicalize(-Infinity))
    expect(canonicalize(Infinity)).not.toBe(canonicalize(-Infinity))
    expect(canonicalize(Infinity)).not.toBe(canonicalize(Number.MAX_SAFE_INTEGER))
  })

  it("canonicalizes BigInt distinctly from an equal-valued number", () => {
    expect(canonicalize(1n)).toBe(canonicalize(1n))
    expect(canonicalize(1n)).not.toBe(canonicalize(1))
  })

  it("canonicalizes null and undefined distinctly", () => {
    expect(canonicalize(null)).not.toBe(canonicalize(undefined))
  })

  it("canonicalizes Date by instant, distinctly from a same-instant-string", () => {
    const a = new Date("2024-01-01T00:00:00.000Z")
    const b = new Date("2024-01-01T00:00:00.000Z")
    expect(canonicalize(a)).toBe(canonicalize(b))
    expect(canonicalize(a)).not.toBe(canonicalize(a.toISOString()))
  })

  it("returns undefined (non-canonicalizable) for an invalid Date", () => {
    expect(canonicalize(new Date("not a date"))).toBeUndefined()
  })

  it("canonicalizes URL by href", () => {
    expect(canonicalize(new URL("https://example.com/a"))).toBe(
      canonicalize(new URL("https://example.com/a")),
    )
    expect(canonicalize(new URL("https://example.com/a"))).not.toBe(
      canonicalize(new URL("https://example.com/b")),
    )
  })

  it("canonicalizes RegExp by source+flags", () => {
    expect(canonicalize(/abc/gu)).toBe(canonicalize(/abc/gu))
    expect(canonicalize(/abc/gu)).not.toBe(canonicalize(/abc/u))
  })

  it("canonicalizes arrays preserving order -- order is meaningful", () => {
    expect(canonicalize([1, 2, 3])).toBe(canonicalize([1, 2, 3]))
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]))
  })

  it("canonicalizes plain objects independent of property order", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }))
  })

  it("distinguishes objects with different values for the same key", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }))
  })

  it("distinguishes structurally different nestings that could naively collide via key/value concatenation", () => {
    expect(canonicalize({ a: "bc" })).not.toBe(canonicalize({ ab: "c" }))
    expect(canonicalize([1, 23])).not.toBe(canonicalize([12, 3]))
  })

  it("returns undefined for functions, symbols, and cyclic references", () => {
    expect(canonicalize(() => undefined)).toBeUndefined()
    expect(canonicalize(Symbol("x"))).toBeUndefined()
    const cyclic: Record<string, unknown> = {}
    cyclic["self"] = cyclic
    expect(canonicalize(cyclic)).toBeUndefined()
  })

  it("never throws for a cyclic reference nested inside an array", () => {
    const cyclic: Record<string, unknown>[] = []
    cyclic.push({ self: cyclic })
    expect(() => canonicalize(cyclic)).not.toThrow()
    expect(canonicalize(cyclic)).toBeUndefined()
  })

  it("never throws for an array that references itself directly, with no intermediate object", () => {
    // Distinct from the previous case: no nested object sits between the
    // array and its own cycle, so no OBJECT-side `nextSeen` tracking can
    // ever catch this -- only the array's own `nextSeen` (or, failing that,
    // MAX_DEPTH's independent backstop -- see the depth-boundary tests
    // below) can.
    const cyclic: unknown[] = []
    cyclic.push(cyclic)
    expect(() => canonicalize(cyclic)).not.toThrow()
    expect(canonicalize(cyclic)).toBeUndefined()
  })

  it("canonicalizes a non-cyclic structure nested exactly MAX_DEPTH levels deep", () => {
    let value: unknown = "leaf"
    for (let i = 0; i < 200; i++) value = { n: value }
    expect(canonicalize(value)).toBeDefined()
  })

  it("returns undefined for a non-cyclic structure nested one level past MAX_DEPTH -- the depth ceiling itself, not just the cycle checks it backstops", () => {
    let value: unknown = "leaf"
    for (let i = 0; i < 201; i++) value = { n: value }
    expect(() => canonicalize(value)).not.toThrow()
    expect(canonicalize(value)).toBeUndefined()
  })

  it("increments depth through array nesting too, not just object nesting", () => {
    let value: unknown = "leaf"
    for (let i = 0; i < 200; i++) value = [value]
    expect(canonicalize(value)).toBeDefined()

    let tooDeep: unknown = "leaf"
    for (let i = 0; i < 201; i++) tooDeep = [tooDeep]
    expect(canonicalize(tooDeep)).toBeUndefined()
  })

  it("returns undefined for an object carrying __proto__/constructor/prototype as an own key", () => {
    const withProto: Record<string, unknown> = {}
    Object.defineProperty(withProto, "__proto__", {
      value: 1,
      enumerable: true,
      configurable: true,
    })
    expect(canonicalize(withProto)).toBeUndefined()
    expect(canonicalize({ constructor: "smuggled" })).toBeUndefined()
    expect(canonicalize({ prototype: "smuggled" })).toBeUndefined()
  })

  it("returns undefined for a class instance without a .toJSON() method", () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    expect(canonicalize(new Point(1, 2))).toBeUndefined()
  })

  it("uses .toJSON() for a class instance that provides one, matching JSON.stringify's own convention", () => {
    class Money {
      constructor(private cents: number) {}
      toJSON(): number {
        return this.cents
      }
    }
    expect(canonicalize(new Money(500))).toBe(canonicalize(500))
  })

  it("propagates non-canonicalizability from a nested value up through arrays and objects", () => {
    expect(canonicalize([1, () => undefined, 3])).toBeUndefined()
    expect(canonicalize({ a: 1, b: Symbol("x") })).toBeUndefined()
  })

  it("never throws for a value containing the internal atom separator characters", () => {
    const tricky = "contains:colons:and5:length-looking:prefixes"
    expect(() => canonicalize(tricky)).not.toThrow()
    expect(canonicalize(tricky)).toBe(canonicalize(tricky))
    expect(canonicalize(tricky)).not.toBe(canonicalize("contains"))
  })
})

describe("canonicalize -- property-based obligations", () => {
  const samples: unknown[] = [
    "",
    "a",
    "ab",
    "abc",
    0,
    1,
    -1,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    true,
    false,
    null,
    undefined,
    1n,
    2n,
    [],
    [1],
    [1, 2],
    [2, 1],
    {},
    { a: 1 },
    // { b: 2, a: 1 } deliberately omitted -- it's the same logical value as
    // { a: 1, b: 2 } (property-order independence is correct, verified
    // separately above), not a distinct sample for the injectivity check below.
    { a: 1, b: 2 },
    { a: "1" },
    { a: 1, b: { c: 2 } },
    new Date(0),
    new Date(1),
    new URL("https://example.com/a"),
    new URL("https://example.com/b"),
    /a/u,
    /b/u,
    "1",
    "true",
    "null",
  ]

  it("determinism: canonicalize(x) === canonicalize(x) for every supported sample", () => {
    for (const sample of samples) {
      const once = canonicalize(structuredCloneSafe(sample))
      const twice = canonicalize(structuredCloneSafe(sample))
      expect(twice).toBe(once)
    }
  })

  it("injectivity: distinct supported samples never produce the same canonical key", () => {
    const seen = new Map<string, unknown>()
    for (const sample of samples) {
      const key = canonicalize(sample)
      if (key === undefined) continue
      if (seen.has(key)) {
        const collidesWith = seen.get(key)
        expect.fail(
          `canonicalize collision: ${JSON.stringify(sample)} and ${JSON.stringify(collidesWith)} both produced ${key}`,
        )
      }
      seen.set(key, sample)
    }
  })

  it("deep-equal-but-distinct-instance inputs still canonicalize identically (value equality, not reference equality)", () => {
    for (let i = 0; i < 20; i++) {
      const a = { x: i, nested: { y: i * 2, list: [i, i + 1] } }
      const b = { x: i, nested: { y: i * 2, list: [i, i + 1] } }
      expect(canonicalize(a)).toBe(canonicalize(b))
    }
  })
})

// Rebuilds a fresh, independent structural copy of a sample so the
// "determinism" test genuinely re-canonicalizes distinct object instances
// rather than trivially re-canonicalizing the exact same reference twice
// (Date/URL/RegExp don't support structuredClone identically across all
// runtimes for this repo's purposes, so those are simply reused directly --
// they're immutable-in-practice for this test's needs).
function structuredCloneSafe<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (value instanceof Date || value instanceof URL || value instanceof RegExp) return value
  if (Array.isArray(value)) return value.map((item: unknown) => structuredCloneSafe(item)) as T
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    result[key] = structuredCloneSafe((value as Record<string, unknown>)[key])
  }
  return result as T
}
