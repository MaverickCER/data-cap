import { describe, expect, it } from "vitest"
import { fields } from "../../src/core/fields.js"
import { InvalidFieldDefaultError } from "../../src/core/errors.js"
import { checkValueAgainstSchema, resolveFieldDefaults } from "../../src/core/schema.js"

describe("resolveFieldDefaults", () => {
  it("resolves primitives, nested objects, and arrays to themselves", () => {
    expect(resolveFieldDefaults("", [], new Set())).toBe("")
    expect(resolveFieldDefaults(0, [], new Set())).toBe(0)
    expect(resolveFieldDefaults({ a: { b: 1 } }, [], new Set())).toEqual({ a: { b: 1 } })
    expect(resolveFieldDefaults([1, 2], [], new Set())).toEqual([1, 2])
  })

  it("resolves nullable/optional markers to null/undefined", () => {
    expect(resolveFieldDefaults(fields.nullable("x"), [], new Set())).toBeNull()
    expect(resolveFieldDefaults(fields.optional("x"), [], new Set())).toBeUndefined()
  })

  it("passes a null default through unchanged", () => {
    expect(resolveFieldDefaults(null, [], new Set())).toBeNull()
  })

  it("throws InvalidFieldDefaultError, with its exact message, for a function value", () => {
    expect(() => resolveFieldDefaults(() => undefined, [], new Set())).toThrow(
      InvalidFieldDefaultError,
    )
    expect(() => resolveFieldDefaults(() => undefined, [], new Set())).toThrow(
      "functions are not valid field values",
    )
  })

  it("throws InvalidFieldDefaultError, with its exact message, for a cyclic reference", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => resolveFieldDefaults(cyclic, [], new Set())).toThrow(
      "cyclic field defaults are not supported",
    )
  })

  it("names the offending path segment: an object key", () => {
    expect(() => resolveFieldDefaults({ nested: () => undefined }, [], new Set())).toThrow(/nested/)
  })

  it("names the offending path segment: an array index", () => {
    expect(() => resolveFieldDefaults(["ok", () => undefined], [], new Set())).toThrow(/\b1\b/)
  })

  it("names a marker's inner in the path when the inner shape itself is invalid", () => {
    expect(() =>
      resolveFieldDefaults(
        fields.nullable(() => undefined),
        [],
        new Set(),
      ),
    ).toThrow(/<nullable\/optional inner>/)
  })
})

describe("checkValueAgainstSchema", () => {
  it("validates primitives by typeof", () => {
    expect(checkValueAgainstSchema("", "hello")).toEqual({ valid: true, accepted: "hello" })
    expect(checkValueAgainstSchema("", 5)).toEqual({ valid: false })
    expect(checkValueAgainstSchema(0, 5)).toEqual({ valid: true, accepted: 5 })
    expect(checkValueAgainstSchema(false, true)).toEqual({ valid: true, accepted: true })
  })

  it("validates Date/URL/RegExp by instance type", () => {
    const schemaDate = new Date(0)
    const validDate = new Date(1)
    expect(checkValueAgainstSchema(schemaDate, validDate)).toEqual({
      valid: true,
      accepted: validDate,
    })
    expect(checkValueAgainstSchema(schemaDate, "not a date")).toEqual({ valid: false })

    const schemaUrl = new URL("https://example.com")
    const validUrl = new URL("https://other.example.com")
    expect(checkValueAgainstSchema(schemaUrl, validUrl)).toEqual({
      valid: true,
      accepted: validUrl,
    })
    expect(checkValueAgainstSchema(schemaUrl, "not a url")).toEqual({ valid: false })

    const schemaRegExp = /a/u
    const validRegExp = /b/u
    expect(checkValueAgainstSchema(schemaRegExp, validRegExp)).toEqual({
      valid: true,
      accepted: validRegExp,
    })
    expect(checkValueAgainstSchema(schemaRegExp, "not a regexp")).toEqual({ valid: false })
  })

  it("validates arrays atomically -- valid only if the value is itself an array", () => {
    expect(checkValueAgainstSchema([] as string[], ["a", "b"])).toEqual({
      valid: true,
      accepted: ["a", "b"],
    })
    expect(checkValueAgainstSchema([] as string[], "not an array")).toEqual({ valid: false })
  })

  it("widens the accepted shape for nullable/optional markers, on top of the inner type", () => {
    const nullable = fields.nullable("")
    expect(checkValueAgainstSchema(nullable, null)).toEqual({ valid: true, accepted: null })
    expect(checkValueAgainstSchema(nullable, "value")).toEqual({ valid: true, accepted: "value" })
    expect(checkValueAgainstSchema(nullable, 5)).toEqual({ valid: false })

    const optional = fields.optional("")
    expect(checkValueAgainstSchema(optional, undefined)).toEqual({
      valid: true,
      accepted: undefined,
    })
    expect(checkValueAgainstSchema(optional, "value")).toEqual({ valid: true, accepted: "value" })
  })

  it("validates a nullable/optional-wrapped plain object, partially and recursively, resetting invalid nested leaves", () => {
    const schemaNode = fields.nullable({ name: "", age: 0 })
    const result = checkValueAgainstSchema(schemaNode, { name: "Maverick", age: "not-a-number" })
    expect(result).toEqual({ valid: true, accepted: { name: "Maverick", age: 0 } })
  })

  it("drops an unknown key inside a nullable/optional-wrapped plain object without invalidating siblings", () => {
    const schemaNode = fields.optional({ name: "" })
    const result = checkValueAgainstSchema(schemaNode, { name: "Maverick", extra: "smuggled" })
    expect(result).toEqual({ valid: true, accepted: { name: "Maverick" } })
  })

  it("rejects a non-object value for a nullable/optional-wrapped plain object (and not null/undefined either)", () => {
    const schemaNode = fields.nullable({ name: "" })
    expect(checkValueAgainstSchema(schemaNode, "not an object")).toEqual({ valid: false })
    expect(checkValueAgainstSchema(schemaNode, ["array", "not object"])).toEqual({ valid: false })
  })

  it("a nullable marker widens only to `null`, never to `undefined`", () => {
    expect(checkValueAgainstSchema(fields.nullable(""), undefined)).toEqual({ valid: false })
  })

  it("an optional marker widens only to `undefined`, never to `null`", () => {
    expect(checkValueAgainstSchema(fields.optional(""), null)).toEqual({ valid: false })
  })

  it("a Date/URL/RegExp schema rejects a plain object that merely shares the `object` typeof", () => {
    expect(checkValueAgainstSchema(new Date(0), { not: "a date" })).toEqual({ valid: false })
    expect(checkValueAgainstSchema(new URL("https://x.example"), { not: "a url" })).toEqual({
      valid: false,
    })
    expect(checkValueAgainstSchema(/x/u, { not: "a regexp" })).toEqual({ valid: false })
  })

  it("an array schema rejects a non-array object", () => {
    expect(checkValueAgainstSchema([] as string[], { not: "an array" })).toEqual({ valid: false })
  })

  it("a bare (unwrapped) plain-object schema rejects a null value without crashing", () => {
    expect(checkValueAgainstSchema({ name: "" }, null)).toEqual({ valid: false })
  })

  it("a `null` schema node is a primitive leaf: it accepts any object value by typeof, without crashing", () => {
    expect(checkValueAgainstSchema(null, { anything: 1 })).toEqual({
      valid: true,
      accepted: { anything: 1 },
    })
  })

  it("truly omits an unknown nested key from the accepted result, not just sets it undefined", () => {
    const result = checkValueAgainstSchema(fields.optional({ name: "" }), {
      name: "Maverick",
      extra: "smuggled",
    })
    expect(result).toEqual({ valid: true, accepted: { name: "Maverick" } })
    if (result.valid) {
      expect(Object.keys(result.accepted as Record<string, unknown>)).toEqual(["name"])
    }
  })

  it("propagates an InvalidFieldDefaultError (naming the key) when resetting an invalid nested value whose schema default is itself invalid", () => {
    expect(() =>
      checkValueAgainstSchema(fields.nullable({ bad: (): void => undefined }), {
        bad: "wrong-type",
      }),
    ).toThrow(/bad/)
  })
})
