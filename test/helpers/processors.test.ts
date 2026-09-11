import { describe, expect, it } from "vitest"
import * as processors from "../../src/helpers/processors.js"

describe("processors.toString", () => {
  it("passes strings through unchanged", () => {
    expect(processors.toString("hi")).toBe("hi")
  })
  it("stringifies non-string values", () => {
    expect(processors.toString(42)).toBe("42")
    expect(processors.toString(true)).toBe("true")
  })
  it("returns undefined for nullish input", () => {
    expect(processors.toString(undefined)).toBeUndefined()
    expect(processors.toString(null)).toBeUndefined()
  })
})

describe("processors.toNumber", () => {
  it("passes finite numbers through unchanged", () => {
    expect(processors.toNumber(3.5)).toBe(3.5)
  })
  it("coerces a numeric string", () => {
    expect(processors.toNumber("42")).toBe(42)
  })
  it("returns undefined for an empty/whitespace-only string rather than 0", () => {
    expect(processors.toNumber("")).toBeUndefined()
    expect(processors.toNumber("   ")).toBeUndefined()
  })
  it("returns undefined for NaN and non-numeric input", () => {
    expect(processors.toNumber(NaN)).toBeUndefined()
    expect(processors.toNumber("not-a-number")).toBeUndefined()
    expect(processors.toNumber({})).toBeUndefined()
  })
})

describe("processors.toInteger", () => {
  it("accepts an integer value", () => {
    expect(processors.toInteger("7")).toBe(7)
  })
  it("rejects a non-integer numeric value", () => {
    expect(processors.toInteger("7.5")).toBeUndefined()
  })
  it("returns undefined for non-numeric input", () => {
    expect(processors.toInteger("nope")).toBeUndefined()
  })
})

describe("processors.toBoolean", () => {
  it("passes booleans through unchanged", () => {
    expect(processors.toBoolean(true)).toBe(true)
    expect(processors.toBoolean(false)).toBe(false)
  })
  it.each(["true", "1", "yes", "on", "TRUE", " On "])("recognizes %s as true", (input) => {
    expect(processors.toBoolean(input)).toBe(true)
  })
  it.each(["false", "0", "no", "off", "FALSE"])("recognizes %s as false", (input) => {
    expect(processors.toBoolean(input)).toBe(false)
  })
  it("returns undefined for an unrecognized string or non-string/boolean", () => {
    expect(processors.toBoolean("maybe")).toBeUndefined()
    expect(processors.toBoolean(1)).toBeUndefined()
  })
})

describe("processors.toDate", () => {
  it("passes a valid Date through unchanged", () => {
    const date = new Date("2024-01-01T00:00:00.000Z")
    expect(processors.toDate(date)).toBe(date)
  })
  it("returns undefined for an invalid Date instance", () => {
    expect(processors.toDate(new Date("not-a-date"))).toBeUndefined()
  })
  it("parses a valid date string or epoch number", () => {
    expect(processors.toDate("2024-01-01T00:00:00.000Z")?.toISOString()).toBe(
      "2024-01-01T00:00:00.000Z",
    )
    expect(processors.toDate(0)?.toISOString()).toBe("1970-01-01T00:00:00.000Z")
  })
  it("returns undefined for unparseable or wrong-typed input", () => {
    expect(processors.toDate("not-a-date")).toBeUndefined()
    expect(processors.toDate(true)).toBeUndefined()
  })
})

describe("processors.toURL", () => {
  it("passes a URL instance through unchanged", () => {
    const url = new URL("https://example.com")
    expect(processors.toURL(url)).toBe(url)
  })
  it("parses a valid absolute URL string", () => {
    expect(processors.toURL("https://example.com/path")?.pathname).toBe("/path")
  })
  it("returns undefined for an invalid URL or non-string input", () => {
    expect(processors.toURL("not a url")).toBeUndefined()
    expect(processors.toURL(42)).toBeUndefined()
  })
  it("rejects a non-string even when its stringification would be a valid URL", () => {
    expect(processors.toURL({ toString: () => "https://example.com" })).toBeUndefined()
  })
})

describe("processors.toRegExp", () => {
  it("passes a RegExp instance through unchanged", () => {
    const pattern = /abc/
    expect(processors.toRegExp(pattern)).toBe(pattern)
  })
  it("compiles a valid pattern string", () => {
    expect(processors.toRegExp("^abc$")?.test("abc")).toBe(true)
  })
  it("returns undefined for an invalid pattern or non-string input", () => {
    expect(processors.toRegExp("(unterminated")).toBeUndefined()
    expect(processors.toRegExp(42)).toBeUndefined()
  })
})

describe("processors.toBigInt", () => {
  it("passes a bigint through unchanged", () => {
    expect(processors.toBigInt(10n)).toBe(10n)
  })
  it("coerces a numeric string or safe integer number", () => {
    expect(processors.toBigInt("123")).toBe(123n)
    expect(processors.toBigInt(123)).toBe(123n)
  })
  it("returns undefined for a non-integer numeric string or wrong-typed input", () => {
    expect(processors.toBigInt("12.5")).toBeUndefined()
    expect(processors.toBigInt(true)).toBeUndefined()
  })
})

describe("processors.trim / toLowerCase / toUpperCase", () => {
  it("trims surrounding whitespace", () => {
    expect(processors.trim("  hi  ")).toBe("hi")
  })
  it("lowercases and uppercases", () => {
    expect(processors.toLowerCase("HI")).toBe("hi")
    expect(processors.toUpperCase("hi")).toBe("HI")
  })
  it("returns undefined for nullish input, matching toString", () => {
    expect(processors.trim(null)).toBeUndefined()
    expect(processors.toLowerCase(undefined)).toBeUndefined()
    expect(processors.toUpperCase(null)).toBeUndefined()
  })
})

describe("processors.toArray", () => {
  it("splits a delimited string into trimmed items", () => {
    expect(processors.toArray("a, b ,c")).toEqual(["a", "b", "c"])
  })
  it("supports a custom separator", () => {
    expect(processors.toArray("a|b|c", "|")).toEqual(["a", "b", "c"])
  })
  it("returns an empty array for a blank string", () => {
    expect(processors.toArray("   ")).toEqual([])
  })
  it("stringifies items of an array input rather than treating it as unsupported", () => {
    expect(processors.toArray([1, 2, 3])).toEqual(["1", "2", "3"])
  })
  it("returns undefined for non-string, non-array input", () => {
    expect(processors.toArray(42)).toBeUndefined()
  })
})

describe("processors.parseJSON", () => {
  it("parses a valid JSON string", () => {
    expect(processors.parseJSON('{"a":1}')).toEqual({ a: 1 })
  })
  it("returns undefined for invalid JSON", () => {
    expect(processors.parseJSON("{not json")).toBeUndefined()
  })
  it("returns undefined for non-string input", () => {
    expect(processors.parseJSON({ a: 1 })).toBeUndefined()
  })
  it("returns undefined for a number/boolean input, never JSON.parse(String(value))", () => {
    // `JSON.parse("42")` / `JSON.parse("true")` would succeed -- the string
    // guard is what stops a non-string from being parsed as JSON.
    expect(processors.parseJSON(42)).toBeUndefined()
    expect(processors.parseJSON(true)).toBeUndefined()
  })
})
