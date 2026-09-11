import ts from "typescript"
import { describe, expect, it } from "vitest"
import { FIELD_MARKER } from "../../src/core/fields.js"
import {
  evaluateAllowedConstructor,
  evaluateArgs,
  evaluateLiteral,
  evaluateMarkerCall,
  getStaticPropertyName,
} from "../../src/build/literal-eval.js"

/** Parses a single expression snippet (as it would appear in `const x = <expr>`) into its AST node. */
function parseExpression(code: string): ts.Expression {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    `const __x = ${code};`,
    ts.ScriptTarget.Latest,
    true,
  )
  const statement = sourceFile.statements[0]
  if (statement === undefined || !ts.isVariableStatement(statement)) {
    throw new Error("expected a variable statement")
  }
  const declaration = statement.declarationList.declarations[0]
  if (declaration?.initializer === undefined) {
    throw new Error("expected an initializer")
  }
  return declaration.initializer
}

describe("evaluateLiteral -- base literal grammar", () => {
  it("evaluates string/number/boolean/null literals", () => {
    expect(evaluateLiteral(parseExpression('"hello"'))).toEqual({ ok: true, value: "hello" })
    expect(evaluateLiteral(parseExpression("42"))).toEqual({ ok: true, value: 42 })
    expect(evaluateLiteral(parseExpression("true"))).toEqual({ ok: true, value: true })
    expect(evaluateLiteral(parseExpression("false"))).toEqual({ ok: true, value: false })
    expect(evaluateLiteral(parseExpression("null"))).toEqual({ ok: true, value: null })
  })

  it("evaluates a negative number literal", () => {
    expect(evaluateLiteral(parseExpression("-5"))).toEqual({ ok: true, value: -5 })
  })

  it("unwraps a parenthesized expression", () => {
    expect(evaluateLiteral(parseExpression('("hello")'))).toEqual({ ok: true, value: "hello" })
  })

  it("unwraps an `as` type assertion", () => {
    expect(evaluateLiteral(parseExpression("[] as string[]"))).toEqual({ ok: true, value: [] })
    expect(evaluateLiteral(parseExpression("{ a: 1 } as Record<string, number>"))).toEqual({
      ok: true,
      value: { a: 1 },
    })
  })

  it("propagates non-literal-ness through an `as` type assertion", () => {
    expect(evaluateLiteral(parseExpression("someIdentifier as string[]"))).toEqual({ ok: false })
  })

  it("evaluates an array literal recursively", () => {
    expect(evaluateLiteral(parseExpression('[1, "a", true]'))).toEqual({
      ok: true,
      value: [1, "a", true],
    })
  })

  it("evaluates a nested object literal recursively", () => {
    expect(evaluateLiteral(parseExpression('{ a: 1, b: { c: "x" } }'))).toEqual({
      ok: true,
      value: { a: 1, b: { c: "x" } },
    })
  })

  it("evaluates an object literal with quoted and numeric keys", () => {
    expect(evaluateLiteral(parseExpression('{ "a-b": 1, 2: "two" }'))).toEqual({
      ok: true,
      value: { "a-b": 1, "2": "two" },
    })
  })

  it("rejects a spread element in an array literal", () => {
    expect(evaluateLiteral(parseExpression("[...rest]"))).toEqual({ ok: false })
  })

  it("rejects a computed property key", () => {
    expect(evaluateLiteral(parseExpression("{ [dynamicKey]: 1 }"))).toEqual({ ok: false })
  })

  it("rejects a shorthand property (references an identifier, not a literal)", () => {
    expect(evaluateLiteral(parseExpression("{ shorthand }"))).toEqual({ ok: false })
  })

  it("rejects a bare identifier", () => {
    expect(evaluateLiteral(parseExpression("someIdentifier"))).toEqual({ ok: false })
  })

  it("rejects a template literal with interpolation", () => {
    expect(evaluateLiteral(parseExpression("`hello ${name}`"))).toEqual({ ok: false })
  })

  it("rejects an arbitrary function call", () => {
    expect(evaluateLiteral(parseExpression("someFunction()"))).toEqual({ ok: false })
  })

  it("propagates non-literal-ness from a nested array element", () => {
    expect(evaluateLiteral(parseExpression("[1, someIdentifier, 3]"))).toEqual({ ok: false })
  })

  it("propagates non-literal-ness from a nested object property", () => {
    expect(evaluateLiteral(parseExpression("{ a: 1, b: someIdentifier }"))).toEqual({ ok: false })
  })
})

describe("evaluateLiteral -- allowed constructor calls", () => {
  it("evaluates new Date() with no arguments", () => {
    const result = evaluateLiteral(parseExpression("new Date()"))
    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toBeInstanceOf(Date)
  })

  it("evaluates new Date(isoString)", () => {
    const result = evaluateLiteral(parseExpression('new Date("2024-01-01T00:00:00.000Z")'))
    expect(result.ok).toBe(true)
    expect(result.ok && (result.value as Date).toISOString()).toBe("2024-01-01T00:00:00.000Z")
  })

  it("evaluates new URL(href)", () => {
    const result = evaluateLiteral(parseExpression('new URL("https://example.com/a")'))
    expect(result.ok).toBe(true)
    expect(result.ok && (result.value as URL).href).toBe("https://example.com/a")
  })

  it("rejects new URL() with an invalid href (constructor throws)", () => {
    expect(evaluateLiteral(parseExpression('new URL("not a url")'))).toEqual({ ok: false })
  })

  it("evaluates new RegExp(source, flags)", () => {
    const result = evaluateLiteral(parseExpression('new RegExp("abc", "gu")'))
    expect(result.ok).toBe(true)
    expect(result.ok && (result.value as RegExp).source).toBe("abc")
    expect(result.ok && (result.value as RegExp).flags).toBe("gu")
  })

  it("evaluates new Map() and new Map(entries)", () => {
    const empty = evaluateLiteral(parseExpression("new Map()"))
    expect(empty.ok && (empty.value as Map<unknown, unknown>).size).toBe(0)

    const withEntries = evaluateLiteral(parseExpression('new Map([["a", 1]])'))
    expect(withEntries.ok && (withEntries.value as Map<string, number>).get("a")).toBe(1)
  })

  it("evaluates new Set() and new Set(values)", () => {
    const withValues = evaluateLiteral(parseExpression("new Set([1, 2, 2])"))
    expect(withValues.ok && (withValues.value as Set<number>).size).toBe(2)
  })

  it("rejects a constructor not on the allowlist", () => {
    expect(evaluateLiteral(parseExpression("new SomeArbitraryClass()"))).toEqual({ ok: false })
  })

  it("rejects an allowed constructor whose arguments are not themselves literal-evaluable", () => {
    expect(evaluateLiteral(parseExpression("new Date(someIdentifier)"))).toEqual({ ok: false })
  })
})

describe("evaluateLiteral -- fields.nullable/fields.optional marker recognition", () => {
  it('recognizes X.nullable(literal) and wraps it using the real FIELD_MARKER, tagged "nullable"', () => {
    const result = evaluateLiteral(parseExpression('fields.nullable("")'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const value = result.value as Record<symbol, unknown>
      expect(value[FIELD_MARKER]).toBe("nullable")
      expect((value as unknown as { inner: string }).inner).toBe("")
    }
  })

  it('recognizes X.optional(literal) and wraps it using the real FIELD_MARKER, tagged "optional"', () => {
    const result = evaluateLiteral(parseExpression("fields.optional(0)"))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const value = result.value as Record<symbol, unknown>
      expect(value[FIELD_MARKER]).toBe("optional")
    }
  })

  it("recognizes the marker call by property name alone, regardless of the receiver expression", () => {
    const result = evaluateLiteral(parseExpression('dataCap.fields.nullable("")'))
    expect(result.ok).toBe(true)
  })

  it("does NOT recognize a property-access call whose name is not exactly nullable/optional", () => {
    expect(evaluateLiteral(parseExpression('fields.notAMarker("")'))).toEqual({ ok: false })
    expect(evaluateLiteral(parseExpression('fields.nullish("")'))).toEqual({ ok: false })
  })

  it("rejects a marker call with the wrong argument count", () => {
    expect(evaluateLiteral(parseExpression("fields.nullable()"))).toEqual({ ok: false })
    expect(evaluateLiteral(parseExpression('fields.nullable("a", "b")'))).toEqual({ ok: false })
  })

  it("propagates non-literal-ness from the marker's own inner argument", () => {
    expect(evaluateLiteral(parseExpression("fields.nullable(someIdentifier)"))).toEqual({
      ok: false,
    })
  })

  it("evaluates a nested object inside a marker call", () => {
    const result = evaluateLiteral(parseExpression('fields.nullable({ name: "" })'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const value = result.value as { inner: unknown }
      expect(value.inner).toEqual({ name: "" })
    }
  })
})

describe("getStaticPropertyName", () => {
  function parseFirstPropertyName(objectLiteral: string): ts.PropertyName {
    const expr = parseExpression(objectLiteral)
    if (!ts.isObjectLiteralExpression(expr)) throw new Error("expected an object literal")
    const prop = expr.properties[0]
    if (prop === undefined) throw new Error("expected at least one property")
    return prop.name!
  }

  it("reads an identifier property name", () => {
    expect(getStaticPropertyName(parseFirstPropertyName("{ foo: 1 }"))).toBe("foo")
  })

  it("reads a string literal property name", () => {
    expect(getStaticPropertyName(parseFirstPropertyName('{ "foo-bar": 1 }'))).toBe("foo-bar")
  })

  it("reads a numeric literal property name", () => {
    expect(getStaticPropertyName(parseFirstPropertyName("{ 5: 1 }"))).toBe("5")
  })

  it("returns undefined for a computed property name", () => {
    expect(getStaticPropertyName(parseFirstPropertyName("{ [dynamicKey]: 1 }"))).toBeUndefined()
  })

  it("returns undefined for a private-identifier member name (#foo)", () => {
    const source = ts.createSourceFile("c.ts", `class C { #foo = 1 }`, ts.ScriptTarget.Latest, true)
    const cls = source.statements[0] as ts.ClassDeclaration
    const member = cls.members[0] as ts.PropertyDeclaration
    expect(ts.isPrivateIdentifier(member.name)).toBe(true)
    expect(getStaticPropertyName(member.name)).toBeUndefined()
  })
})

/** The `.arguments` NodeArray of a `new X(...)` / `x.m(...)` expression. */
function argsOf(callSnippet: string): readonly ts.Expression[] {
  const node = parseExpression(callSnippet)
  if (ts.isNewExpression(node)) return node.arguments ?? []
  if (ts.isCallExpression(node)) return node.arguments
  throw new Error("expected a new/call expression")
}

describe("evaluateArgs (direct)", () => {
  it("returns each argument's literal value, in order", () => {
    expect(evaluateArgs(argsOf('f("a", 1, true)'))).toEqual(["a", 1, true])
  })

  it("returns undefined the moment any argument is not literal-evaluable", () => {
    expect(evaluateArgs(argsOf('f("a", someIdentifier, 1)'))).toBeUndefined()
    expect(evaluateArgs(argsOf('f("a", nonLiteralSecond)'))).toBeUndefined()
  })

  it("returns an empty array for no arguments", () => {
    expect(evaluateArgs(argsOf("f()"))).toEqual([])
  })
})

describe("evaluateAllowedConstructor (direct)", () => {
  it("new Date(): a Date; new Date(number|string): parsed", () => {
    expect(
      (evaluateAllowedConstructor("Date", argsOf("new Date()")) as { value: Date }).value,
    ).toBeInstanceOf(Date)
    const fromMs = evaluateAllowedConstructor("Date", argsOf("new Date(1704067200000)"))
    expect(fromMs.ok && (fromMs.value as Date).toISOString()).toBe("2024-01-01T00:00:00.000Z")
  })

  it("new Date(boolean) is not literal-evaluable", () => {
    expect(evaluateAllowedConstructor("Date", argsOf("new Date(true)"))).toEqual({ ok: false })
  })

  it("new URL(base, relative): resolves; new URL(number, base): rejected; bad second arg: rejected", () => {
    const resolved = evaluateAllowedConstructor("URL", argsOf('new URL("/p", "https://x.example")'))
    expect(resolved.ok && (resolved.value as URL).href).toBe("https://x.example/p")
    expect(evaluateAllowedConstructor("URL", argsOf('new URL(1, "https://x.example")'))).toEqual({
      ok: false,
    })
    expect(evaluateAllowedConstructor("URL", argsOf('new URL("https://x.example", 5)'))).toEqual({
      ok: false,
    })
  })

  it("new RegExp(number) and new RegExp(src, non-string flags) are rejected, not coerced", () => {
    expect(evaluateAllowedConstructor("RegExp", argsOf("new RegExp(123)"))).toEqual({ ok: false })
    expect(evaluateAllowedConstructor("RegExp", argsOf('new RegExp("a", 5)'))).toEqual({
      ok: false,
    })
    // `[]` would coerce to "" (valid empty flags) -- the non-string guard must
    // still reject it, not let it through.
    expect(evaluateAllowedConstructor("RegExp", argsOf('new RegExp("a", [])'))).toEqual({
      ok: false,
    })
  })

  it("rejects a non-string URL base even when it is a valid URL instance", () => {
    // `new URL("/p", <URL instance>)` is valid at runtime, but this evaluator
    // only accepts a string base -- the non-string guard must reject it.
    expect(
      evaluateAllowedConstructor("URL", argsOf('new URL("/p", new URL("https://base.example/"))')),
    ).toEqual({ ok: false })
  })

  it("new Set(array) and new Map(array) are accepted", () => {
    const set = evaluateAllowedConstructor("Set", argsOf("new Set([1, 2, 2])"))
    expect(set.ok && (set.value as Set<number>).size).toBe(2)
    const map = evaluateAllowedConstructor("Map", argsOf('new Map([["k", 9]])'))
    expect(map.ok && (map.value as Map<string, number>).get("k")).toBe(9)
  })

  it("new Set() and new Map() with no arguments are accepted as empty collections", () => {
    const set = evaluateAllowedConstructor("Set", argsOf("new Set()"))
    expect(set.ok).toBe(true)
    expect(set.ok && (set.value as Set<unknown>).size).toBe(0)
    expect(set.ok && set.value).toBeInstanceOf(Set)
    const map = evaluateAllowedConstructor("Map", argsOf("new Map()"))
    expect(map.ok && (map.value as Map<unknown, unknown>).size).toBe(0)
    expect(map.ok && map.value).toBeInstanceOf(Map)
  })

  it("new RegExp(source): one-arg form is accepted", () => {
    const r = evaluateAllowedConstructor("RegExp", argsOf('new RegExp("abc")'))
    expect(r.ok && (r.value as RegExp).source).toBe("abc")
    expect(r.ok && (r.value as RegExp).flags).toBe("")
  })

  it("new Map(non-array) and new Set(non-array) are rejected", () => {
    expect(evaluateAllowedConstructor("Map", argsOf('new Map("nope")'))).toEqual({ ok: false })
    expect(evaluateAllowedConstructor("Set", argsOf('new Set("nope")'))).toEqual({ ok: false })
  })

  it("swallows a constructor's own throw (invalid URL) and reports not-literal-evaluable", () => {
    expect(evaluateAllowedConstructor("URL", argsOf('new URL("not a url")'))).toEqual({ ok: false })
    expect(evaluateAllowedConstructor("RegExp", argsOf('new RegExp("(")'))).toEqual({ ok: false })
  })
})

describe("evaluateLiteral -- constructor recognition boundary", () => {
  it("a `new` of a name not on the allowlist is never literal-evaluated, even with literal args", () => {
    expect(evaluateLiteral(parseExpression('new WeakMap("literal")'))).toEqual({ ok: false })
    expect(evaluateLiteral(parseExpression("new Foo(1, 2)"))).toEqual({ ok: false })
  })

  it("evaluates `new Date` written with no parentheses (arguments node is absent)", () => {
    const result = evaluateLiteral(parseExpression("new Date"))
    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toBeInstanceOf(Date)
  })
})

describe("evaluateMarkerCall (direct)", () => {
  it("wraps the single literal argument, tagged by the property name", () => {
    const nullable = evaluateMarkerCall("nullable", argsOf('f("x")'))
    expect(nullable.ok && (nullable.value as Record<symbol, unknown>)[FIELD_MARKER]).toBe(
      "nullable",
    )
    const optional = evaluateMarkerCall("optional", argsOf("f(0)"))
    expect(optional.ok && (optional.value as Record<symbol, unknown>)[FIELD_MARKER]).toBe(
      "optional",
    )
    // Any name other than exactly "nullable" is tagged "optional".
    const other = evaluateMarkerCall("somethingElse", argsOf("f(0)"))
    expect(other.ok && (other.value as Record<symbol, unknown>)[FIELD_MARKER]).toBe("optional")
  })

  it("rejects zero, two, or non-literal arguments", () => {
    expect(evaluateMarkerCall("nullable", argsOf("f()"))).toEqual({ ok: false })
    expect(evaluateMarkerCall("nullable", argsOf('f("a", "b")'))).toEqual({ ok: false })
    expect(evaluateMarkerCall("nullable", argsOf("f(someIdentifier)"))).toEqual({ ok: false })
  })
})

describe("evaluateLiteral -- prefix unary edge cases", () => {
  it.each(["+5", "~5", "!true", "-someIdentifier", `-"hello"`, "-[]"])(
    "does not literal-evaluate %s",
    (code) => {
      expect(evaluateLiteral(parseExpression(code))).toEqual({ ok: false })
    },
  )

  it("literal-evaluates -0 and a negative float", () => {
    expect(evaluateLiteral(parseExpression("-1.5"))).toEqual({ ok: true, value: -1.5 })
  })
})
