import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { canonicalize } from "../../src/core/canonicalize.js"

/** `-0` is the one JSON-safe number that `JSON.stringify` cannot tell from `0`. */
function containsNegativeZero(value: unknown): boolean {
  if (typeof value === "number") return Object.is(value, -0)
  if (Array.isArray(value)) return (value as unknown[]).some(containsNegativeZero)
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsNegativeZero)
  }
  return false
}

const jsonValue = fc.jsonValue().filter((value) => !containsNegativeZero(value))

/** JSON text with object keys in sorted order, the oracle for "the same value". */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${(value as unknown[]).map(stableStringify).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}

describe("canonicalize -- property-based", () => {
  it("never throws and answers with a string or undefined, whatever it is given", () => {
    fc.assert(
      fc.property(
        fc.anything({ withBigInt: true, withDate: true, withMap: true, withSet: true }),
        (value) => {
          const result = canonicalize(value)
          expect(result === undefined || typeof result === "string").toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })

  it("is deterministic, and the same for a value and its structured clone", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const result = canonicalize(value)
        expect(canonicalize(value)).toBe(result)
        expect(canonicalize(structuredClone(value))).toBe(result)
      }),
      { numRuns: 300 },
    )
  })

  it("does not depend on the order an object's keys were written in", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ maxLength: 8 }), jsonValue), (record) => {
        const reversed = Object.fromEntries(Object.entries(record).reverse())
        expect(canonicalize(reversed)).toBe(canonicalize(record))
      }),
      { numRuns: 200 },
    )
  })

  it("gives two values the same text only when they are the same value", () => {
    fc.assert(
      fc.property(jsonValue, jsonValue, (a, b) => {
        const ca = canonicalize(a)
        const cb = canonicalize(b)
        // A key such as `constructor` makes a value non-canonicalizable; that is covered below.
        fc.pre(ca !== undefined && cb !== undefined)
        expect(ca === cb).toBe(stableStringify(a) === stableStringify(b))
      }),
      { numRuns: 500 },
    )
  })

  it("keeps an array's elements apart: moving a character between neighbours changes the text", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.string({ minLength: 1, maxLength: 6 }),
        (a, b) => {
          // `["ab", "x"]` and `["a", "bx"]` must not collide (`b` is non-empty, so the arrays differ).
          const left = canonicalize([`${a}${b}`, "x"])
          const right = canonicalize([a, `${b}x`])
          expect(left).not.toBe(right)
        },
      ),
      { numRuns: 200 },
    )
  })

  it("refuses what it cannot canonicalize safely instead of guessing", () => {
    expect(canonicalize(() => 1)).toBeUndefined()
    expect(canonicalize(Symbol("s"))).toBeUndefined()
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(canonicalize(cyclic)).toBeUndefined()
    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(canonicalize(JSON.parse(`{"${key}": 1}`))).toBeUndefined()
    }
  })
})
