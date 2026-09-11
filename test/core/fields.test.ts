import { describe, expect, it } from "vitest"
import { FIELD_MARKER, fields, isFieldMarker } from "../../src/core/fields.js"

describe("fields.nullable", () => {
  it("wraps the default with a nullable marker, preserving the inner value", () => {
    const marker = fields.nullable("")
    expect(marker[FIELD_MARKER]).toBe("nullable")
    expect(marker.inner).toBe("")
  })

  it("preserves the inner default across supported value types", () => {
    expect(fields.nullable(0).inner).toBe(0)
    expect(fields.nullable(false).inner).toBe(false)
    const date = new Date(0)
    expect(fields.nullable(date).inner).toBe(date)
    const url = new URL("https://example.com")
    expect(fields.nullable(url).inner).toBe(url)
    expect(fields.nullable({ a: 1 }).inner).toEqual({ a: 1 })
  })
})

describe("fields.optional", () => {
  it("wraps the default with an optional marker, preserving the inner value", () => {
    const marker = fields.optional("")
    expect(marker[FIELD_MARKER]).toBe("optional")
    expect(marker.inner).toBe("")
  })
})

describe("FIELD_MARKER", () => {
  it("is registered in the global symbol registry (Symbol.for), not a bare Symbol() -- load-bearing for cross-bundle identity (see test/runtime/cross-bundle-field-marker.test.ts)", () => {
    expect(Symbol.for("data-cap.field-marker")).toBe(FIELD_MARKER)
    expect(Symbol.keyFor(FIELD_MARKER)).toBe("data-cap.field-marker")
  })
})

describe("isFieldMarker", () => {
  it("recognizes nullable and optional markers", () => {
    expect(isFieldMarker(fields.nullable(""))).toBe(true)
    expect(isFieldMarker(fields.optional(""))).toBe(true)
  })

  it("rejects ordinary values, including near-miss shapes", () => {
    expect(isFieldMarker("")).toBe(false)
    expect(isFieldMarker(0)).toBe(false)
    expect(isFieldMarker(null)).toBe(false)
    expect(isFieldMarker(undefined)).toBe(false)
    expect(isFieldMarker({})).toBe(false)
    expect(isFieldMarker([])).toBe(false)
    // Has *a* value at the marker key, but not one of the two recognized kinds.
    expect(isFieldMarker({ [FIELD_MARKER]: "something-else" })).toBe(false)
  })
})
