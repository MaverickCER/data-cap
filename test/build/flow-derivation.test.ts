import { describe, expect, it } from "vitest"
import { identifierCounts, isPureDerivation } from "../../src/build/flow-derivation.js"
import { ts } from "../../src/build/typescript.js"

/** The initializer of `const x = <code>`. */
function initializer(code: string) {
  const file = ts.createSourceFile("x.ts", `const x = ${code}`, ts.ScriptTarget.Latest, true)
  const [statement] = file.statements
  if (statement === undefined || !ts.isVariableStatement(statement)) throw new Error("no statement")
  const [declaration] = statement.declarationList.declarations
  if (declaration?.initializer === undefined) throw new Error("no initializer")
  return declaration.initializer
}

const pure = (code: string): boolean => isPureDerivation(initializer(code))

describe("isPureDerivation", () => {
  it.each([
    "a",
    "a.b.c",
    "a[b]",
    "a[0]",
    '"text"',
    "1",
    "`t`",
    "this",
    "true",
    "false",
    "null",
    "(a)",
    "a as any",
    "a!",
    "a satisfies object",
    "<any>a",
    "typeof a",
    "{ a, b: c, ...d, [e]: f }",
    "{ m() { return 1 }, get g() { return 1 } }",
    "[a, ...b, c.d]",
    "`x ${a} y ${b.c}`",
    "a + b * c",
    "a && b || c ?? d",
    "a ? b : c",
    "!a",
    "-a",
    "a.trim()",
    "a.b.toUpperCase().slice(1)",
    "a.map((x) => x.id)",
    "a.filter((x) => x.ok).map((x) => ({ id: x.id }))",
    "a.join(', ')",
    "u.getSnapshot().fields.user",
    "a.concat(b, [c])",
  ])("%s is a derivation", (code) => {
    expect(pure(code)).toBe(true)
  })

  it.each([
    "f(a)",
    "a.send(b)",
    "a.b.save()",
    "a.map(f)",
    "a.map((x) => { send(x) })",
    "a.map((x) => send(x))",
    "a.getSnapshot(1)",
    "f().getSnapshot()",
    "await a",
    "new A(b)",
    "(a = b)",
    "a += b",
    "a++",
    "++a",
    "--a",
    "delete a.b",
    "tag`x`",
    "[a, f(b)]",
    "{ a: f(b) }",
    "{ ...f(b) }",
    "{ [f()]: a }",
    "`x ${f(a)}`",
    "a ? f(b) : c",
    "a + f(b)",
    "a[f(b)]",
    "a.b(f(c))",
    "function () { return 1 }",
    "() => 1",
    "[, a]",
    "a?.b.c()",
    "import('x')",
  ])("%s is not", (code) => {
    expect(pure(code)).toBe(false)
  })

  it("accepts a computed key that is itself pure", () => {
    expect(pure("{ [a.b]: c }")).toBe(true)
  })
})

describe("isPureDerivation, case by case", () => {
  const deriving = [
    "toString",
    "toLowerCase",
    "toUpperCase",
    "trim",
    "trimStart",
    "trimEnd",
    "substring",
    "substr",
    "split",
    "join",
    "replace",
    "replaceAll",
    "padStart",
    "padEnd",
    "repeat",
    "normalize",
    "charAt",
    "toFixed",
    "toISOString",
    "map",
    "filter",
    "flat",
    "flatMap",
    "slice",
    "concat",
    "toSorted",
    "toReversed",
    "at",
  ]
  const callbackTakers = ["map", "filter", "flatMap", "toSorted"]

  it.each(deriving)("%s makes a new value and nothing else", (name) => {
    expect(pure(`a.${name}()`)).toBe(true)
  })

  it("does not take a method it does not know for a derivation", () => {
    expect(pure("a.sort()")).toBe(false)
    expect(pure("a.push(b)")).toBe(false)
  })

  it.each(callbackTakers)("%s needs a callback it can see is pure", (name) => {
    expect(pure(`a.${name}(f)`)).toBe(false)
    expect(pure(`a.${name}((x) => x.id)`)).toBe(true)
    expect(pure(`a.${name}((x) => { return x })`)).toBe(false)
    expect(pure(`a.${name}((x) => f(x))`)).toBe(false)
  })

  it.each(deriving.filter((name) => !callbackTakers.includes(name)))(
    "%s takes a plain argument, not a callback",
    (name) => {
      expect(pure(`a.${name}(b)`)).toBe(true)
      expect(pure(`a.${name}(f())`)).toBe(false)
      expect(pure(`a.${name}((x) => x)`)).toBe(false)
    },
  )

  it.each([
    "=",
    "+=",
    "-=",
    "*=",
    "**=",
    "/=",
    "%=",
    "<<=",
    ">>=",
    ">>>=",
    "&=",
    "|=",
    "^=",
    "&&=",
    "||=",
    "??=",
  ])("an assignment with %s changes something", (operator) => {
    expect(pure(`(a ${operator} b)`)).toBe(false)
  })

  it.each(["a , b", "a in b", "a === b", "a !== b", "a instanceof b", "a ?? b", "a ** b"])(
    "%s is not an assignment",
    (code) => {
      expect(pure(`(${code})`)).toBe(true)
    },
  )

  it("is not pure when any member of an object, array or template is not", () => {
    expect(pure("{ a, b: f() }")).toBe(false)
    expect(pure("{ a: b, ...f() }")).toBe(false)
    expect(pure("[a, f()]")).toBe(false)
    expect(pure("`x ${a} y ${f()}`")).toBe(false)
    expect(pure("{ [f()]: a }")).toBe(false)
  })

  it("is not pure when either side of an index or an operator is not", () => {
    expect(pure("a[f()]")).toBe(false)
    expect(pure("f()[a]")).toBe(false)
    expect(pure("a + f()")).toBe(false)
    expect(pure("f() + a")).toBe(false)
    expect(pure("a ? b : f()")).toBe(false)
    expect(pure("a ? f() : b")).toBe(false)
    expect(pure("f() ? a : b")).toBe(false)
  })

  it("is not pure for ++ and -- in either position", () => {
    expect(pure("(a++)")).toBe(false)
    expect(pure("(--a)")).toBe(false)
    expect(pure("(++a)")).toBe(false)
    expect(pure("(a--)")).toBe(false)
  })

  it("accepts getSnapshot only with no arguments and a pure receiver", () => {
    expect(pure("u.getSnapshot()")).toBe(true)
    expect(pure("u.getSnapshot(a)")).toBe(false)
    expect(pure("f().getSnapshot()")).toBe(false)
  })
})

describe("identifierCounts", () => {
  it("counts every identifier under the root, declarations, uses and member names alike", () => {
    const file = ts.createSourceFile(
      "x.ts",
      "function f(u) { const d = u.email; const e = d.length; return { e } }",
      ts.ScriptTarget.Latest,
      true,
    )
    expect([...identifierCounts(file)].sort()).toEqual(
      [
        ["d", 2],
        ["e", 2],
        ["email", 1],
        ["f", 1],
        ["length", 1],
        ["u", 2],
      ].sort(),
    )
  })

  it("counts nothing for a tree without names", () => {
    const file = ts.createSourceFile("x.ts", "1 + 2", ts.ScriptTarget.Latest, true)
    expect(identifierCounts(file).size).toBe(0)
  })
})
