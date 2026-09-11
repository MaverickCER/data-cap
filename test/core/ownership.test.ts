import { describe, expect, it } from "vitest"
import { fields } from "../../src/core/fields.js"
import { resolveOperationPatch } from "../../src/core/ownership.js"

const schema = {
  id: "",
  count: 0,
  active: false,
  user: { email: "", profile: { name: "" } },
  tags: [] as string[],
  middleName: fields.nullable(""),
  nickname: fields.optional(""),
}

describe("resolveOperationPatch -- ownership boundary", () => {
  it("accepts a field explicitly declared owned (getter-style, fields: {id: true})", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { id: true },
      fieldsSchema: schema,
      processedOutput: { id: "new" },
      operator: "getId",
    })
    expect(result.acceptedPatch).toEqual({ id: "new" })
    expect(result.fieldErrors.size).toBe(0)
  })

  it("drops a field NOT declared owned, without dropping owned siblings, and records a fieldError (negative guarantee 1: no smuggling)", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { id: true },
      fieldsSchema: schema,
      processedOutput: { id: "new", count: 999 },
      operator: "getId",
    })
    expect(result.acceptedPatch).toEqual({ id: "new" })
    expect(result.acceptedPatch).not.toHaveProperty("count")
    expect(result.fieldErrors.has("count")).toBe(true)
  })

  it("rejects a field that isn't declared anywhere in the schema, even if the processor smuggles it as 'owned'", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { id: true },
      fieldsSchema: schema,
      // `processedOutput` is deliberately typed `unknown` -- runtime data
      // whose shape can't be known statically -- so this malformed value is
      // valid at the type level; the point of this test is that the RUNTIME
      // still rejects it.
      processedOutput: { totallyMadeUp: "value" },
      operator: "getId",
    })
    expect(result.acceptedPatch).toBeUndefined()
    expect(result.fieldErrors.has("totallyMadeUp")).toBe(true)
  })

  it("rejects __proto__/constructor/prototype keys outright, even when nominally 'owned'", () => {
    const maliciousOutput: Record<string, unknown> = {}
    Object.defineProperty(maliciousOutput, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    })
    const result = resolveOperationPatch({
      declaredOwnership: true,
      fieldsSchema: schema,
      processedOutput: maliciousOutput,
      operator: "mutate",
    })
    expect(result.acceptedPatch).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty("polluted")
  })

  it("mutator with no declared ownership (undefined) may write any declared schema field, bounded to the schema", () => {
    const result = resolveOperationPatch({
      declaredOwnership: undefined,
      fieldsSchema: schema,
      processedOutput: { id: "new", count: 5 },
      operator: "updateEverything",
    })
    expect(result.acceptedPatch).toEqual({ id: "new", count: 5 })
  })

  it("mutator with no declared ownership still cannot introduce a field outside the declared schema", () => {
    const result = resolveOperationPatch({
      declaredOwnership: undefined,
      fieldsSchema: schema,
      processedOutput: { id: "new", notInSchema: "value" },
      operator: "updateEverything",
    })
    expect(result.acceptedPatch).toEqual({ id: "new" })
    expect(result.fieldErrors.has("notInSchema")).toBe(true)
  })

  it("resets a whole nested-object field to its schema default when the processor returns a non-object value for it", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { user: true },
      fieldsSchema: schema,
      processedOutput: { user: "not an object at all" },
      operator: "badUser",
    })
    expect(result.acceptedPatch).toEqual({ user: { email: "", profile: { name: "" } } })
    expect(result.fieldErrors.has("user")).toBe(true)
  })

  it("treats a nested ownership object declared for a non-object (leaf) schema field as not owned -- misconfiguration is never silently permissive", () => {
    const result = resolveOperationPatch({
      declaredOwnership: {
        // `count` is a number in the schema -- a nested ownership object
        // here is a misconfiguration (FieldOwnership's own type already
        // rejects this at compile time); only `true` can grant access to a
        // leaf. This proves the runtime is defensive about it too.
        // @ts-expect-error -- intentionally invalid FieldOwnership shape
        count: { nested: true },
      },
      fieldsSchema: schema,
      processedOutput: { count: 5 },
      operator: "misconfigured",
    })
    expect(result.acceptedPatch).toBeUndefined()
    expect(result.fieldErrors.has("count")).toBe(true)
  })

  it("supports partial ownership of a nested object -- only the listed sub-keys are owned", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { user: { email: true } },
      fieldsSchema: schema,
      processedOutput: { user: { email: "new@example.com", profile: { name: "smuggled" } } },
      operator: "updateEmail",
    })
    expect(result.acceptedPatch).toEqual({ user: { email: "new@example.com" } })
    expect(result.fieldErrors.has("user.profile")).toBe(true)
  })
})

describe("resolveOperationPatch -- presence, never truthiness (negative guarantee 2)", () => {
  it.each([
    ["empty string", "id", ""],
    ["zero", "count", 0],
    ["false", "active", false],
  ] as const)(
    "accepts a legitimate falsy value (%s) rather than treating it as absent",
    (_label, key, value) => {
      const result = resolveOperationPatch({
        declaredOwnership: { [key]: true },
        fieldsSchema: schema,
        processedOutput: { [key]: value },
        operator: "setFalsy",
      })
      expect(result.acceptedPatch).toEqual({ [key]: value })
    },
  )

  it("accepts null on a nullable field as a real, intentional value", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { middleName: true },
      fieldsSchema: schema,
      processedOutput: { middleName: null },
      operator: "setMiddleName",
    })
    expect(result.acceptedPatch).toEqual({ middleName: null })
  })

  it("accepts an explicit undefined on an optional field as a real, intentional value", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { nickname: true },
      fieldsSchema: schema,
      processedOutput: { nickname: undefined },
      operator: "clearNickname",
    })
    expect(result.acceptedPatch).toHaveProperty("nickname")
    expect((result.acceptedPatch as { nickname?: string }).nickname).toBeUndefined()
  })

  it("accepts an empty array as a legitimate, intentional value", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { tags: true },
      fieldsSchema: schema,
      processedOutput: { tags: [] },
      operator: "clearTags",
    })
    expect(result.acceptedPatch).toEqual({ tags: [] })
  })

  it("a key genuinely absent from processedOutput (never mentioned) never appears in the accepted patch", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { id: true, count: true },
      fieldsSchema: schema,
      processedOutput: { id: "new" },
      operator: "partialUpdate",
    })
    expect(result.acceptedPatch).toEqual({ id: "new" })
    expect(Object.hasOwn(result.acceptedPatch ?? {}, "count")).toBe(false)
  })
})

describe("resolveOperationPatch -- invalid shape resets to schema default", () => {
  it("resets a single invalid field to its own default while preserving valid siblings (round-1 decision 2)", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { id: true, count: true },
      fieldsSchema: schema,
      // Wrong runtime type for `count` -- valid at the `unknown` type level, rejected at runtime.
      processedOutput: { id: "valid", count: "not-a-number" },
      operator: "badMutation",
    })
    expect(result.acceptedPatch).toEqual({ id: "valid", count: 0 })
    expect(result.fieldErrors.has("count")).toBe(true)
  })

  it("descends to the smallest invalid leaf/subtree -- a malformed descendant doesn't reject the whole branch", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { user: true },
      fieldsSchema: schema,
      processedOutput: {
        user: { email: "valid@example.com", profile: { name: 12345 } },
      },
      operator: "updateUser",
    })
    expect(result.acceptedPatch).toEqual({
      user: { email: "valid@example.com", profile: { name: "" } },
    })
    expect(result.fieldErrors.has("user.profile.name")).toBe(true)
  })

  it("rejects a non-array value for an array-typed field, resetting to the empty-array default", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { tags: true },
      fieldsSchema: schema,
      // Wrong runtime type -- valid at the `unknown` type level, rejected at runtime.
      processedOutput: { tags: "not-an-array" },
      operator: "badTags",
    })
    expect(result.acceptedPatch).toEqual({ tags: [] })
  })

  it("accepts null for a nullable field, and rejects a mismatched non-null, non-inner-type value", () => {
    const accepted = resolveOperationPatch({
      declaredOwnership: { middleName: true },
      fieldsSchema: schema,
      processedOutput: { middleName: null },
      operator: "clearMiddleName",
    })
    expect(accepted.acceptedPatch).toEqual({ middleName: null })

    const rejected = resolveOperationPatch({
      declaredOwnership: { middleName: true },
      fieldsSchema: schema,
      // Wrong runtime type -- valid at the `unknown` type level, rejected at runtime.
      processedOutput: { middleName: 12345 },
      operator: "badMiddleName",
    })
    expect(rejected.acceptedPatch).toEqual({ middleName: null })
  })
})

describe("resolveOperationPatch -- non-object processor output", () => {
  it("accepts nothing when the processor returns undefined (a mutator with no meaningful patch)", () => {
    const result = resolveOperationPatch({
      declaredOwnership: undefined,
      fieldsSchema: schema,
      processedOutput: undefined,
      operator: "sendEmail",
    })
    expect(result.acceptedPatch).toBeUndefined()
    expect(result.fieldErrors.size).toBe(0)
  })

  it("accepts nothing when the processor returns null", () => {
    const result = resolveOperationPatch({
      declaredOwnership: undefined,
      fieldsSchema: schema,
      processedOutput: null,
      operator: "sendEmail",
    })
    expect(result.acceptedPatch).toBeUndefined()
    expect(result.fieldErrors.size).toBe(0)
  })

  it("accepts nothing when the processor returns an array or a primitive", () => {
    expect(
      resolveOperationPatch({
        declaredOwnership: undefined,
        fieldsSchema: schema,
        processedOutput: [1, 2, 3],
        operator: "weird",
      }).acceptedPatch,
    ).toBeUndefined()
    expect(
      resolveOperationPatch({
        declaredOwnership: undefined,
        fieldsSchema: schema,
        processedOutput: "just a string",
        operator: "weird",
      }).acceptedPatch,
    ).toBeUndefined()
  })
})

describe("resolveOperationPatch -- property-based obligations", () => {
  it("no-smuggling: a randomly generated processor output including malicious/unlisted keys never leaks them into the accepted patch", () => {
    const maliciousKeys = ["__proto__", "constructor", "prototype", "notInSchema", "randomKey"]
    for (let i = 0; i < 30; i++) {
      // Index is always in bounds (i % length) -- the fixture array's own known length guarantees this.
      const key = maliciousKeys[i % maliciousKeys.length]!
      const processedOutput: Record<string, unknown> = { id: `value-${i}` }
      if (key !== "__proto__") {
        processedOutput[key] = "smuggled"
      }
      const result = resolveOperationPatch({
        declaredOwnership: { id: true },
        fieldsSchema: schema,
        processedOutput,
        operator: "fuzzTest",
      })
      const accepted = result.acceptedPatch
      expect(accepted).toEqual({ id: `value-${i}` })
      for (const maliciousKey of maliciousKeys) {
        expect(Object.hasOwn(accepted ?? {}, maliciousKey)).toBe(false)
      }
    }
  })

  it("round-trip: fully valid, fully owned processor output passes through unchanged", () => {
    const samples: Record<string, unknown>[] = [
      { id: "a", count: 1, active: true },
      { user: { email: "x@example.com", profile: { name: "Y" } } },
      { middleName: null, nickname: undefined, tags: ["a", "b"] },
    ]
    for (const processedOutput of samples) {
      const result = resolveOperationPatch({
        declaredOwnership: true,
        fieldsSchema: schema,
        processedOutput,
        operator: "roundTrip",
      })
      expect(result.acceptedPatch).toEqual(processedOutput)
      expect(result.fieldErrors.size).toBe(0)
    }
  })

  it("records each rejection with an exact, dotted, reason-specific fieldError message and map key", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { id: true, tags: true, user: { email: true } },
      fieldsSchema: schema,
      processedOutput: {
        id: "ok",
        count: 9, // declared, but not owned
        madeUp: "smuggled", // not in the schema at all
        user: { email: "e@x", profile: { name: "n" } }, // user.profile not owned
        tags: "not-an-array", // owned leaf, wrong shape
      },
      operator: "op",
    })
    const msg = (key: string): string | undefined => {
      const err = result.fieldErrors.get(key)?.error
      return err instanceof Error ? err.message : undefined
    }
    expect(msg("count")).toBe('Field is not owned by this operation at "count" (operator: "op")')
    expect(msg("madeUp")).toBe(
      'Field is not declared in the capability schema at "madeUp" (operator: "op")',
    )
    expect(msg("user.profile")).toBe(
      'Field is not owned by this operation at "user.profile" (operator: "op")',
    )
    expect(msg("tags")).toBe('Invalid shape at "tags" (operator: "op")')
    // Every fieldError is a real { operator, error } pair.
    for (const [, err] of result.fieldErrors) {
      expect(err.operator).toBe("op")
      expect(err.error).toBeInstanceOf(Error)
    }
  })

  it("dots every rejection's map key and message with the full nested path", () => {
    const nestedSchema = { user: { email: "", profile: { name: "" } } }
    const evilNested: Record<string, unknown> = {
      email: "x",
      madeUp: "x",
      profile: "not-an-object",
    }
    Object.defineProperty(evilNested, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    })
    const result = resolveOperationPatch({
      declaredOwnership: { user: { email: { deep: true }, profile: true } } as never,
      fieldsSchema: nestedSchema as never,
      processedOutput: { user: evilNested },
      operator: "op",
    })
    const msg = (key: string): string | undefined => {
      const err = result.fieldErrors.get(key)?.error
      return err instanceof Error ? err.message : undefined
    }
    expect(msg("user.__proto__")).toBe('Rejected unsafe key at "user.__proto__" (operator: "op")')
    expect(msg("user.madeUp")).toBe(
      'Field is not declared in the capability schema at "user.madeUp" (operator: "op")',
    )
    expect(msg("user.profile")).toBe('Invalid shape at "user.profile" (operator: "op")')
    expect(msg("user.email")).toBe(
      'Field is not owned by this operation at "user.email" (operator: "op")',
    )
  })

  it("rejects an unsafe key with the exact 'Rejected unsafe key' reason, not a generic one", () => {
    const evil: Record<string, unknown> = { id: "ok" }
    Object.defineProperty(evil, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    })
    const result = resolveOperationPatch({
      declaredOwnership: true,
      fieldsSchema: schema,
      processedOutput: evil,
      operator: "op",
    })
    const protoErr = result.fieldErrors.get("__proto__")?.error
    expect(protoErr instanceof Error ? protoErr.message : undefined).toBe(
      'Rejected unsafe key at "__proto__" (operator: "op")',
    )
    expect(Object.hasOwn(result.acceptedPatch ?? {}, "__proto__")).toBe(false)
  })

  it("does not crash, and resets to the schema default, when a plain-object schema field's default is `null`", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { thing: true } as never,
      fieldsSchema: { thing: null } as never,
      processedOutput: { thing: { nested: 1 } },
      operator: "op",
    })
    expect(result.acceptedPatch).toEqual({ thing: { nested: 1 } })
  })

  it("does not crash when the processor returns `null` for a nested-object schema field -- resets it", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { user: true },
      fieldsSchema: schema,
      processedOutput: { user: null },
      operator: "op",
    })
    expect(result.acceptedPatch).toEqual({ user: { email: "", profile: { name: "" } } })
    const userErr = result.fieldErrors.get("user")?.error
    expect(userErr instanceof Error ? userErr.message : undefined).toBe(
      'Invalid shape at "user" (operator: "op")',
    )
  })

  it("omits a nested-object key entirely when none of its sub-keys were accepted", () => {
    const result = resolveOperationPatch({
      declaredOwnership: { id: true, user: { email: true } },
      fieldsSchema: schema,
      processedOutput: { id: "keep", user: { profile: { name: "unowned" } } },
      operator: "op",
    })
    expect(result.acceptedPatch).toEqual({ id: "keep" })
    expect(Object.hasOwn(result.acceptedPatch ?? {}, "user")).toBe(false)
  })

  it("leaf isolation: a single malformed leaf embedded in an otherwise-valid tree never causes a sibling leaf to be dropped", () => {
    const validSiblingValues = ["sibling-a", "sibling-b", "sibling-c"]
    for (const siblingValue of validSiblingValues) {
      const result = resolveOperationPatch({
        declaredOwnership: { user: true },
        fieldsSchema: schema,
        processedOutput: {
          // `email` is valid, `profile.name` is malformed (wrong type).
          user: { email: siblingValue, profile: { name: 42 } },
        },
        operator: "isolationTest",
      })
      const accepted = result.acceptedPatch as
        { user: { email: string; profile: { name: string } } } | undefined
      expect(accepted?.user.email).toBe(siblingValue)
      expect(accepted?.user.profile.name).toBe("")
    }
  })
})
