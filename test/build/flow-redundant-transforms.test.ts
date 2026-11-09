import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { USER } from "./mut-flow-scan-harness.js"
import { buildFlowModel } from "../../src/flow/flow-model.js"
import type { FlowEdgeTag } from "../../src/flow/flow-model.js"
import { analyzeRedundantTransforms } from "../../src/flow/redundant-transform.js"
import { handler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * The redundant transformations the flow pass finds (ADR 0075), one table row each. A row is a small program and what the
 * analysis must say about it: `[kind, how, paths, line:column]`, with the hop functions for a forwarding chain. The
 * negative rows matter as much as the positive ones: a copy that changes something, a wrapper that also logs, and a
 * derivation that is used are not redundant.
 */
describe("redundant transformations found by the flow pass", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = USER
  const FN = (name: string): string => `function:app/p.ts#${name}`

  async function run(body: string, extra = "") {
    const model = buildFlowModel((await h.scan(handler(body, extra))).input)
    return {
      model,
      rows: analyzeRedundantTransforms(model).map((item) => [
        item.kind,
        item.via ?? item.hops.length,
        item.paths.map((path) => path.join(".") || "(whole)"),
        `${item.source?.line}:${item.source?.column}`,
      ]),
    }
  }

  describe("round-trip", () => {
    const rows: readonly (readonly [string, string, string, unknown[]])[] = [
      [
        "JSON.parse(JSON.stringify(x))",
        `  res.json(JSON.parse(JSON.stringify(${u})))`,
        "",
        [["round-trip", "serialized", ["(whole)"], "3:12"]],
      ],
      [
        "the same of one path of the field",
        `  const c = JSON.parse(JSON.stringify(${u}.email))\n  res.json(c)`,
        "",
        [["round-trip", "serialized", ["email"], "3:13"]],
      ],
      [
        "Object.fromEntries(Object.entries(x))",
        `  res.json(Object.fromEntries(Object.entries(${u})))`,
        "",
        [["round-trip", "serialized", ["(whole)"], "3:12"]],
      ],
      [
        "structuredClone of a structuredClone",
        `  res.json(structuredClone(structuredClone(${u})))`,
        "",
        [["round-trip", "copied", ["(whole)"], "3:12"]],
      ],
      [
        "structuredClone of a JSON round trip, through a name",
        `  const a = JSON.parse(JSON.stringify(${u}))\n  res.json(structuredClone(a))`,
        "",
        [
          ["round-trip", "serialized", ["(whole)"], "3:13"],
          ["round-trip", "copied", ["(whole)"], "4:12"],
        ],
      ],
      [
        "a spread of a spread",
        `  const a = { ...${u} }\n  res.json({ ...a })`,
        "",
        [["round-trip", "copied", ["(whole)"], "4:12"]],
      ],
      [
        "Array.from of a copy of an array",
        `  const a = [...[${u}.email]]\n  res.json(Array.from(a))`,
        "",
        [["round-trip", "copied", ["email"], "4:12"]],
      ],
      [
        "an array spread of a copy of an array",
        `  const a = [...[${u}.email]]\n  res.json([...a])`,
        "",
        [["round-trip", "copied", ["email"], "4:12"]],
      ],
      // Not redundant.
      ["a single structuredClone", `  res.json(structuredClone(${u}))`, "", []],
      ["a single spread", `  res.json({ ...${u} })`, "", []],
      ["a single Array.from", `  res.json(Array.from([${u}.email]))`, "", []],
      [
        "a round trip with a replacer can drop fields",
        `  res.json(JSON.parse(JSON.stringify(${u}, null, 2)))`,
        "",
        [],
      ],
      [
        "an entries round trip that maps the entries",
        `  res.json(Object.fromEntries(Object.entries(${u}).map(([k, v]) => [k, v])))`,
        "",
        [],
      ],
      [
        "a copy that adds a field",
        `  const a = { ...${u} }\n  res.json({ ...a, extra: 1 })`,
        "",
        [],
      ],
      [
        "a copy that renames a field",
        `  const a = { ...${u} }\n  res.json({ mail: a.email })`,
        "",
        [],
      ],
      [
        "a copy that drops fields",
        `  const a = { ...${u} }\n  const { passwordHash, ...rest } = a\n  res.json({ ...rest }, passwordHash)`,
        "",
        [],
      ],
      [
        "a copy of data that is not a copy (a parameter, a call result)",
        `  res.json({ ...pick(${u}) })`,
        `function pick(x: any) { return x }\n`,
        [],
      ],
      [
        "a round trip of data that carries nothing tracked",
        `  res.json(JSON.parse(JSON.stringify({ a: key })))`,
        "",
        [],
      ],
    ]
    it.each(rows)("%s", async (_, body, extra, expected) => {
      expect((await run(body, extra)).rows).toEqual(expected)
    })
  })

  describe("dead-derivation", () => {
    const rows: readonly (readonly [string, string, string, unknown[]])[] = [
      [
        "a transformed value nobody reads",
        `  const d = ${u}.email.toUpperCase()`,
        "",
        [["dead-derivation", 0, ["email"], "3:9"]],
      ],
      [
        "a mapped array nobody reads",
        `  const d = [${u}.email].map((x) => x + "!")`,
        "",
        [["dead-derivation", 0, ["email"], "3:9"]],
      ],
      [
        "a copy of the whole record nobody reads",
        `  const d = { ...${u} }`,
        "",
        [["dead-derivation", 0, ["(whole)"], "3:9"]],
      ],
      ["a derivation that is used", `  const d = ${u}.email.toUpperCase()\n  res.json(d)`, "", []],
      ["a derivation that is returned", `  const d = { e: ${u}.email }\n  return d`, "", []],
      [
        "a derivation that is only read by a closure",
        `  const d = ${u}.email.trim()\n  const f = () => d\n  res.json(f())`,
        "",
        [],
      ],
      ["a name that says it is unused", `  const _d = ${u}.email.toUpperCase()`, "", []],
      [
        "a call that sends the data (the result is not the point)",
        `  const d = send(${u}.email)`,
        `function send(x: any) { return x }\n`,
        [],
      ],
      [
        "a destructuring where another name is used",
        `  const { email, name } = ${u}\n  res.json(name)`,
        "",
        [],
      ],
      [
        "a name shadowed in a block counts as used",
        `  const d = ${u}.email.trim()\n  { const d = 1; res.json(d) }`,
        "",
        [],
      ],
    ]
    it.each(rows)("%s", async (_, body, extra, expected) => {
      expect((await run(body, extra)).rows).toEqual(expected)
    })
  })

  describe("forwarding-hop", () => {
    const wrappers = (middle: string): string =>
      `function fa(u: any) { return fb(u) }\nfunction fb(u: any) { ${middle} }\nfunction fc(u: any) { return fd(u) }\nfunction fd(u: any) { return u }\n`
    const rows: readonly (readonly [string, string, string, unknown[]])[] = [
      [
        "three wrappers in a row",
        `  fa(${u}.email)`,
        wrappers("return fc(u)"),
        [["forwarding-hop", 4, ["email"], "2:30"]],
      ],
      [
        "three wrappers that return nothing",
        `  fa(${u}.email)`,
        `function fa(u: any) { fb(u) }\nfunction fb(u: any) { fc(u) }\nfunction fc(u: any) { fd(u) }\nfunction fd(u: any) { console.log(u) }\n`,
        [["forwarding-hop", 4, ["email"], "2:23"]],
      ],
      [
        "three async wrappers",
        `  await fa(${u}.email)`,
        `async function fa(u: any) { return await fb(u) }\nasync function fb(u: any) { return await fc(u) }\nasync function fc(u: any) { return await fd(u) }\nasync function fd(u: any) { return u }\n`,
        [["forwarding-hop", 4, ["email"], "2:42"]],
      ],
      [
        "wrappers that carry other arguments along",
        `  fa(${u}.email, 1)`,
        `function fa(u: any, n: number) { return fb(u, n) }\nfunction fb(u: any, n: number) { return fc(u, n) }\nfunction fc(u: any, n: number) { return fd(u, n) }\nfunction fd(u: any, n: number) { return u }\n`,
        [["forwarding-hop", 4, ["email"], "2:41"]],
      ],
      [
        "the whole record handed down",
        `  fa(${u})`,
        `function fa(u: any) { return fb(u) }\nfunction fb(u: any) { return fc(u) }\nfunction fc(u: any) { return fd(u) }\nfunction fd(u: any) { console.log(u) }\n`,
        [["forwarding-hop", 4, ["(whole)"], "2:30"]],
      ],
      [
        "a wrapper that logs something else",
        `  fa(${u}.email)`,
        wrappers("console.log('x'); return fc(u)"),
        [["forwarding-hop", 4, ["email"], "2:30"]],
      ],
      // Not redundant.
      [
        "a wrapper that also logs the path",
        `  fa(${u}.email)`,
        wrappers("console.log(u); return fc(u)"),
        [],
      ],
      [
        "a wrapper that transforms it",
        `  fa(${u}.email)`,
        wrappers("return fc(u.toUpperCase())"),
        [],
      ],
      [
        "a wrapper that hands it to two callees",
        `  fa(${u}.email)`,
        wrappers("fd(u); return fc(u)"),
        [],
      ],
      [
        "a chain of two",
        `  fa(${u}.email)`,
        `function fa(u: any) { return fb(u) }\nfunction fb(u: any) { return fd(u) }\nfunction fd(u: any) { return u }\n`,
        [],
      ],
    ]
    it.each(rows)("%s", async (_, body, extra, expected) => {
      expect((await run(body, extra)).rows).toEqual(expected)
    })

    it("lists the hop functions and then the one that does something with the data", async () => {
      const { model } = await run(`  fa(${u}.email)`, wrappers("return fc(u)"))
      const [found] = analyzeRedundantTransforms(model)
      expect(found?.hops).toEqual([FN("fa"), FN("fb"), FN("fc"), FN("fd")])
      expect(found?.field).toBe("user")
      expect(found?.capability).toEqual({ file: "features/user/user.ts", exportName: "userData" })
    })
  })

  describe("what the scan records", () => {
    const tags = async (body: string): Promise<readonly FlowEdgeTag[]> =>
      (await run(body)).model.edgeTags ?? []

    it("tags the edge that carries the copied data, at the place of the copy", async () => {
      const [tag] = await tags(`  res.json(JSON.parse(JSON.stringify(${u})))`)
      expect(tag?.via).toBe("serialize-roundtrip")
      expect(tag?.source).toEqual({ file: "app/p.ts", line: 3, column: 12 })
      expect(tag?.edge.startsWith("reads:field:features/user/user.ts#userData.user->")).toBe(true)
      expect(tag?.fresh).toBeUndefined()
    })

    it("says a copy is fresh only when what was copied was itself a copy", async () => {
      const found = await tags(`  const a = { ...${u} }\n  res.json({ ...a })`)
      expect(found.map((tag) => [tag.via, tag.fresh, tag.source.line])).toEqual([
        ["copy", undefined, 3],
        ["copy", true, 4],
      ])
    })

    it("marks a derivation nothing reads as unused", async () => {
      const found = await tags(`  const d = ${u}.email.toUpperCase()`)
      expect(found.map((tag) => [tag.via, tag.unused])).toEqual([["derive", true]])
    })

    it("records nothing for a program that copies and derives nothing", async () => {
      expect(await tags(`  res.json(${u}.email)`)).toEqual([])
      expect("edgeTags" in (await run(`  res.json(${u}.email)`)).model).toBe(false)
    })

    it("a copy made apart from the original does not share what is stored into it", async () => {
      const result = await run(
        `  const a: any = { list: [] }\n  const b = JSON.parse(JSON.stringify(a))\n  b.list.push(${u}.email)\n  res.json(a.list)`,
      )
      expect(result.model.edges.filter((edge) => edge.kind === "side-effect")).toEqual([])
    })
  })
})
