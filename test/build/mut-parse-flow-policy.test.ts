import { describe, expect, it, vi } from "vitest"
import type * as ParseModule from "../../src/build/parse.js"
import type { ParseWarning } from "../../src/build/parse.js"

interface PolicyResult {
  rules: unknown
  messages: string[]
}

/**
 * Loads a fresh copy of the parser inside the test, so the module-level key sets are evaluated while this
 * test runs (and a mutant in them is exercised by it, not only by the module's static load).
 */
async function load() {
  vi.resetModules()
  const { extractCapabilityDocs, parseCapabilityFile } = await import("../../src/build/parse.js")
  const policyOf = (expr: string): PolicyResult =>
    policyIn(expr, parseCapabilityFile, extractCapabilityDocs)
  return { policyOf, rule: (body: string) => policyOf(`[{ ${body} }]`) }
}

type Parse = typeof ParseModule

function policyIn(
  expr: string,
  parseCapabilityFile: Parse["parseCapabilityFile"],
  extractCapabilityDocs: Parse["extractCapabilityDocs"],
): PolicyResult {
  const parsed = parseCapabilityFile(
    "/project/user.ts",
    `documentData({ fields: {} }, { flowPolicy: ${expr} });`,
  )
  const warnings: ParseWarning[] = []
  const docs = extractCapabilityDocs(
    parsed.documentDataCalls[0]?.docsNode,
    "userCapability",
    "/project/user.ts",
    warnings,
  )
  for (const warning of warnings) expect(warning.file).toBe("/project/user.ts")
  return { rules: docs?.flowPolicy, messages: warnings.map((w) => w.message) }
}

const dropped = (reason: string) =>
  `A "flowPolicy" rule for "userCapability" ${reason}; dropping it.`
const OK_APPLIES = `appliesTo: { classification: "pii" }`
const OK = `id: "a", ${OK_APPLIES}, forbidDestinations: ["log"]`

describe("flowPolicy: array-level handling", () => {
  it("ignores a non-array with the exact warning", async () => {
    const { policyOf } = await load()
    expect(policyOf(`"nope"`)).toEqual({
      rules: undefined,
      messages: [`"flowPolicy" for "userCapability" is not an inline array literal; ignoring it.`],
    })
  })

  it("reports a spread element and a non-literal element separately and exactly", async () => {
    const { policyOf } = await load()
    const notLiteral = `A "flowPolicy" entry for "userCapability" is not a statically-resolvable object literal; dropping it.`
    expect(policyOf(`[...others]`)).toEqual({
      rules: [],
      messages: [
        `A "flowPolicy" entry for "userCapability" is a spread element, not statically resolvable; dropping it.`,
      ],
    })
    for (const element of ["someVariable", `"text"`, "[1]", "null", "42", "[]"]) {
      expect(policyOf(`[${element}]`)).toEqual({ rules: [], messages: [notLiteral] })
    }
  })

  it("keeps the valid rules around invalid ones, in order", async () => {
    const { policyOf } = await load()
    const result = policyOf(
      `[{ id: "x", appliesTo: { field: "f" }, forbidDestinations: ["log"] }, 5, { id: "y", appliesTo: { field: "f" }, requireHandling: ["hashed"] }]`,
    )
    expect((result.rules as { id: string }[]).map((r) => r.id)).toEqual(["x", "y"])
    expect(result.messages).toHaveLength(1)
  })

  it("an empty array is an empty policy with no warnings", async () => {
    const { policyOf } = await load()
    expect(policyOf(`[]`)).toEqual({ rules: [], messages: [] })
  })
})

describe("flowPolicy: rule validation messages", () => {
  it("rejects unknown keys, naming the first one", async () => {
    const { rule } = await load()
    expect(rule(`${OK}, bogus: 1`).messages).toEqual([dropped(`has an unrecognised key "bogus"`)])
    expect(rule(`${OK}, bogus: 1`).rules).toEqual([])
  })

  it("accepts each documented top-level key", async () => {
    const { rule } = await load()
    const full = rule(
      `id: "a", description: "d", appliesTo: { field: "f" }, forbidDestinations: ["log"], allowedDestinations: ["database"], allowedHandling: ["hashed"], requireHandling: ["masked"]`,
    )
    expect(full.messages).toEqual([])
    expect(full.rules).toHaveLength(1)
  })

  it("requires a non-empty string id", async () => {
    const { rule } = await load()
    const message = dropped(`has no "id" (a non-empty string)`)
    for (const body of [
      `${OK_APPLIES}, forbidDestinations: ["log"]`,
      `id: "", ${OK_APPLIES}, forbidDestinations: ["log"]`,
      `id: 5, ${OK_APPLIES}, forbidDestinations: ["log"]`,
    ]) {
      expect(rule(body)).toEqual({ rules: [], messages: [message] })
    }
  })

  it("requires a string description when present", async () => {
    const { rule } = await load()
    expect(rule(`${OK}, description: 5`)).toEqual({
      rules: [],
      messages: [dropped(`"description" must be a string`)],
    })
    expect(rule(`${OK}, description: ""`).messages).toEqual([])
  })

  it("requires an appliesTo object", async () => {
    const { rule } = await load()
    const message = dropped(`has no "appliesTo" object`)
    for (const applies of ["", `appliesTo: "x",`, `appliesTo: [],`, `appliesTo: null,`]) {
      expect(rule(`id: "a", ${applies} forbidDestinations: ["log"]`)).toEqual({
        rules: [],
        messages: [message],
      })
    }
  })

  it("validates the appliesTo keys and types", async () => {
    const { rule } = await load()
    const ruleWith = (applies: string) =>
      rule(`id: "a", appliesTo: ${applies}, requireHandling: ["hashed"]`)
    expect(ruleWith(`{ classification: "x", extra: 1 }`)).toEqual({
      rules: [],
      messages: [dropped(`"appliesTo" has an unrecognised key "extra"`)],
    })
    expect(ruleWith(`{ classification: 5 }`).messages).toEqual([
      dropped(`"appliesTo.classification" must be a string`),
    ])
    expect(ruleWith(`{ field: 5 }`).messages).toEqual([
      dropped(`"appliesTo.field" must be a string`),
    ])
    expect(ruleWith(`{ classification: 5, field: "f" }`).messages).toEqual([
      dropped(`"appliesTo.classification" must be a string`),
    ])
    expect(ruleWith(`{ classification: "c", field: 5 }`).messages).toEqual([
      dropped(`"appliesTo.field" must be a string`),
    ])
    expect(ruleWith(`{}`).messages).toEqual([
      dropped(`"appliesTo" needs "classification" or "field"`),
    ])
    expect(ruleWith(`{ path: ["a"] }`).messages).toEqual([
      dropped(`"appliesTo" needs "classification" or "field"`),
    ])
    expect(ruleWith(`{ classification: "" }`).messages).toEqual([])
    expect(ruleWith(`{ field: "" }`).messages).toEqual([])
  })

  it("accepts only a non-empty array of non-empty strings as a path", async () => {
    const { rule } = await load()
    const message = dropped(`"appliesTo.path" must be a non-empty array of non-empty strings`)
    const withPath = (path: string) =>
      rule(`id: "a", appliesTo: { field: "f", path: ${path} }, forbidDestinations: ["log"]`)
    for (const bad of [
      `"x"`,
      `[]`,
      `[["a"]]`,
      `[{ length: 2 }]`,
      `[1]`,
      `["a", 1]`,
      `[1, "a"]`,
      `[""]`,
      `["a", ""]`,
      `["", "a"]`,
      `null`,
      `{}`,
    ]) {
      expect(withPath(bad), bad).toEqual({ rules: [], messages: [message] })
    }
    expect(withPath(`["a", "b"]`).rules).toEqual([
      { id: "a", appliesTo: { field: "f", path: ["a", "b"] }, forbidDestinations: ["log"] },
    ])
  })

  it("rejects non-array and unrecognised list members with exact messages", async () => {
    const { rule } = await load()
    const withList = (name: string, value: string) =>
      rule(`id: "a", ${OK_APPLIES}, forbidDestinations: ["log"], ${name}: ${value}`)
    for (const name of [
      "forbidDestinations",
      "allowedDestinations",
      "allowedHandling",
      "requireHandling",
    ]) {
      const bad = name.endsWith("Handling") ? "rot13" : "moon"
      const other = name.endsWith("Handling") ? "log" : "hashed"
      expect(withList(name, `"x"`).messages).toEqual([dropped(`"${name}" must be an array`)])
      expect(withList(name, `[${JSON.stringify(bad)}]`).messages).toEqual([
        dropped(`"${name}" contains "${bad}", which is not a recognised value`),
      ])
      expect(withList(name, `[${JSON.stringify(bad)}, 7]`).messages).toEqual([
        dropped(`"${name}" contains "${bad}", which is not a recognised value`),
      ])
      expect(withList(name, `[${JSON.stringify(other)}]`).messages).toEqual([
        dropped(`"${name}" contains "${other}", which is not a recognised value`),
      ])
    }
    expect(withList("allowedHandling", `[5]`).messages).toEqual([
      dropped(`"allowedHandling" contains 5, which is not a recognised value`),
    ])
  })

  it("accepts every destination kind and every handling value", async () => {
    const { rule } = await load()
    const kinds = [
      "database",
      "cache",
      "storage",
      "queue",
      "api",
      "external-service",
      "user-input",
      "computed",
      "internal",
      "client-response",
      "log",
    ]
    const handling = ["plaintext", "masked", "redacted", "hashed", "encrypted"]
    const result = rule(
      `id: "a", ${OK_APPLIES}, forbidDestinations: ${JSON.stringify(kinds)}, allowedDestinations: ${JSON.stringify(kinds)}, allowedHandling: ${JSON.stringify(handling)}, requireHandling: ${JSON.stringify(handling)}`,
    )
    expect(result.messages).toEqual([])
    expect(result.rules).toEqual([
      {
        id: "a",
        appliesTo: { classification: "pii" },
        forbidDestinations: kinds,
        allowedDestinations: kinds,
        allowedHandling: handling,
        requireHandling: handling,
      },
    ])
  })

  it("requires the rule to constrain something", async () => {
    const { rule } = await load()
    const message = dropped(
      `does not constrain anything: set "forbidDestinations", "allowedDestinations" or "requireHandling"`,
    )
    for (const body of [
      OK_APPLIES,
      `${OK_APPLIES}, forbidDestinations: []`,
      `${OK_APPLIES}, allowedHandling: ["hashed"]`,
      `${OK_APPLIES}, forbidDestinations: [], allowedHandling: ["hashed"]`,
    ]) {
      expect(rule(`id: "a", ${body}`), body).toEqual({ rules: [], messages: [message] })
    }
    for (const body of [
      `forbidDestinations: ["log"]`,
      `allowedDestinations: []`,
      `requireHandling: []`,
      `forbidDestinations: [], allowedDestinations: ["log"]`,
    ]) {
      expect(rule(`id: "a", ${OK_APPLIES}, ${body}`).messages, body).toEqual([])
    }
  })

  it("builds the rule with only the keys that were given", async () => {
    const { rule } = await load()
    const minimal = rule(`id: "a", appliesTo: { field: "f" }, forbidDestinations: ["log"]`)
    expect(minimal.rules).toStrictEqual([
      { id: "a", appliesTo: { field: "f" }, forbidDestinations: ["log"] },
    ])
    const classOnly = rule(
      `id: "a", appliesTo: { classification: "c" }, forbidDestinations: ["log"]`,
    )
    expect(classOnly.rules).toStrictEqual([
      { id: "a", appliesTo: { classification: "c" }, forbidDestinations: ["log"] },
    ])
    const pathOnly = rule(
      `id: "a", appliesTo: { classification: "c", path: ["p"] }, forbidDestinations: ["log"]`,
    )
    expect(pathOnly.rules).toStrictEqual([
      { id: "a", appliesTo: { classification: "c", path: ["p"] }, forbidDestinations: ["log"] },
    ])
    const described = rule(
      `id: "a", description: "why", appliesTo: { classification: "c", field: "f", path: ["p"] }, requireHandling: ["hashed"]`,
    )
    expect(described.rules).toStrictEqual([
      {
        id: "a",
        description: "why",
        appliesTo: { classification: "c", field: "f", path: ["p"] },
        requireHandling: ["hashed"],
      },
    ])
  })

  it("drops a later rule reusing an id, with the exact message", async () => {
    const { policyOf } = await load()
    const result = policyOf(
      `[{ id: "dup", appliesTo: { field: "a" }, forbidDestinations: ["log"] }, { id: "dup", appliesTo: { field: "b" }, forbidDestinations: ["log"] }, { id: "other", appliesTo: { field: "b" }, forbidDestinations: ["log"] }]`,
    )
    expect(result.messages).toEqual([
      `A "flowPolicy" rule for "userCapability" reuses the id "dup"; dropping the later one.`,
    ])
    expect((result.rules as { id: string }[]).map((r) => r.id)).toEqual(["dup", "other"])
  })

  it("does not count a dropped rule's id as seen", async () => {
    const { policyOf } = await load()
    const result = policyOf(
      `[{ id: "dup", appliesTo: { field: "a" } }, { id: "dup", appliesTo: { field: "b" }, forbidDestinations: ["log"] }]`,
    )
    expect((result.rules as { id: string }[]).map((r) => r.id)).toEqual(["dup"])
    expect(result.messages).toHaveLength(1)
  })
})
