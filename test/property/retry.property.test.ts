import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { canonicalize } from "../../src/core/canonicalize.js"
import { defaultBackoff, isStillDefault } from "../../src/runtime/retry.js"

describe("defaultBackoff -- property-based", () => {
  it("starts at one second and never exceeds thirty", () => {
    expect(defaultBackoff(1)).toBe(1000)
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (attempt) => {
        const delay = defaultBackoff(attempt)
        expect(delay).toBeGreaterThanOrEqual(1000)
        expect(delay).toBeLessThanOrEqual(30_000)
      }),
      { numRuns: 300 },
    )
  })

  it("never waits less for a later attempt", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (attempt, more) => {
          expect(defaultBackoff(attempt + more)).toBeGreaterThanOrEqual(defaultBackoff(attempt))
        },
      ),
      { numRuns: 300 },
    )
  })

  it("doubles each attempt until it reaches the cap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (attempt) => {
        expect(defaultBackoff(attempt + 1)).toBe(defaultBackoff(attempt) * 2)
      }),
      { numRuns: 20 },
    )
    expect(defaultBackoff(6)).toBe(30_000)
  })
})

describe("isStillDefault -- property-based", () => {
  it("treats a value as still the default when it equals a copy of itself", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        // A value carrying `__proto__`, `constructor` or `prototype` as a key cannot be canonicalized, and
        // `isStillDefault` deliberately treats such a value as not the default.
        fc.pre(canonicalize(value) !== undefined)
        expect(isStillDefault(value, structuredClone(value))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it("is symmetric", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        expect(isStillDefault(a, b)).toBe(isStillDefault(b, a))
      }),
      { numRuns: 300 },
    )
  })

  it("never treats a value that cannot be canonicalized as the default, unless it is the very same value", () => {
    fc.assert(
      fc.property(fc.func(fc.constant(1)), (fn) => {
        expect(isStillDefault(fn, () => 1)).toBe(false)
        expect(isStillDefault(fn, fn)).toBe(true)
      }),
      { numRuns: 50 },
    )
  })
})
