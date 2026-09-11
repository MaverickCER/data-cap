import { describe, expect, it } from "vitest"
import { isDate, isNullish, isPlainObject, isRegExp, isURL } from "../../src/helpers/shape.js"

describe("shape.isPlainObject", () => {
  it("is true for an object literal", () => {
    expect(isPlainObject({ a: 1 })).toBe(true)
  })
  it("is true for Object.create(null)", () => {
    expect(isPlainObject(Object.create(null) as unknown)).toBe(true)
  })
  it("is false for null, arrays, and class instances", () => {
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject([1, 2])).toBe(false)
    expect(isPlainObject(new Date())).toBe(false)
    expect(isPlainObject(new URL("https://example.com"))).toBe(false)
    class Custom {
      value = 1
    }
    expect(isPlainObject(new Custom())).toBe(false)
  })
  it("is false for primitives", () => {
    expect(isPlainObject("hi")).toBe(false)
    expect(isPlainObject(42)).toBe(false)
    expect(isPlainObject(undefined)).toBe(false)
  })
})

describe("shape.isDate / isURL / isRegExp", () => {
  it("recognize their own instance type only", () => {
    expect(isDate(new Date())).toBe(true)
    expect(isDate("2024-01-01")).toBe(false)

    expect(isURL(new URL("https://example.com"))).toBe(true)
    expect(isURL("https://example.com")).toBe(false)

    expect(isRegExp(/abc/)).toBe(true)
    expect(isRegExp("abc")).toBe(false)
  })
})

describe("shape.isNullish", () => {
  it("is true only for null/undefined", () => {
    expect(isNullish(null)).toBe(true)
    expect(isNullish(undefined)).toBe(true)
    expect(isNullish(0)).toBe(false)
    expect(isNullish("")).toBe(false)
    expect(isNullish(false)).toBe(false)
  })
})
