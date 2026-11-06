import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { IMPORT_CAP, USER } from "./mut-flow-scan-harness.js"
import { effects, handler, makeHarness, reasons, unknownData } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * The limits that are decisions (ADR 0074), pinned so none of them is ever an accident.
 *
 * The first group is what the analysis deliberately does NOT follow: it is a data-flow analysis, not an
 * information-flow one, so a value derived by comparing, negating or inspecting tracked data carries none of it, and
 * branching on tracked data moves none. The second is what no analysis of source can follow without running the
 * program (`eval`, `Proxy`, `with`, a computed module specifier): whenever tracked data reaches one it is an explicit
 * unknown. The third is the one way past a package: without a declared summary a call into it is an unknown.
 */
describe("flow-reach: deliberate and irreducible limits", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const scan = async (body: string, extra = "", keyword = "") => {
    const source = handler(body, extra)["app/p.ts"] ?? ""
    return (
      await h.scan({
        "app/p.ts": source.replace("export function h", `export ${keyword}function h`),
      })
    ).input
  }

  describe("implicit flows and derived facts carry no data (a data-flow analysis, not an information-flow one)", () => {
    it.each([
      ["a comparison with ===", `res.json(${USER}.email === "a@b.c")`],
      ["a comparison with !==", `res.json(${USER}.email !== "a@b.c")`],
      ["a comparison with ==", `res.json(${USER}.email == "a")`],
      ["a comparison with <", `res.json(${USER}.email < "m")`],
      ["a comparison with >=", `res.json(${USER}.id >= 10)`],
      ["negation", `res.json(!${USER}.email)`],
      ["double negation", `res.json(!!${USER}.email)`],
      ["typeof", `res.json(typeof ${USER}.email)`],
      ["instanceof", `res.json(${USER}.email instanceof Date)`],
      ["in", `res.json("email" in ${USER})`],
      ["delete", `res.json(delete (${USER} as any).email)`],
      ["void", `res.json(void ${USER}.email)`],
      ["an increment", `let n = 0\nn++\nres.json(n)\nvoid ${USER}.id`],
    ])("%s produces a value without tracked data", async (_, body) => {
      const input = await scan(`  ${body.replace(/\n/g, "\n  ")}`)
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it.each([
      ["if", `if (${USER}.email) res.json("yes")`],
      ["else", `if (${USER}.email) { void 0 } else { res.json("no") }`],
      ["a ternary condition", `res.json(${USER}.email ? "a" : "b")`],
      [
        "a switch on the data",
        `switch (${USER}.role) { case "admin": res.json("admin"); break; default: res.json("user") }`,
      ],
      ["a while loop", `let n = 0\nwhile (${USER}.id && n < 2) { n++ }\nres.json(n)`],
      ["a for loop bound", `for (let i = 0; i < ${USER}.id; i++) { res.json(i) }`],
      [
        "a try that depends on it",
        `try { if (${USER}.email) throw new Error("x") } catch { res.json("caught") }`,
      ],
    ])("branching on tracked data (%s) moves none of it", async (_, body) => {
      const input = await scan(`  ${body.replace(/\n/g, "\n  ")}`)
      expect(reasons(input)).toEqual([])
      // The condition reads the field, and nothing of it reaches the response.
      expect(
        effects(input).filter(
          (effect) =>
            effect.startsWith("email") || effect.startsWith("role") || effect.startsWith("id"),
        ),
      ).toEqual([])
    })

    it("a test whose result is the data itself still carries it: `a && b` and `a || b` give one of their operands", async () => {
      const input = await scan(
        `  res.json(${USER}.email || "none")\n  res.json(${USER}.name && "x")`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it.each([
      ["Object.keys", `res.json(Object.keys(${USER}))`],
      ["Object.getOwnPropertyNames", `res.json(Object.getOwnPropertyNames(${USER}))`],
      ["Reflect.ownKeys", `res.json(Reflect.ownKeys(${USER}))`],
      ["Object.hasOwn", `res.json(Object.hasOwn(${USER}, "email"))`],
      ["Reflect.has", `res.json(Reflect.has(${USER}, "email"))`],
      ["the key variable of for...in", `for (const k in ${USER}) res.json(k)`],
      ["hasOwnProperty", `res.json(${USER}.hasOwnProperty("email"))`],
      ["Array.isArray", `res.json(Array.isArray(${USER}.email))`],
    ])("%s answers with field names, which carry no data", async (_, body) => {
      const input = await scan(`  ${body}`)
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("the names of a tracked object are not its values: reading by those names is the dynamic access that is reported", async () => {
      const input = await scan(`  const u = ${USER}\n  for (const k in u) res.json(u[k])`)
      expect(reasons(input)).toEqual(["dynamic-access 4:31"])
      // The whole record is what a computed key may reach.
      expect(unknownData(input)).toEqual([[""]])
      expect(effects(input)).toEqual(["|inferred"])
    })
  })

  describe("what needs the program to run is an explicit unknown whenever tracked data reaches it", () => {
    it.each([
      ["eval", `res.json(eval(${USER}.email))`, ["unresolved-call"]],
      ["eval of a string built from it", `eval("1 + " + ${USER}.id)`, ["unresolved-call"]],
      ["new Function(string)", `new Function(${USER}.email)()`, ["unresolved-call"]],
      [
        "new Function called with it",
        `res.json(new Function("v", "return v")(${USER}.email))`,
        ["unresolved-call"],
      ],
      ["Function(string)", `Function(${USER}.email)()`, ["unresolved-call"]],
      ["Proxy over it", `const p = new Proxy(${USER}, {})\nres.json(p.email)`, ["unresolved-call"]],
      [
        "a Proxy handler that returns it",
        `const p = new Proxy({}, { get: () => ${USER}.email })\nres.json(p.x)`,
        ["unanalyzed-function"],
      ],
      ["with", `with (${USER}) { res.json(email) }`, ["unsupported-construct"]],
      ["import(expression)", `await import(${USER}.email)`, ["unresolved-import"]],
      ["require(expression)", `require(${USER}.email)`, ["unresolved-import"]],
      [
        "require of a template built from it",
        "require(`./${" + USER + ".role}`)",
        ["unresolved-import"],
      ],
      ["setTimeout with a string", `setTimeout(${USER}.email, 0)`, ["unresolved-call"]],
    ])("%s", async (_, body, expected) => {
      const input = await scan(`  ${body.replace(/\n/g, "\n  ")}`, "", "async ")
      expect(reasons(input).map((reason) => reason.split(" ")[0])).toEqual(expected)
      expect(unknownData(input).flat().length).toBeGreaterThan(0)
    })

    it.each([
      ["eval", `eval("1 + 1")`],
      ["new Function", `new Function("return 1")()`],
      ["Proxy", `new Proxy({}, {})`],
      ["import(expression)", `await import(key)`],
      ["require(expression)", `require(key)`],
    ])("%s with no tracked data in reach says nothing", async (_, body) => {
      const input = await scan(`  ${body}\n  void ${USER}.email`, "", "async ")
      expect(reasons(input)).toEqual([])
    })

    it("a trace through an unknown is not complete, and says which data it concerns", async () => {
      const input = await scan(`  eval(${USER}.email)\n  res.json(${USER}.name)`)
      expect(unknownData(input)).toEqual([["email"]])
      expect(effects(input)).toEqual(["name|static"])
    })
  })

  describe("a call into a package that has no declared summary is an explicit unknown", () => {
    const pkg = `import { audit } from "some-lib";\nimport * as lib from "some-other-lib";\nimport dflt from "third-lib";\n`

    it.each([
      ["a named import", `audit(${USER}.email)`],
      ["a namespace import", `lib.send(${USER}.email)`],
      ["a default import", `dflt(${USER}.email)`],
      ["a member of a default import", `dflt.send(${USER}.email)`],
      ["a constructor", `new lib.Client(${USER}.email)`],
      ["a tagged template", "audit`row ${" + USER + ".email}`"],
      ["a method of its result", `lib.open().send(${USER}.email)`],
      ["a callback it is given", `lib.on("x", () => 1, ${USER}.email)`],
      ["a require of it", `require("some-lib").send(${USER}.email)`],
    ])("%s", async (_, body) => {
      const input = await scan(`  ${body}`, pkg)
      expect(reasons(input)).toHaveLength(1)
      expect(reasons(input)[0]?.startsWith("unresolved-call")).toBe(true)
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a call that receives nothing tracked is not an unknown", async () => {
      const input = await scan(`  audit("x")\n  lib.send(1)\n  void ${USER}.email`, pkg)
      expect(reasons(input)).toEqual([])
    })
  })

  describe("data that keeps moving between functions", () => {
    /** `hops` functions in a row, each storing into module state what the next one stored, the last one the field: one more round of the analysis per hop. */
    const chain = (hops: number): Record<string, string> => ({
      "app/p.ts": `${IMPORT_CAP}const store: any = {}
export function reader(res: any) { res.json(store.v0) }
${Array.from({ length: hops }, (_, i) => `export function w${i}() { store.v${i} = ${i === hops - 1 ? `${USER}.email` : `store.v${i + 1}`} }`).join("\n")}
`,
    })

    it("a chain the rounds can carry settles, and reaches the response", async () => {
      const input = (await h.scan(chain(4))).input
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a chain longer than the rounds is reported as an analysis that did not settle, concerning everything", async () => {
      const input = (await h.scan(chain(12))).input
      expect(input.unknowns).toHaveLength(1)
      expect(input.unknowns[0]).toMatchObject({
        reason: "unanalyzed-function",
        detail:
          "the analysis did not settle after 6 rounds: data written by one function was still reaching others",
        data: [],
      })
    })
  })
})
