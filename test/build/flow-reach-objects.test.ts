import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { IMPORT_CAP, USER } from "./mut-flow-scan-harness.js"
import { effects, handler, makeHarness, reasons, unknownData } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * Reach of the flow pass over objects and modules the language builds in less direct ways (ADR 0074): constructor
 * functions with prototypes, `Object.create`, CommonJS, decorators, and classes made by one evaluation of a function.
 */
describe("flow-reach: prototypes, CommonJS, decorators and per-evaluation classes", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const scan = async (body: string, extra = "") => (await h.scan(handler(body, extra))).input
  const files = async (sources: Record<string, string>) => (await h.scan(sources)).input

  describe("constructor functions and prototypes", () => {
    const svc = `function Svc(this: any, v: any) { this.v = v }\n`

    it("new on a function runs it on a fresh instance, which answers to what the prototype holds", async () => {
      const input = await scan(
        `  new (Svc as any)(${USER}.email).out(res)`,
        `${svc}(Svc as any).prototype.out = function (this: any, res: any) { res.json(this.v) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("data stored on this by the function is data of the instance, field by field", async () => {
      const input = await scan(
        `  const s = new (Svc as any)(${USER}.email)\n  res.json(s.v)\n  void ${USER}.name`,
        svc,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a prototype replaced by an object, extended by Object.assign, or set on a function held in a variable", async () => {
      for (const extra of [
        `${svc}(Svc as any).prototype = { out(this: any, res: any) { res.json(this.v) } }\n`,
        `${svc}Object.assign((Svc as any).prototype, { out(this: any, res: any) { res.json(this.v) } })\n`,
      ]) {
        const input = await scan(`  new (Svc as any)(${USER}.email).out(res)`, extra)
        expect(effects(input), extra).toEqual(["email|static"])
      }
      const held = await scan(
        `  new Svc2(${USER}.email).out(res)`,
        `const Svc2: any = function (this: any, v: any) { this.v = v }\nSvc2.prototype.out = function (this: any, res: any) { res.json(this.v) }\n`,
      )
      expect(effects(held)).toEqual(["email|static"])
    })

    it("a prototype written after the instance was made is picked up by another round", async () => {
      const input = await scan(
        `  const s = new (Svc as any)(${USER}.email)\n  setup()\n  s.out(res)`,
        `${svc}function setup() { (Svc as any).prototype.out = function (this: any, res: any) { res.json(this.v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a store on a function is a property of that function, from another module too", async () => {
      const out = await files({
        "app/svc.ts": `export function Svc(this: any, v: any) { this.v = v }\n`,
        "app/proto.ts": `${IMPORT_CAP}import { Svc } from "./svc.js"\n;(Svc as any).prototype.out = function (this: any) { console.log(this.v) }\nexport function h() { new (Svc as any)(${USER}.email).out() }\n`,
      })
      expect(effects(out)).toEqual(["email|static"])
    })

    it("Base.call(this, x) and Base.apply(this, [x]) fill in the object they are called on", async () => {
      const input = await scan(
        `  const d: any = new (Derived as any)(${USER}.email, ${USER}.name)\n  res.json(d.a)\n  res.json(d.b)\n  void ${USER}.id`,
        `function Base(this: any, a: any) { this.a = a }\nfunction Other(this: any, b: any) { this.b = b }\nfunction Derived(this: any, x: any, y: any) { (Base as any).call(this, x); (Other as any).apply(this, [y]) }\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("an arrow function cannot be constructed, and a function the scan cannot read is an unknown", async () => {
      const arrow = await scan(
        `  new (arrow as any)(${USER}.email)`,
        `const arrow = (v: any) => v\n`,
      )
      expect(reasons(arrow)).toEqual(["unresolved-call 4:3"])
      const pkg = await scan(`  new Thing(${USER}.email)`, `import { Thing } from "some-lib";\n`)
      expect(reasons(pkg)).toEqual(["unresolved-call 4:3"])
    })
  })

  describe("Object.create, Object.setPrototypeOf and __proto__", () => {
    const proto = `const proto = { out(v: any) { return v }, v: ${USER}.name }\n`

    it("an object created from another answers to its methods and holds its data", async () => {
      const input = await scan(
        `  const o: any = Object.create(proto)\n  res.json(o.out(${USER}.email))\n  res.json(o.v)`,
        proto,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("descriptors given to Object.create define properties under names chosen at run time", async () => {
      const input = await scan(
        `  const o: any = Object.create({}, { a: { value: ${USER}.email } })\n  res.json(o.a)`,
      )
      expect(effects(input)).toEqual(["email.a|inferred"])
    })

    it("Object.create(null) and of something unknown hold nothing", async () => {
      const input = await scan(
        `  res.json(Object.create(null).x)\n  res.json(Object.create(base).x)\n  void ${USER}.email`,
        `import { base } from "some-lib";\n`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("Object.setPrototypeOf and __proto__ make an object answer to the prototype", async () => {
      const input = await scan(
        `  const a: any = {}\n  Object.setPrototypeOf(a, proto)\n  res.json(a.out(${USER}.email))\n  const b: any = {}\n  b.__proto__ = proto\n  res.json(b.out(${USER}.id))\n  const c: any = { __proto__: proto }\n  res.json(c.out(${USER}.role))`,
        proto,
      )
      expect(new Set(effects(input))).toEqual(new Set(["email|static", "id|static", "role|static"]))
    })

    it("__proto__ in a literal makes the object answer to what the value holds", async () => {
      const input = await scan(`  const c: any = { __proto__: ${USER} }\n  res.json(c.email)`)
      expect(effects(input)).toEqual(["email|static"])
    })

    it("getPrototypeOf gives an approximation of its argument", async () => {
      const input = await scan(`  res.json(Object.getPrototypeOf(${USER}.email))`)
      expect(effects(input)).toEqual(["email|inferred"])
    })
  })

  describe("methods added to a class from outside", () => {
    it("Class.prototype.m = f, Object.assign(Class.prototype, mixin), and inheritance of both", async () => {
      const input = await scan(
        `  (new Sub() as any).viaProto(${USER}.email)\n  ;(new Sub() as any).viaMixin(${USER}.name)\n  res.json((new Sub() as any).value)`,
        `class Base { }\nclass Sub extends Base { }\n;(Base as any).prototype.viaProto = function (v: any) { res_(v) }\nObject.assign(Base.prototype, { viaMixin(v: any) { res_(v) } })\n;(Base as any).prototype.value = ${USER}.id\nfunction res_(v: any) { console.log(v) }\n`,
      )
      expect(new Set(effects(input))).toEqual(new Set(["email|static", "name|static", "id|static"]))
    })

    it("a method the class declares wins over one added to its prototype", async () => {
      const input = await scan(
        `  new Svc().out(${USER}.email)`,
        `class Svc { out(v: any) { console.log(v) } }\n;(Svc as any).prototype.out = function (v: any) { console.log("other", v, ${USER}.name) }\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("a method on a class whose parent the scan cannot read is still an unknown when nothing is found", async () => {
      const input = await scan(
        `  new Svc().send(${USER}.email)`,
        `import { Base } from "some-lib";\nclass Svc extends Base { }\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 5:3"])
    })
  })

  describe("CommonJS", () => {
    const use = (requires: string, call: string) =>
      `${IMPORT_CAP}${requires}\nexport function h(res: any) { ${call} }\n`

    it("exports.x, module.exports.x, module.exports = and a function assigned to module.exports", async () => {
      const cases: [string, string, string][] = [
        [
          `exports.fx = (v: any) => console.log(v)`,
          `const lib = require("./lib.js")`,
          `lib.fx(${USER}.email)`,
        ],
        [
          `module.exports.fx = (v: any) => console.log(v)`,
          `const lib = require("./lib.js")`,
          `lib.fx(${USER}.email)`,
        ],
        [
          `module.exports = { fx: (v: any) => console.log(v) }`,
          `const { fx } = require("./lib.js")`,
          `fx(${USER}.email)`,
        ],
        [
          `module.exports = (v: any) => console.log(v)`,
          `const fx = require("./lib.js")`,
          `fx(${USER}.email)`,
        ],
        [`module.exports = (v: any) => console.log(v)`, ``, `require("./lib.js")(${USER}.email)`],
      ]
      for (const [lib, requires, call] of cases) {
        const input = await files({ "app/lib.ts": `${lib}\n`, "app/p.ts": use(requires, call) })
        expect(effects(input), lib).toEqual(["email|static"])
        expect(reasons(input), lib).toEqual([])
      }
    })

    it("a module that exports a class, and an ES module required from CommonJS code", async () => {
      const cls = await files({
        "app/lib.ts": `module.exports = class Svc { send(v: any) { console.log(v) } }\n`,
        "app/p.ts": use(`const Svc = require("./lib.js")`, `new Svc().send(${USER}.email)`),
      })
      expect(effects(cls)).toEqual(["email|static"])
      const esm = await files({
        "app/lib.ts": `export default function send(v: any) { console.log(v) }\nexport const other = 1\n`,
        "app/p.ts": use(`const lib = require("./lib.js")`, `lib.default(${USER}.email)`),
      })
      expect(effects(esm)).toEqual(["email|static"])
    })

    it("exports written by a function the module calls, and import x = require()", async () => {
      const input = await files({
        "app/lib.ts": `function init() { (exports as any).fx = (v: any) => console.log(v) }\ninit()\n`,
        "app/p.ts": use(`import lib = require("./lib.js")`, `(lib as any).fx(${USER}.email)`),
      })
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a required module's own exports are not another module's", async () => {
      const input = await files({
        "app/a.ts": `exports.fx = (v: any) => console.log("a", v)\n`,
        "app/b.ts": `exports.fx = (v: any) => console.log("b", v)\n`,
        "app/p.ts": use(`const a = require("./a.js")`, `a.fx(${USER}.email)`),
      })
      expect(effects(input)).toEqual(["email|static"])
      expect(input.edges.some((edge) => edge.kind === "calls" && edge.to.includes("b.ts"))).toBe(
        false,
      )
    })

    it("a package, destructured from a package, a module nothing is exported from, and a computed specifier", async () => {
      const pkg = await files({
        "app/p.ts": use(`const lib = require("some-lib")`, `lib.send(${USER}.email)`),
      })
      expect(reasons(pkg)).toEqual(["unresolved-call 3:31"])
      const empty = await files({
        "app/lib.ts": `const hidden = 1\n`,
        "app/p.ts": use(`const lib = require("./lib.js")`, `lib.fx(${USER}.email)`),
      })
      expect(reasons(empty)).toEqual(["unresolved-call 3:31"])
      const computed = await files({ "app/p.ts": use(``, `require(${USER}.email)`) })
      expect(reasons(computed)).toEqual(["unresolved-import 3:31"])
      expect(unknownData(computed)).toEqual([["email"]])
      const unrelated = await files({
        "app/p.ts": use(``, `require("x" + (res as any).name); res.json(${USER}.email)`),
      })
      expect(reasons(unrelated)).toEqual([])
    })

    it("a name the code declares called require is not the loader", async () => {
      const input = await files({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { const require = (v: any) => v; res.json(require(${USER}.email)) }\n`,
      })
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("decorators", () => {
    const run = async (extra: string) => scan(`  new Svc().send(${USER}.email)`, extra)
    const svc = (decorators: string, member = "send(v: any) { console.log(v) }") =>
      `class Svc { ${decorators} ${member} }\n`

    it("a project decorator is called with the member, and what it returns replaces it", async () => {
      const wrap = `function wrap(t: any, k: string, d: any) { const o = d.value; return { value: function (this: any, ...a: any[]) { return o.apply(this, a) } } }\n`
      const input = await run(`${wrap}${svc("@wrap")}`)
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a replacement is what runs: the original no longer does", async () => {
      const swap = `function swap(t: any, k: string, d: any) { return { value: function (this: any, v: any) { return 1 } } }\n`
      const input = await run(`${swap}${svc("@swap")}`)
      expect(effects(input)).toEqual([])
    })

    it("a standard decorator returns the replacement function", async () => {
      const wrap = `function wrap(m: any, c: any) { return function (this: any, ...a: any[]) { return m.apply(this, a) } }\n`
      const input = await run(`${wrap}${svc("@wrap")}`)
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a decorator that rewrites the descriptor in place leaves the method ambiguous, so it is an unknown", async () => {
      const rewrite = `function rewrite(t: any, k: string, d: any) { const o = d.value; d.value = function (this: any, ...a: any[]) { return o.apply(this, a) }; return d }\n`
      const input = await run(`${rewrite}${svc("@rewrite")}`)
      expect(reasons(input)).toEqual(["unresolved-call 5:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("decorators apply bottom up, and a factory is called for the decorator it returns", async () => {
      const order = `const log: string[] = []\nfunction tag(name: string) { return function (t: any, k: string, d: any) { return d } }\n`
      const input = await run(`${order}${svc('@tag("a") @tag("b")')}`)
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a class decorator may hand back another class, which is then what the name stands for", async () => {
      const ext = `function ext(c: any) { return class extends c { extra(v: any) { console.log("sub", v) } } }\n`
      const input = await scan(
        `  (new Svc() as any).extra(${USER}.email)`,
        `${ext}@ext\nclass Svc { }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a class decorator the project defines is called with the class", async () => {
      const input = await run(`function seal(c: any) { return c }\n@seal\n${svc("")}`)
      expect(effects(input)).toEqual(["email|static"])
    })

    it("field, accessor, static and parameter decorators are called and change nothing the scan sees", async () => {
      const noop = `function noop(...a: any[]) {}\n`
      const input = await scan(
        `  const s = new Svc(${USER}.email)\n  res.json(s.v)\n  res.json(s.w)\n  res.json(Svc.s(${USER}.name))\n  s.p(${USER}.id)`,
        `${noop}class Svc { @noop v: any; constructor(v: any) { this.v = v }\n @noop get w() { return ${USER}.role }\n @noop static s(x: any) { return x }\n p(@noop x: any) { console.log(x) } }\n`,
      )
      expect(new Set(effects(input))).toEqual(
        new Set(["email|static", "role|static", "name|static", "id|static"]),
      )
    })

    it("a decorator imported from another module is followed", async () => {
      const input = await files({
        "app/deco.ts": `export function keep(t: any, k: string, d: any) { return d }\n`,
        "app/p.ts": `${IMPORT_CAP}import { keep } from "./deco.js"\nclass Svc { @keep send(v: any) { console.log(v) } }\nexport function h() { new Svc().send(${USER}.email) }\n`,
      })
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a package decorator makes the member an unknown only when it is called with tracked data", async () => {
      const pkg = `import { Cached } from "some-lib";\n`
      const unseen = await scan(
        `  new Svc().send(1)\n  void ${USER}.email`,
        `${pkg}${svc("@Cached()")}`,
      )
      expect(reasons(unseen)).toEqual([])
      const seen = await scan(`  new Svc().send(${USER}.email)`, `${pkg}${svc("@Cached()")}`)
      expect(reasons(seen)).toEqual(["unresolved-call 5:3"])
      expect(unknownData(seen)).toEqual([["email"]])
      const other = await scan(
        `  new Svc().other(${USER}.email)`,
        `${pkg}${svc("@Cached()", "send(v: any) {} other(v: any) { console.log(v) }")}`,
      )
      expect(effects(other)).toEqual(["email|static"])
    })

    it("a package class decorator makes every member of the class an unknown, inherited ones too", async () => {
      const pkg = `import { Injectable } from "some-lib";\n`
      const own = await scan(`  new Svc().send(${USER}.email)`, `${pkg}@Injectable()\n${svc("")}`)
      expect(reasons(own)).toEqual(["unresolved-call 6:3"])
      const inherited = await scan(
        `  new Sub().send(${USER}.email)`,
        `${pkg}@Injectable()\n${svc("")}class Sub extends Svc { }\n`,
      )
      expect(reasons(inherited)).toEqual(["unresolved-call 7:3"])
    })

    it("a package decorator on a getter makes reading it an unknown", async () => {
      const input = await scan(
        `  res.json(new Svc().w)`,
        `import { Observed } from "some-lib";\nclass Svc { v: any = ${USER}.email; @Observed() get w() { return this.v } }\n`,
      )
      expect(reasons(input).map((r) => r.split(" ")[0])).toEqual(["unresolved-call"])
      expect(unknownData(input).flat()).toContain("email")
    })

    it("a package parameter or field decorator changes nothing", async () => {
      const input = await scan(
        `  new Svc().send(${USER}.email)`,
        `import { Body, Prop } from "some-lib";\nclass Svc { @Prop() v: any; send(@Body() x: any) { console.log(x) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("a class made by one evaluation of a function", () => {
    const mk = `function mk(v: any) { return class { out() { return v } } }\n`

    it("each call makes a class of its own, with the variables of that call", async () => {
      const input = await scan(
        `  const A = mk(${USER}.name)\n  const B = mk(${USER}.email)\n  void A\n  res.json(new B().out())`,
        mk,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("the same holds for a class declaration in the function, statics, constructors and field initializers", async () => {
      const decl = await scan(
        `  void mk(${USER}.name)\n  res.json(new (mk(${USER}.email))().out())`,
        `function mk(v: any) { class C { out() { return v } }\n return C }\n`,
      )
      expect(effects(decl)).toEqual(["email|static"])
      const statics = await scan(
        `  void mk(${USER}.name)\n  res.json(mk(${USER}.email).send())`,
        `function mk(v: any) { return class { static send() { return v } } }\n`,
      )
      expect(effects(statics)).toEqual(["email|static"])
      const ctor = await scan(
        `  void mk(${USER}.name)\n  const C = mk(${USER}.email)\n  res.json(new C().v)`,
        `function mk(v: any) { return class { v: any; constructor() { this.v = v } } }\n`,
      )
      expect(effects(ctor)).toEqual(["email|static"])
      const field = await scan(
        `  void mk(${USER}.name)\n  res.json(new (mk(${USER}.email))().v)`,
        `function mk(x: any) { return class { v = x } }\n`,
      )
      expect(effects(field)).toEqual(["email|static"])
    })

    it("a subclass made in a function extends a class of the module", async () => {
      const input = await scan(
        `  void mk(${USER}.name)\n  res.json(new (mk(${USER}.email))().out())`,
        `class Base { v: any; out() { return this.v } }\nfunction mk(x: any) { return class extends Base { v = x } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a method of a class nothing calls is still analyzed, and what it sends counts", async () => {
      const input = await scan(
        `  void mk(${USER}.name)`,
        `function mk(v: any) { return class { out() { console.log(v) } } }\n`,
      )
      expect(effects(input)).toEqual(["name|static"])
    })
  })

  describe("closures, classes and promises that carry tracked data out of the program without reading it", () => {
    const pkg = `import * as lib from "some-lib";\n`

    it("a closure made by a call and handed to a package is run with the variables of that call", async () => {
      const input = await scan(
        `  lib.on("x", mk(${USER}.email))\n  mk(1)()`,
        `${pkg}function mk(v: any) { return () => console.log(v) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("one that returns what it captured is a closure nothing in the project calls, which is an unknown concerning that data", async () => {
      const input = await scan(
        `  lib.on("x", mk(${USER}.email))\n  mk(1)()`,
        `${pkg}function mk(v: any) { return () => v }\n`,
      )
      expect(reasons(input)).toEqual(["unanalyzed-function 3:30"])
      expect(unknownData(input)).toEqual([["email"]])
      expect(input.unknowns[0]?.detail).toBe(
        "closure returns tracked data but nothing in the project calls it",
      )
    })

    it("a call of one closure from a factory does not excuse another made by the same factory", async () => {
      const input = await scan(
        `  const used = mk(${USER}.name)\n  res.json(used())\n  lib.on("x", mk(${USER}.email))`,
        `${pkg}function mk(v: any) { return () => v }\n`,
      )
      expect(effects(input)).toEqual(["name|static"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a closure that was called is not reported, whatever it returned", async () => {
      const input = await scan(
        `  const f = mk(${USER}.email)\n  void f()`,
        `function mk(v: any) { return () => v }\n`,
      )
      expect(reasons(input)).toEqual([])
    })

    it("a function analyzed on its own makes closures over parameters nothing has given values to, which say nothing", async () => {
      const input = await scan(
        `  later(() => 1)`,
        `${pkg}function later(cb: () => void) { lib.on("x", () => cb()) }\n`,
      )
      expect(reasons(input)).toEqual([])
    })

    it("the methods of a class a call made are closures of that call", async () => {
      const handed = await scan(
        `  lib.on("x", mk(${USER}.email))`,
        `${pkg}function mk(v: any) { return class { out() { return v } } }\n`,
      )
      expect(reasons(handed)).toEqual(["unanalyzed-function 3:38"])
      expect(unknownData(handed)).toEqual([["email"]])
      const used = await scan(
        `  const C = mk(${USER}.email)\n  void new C().out()`,
        `function mk(v: any) { return class { out() { return v } } }\n`,
      )
      expect(reasons(used)).toEqual([])
    })

    it("a promise settled with tracked data, a Map and a Set that hold it, handed to a package, are unknowns concerning it", async () => {
      for (const value of [
        `new Promise((resolve) => resolve(${USER}.email))`,
        `new Map([["a", ${USER}.email]])`,
        `new Set([${USER}.email])`,
        `Promise.all([new Promise((resolve) => resolve(${USER}.email))])`,
      ]) {
        const input = await scan(`  lib.on("x", ${value})`, pkg)
        expect(reasons(input), value).toEqual(["unresolved-call 4:3"])
        expect(unknownData(input), value).toEqual([["email"]])
      }
    })

    it("a promise that is awaited here is read here, and is the same data the sink gets", async () => {
      const input = await scan(
        `  const p = new Promise((resolve) => resolve(${USER}.email))\n  res.json(await p)`,
        "",
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })
})
