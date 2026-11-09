import { describe, expect, it } from "vitest"
import { scanHelpers } from "../../src/build/flow-scan.js"
import { ts } from "../../src/build/typescript.js"
import type TS from "typescript"
import {
  atomVal,
  ELEMENT_KEY,
  EMPTY_VAL,
  GENERATOR_HANDLE,
  handleVal,
  mergeVals,
  OPAQUE_ALLOC,
  PROMISE_HANDLE,
  REJECT_HANDLE,
  setVal,
} from "../../src/build/flow-values.js"
import type { Atom, Val } from "../../src/build/flow-values.js"

const h = scanHelpers()

function source(code: string): TS.SourceFile {
  return ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true)
}

/** The initializer of `const x = <code>`. */
function expr(code: string): TS.Expression {
  const [statement] = source(`const x = ${code}`).statements
  if (statement === undefined || !ts.isVariableStatement(statement)) throw new Error("no statement")
  const initializer = statement.declarationList.declarations[0]?.initializer
  if (initializer === undefined) throw new Error("no initializer")
  return initializer
}

/** The first statement of `code`. */
function statement(code: string): TS.Statement {
  const [first] = source(code).statements
  if (first === undefined) throw new Error("no statement")
  return first
}

/** The name of the first member of `class C { <member> }`. */
function memberNameOf(member: string): TS.PropertyName {
  const declaration = statement(`class C { ${member} }`)
  if (!ts.isClassDeclaration(declaration)) throw new Error("no class")
  const name = declaration.members[0]?.name
  if (name === undefined) throw new Error("no name")
  return name
}

const atom = (path: string): Atom => ({
  origin: "field:src/u.ts#userData.user",
  path: [path],
  approx: false,
  entry: { kind: "read" },
  entryPath: [],
})
const one: Val = atomVal(atom("one"))
const two: Val = atomVal(atom("two"))

describe("memberName", () => {
  it.each([
    ["plain() {}", "plain"],
    ['"quoted"() {}', "quoted"],
    ["7() {}", "7"],
    ["#secret = 1", "#secret"],
    ["[Symbol.iterator]() {}", "[Symbol.iterator]"],
    ["[Symbol.asyncIterator]() {}", "[Symbol.asyncIterator]"],
  ])("%s is %j", (member, expected) => {
    expect(h.memberName(memberNameOf(member))).toBe(expected)
  })

  it.each([
    "[other.iterator]() {}",
    "[Symbol]() {}",
    "[Symbol[0]]() {}",
    "[a.b.c]() {}",
    '["x" + y]() {}',
    "[f()]() {}",
  ])("%s has no name the scan can know", (member) => {
    expect(h.memberName(memberNameOf(member))).toBeUndefined()
  })
})

describe("holdsFields and holdsPromise", () => {
  const nested = (inner: Val): Val => ({ ...EMPTY_VAL, props: new Map([["below", inner]]) })

  it("holdsFields: a capability, a fields object, or either of them below", () => {
    expect(h.holdsFields({ ...EMPTY_VAL, fieldsOf: "f#x" })).toBe(true)
    expect(h.holdsFields({ ...EMPTY_VAL, capability: "f#x" })).toBe(true)
    expect(h.holdsFields(nested({ ...EMPTY_VAL, capability: "f#x" }))).toBe(true)
    expect(h.holdsFields(nested(nested({ ...EMPTY_VAL, fieldsOf: "f#x" })))).toBe(true)
    expect(h.holdsFields(EMPTY_VAL)).toBe(false)
    expect(h.holdsFields(one)).toBe(false)
    expect(h.holdsFields(nested(nested(EMPTY_VAL)))).toBe(false)
  })

  it("holdsFields: any one thing below is enough, not every one", () => {
    const mixed: Val = {
      ...EMPTY_VAL,
      props: new Map<string, Val>([
        ["a", EMPTY_VAL],
        ["b", { ...EMPTY_VAL, capability: "f#x" }],
      ]),
    }
    expect(h.holdsFields(mixed)).toBe(true)
  })

  it("holdsPromise: a promise handle here or below, of the promise kind only", () => {
    expect(h.holdsPromise(handleVal(PROMISE_HANDLE, "1"))).toBe(true)
    expect(h.holdsPromise(nested(handleVal(PROMISE_HANDLE, "1")))).toBe(true)
    expect(h.holdsPromise(nested(nested(handleVal(PROMISE_HANDLE, "1"))))).toBe(true)
    expect(h.holdsPromise(handleVal(REJECT_HANDLE, "1"))).toBe(false)
    expect(h.holdsPromise(handleVal(GENERATOR_HANDLE, "1"))).toBe(false)
    expect(h.holdsPromise(EMPTY_VAL)).toBe(false)
    expect(h.holdsPromise(nested(nested(EMPTY_VAL)))).toBe(false)
  })

  it("holdsPromise: any one thing below is enough, not every one", () => {
    const mixed: Val = {
      ...EMPTY_VAL,
      props: new Map<string, Val>([
        ["a", EMPTY_VAL],
        ["b", handleVal(PROMISE_HANDLE, "1")],
      ]),
    }
    expect(h.holdsPromise(mixed)).toBe(true)
  })
})

describe("rejectedKey, settled and memberKey", () => {
  it("rejectedKey is a name no property can have", () => {
    expect(h.rejectedKey()).toBe("\u0000rejected")
  })

  it("settled takes the rejection off and leaves everything else, without changing the original", () => {
    const rejected: Val = {
      ...EMPTY_VAL,
      props: new Map<string, Val>([
        [h.rejectedKey(), one],
        ["kept", two],
      ]),
    }
    const result = h.settled(rejected)
    expect([...result.props.keys()]).toEqual(["kept"])
    expect([...rejected.props.keys()]).toEqual([h.rejectedKey(), "kept"])
  })

  it.each([
    ["method", true, "x", "method:static:x"],
    ["method", false, "x", "method:instance:x"],
    ["get", true, "y", "get:static:y"],
    ["set", false, "z", "set:instance:z"],
  ] as const)("memberKey(%s, static=%s, %s) is %s", (kind, isStatic, name, expected) => {
    expect(h.memberKey(kind, isStatic, name)).toBe(expected)
  })
})

describe("linkKey", () => {
  const literal = (e: TS.Expression): string | undefined =>
    ts.isStringLiteralLike(e) ? e.text : undefined
  const link = (code: string) =>
    expr(code) as TS.PropertyAccessExpression | TS.ElementAccessExpression

  it("a property is its name and not dynamic", () => {
    expect(h.linkKey(link("a.b"), literal)).toEqual({ key: "b", dynamic: false })
  })

  it("an element with a literal key is that key and not dynamic", () => {
    expect(h.linkKey(link('a["k"]'), literal)).toEqual({ key: "k", dynamic: false })
    expect(h.linkKey(link('a[("k")]'), literal)).toEqual({ key: "k", dynamic: false })
  })

  it("an element with a number is the element key and not dynamic; any other is dynamic", () => {
    expect(h.linkKey(link("a[0]"), literal)).toEqual({ key: ELEMENT_KEY, dynamic: false })
    expect(h.linkKey(link("a[k]"), literal)).toEqual({ key: ELEMENT_KEY, dynamic: true })
    expect(h.linkKey(link("a[f()]"), literal)).toEqual({ key: ELEMENT_KEY, dynamic: true })
    expect(h.linkKey(link('a["k"]'), () => undefined)).toEqual({ key: ELEMENT_KEY, dynamic: true })
  })
})

describe("memberChain", () => {
  const literal = (e: TS.Expression): string | undefined =>
    ts.isStringLiteralLike(e) ? e.text : undefined

  it("walks a chain to its root, root first", () => {
    expect(h.memberChain(expr("a.b.c"))).toEqual({ root: "a", keys: ["b", "c"], dynamic: false })
    expect(h.memberChain(expr("a"))).toEqual({ root: "a", keys: [], dynamic: false })
    expect(h.memberChain(expr("(a.b as any).c"))).toEqual({
      root: "a",
      keys: ["b", "c"],
      dynamic: false,
    })
  })

  it("roots a chain on this", () => {
    expect(h.memberChain(expr("this.x.y"))).toEqual({
      root: "this",
      keys: ["x", "y"],
      dynamic: false,
    })
  })

  it("has no root when the chain does not start at a name", () => {
    expect(h.memberChain(expr("f().x"))).toEqual({ root: undefined, keys: ["x"], dynamic: false })
    expect(h.memberChain(expr('"s".length'))).toEqual({
      root: undefined,
      keys: ["length"],
      dynamic: false,
    })
  })

  it("is dynamic when any link has a key it cannot know, and reads literal keys when it can", () => {
    expect(h.memberChain(expr("a[k].b"))).toEqual({
      root: "a",
      keys: [ELEMENT_KEY, "b"],
      dynamic: true,
    })
    expect(h.memberChain(expr("a.b[k]"))).toEqual({
      root: "a",
      keys: ["b", ELEMENT_KEY],
      dynamic: true,
    })
    expect(h.memberChain(expr('a["k"].b'), literal)).toEqual({
      root: "a",
      keys: ["k", "b"],
      dynamic: false,
    })
  })
})

describe("isReferenceExpression", () => {
  it.each(["a", "a.b", "a[0]", "this", "(a)", "a as any", "a!"])("%s is one", (code) => {
    expect(h.isReferenceExpression(expr(code))).toBe(true)
  })

  it.each(["f()", "1", '"s"', "a + b", "{}", "[]", "new A()", "a ? b : c"])("%s is not", (code) => {
    expect(h.isReferenceExpression(expr(code))).toBe(false)
  })

  it("nothing is not", () => {
    expect(h.isReferenceExpression(undefined)).toBe(false)
  })
})

describe("memberCallee", () => {
  const literal = (e: TS.Expression): string | undefined =>
    ts.isStringLiteralLike(e) ? e.text : undefined

  it("a property callee is itself", () => {
    const callee = expr("a.b")
    expect(h.memberCallee(callee, literal)).toBe(callee)
  })

  it("an element callee with a literal key is the receiver and the key as a name", () => {
    const callee = expr('a["b"]') as TS.ElementAccessExpression
    const result = h.memberCallee(callee, literal)
    expect(result?.expression).toBe(callee.expression)
    expect(result?.name).toEqual({ text: "b" })
  })

  it("an element callee whose key is not known, and anything else, is nothing", () => {
    expect(h.memberCallee(expr("a[k]"), literal)).toBeUndefined()
    expect(h.memberCallee(expr('a["b"]'), () => undefined)).toBeUndefined()
    expect(h.memberCallee(expr("f"), literal)).toBeUndefined()
    expect(h.memberCallee(expr("f()"), literal)).toBeUndefined()
  })
})

describe("operator kinds", () => {
  const kindOf = (operator: string): TS.SyntaxKind => {
    const binary = expr(`a ${operator} b`) as TS.BinaryExpression
    return binary.operatorToken.kind
  }

  it.each(["&&", "||", "??"])("%s is a logical operator", (operator) => {
    expect(h.isLogicalOperator(kindOf(operator))).toBe(true)
  })
  it.each(["&", "|", "+", "==", "<", "="])("%s is not a logical operator", (operator) => {
    expect(h.isLogicalOperator(kindOf(operator))).toBe(false)
  })

  it.each(["+=", "||=", "??=", "&&="])(
    "%s is a compound assignment of the kind that picks or alters",
    (operator) => {
      expect(h.isCompoundAssignment(kindOf(operator))).toBe(true)
    },
  )
  it.each(["=", "-=", "*=", "|=", "&=", "+", "||"])("%s is not", (operator) => {
    expect(h.isCompoundAssignment(kindOf(operator))).toBe(false)
  })

  it.each(["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"])(
    "%s computes a new value out of both operands",
    (operator) => {
      expect(h.isArithmeticOperator(kindOf(operator))).toBe(true)
    },
  )
  it.each(["&&", "||", "??", "==", "===", "<", "in", "instanceof", "=", "+="])(
    "%s does not",
    (operator) => {
      expect(h.isArithmeticOperator(kindOf(operator))).toBe(false)
    },
  )
})

describe("isTransparentWrapper, unwrap and keyOf", () => {
  it.each(["(a)", "a as T", "a!", "a satisfies T", "<T>a"])("%s only wraps", (code) => {
    expect(h.isTransparentWrapper(expr(code))).toBe(true)
  })
  it.each(["a", "a.b", "f()", "1", "-a", "[a]"])("%s does not", (code) => {
    expect(h.isTransparentWrapper(expr(code))).toBe(false)
  })

  it("unwrap goes through every wrapper, however deep, and stops at the first thing that is not one", () => {
    const inner = expr("((a as any)! satisfies T)") as TS.ParenthesizedExpression
    const target = h.unwrap(inner)
    expect(ts.isIdentifier(target) && target.text).toBe("a")
    const call = h.unwrap(expr("(f(x))"))
    expect(ts.isCallExpression(call)).toBe(true)
  })

  it("keyOf reads a name, a string and a number, and nothing computed", () => {
    expect(h.keyOf(memberNameOf("plain() {}"))).toBe("plain")
    expect(h.keyOf(memberNameOf('"s"() {}'))).toBe("s")
    expect(h.keyOf(memberNameOf("5() {}"))).toBe("5")
    expect(h.keyOf(memberNameOf("[k]() {}"))).toBeUndefined()
  })
})

describe("setAlgebra and arrayOf", () => {
  it.each(["isSubsetOf", "isSupersetOf", "isDisjointFrom"])(
    "%s only asks, and holds nothing",
    (name) => {
      expect(h.setAlgebra(name, one, two)).toBe(EMPTY_VAL)
    },
  )
  it.each(["union", "symmetricDifference"])("%s holds items of both", (name) => {
    expect(h.setAlgebra(name, one, two)).toEqual(setVal(mergeVals(one, two)))
  })
  it.each(["intersection", "difference"])("%s holds items of the first", (name) => {
    expect(h.setAlgebra(name, one, two)).toEqual(setVal(one))
  })
  it.each(["add", "has", "", "Union"])("%j is no set method", (name) => {
    expect(h.setAlgebra(name, one, two)).toBeUndefined()
  })

  it("arrayOf is a value whose every element is the one given", () => {
    const array = h.arrayOf(one)
    expect(array.atoms).toEqual([])
    expect([...array.props.entries()]).toEqual([[ELEMENT_KEY, one]])
  })
})

describe("literalPairs", () => {
  const pairs = (code: string) => h.literalPairs(expr(code))?.map((pair) => pair.getText())

  it("reads the pairs of a literal list of pairs", () => {
    expect(pairs('[["a", 1], ["b", 2]]')).toEqual(['["a", 1]', '["b", 2]'])
    expect(pairs('([["a", 1]])')).toEqual(['["a", 1]'])
    expect(pairs('[["a"], ["b", 2]]')).toEqual(['["a"]', '["b", 2]'])
    expect(pairs("[[], []]")).toEqual(["[]", "[]"])
  })

  it.each([
    "[]",
    "x",
    "5",
    '[["a", 1], 5]',
    '[5, ["a", 1]]',
    '[["a", 1], x]',
    '[["a", 1, 2]]',
    '[["a", 1, 2], ["b", 1]]',
    '[["b", 1], ["a", 1, 2]]',
    "[[...a, 1]]",
    '[[...a], ["b", 1]]',
    '[["b", 1], [...a]]',
  ])("%s is not a list of pairs it can read", (code) => {
    expect(pairs(code)).toBeUndefined()
  })
})

describe("collectionBase", () => {
  const baseText = (code: string) => h.collectionBase(expr(code)).getText()

  it("goes back through a chain of set and add calls to where it starts", () => {
    expect(baseText("m.set(1, 2).set(3, 4)")).toBe("m")
    expect(baseText("s.add(1).add(2).add(3)")).toBe("s")
    expect(baseText("(m.set(1, 2))")).toBe("m")
    expect(baseText("m.set(1, 2).add(3)")).toBe("m")
  })

  it("stops at any other call, member or expression", () => {
    expect(baseText("m")).toBe("m")
    expect(baseText("m.get(1)")).toBe("m.get(1)")
    expect(baseText("m.get(1).set(2, 3)")).toBe("m.get(1)")
    expect(baseText("m.delete(1).set(2, 3)")).toBe("m.delete(1)")
    expect(baseText("f()")).toBe("f()")
    expect(baseText("f(1).set(2, 3)")).toBe("f(1)")
    expect(baseText('m["set"](1, 2)')).toBe('m["set"](1, 2)')
  })
})

describe("prototypeMethod", () => {
  const none = () => false
  it.each([
    ["[].slice", "slice"],
    ["Array.prototype.map", "map"],
    ["Object.prototype.hasOwnProperty", "hasOwnProperty"],
    ["String.prototype.trim", "trim"],
    ["Number.prototype.toFixed", "toFixed"],
    ["Boolean.prototype.valueOf", "valueOf"],
    ["(Array.prototype).map", "map"],
  ])("%s is the method %s", (code, expected) => {
    expect(h.prototypeMethod(expr(code), none)).toBe(expected)
  })

  it.each([
    "[1].slice",
    "[...a].slice",
    "Map.prototype.get",
    "Set.prototype.add",
    "Array.proto.slice",
    "a.prototype.x",
    "Array.prototype",
    "Array.slice",
    "slice",
    "f().slice",
    "x[0].slice",
  ])("%s is not one", (code) => {
    expect(h.prototypeMethod(expr(code), none)).toBeUndefined()
  })

  it("is not one when the builtin's name is shadowed", () => {
    expect(
      h.prototypeMethod(expr("Array.prototype.map"), (name) => name === "Array"),
    ).toBeUndefined()
    expect(h.prototypeMethod(expr("Array.prototype.map"), (name) => name === "Object")).toBe("map")
  })
})

describe("loadedSpecifier", () => {
  const specifier = (code: string) => {
    const node = statement(code)
    if (ts.isVariableStatement(node)) {
      const init = node.declarationList.declarations[0]?.initializer
      return init === undefined ? undefined : h.loadedSpecifier(init)
    }
    return h.loadedSpecifier(node)
  }

  it("reads the literal of an import(), a require() and an import = require()", () => {
    expect(specifier('const v = import("./a.js")')).toBe("./a.js")
    expect(specifier('const v = require("pkg")')).toBe("pkg")
    expect(specifier('const v = require(("pkg"))')).toBe("pkg")
    expect(specifier("const v = require(`pkg`)")).toBe("pkg")
    expect(specifier('import a = require("pkg")')).toBe("pkg")
  })

  it("is nothing for a load whose specifier is not a literal, or for anything that is not a load", () => {
    expect(specifier("const v = import(name)")).toBeUndefined()
    expect(specifier("const v = require(name)")).toBeUndefined()
    expect(specifier("const v = require()")).toBeUndefined()
    expect(specifier('const v = load("pkg")')).toBeUndefined()
    expect(specifier('const v = a.require("pkg")')).toBeUndefined()
    expect(specifier("import a = B.C")).toBeUndefined()
    expect(specifier("const v = 5")).toBeUndefined()
  })
})

describe("decoratorsOf", () => {
  it("lists the decorators of a class in the order written, and none for one without", () => {
    const decorated = statement("@a @b() class C {}")
    expect(h.decoratorsOf(decorated).map((decorator) => decorator.expression.getText())).toEqual([
      "a",
      "b()",
    ])
    expect(h.decoratorsOf(statement("class D {}"))).toEqual([])
  })

  it("lists none for a node that cannot carry any", () => {
    expect(h.decoratorsOf(expr("a"))).toEqual([])
  })
})

describe("async and generator functions", () => {
  const fn = (code: string): TS.SignatureDeclaration => {
    const node = statement(code)
    if (ts.isFunctionDeclaration(node)) return node
    if (ts.isVariableStatement(node)) {
      const init = node.declarationList.declarations[0]?.initializer
      if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
        return init
    }
    if (ts.isClassDeclaration(node)) {
      const member = node.members[0]
      if (member !== undefined && ts.isMethodDeclaration(member)) return member
    }
    throw new Error("no function")
  }

  it("isAsyncFunction", () => {
    expect(h.isAsyncFunction(undefined)).toBe(false)
    expect(h.isAsyncFunction(fn("async function f() {}") as never)).toBe(true)
    expect(h.isAsyncFunction(fn("const f = async () => 1") as never)).toBe(true)
    expect(h.isAsyncFunction(fn("class C { async m() {} }") as never)).toBe(true)
    expect(h.isAsyncFunction(fn("function f() {}") as never)).toBe(false)
    expect(h.isAsyncFunction(fn("const f = () => 1") as never)).toBe(false)
  })

  it("isGeneratorFunction", () => {
    expect(h.isGeneratorFunction(undefined)).toBe(false)
    expect(h.isGeneratorFunction(fn("function* g() {}") as never)).toBe(true)
    expect(h.isGeneratorFunction(fn("class C { *m() {} }") as never)).toBe(true)
    expect(h.isGeneratorFunction(fn("async function* g() {}") as never)).toBe(true)
    expect(h.isGeneratorFunction(fn("function f() {}") as never)).toBe(false)
    expect(h.isGeneratorFunction(fn("const f = () => 1") as never)).toBe(false)
    expect(h.isGeneratorFunction(fn("async function f() {}") as never)).toBe(false)
  })
})

describe("withBound", () => {
  const fnWith = (bound?: { args: Val[]; thisVal?: Val }) => ({ bound }) as never

  it("passes a function that was not bound what it was given", () => {
    const own = {}
    expect(h.withBound(fnWith(), [one], own)).toEqual({ args: [one], options: own })
  })

  it("puts what was bound ahead of what the call gives, and keeps the caller's options without a bound receiver", () => {
    const own = { constructs: true as const }
    const result = h.withBound(fnWith({ args: [one] }), [two], own)
    expect(result.args).toEqual([one, two])
    expect(result.options).toBe(own)
  })

  it("takes the receiver that was bound over the caller's", () => {
    const bound = { ...EMPTY_VAL, instance: "C" }
    const result = h.withBound(fnWith({ args: [], thisVal: bound }), [], { thisVal: EMPTY_VAL })
    expect(result.options).toEqual({ thisVal: bound })
  })
})

describe("what a package exports", () => {
  it("externalVal names the export and marks the object as one the scan did not see made", () => {
    expect(h.externalVal("lodash", "pick")).toEqual({
      ...EMPTY_VAL,
      external: "lodash\u0000pick",
      alloc: [OPAQUE_ALLOC],
    })
  })

  it("externalMember is a member of the export, or of the module itself for the whole module", () => {
    expect(h.externalMember("lodash\u0000*", "pick")).toEqual(["lodash", "pick"])
    expect(h.externalMember("zod\u0000z", "object")).toEqual(["zod", "z.object"])
    expect(h.externalMember("zod\u0000z.string", "min")).toEqual(["zod", "z.string.min"])
    expect(h.externalMember("zod", "x")).toEqual(["zod", ".x"])
    expect(h.externalMember("", "x")).toEqual(["", ".x"])
  })

  it("externalKey joins the module and the path", () => {
    expect(h.externalKey(["lodash", "pick"])).toBe("lodash\u0000pick")
    expect(h.externalKey(["", ""])).toBe("\u0000")
  })
})
