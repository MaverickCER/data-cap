import { describe, expect, it } from "vitest"
import { canonicalize } from "../../src/helpers/canonicalize.js"
import { canonicalize as coreCanonicalize } from "../../src/core/canonicalize.js"

describe("helpers/canonicalize", () => {
  it("is the exact same function core uses internally, not a reimplementation", () => {
    expect(canonicalize).toBe(coreCanonicalize)
  })

  it("still exhibits its documented behavior through the re-export", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }))
    expect(canonicalize(1)).not.toBe(canonicalize("1"))
    expect(canonicalize(() => 1)).toBeUndefined()
  })
})
