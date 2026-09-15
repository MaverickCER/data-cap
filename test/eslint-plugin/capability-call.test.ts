import * as espree from "espree"
import { describe, expect, it } from "vitest"
import type { TSESTree } from "@typescript-eslint/types"
import {
  CAPABILITY_CALL_NAMES,
  getStaticKeyName,
  isCapabilityCall,
  isInlineFunction,
  isOperationBodyKey,
  isOperationSectionKey,
} from "../../src/eslint-plugin/capability-call.js"

/** Parses `code` and returns the first statement's expression node. */
function expr(code: string): TSESTree.Node {
  const program = espree.parse(code, { ecmaVersion: 2022, sourceType: "module", loc: true })
  const statement = (program as { body: unknown[] }).body[0] as { expression: TSESTree.Node }
  return statement.expression
}

/** Parses `({ ...code })` and returns its first property. */
function firstProperty(objectCode: string): TSESTree.Property {
  const object = expr(`(${objectCode})`) as TSESTree.ObjectExpression
  return object.properties[0] as TSESTree.Property
}

/** Depth-first: the first `CallExpression` node anywhere in `code`. */
function firstCall(code: string): TSESTree.CallExpression {
  const program = espree.parse(code, { ecmaVersion: 2022, sourceType: "module", loc: true })
  let found: TSESTree.CallExpression | undefined
  const visit = (node: unknown): void => {
    if (found || node === null || typeof node !== "object") return
    const record = node as Record<string, unknown>
    if (record["type"] === "CallExpression") {
      found = node as TSESTree.CallExpression
      return
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(visit)
      else visit(value)
    }
  }
  visit(program)
  if (found === undefined) throw new Error(`no CallExpression in: ${code}`)
  return found
}

describe("isCapabilityCall", () => {
  it("recognizes a bare call to a listed name", () => {
    expect(isCapabilityCall(expr("createData({})"), CAPABILITY_CALL_NAMES)).toBe(true)
    expect(isCapabilityCall(expr("buildData({})"), CAPABILITY_CALL_NAMES)).toBe(true)
  })

  it("recognizes a member-access call to a listed name", () => {
    expect(isCapabilityCall(expr("dataCap.createData({})"), CAPABILITY_CALL_NAMES)).toBe(true)
  })

  it("rejects a bare call to an unlisted name", () => {
    expect(isCapabilityCall(expr("makeSomething({})"), CAPABILITY_CALL_NAMES)).toBe(false)
  })

  it("rejects a member-access call whose property name is unlisted", () => {
    expect(isCapabilityCall(expr("dataCap.makeSomething({})"), CAPABILITY_CALL_NAMES)).toBe(false)
  })

  it("rejects a node that is not a CallExpression at all", () => {
    expect(isCapabilityCall(expr("42"), CAPABILITY_CALL_NAMES)).toBe(false)
    expect(isCapabilityCall(expr("createData"), CAPABILITY_CALL_NAMES)).toBe(false)
    expect(isCapabilityCall(expr("new createData({})"), CAPABILITY_CALL_NAMES)).toBe(false)
  })

  it("rejects a call whose callee is itself a call, without throwing", () => {
    expect(isCapabilityCall(expr("makeFactory()()"), CAPABILITY_CALL_NAMES)).toBe(false)
  })

  it("rejects a computed member-access call (property is a literal, not an identifier)", () => {
    expect(isCapabilityCall(expr(`dataCap["createData"]()`), CAPABILITY_CALL_NAMES)).toBe(false)
  })

  it("rejects a private-method call named like a capability (property is a PrivateIdentifier)", () => {
    const call = firstCall(`class C { #createData() {} m() { this.#createData({}); } }`)
    expect(isCapabilityCall(call, CAPABILITY_CALL_NAMES)).toBe(false)
  })
})

describe("getStaticKeyName", () => {
  it("returns an identifier key's name", () => {
    expect(getStaticKeyName(firstProperty("{ execute: 1 }").key)).toBe("execute")
  })

  it("returns a string-literal key's value", () => {
    expect(getStaticKeyName(firstProperty(`{ "execute": 1 }`).key)).toBe("execute")
  })

  it("returns undefined for a numeric-literal key", () => {
    expect(getStaticKeyName(firstProperty("{ 5: 1 }").key)).toBeUndefined()
  })

  it("returns undefined for a non-string literal key (e.g. a regexp)", () => {
    expect(getStaticKeyName(firstProperty("{ [/x/]: 1 }").key)).toBeUndefined()
  })
})

describe("isOperationSectionKey", () => {
  it.each(["getters", "mutators", "subscriptions"])("is true for %s", (key) => {
    expect(isOperationSectionKey(key)).toBe(true)
  })
  it.each(["execute", "fields", "getter", "getterss", undefined])("is false for %s", (key) => {
    expect(isOperationSectionKey(key)).toBe(false)
  })
})

describe("isOperationBodyKey", () => {
  it.each(["execute", "subscribe"])("is true for %s", (key) => {
    expect(isOperationBodyKey(key)).toBe(true)
  })
  it.each(["getters", "processor", "optimistic", "executes", undefined])(
    "is false for %s",
    (key) => {
      expect(isOperationBodyKey(key)).toBe(false)
    },
  )
})

describe("isInlineFunction", () => {
  it("is true for an arrow function and a function expression", () => {
    expect(isInlineFunction(expr("() => {}"))).toBe(true)
    expect(isInlineFunction(expr("(function () {})"))).toBe(true)
  })

  it("is false for an identifier, a call, and a member access", () => {
    expect(isInlineFunction(expr("getUser"))).toBe(false)
    expect(isInlineFunction(expr("getUser()"))).toBe(false)
    expect(isInlineFunction(expr("obj.getUser"))).toBe(false)
  })
})
