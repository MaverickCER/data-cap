import { describe, expect, it } from "vitest"
import { buildData } from "../../src/core/build.js"
import { InvalidFieldDefaultError } from "../../src/core/errors.js"
import { fields } from "../../src/core/fields.js"

describe("buildData", () => {
  it("fields are synchronously readable immediately, populated with declared defaults", () => {
    const capability = buildData({
      fields: {
        id: "",
        count: 0,
        active: false,
        user: { email: "" },
        comments: [] as { id: string; body: string }[],
      },
    })

    expect(capability.fields.id).toBe("")
    expect(capability.fields.count).toBe(0)
    expect(capability.fields.active).toBe(false)
    expect(capability.fields.user.email).toBe("")
    expect(capability.fields.comments).toEqual([])
  })

  it("info is present (not undefined) and starts structurally sparse -- an empty object", () => {
    const capability = buildData({ fields: { id: "" } })
    expect(capability.info).toBeDefined()
    expect(capability.info).toEqual({})
  })

  it("fields and info are returned from the same DataState object", () => {
    const capability = buildData({ fields: { id: "" } })
    expect(Object.keys(capability).sort()).toEqual(["fields", "info"])
  })

  it("resolves fields.nullable to null and fields.optional to undefined", () => {
    const capability = buildData({
      fields: {
        middleName: fields.nullable(""),
        nickname: fields.optional(""),
      },
    })
    expect(capability.fields.middleName).toBeNull()
    expect(capability.fields.nickname).toBeUndefined()
  })

  it("preserves Date/URL/RegExp defaults as opaque, untouched instances (same reference)", () => {
    const createdAt = new Date(0)
    const homepage = new URL("https://example.com")
    const pattern = /abc/u
    const capability = buildData({ fields: { createdAt, homepage, pattern } })
    expect(capability.fields.createdAt).toBe(createdAt)
    expect(capability.fields.homepage).toBe(homepage)
    expect(capability.fields.pattern).toBe(pattern)
  })

  it("throws InvalidFieldDefaultError with a stable code for a function-valued field default", () => {
    expect(() => buildData({ fields: { cb: () => undefined } })).toThrow(InvalidFieldDefaultError)

    try {
      buildData({ fields: { cb: () => undefined } })
      expect.unreachable("buildData should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidFieldDefaultError)
      expect((error as InvalidFieldDefaultError).code).toBe("DATA_CAP_INVALID_FIELD_DEFAULT")
      // Negative guarantee: the thrown message never embeds a raw/processed value.
      expect((error as InvalidFieldDefaultError).message).not.toContain("() => undefined")
    }
  })

  it("throws InvalidFieldDefaultError for a function nested inside fields.nullable/fields.optional", () => {
    expect(() => buildData({ fields: { thing: fields.nullable(() => undefined) } })).toThrow(
      InvalidFieldDefaultError,
    )
    expect(() => buildData({ fields: { thing: fields.optional(() => undefined) } })).toThrow(
      InvalidFieldDefaultError,
    )
  })

  it("throws InvalidFieldDefaultError for a cyclic field default", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => buildData({ fields: { thing: cyclic } })).toThrow(InvalidFieldDefaultError)
  })

  it("throws InvalidFieldDefaultError for a cycle nested inside an array default", () => {
    const list: Record<string, unknown>[] = []
    const item: Record<string, unknown> = { self: list }
    list.push(item)
    expect(() => buildData({ fields: { list } })).toThrow(InvalidFieldDefaultError)
  })

  it("does not misreport a shared, acyclic reference as a cycle", () => {
    const shared = { value: 1 }
    const capability = buildData({ fields: { a: shared, b: shared } })
    expect(capability.fields.a).toEqual({ value: 1 })
    expect(capability.fields.b).toEqual({ value: 1 })
  })

  it("deep-freezes the resulting DataState -- direct mutation throws (strict-mode ESM semantics)", () => {
    const capability = buildData({
      fields: { id: "", user: { email: "" }, comments: [] as string[] },
    })

    expect(() => {
      capability.fields.id = "mutated"
    }).toThrow(TypeError)

    expect(() => {
      capability.fields.user.email = "mutated"
    }).toThrow(TypeError)

    expect(() => {
      capability.fields.comments.push("x")
    }).toThrow(TypeError)

    expect(() => {
      // `info` starts as `{}`; adding any property to a frozen, non-extensible
      // object throws exactly like mutating an existing one would.
      Object.assign(capability.info, { id: { status: "success" } })
    }).toThrow(TypeError)
  })

  it("independent buildData calls never share state", () => {
    const a = buildData({ fields: { count: 0 } })
    const b = buildData({ fields: { count: 0 } })
    expect(a.fields).not.toBe(b.fields)
    expect(a).not.toBe(b)
  })
})
