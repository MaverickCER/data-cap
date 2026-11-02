import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowModelInput } from "../../src/flow/flow-model.js"
import { DEFAULT_FLOW_SINKS } from "../../src/build/flow-scan.js"
import { handler, makeHarness, USER } from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

const EMAIL = `${USER}.email`

/** What reached a boundary, as `path|status` per side-effect edge. */
function effects(input: FlowModelInput): string[] {
  return input.edges
    .filter((e) => e.kind === "side-effect")
    .map((e) => `${(e.path ?? []).join(".")}|${e.status}`)
}
const reasons = (input: FlowModelInput): string[] => input.unknowns.map((u) => u.reason)

describe("flow-scan: method and builtin tables", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const scanBody = async (body: string, extra = "") => (await h.scan(handler(body, extra))).input

  describe("DEFAULT_FLOW_SINKS", () => {
    it("lists exactly the recognised sinks", () => {
      expect(
        DEFAULT_FLOW_SINKS.map((s) => `${s.callee}|${s.boundary.kind}|${s.boundary.name}`),
      ).toEqual([
        "res.json|client-response|http-response",
        "res.send|client-response|http-response",
        "res.end|client-response|http-response",
        "res.write|client-response|http-response",
        "res.render|client-response|http-response",
        "res.redirect|client-response|http-response",
        "reply.send|client-response|http-response",
        "Response.json|client-response|http-response",
        "NextResponse.json|client-response|http-response",
        "console.log|log|console",
        "console.info|log|console",
        "console.warn|log|console",
        "console.error|log|console",
        "console.debug|log|console",
        "console.trace|log|console",
        "logger.info|log|logger",
        "logger.warn|log|logger",
        "logger.error|log|logger",
        "logger.debug|log|logger",
        "logger.trace|log|logger",
        "logger.log|log|logger",
      ])
    })

    it.each(DEFAULT_FLOW_SINKS.map((s) => s.callee))(
      "%s sends tracked data to its boundary",
      async (callee) => {
        const input = await scanBody(`  ${callee}(${EMAIL})`)
        const sink = DEFAULT_FLOW_SINKS.find((s) => s.callee === callee)
        const boundary = input.nodes.find((n) => n.kind === "boundary")
        expect(boundary).toEqual({
          kind: "boundary",
          scope: "boundary:code",
          name: sink?.boundary.name,
          status: "static",
          boundaryKind: sink?.boundary.kind,
        })
        expect(
          input.edges.filter((e) => e.kind === "side-effect").map((e) => [e.to, e.path, e.status]),
        ).toEqual([
          [flowNodeId("boundary", "boundary:code", sink?.boundary.name ?? ""), ["email"], "static"],
        ])
        expect(input.unknowns).toEqual([])
      },
    )

    it("does not treat an unlisted method on a sink root as a sink", async () => {
      const input = await scanBody(`  res.status(${EMAIL})\n  console.table(${EMAIL})`)
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual(["unresolved-call", "unresolved-call"])
    })
  })

  describe("opaque callees", () => {
    it.each(["createData", "buildData", "documentData"])(
      "%s arguments are never analyzed",
      async (name) => {
        const input = await scanBody(`  const s = ${name}({ run: () => console.log(${EMAIL}) })`)
        expect(input.nodes.filter((n) => n.kind === "boundary")).toEqual([])
        expect(input.unknowns).toEqual([])
      },
    )

    it.each(["createData", "buildData", "documentData"])(
      "a schema constant passed to %s stays opaque",
      async (name) => {
        const input = (
          await h.scan({
            "app/s.ts": `import { userData } from "../features/user/user.js";\nconst schema = { run: () => console.log(${EMAIL}) };\nexport const other = ${name}(schema);\n`,
          })
        ).input
        expect(input.nodes.filter((n) => n.kind === "boundary")).toEqual([])
        expect(input.nodes.filter((n) => n.kind === "function" && n.scope === "app/s.ts")).toEqual(
          [],
        )
      },
    )

    it("only an identifier argument names a schema constant", async () => {
      const input = (
        await h.scan({
          "app/s.ts": `import { userData } from "../features/user/user.js";\nconst a = { run: () => console.log(${EMAIL}) };\nexport const other = createData();\nexport const other2 = createData({ x: 1 });\nvoid a;\n`,
        })
      ).input
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a method call named like an opaque callee is not opaque", async () => {
      const input = await scanBody(`  x.createData(${EMAIL})`)
      expect(reasons(input)).toEqual(["unresolved-call"])
    })
  })

  describe("then / catch / finally", () => {
    it.each([
      ["then", "email|static"],
      ["catch", ""],
      ["finally", ""],
    ])("%s runs its callback", async (name) => {
      const input = await scanBody(`  const p = ${EMAIL}\n  p.${name}((v: any) => { res.json(v) })`)
      // The callback is called with a call edge only when the method is a promise method.
      expect(input.edges.filter((e) => e.kind === "calls").length).toBe(1)
      expect(effects(input)).toEqual(name === "then" ? ["email|static"] : [])
    })
  })

  describe("element callback methods", () => {
    const callbackMethods = [
      "map",
      "flatMap",
      "forEach",
      "filter",
      "find",
      "findLast",
      "some",
      "every",
      "findIndex",
      "findLastIndex",
      "sort",
      "toSorted",
    ]
    it.each(callbackMethods)("%s analyzes its callback with the element", async (name) => {
      const input = await scanBody(
        `  const items = userData.getSnapshot().fields.tags\n  items.${name}((t: any) => { res.json(t.label) })`,
      )
      expect(input.edges.filter((e) => e.kind === "calls").length).toBe(1)
      expect(effects(input)).toEqual(["[].label|static"])
      expect(input.unknowns).toEqual([])
    })

    it.each(["reduce", "reduceRight"])("%s passes the accumulator and element", async (name) => {
      const input = await scanBody(
        `  const items = userData.getSnapshot().fields.tags\n  const r = items.${name}((acc: any, t: any) => { res.json(t.label); return acc }, 0)\n  res.json(r)`,
      )
      expect(input.edges.filter((e) => e.kind === "calls").length).toBe(1)
      expect(effects(input)).toEqual(["[].label|static", "|inferred"])
      expect(input.unknowns).toEqual([])
    })
  })

  describe("predicate methods", () => {
    const predicates = [
      "includes",
      "indexOf",
      "lastIndexOf",
      "some",
      "every",
      "startsWith",
      "endsWith",
      "has",
      "hasOwnProperty",
      "test",
      "localeCompare",
      "isArray",
      "keys",
      "isNaN",
      "isFinite",
      "isInteger",
      "findIndex",
      "findLastIndex",
    ]
    it.each(predicates)("%s yields nothing and is not an unknown", async (name) => {
      const input = await scanBody(`  res.json(${EMAIL}.${name}(1))`)
      expect(effects(input)).toEqual([])
      expect(input.unknowns).toEqual([])
    })

    it.each(["some", "every", "findIndex", "findLastIndex"])(
      "%s with a callback yields nothing",
      async (name) => {
        const input = await scanBody(
          `  const items = userData.getSnapshot().fields.tags\n  res.json(items.${name}((t: any) => t.label))`,
        )
        expect(effects(input)).toEqual([])
        expect(input.unknowns).toEqual([])
      },
    )
  })

  describe("shape preserving methods", () => {
    const shape = [
      "slice",
      "concat",
      "reverse",
      "flat",
      "at",
      "filter",
      "find",
      "findLast",
      "sort",
      "toSorted",
      "toReversed",
      "splice",
      "valueOf",
    ]
    it.each(shape)("%s keeps the exact path", async (name) => {
      const input = await scanBody(`  res.json(${EMAIL}.${name}(1))`)
      expect(effects(input)).toEqual(["email|static"])
      expect(input.unknowns).toEqual([])
    })

    it.each(["filter", "find", "findLast", "sort", "toSorted"])(
      "%s with a callback returns the receiver",
      async (name) => {
        const input = await scanBody(
          `  const items = userData.getSnapshot().fields.tags\n  res.json(items.${name}((t: any) => t))`,
        )
        expect(effects(input)).toEqual(["|static"])
        expect(input.unknowns).toEqual([])
      },
    )
  })

  describe("transforming methods", () => {
    const transforming = [
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
      "toLocaleString",
      "toJSON",
      "toLocaleLowerCase",
      "toLocaleUpperCase",
    ]
    it.each(transforming)("%s keeps the data approximately", async (name) => {
      const input = await scanBody(`  res.json(${EMAIL}.${name}(1))`)
      expect(effects(input)).toEqual(["email|inferred"])
      expect(input.unknowns).toEqual([])
    })

    it("an unlisted method is an unresolved call", async () => {
      const input = await scanBody(`  res.json(${EMAIL}.frobnicate(1))`)
      expect(reasons(input)).toEqual(["unresolved-call"])
    })
  })

  describe("builtins", () => {
    const roots = [
      "JSON",
      "Math",
      "Number",
      "String",
      "Boolean",
      "Array",
      "Object",
      "Promise",
      "Date",
      "BigInt",
      "Intl",
      "Buffer",
    ]
    it.each(roots)("%s.<method> keeps the data approximately", async (root) => {
      const input = await scanBody(`  res.json(${root}.zzz(${EMAIL}))`)
      expect(effects(input)).toEqual(["email|inferred"])
      expect(input.unknowns).toEqual([])
    })

    it.each(["Object.assign", "Object.freeze", "Object.seal", "Promise.resolve"])(
      "%s keeps the data exactly",
      async (callee) => {
        const input = await scanBody(`  res.json(${callee}(${EMAIL}))`)
        expect(effects(input)).toEqual(["email|static"])
        expect(input.unknowns).toEqual([])
      },
    )

    // The argument of these is an iterable of promises: what is read off it is an element of the data it holds.
    it.each(["Promise.all", "Promise.allSettled", "Promise.race", "Promise.any"])(
      "%s keeps the data exactly, as an element of the iterable it was given",
      async (callee) => {
        const input = await scanBody(`  res.json(${callee}(${EMAIL}))`)
        expect(effects(input)).toEqual(["email.[]|static"])
        expect(input.unknowns).toEqual([])
      },
    )

    it.each([
      "Object.keys",
      "Object.getOwnPropertyNames",
      "Array.isArray",
      "Number.isNaN",
      "Number.isFinite",
      "Number.isInteger",
      "Object.hasOwn",
      "Object.is",
    ])("%s carries no data", async (callee) => {
      const input = await scanBody(`  res.json(${callee}(${EMAIL}))`)
      expect(effects(input)).toEqual([])
      expect(input.unknowns).toEqual([])
    })

    it.each([
      "String",
      "Number",
      "Boolean",
      "parseInt",
      "parseFloat",
      "encodeURIComponent",
      "decodeURIComponent",
      "encodeURI",
      "decodeURI",
      "btoa",
      "atob",
      "BigInt",
    ])("%s(...) keeps the data approximately", async (callee) => {
      const input = await scanBody(`  res.json(${callee}(${EMAIL}))`)
      expect(effects(input)).toEqual(["email|inferred"])
      expect(input.unknowns).toEqual([])
    })

    it("structuredClone keeps the data exactly", async () => {
      const input = await scanBody(`  res.json(structuredClone(${EMAIL}))`)
      expect(effects(input)).toEqual(["email|static"])
    })

    it("an unknown free function is an unresolved call", async () => {
      const input = await scanBody(`  res.json(mystery(${EMAIL}))`)
      expect(reasons(input)).toEqual(["unresolved-call"])
    })
  })
})
