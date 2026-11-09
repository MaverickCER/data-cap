import { describe, expect, it } from "vitest"
import { InvalidFieldDefaultError } from "../../src/core/errors.js"
import { resolveFieldDefaults } from "../../src/core/schema.js"

/** Written to run before the slower tests: the cycle check must be what stops a cycle, not the depth ceiling. */
describe("resolveFieldDefaults: a cycle", () => {
  it("is reported at the key that repeats it, not at the depth ceiling", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic["self"] = cyclic
    let caught: unknown
    try {
      resolveFieldDefaults(cyclic, [], new Set())
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InvalidFieldDefaultError)
    expect((caught as InvalidFieldDefaultError).path).toEqual(["self"])
  })
})
