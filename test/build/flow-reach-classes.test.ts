import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { USER } from "./mut-flow-scan-harness.js"
import {
  effects,
  facts,
  handler,
  makeHarness,
  reasons,
  unknownData,
} from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * Reach of the flow pass over classes (ADR 0070): constructors, instance and static methods, `this`, fields,
 * accessors, `super`, inheritance inside the project, and what stays unknown when the class is not one the scan reads.
 * Receivers are tracked syntactically (`new C()` values carry their class), never with a type checker.
 */
describe("flow-reach: classes and this", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  /** Scans one handler `h(res, key)` with `extra` declared above it. */
  const run = async (body: string, extra = ""): Promise<ReturnType<typeof facts>> =>
    facts((await h.scan(handler(body, extra))).input)
  const scanned = async (body: string, extra = "") => (await h.scan(handler(body, extra))).input

  describe("construction and methods", () => {
    it("a constructor stores its argument on this, and a method of the instance sends it", async () => {
      const input = await scanned(
        `  new Box(${USER}.email).send(res)`,
        `class Box { v: any; constructor(v: any) { this.v = v } send(res: any) { res.json(this.v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
      expect(
        await run(
          `  new Box(${USER}.email).send(res)`,
          `class Box { v: any; constructor(v: any) { this.v = v } send(res: any) { res.json(this.v) } }\n`,
        ),
      ).toMatchInlineSnapshot(`
        [
          "E calls function:app/p.ts#h->function:app/p.ts#Box.constructor p=- static o= h= @app/p.ts:4:3",
          "E passes function:app/p.ts#h->parameter:app/p.ts#Box.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3",
          "E returns function:app/p.ts#Box.constructor->return:app/p.ts#Box.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:21",
          "E calls function:app/p.ts#h->function:app/p.ts#Box.send p=- static o= h= @app/p.ts:4:3",
          "E passes return:app/p.ts#Box.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3",
          "E passes function:app/p.ts#h->parameter:app/p.ts#Box.send.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3",
          "E side-effect function:app/p.ts#Box.send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:73",
        ]
      `)
    })

    it("an instance held in a variable keeps its class for later method calls", async () => {
      const input = await scanned(
        `  const box = new Box(${USER}.email)\n  box.send(res)`,
        `class Box { v: any; constructor(v: any) { this.v = v } send(res: any) { res.json(this.v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("data handed to a method is passed to its parameter, and the receiver is passed as `this`", async () => {
      expect(
        await run(
          `  const s = new Svc(${USER}.id)\n  s.send(${USER}.email)`,
          `class Svc { id: any; constructor(id: any) { this.id = id } send(v: any) { console.log(this.id, v) } }\n`,
        ),
      ).toMatchInlineSnapshot(`
        [
          "E calls function:app/p.ts#h->function:app/p.ts#Svc.constructor p=- static o= h= @app/p.ts:4:13",
          "E passes function:app/p.ts#h->parameter:app/p.ts#Svc.constructor.id p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13",
          "E returns function:app/p.ts#Svc.constructor->return:app/p.ts#Svc.constructor#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:22",
          "E calls function:app/p.ts#h->function:app/p.ts#Svc.send p=- static o= h= @app/p.ts:5:3",
          "E passes return:app/p.ts#Svc.constructor#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3",
          "E passes function:app/p.ts#h->parameter:app/p.ts#Svc.send.this p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3",
          "E passes function:app/p.ts#h->parameter:app/p.ts#Svc.send.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3",
          "E side-effect function:app/p.ts#Svc.send->boundary:boundary:code#console p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:75",
          "E side-effect function:app/p.ts#Svc.send->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:75",
        ]
      `)
    })

    it("a method calling another method of this follows the data through both", async () => {
      const input = await scanned(
        `  new S().a(${USER}.email)`,
        `class S { a(v: any) { this.b(v) } b(v: any) { console.log(v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a static method is called on the class, and `this` in it is the class", async () => {
      const input = await scanned(
        `  S.send(${USER}.email)\n  S.again(${USER}.name)`,
        `class S { static send(v: any) { console.log(v) } static again(v: any) { this.send(v) } }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a static factory returns an instance that keeps the data stored on it", async () => {
      const input = await scanned(
        `  S.make(${USER}.email).out()`,
        `class S { v: any; static make(v: any) { const s = new S(); s.v = v; return s } out() { console.log(this.v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an instance made by a factory function, or handed to another function, is still an instance of its class", async () => {
      const input = await scanned(
        `  make().send(${USER}.email)\n  use(new S(), ${USER}.name)`,
        `class S { send(v: any) { console.log(v) } }\nfunction make() { return new S() }\nfunction use(s: any, v: any) { s.send(v) }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a method called through a literal element access is called on its receiver", async () => {
      const input = await scanned(
        `  const s = new S(${USER}.email)\n  s["out"]()`,
        `class S { v: any; constructor(v: any) { this.v = v } out() { console.log(this.v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a method called through a computed key is an unresolved call that carries the data", async () => {
      const input = await scanned(
        `  const s = new S()\n  s[key](${USER}.email)`,
        `class S { send(v: any) { console.log(v) } }\n`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual(["unresolved-call 5:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a method used as a callback is called with the element, not left behind", async () => {
      const input = await scanned(
        `  const s = new S()\n  ;[${USER}.email].forEach(s.send)`,
        `class S { send(v: any) { console.log(v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("fields and accessors", () => {
    it("a field initializer runs when the instance is made, and an arrow stored in a field is a method", async () => {
      const input = await scanned(
        `  const s = new S()\n  s.out()\n  s.send(${USER}.name)`,
        `class S { v = ${USER}.email; out() { console.log(this.v) } send = (x: any) => console.log(x) }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a getter runs when the property is read, a setter when it is assigned", async () => {
      const input = await scanned(
        `  const s = new S(${USER}.email)\n  console.log(s.v)\n  s.w = ${USER}.name`,
        `class S { _v: any; constructor(v: any) { this._v = v } get v() { return this._v } set w(x: any) { console.log(x) } }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("accessors on an object literal behave the same way", async () => {
      const input = await scanned(
        `  const o = { get v() { return ${USER}.email }, set w(x: any) { console.log(x) } }\n  console.log(o.v)\n  o.w = ${USER}.name`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("private fields, parameter properties and static members are stored and read like public ones", async () => {
      const input = await scanned(
        `  new A(${USER}.email).out()\n  new B(${USER}.name).out()\n  console.log(C.v)`,
        `class A { #v: any; constructor(v: any) { this.#v = v } out() { console.log(this.#v) } }\nclass B { constructor(private v: any) {} out() { console.log(this.v) } }\nclass C { static v = ${USER}.id; static get w() { return ${USER}.role } static { console.log(C.w) } }\n`,
      )
      expect(effects(input).sort()).toEqual([
        "email|static",
        "id|static",
        "name|static",
        "role|static",
      ])
      expect(reasons(input)).toEqual([])
    })

    it("a static initializer and a static block are analyzed even when the class is never used", async () => {
      const input = await scanned(
        `  return`,
        `class C { static { console.log(${USER}.email) } static v = console.log(${USER}.name) }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })
  })

  describe("inheritance", () => {
    it("super(...) hands the arguments to the superclass constructor, which stores them on the same instance", async () => {
      const input = await scanned(
        `  new B(${USER}.email).out()`,
        `class A { v: any; constructor(v: any) { this.v = v } }\nclass B extends A { constructor(v: any) { super(v) } out() { console.log(this.v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an implicit constructor passes its arguments to the superclass", async () => {
      const input = await scanned(
        `  new B(${USER}.email).out()`,
        `class A { v: any; constructor(v: any) { this.v = v } out() { console.log(this.v) } }\nclass B extends A {}\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a method is looked up through the chain, and an override can call super.method", async () => {
      const input = await scanned(
        `  new C().send(${USER}.email)\n  new D().send(${USER}.name)`,
        `class A { send(v: any) { console.log(v) } }\nclass C extends A {}\nclass D extends A { send(v: any) { super.send(v) } }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("super.property reads an accessor of the superclass on this instance", async () => {
      const input = await scanned(
        `  console.log(new B().w)`,
        `class A { get v() { return ${USER}.email } }\nclass B extends A { get w() { return super.v } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("field initializers of both classes run, the base class first", async () => {
      const input = await scanned(
        `  const b = new B()\n  console.log(b.x, b.y)`,
        `class A { x = ${USER}.email }\nclass B extends A { y = ${USER}.name }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a superclass that is not a project class makes a method it might provide an unresolved call", async () => {
      const input = await scanned(
        `  new S().send(${USER}.email)`,
        `class S extends Base { own() {} }\n`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("data given to super(...) of a superclass that is not a project class is an unresolved call", async () => {
      const input = await scanned(
        `  new S(${USER}.email)`,
        `class S extends Base { constructor(v: any) { super(v) } }\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 2:46"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a method the chain does not declare is looked for on the instance itself, then reported", async () => {
      const input = await scanned(
        `  const s = new S()\n  s.nothing(${USER}.email)`,
        `class S extends P { own() {} }\nclass P {}\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 6:3"])
    })

    it("a cycle in the inheritance chain ends the search instead of hanging", async () => {
      const input = await scanned(
        `  new A().nothing(${USER}.email)`,
        `class A extends B {}\nclass B extends A {}\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 5:3"])
    })
  })

  describe("what is not a class the scan reads", () => {
    it("a constructor function is run on a fresh instance, as a class constructor is", async () => {
      const input = await scanned(
        `  console.log(new Svc(${USER}.email).v)`,
        `function Svc(this: any, v: any) { this.v = v }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an ambient class has no body to read", async () => {
      const input = await scanned(
        `  new Thing(${USER}.email)`,
        `declare class Thing { constructor(v: any) }\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })

    it("the methods of a class nobody uses are still analyzed on an instance of their own class", async () => {
      const input = await scanned(
        `  return`,
        `class Lonely { v: any; send(res: any) { res.json(${USER}.email) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a class given to code the scan cannot read hands over its state", async () => {
      const input = await scanned(
        `  audit(new Box(${USER}.email))`,
        `class Box { v: any; constructor(v: any) { this.v = v } }\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })
  })

  describe("state kept by an instance", () => {
    it("a method that stores into this makes the receiver variable hold it afterwards", async () => {
      const input = await scanned(
        `  const s = new S()\n  s.put(${USER}.email)\n  s.out()`,
        `class S { v: any; put(v: any) { this.v = v } out() { console.log(this.v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a method returning this lets calls be chained", async () => {
      const input = await scanned(
        `  new S().put(${USER}.email).out()`,
        `class S { v: any; put(v: any) { this.v = v; return this } out() { console.log(this.v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("storing through a name that may share the object with another is reported", async () => {
      const input = await scanned(
        `  const s = new S()\n  const t = s\n  t.put(${USER}.email)\n  s.out()`,
        `class S { v: any; put(v: any) { this.v = v } out() { console.log(this.v) } }\n`,
      )
      expect(reasons(input)).toEqual(["unsupported-construct 6:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("an instance is iterable through its [Symbol.iterator] generator", async () => {
      const input = await scanned(
        `  for (const x of new Bag(${USER}.email)) console.log(x)`,
        `class Bag { v: any; constructor(v: any) { this.v = v } *[Symbol.iterator]() { yield this.v } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("class declarations in other places", () => {
    it("a class expression and a class declared inside a function are classes too", async () => {
      const input = await scanned(
        `  const E = class { send(v: any) { console.log(v) } }\n  new E().send(${USER}.email)\n  class L { send(v: any) { console.log(v) } }\n  new L().send(${USER}.name)`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("two classes with the same name in one file stay two classes", async () => {
      const input = await scanned(
        `  new (function () { class X { out() { console.log(${USER}.name) } } return X })().out()`,
        `class X { out() { console.log(${USER}.email) } }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })

    it("a class exported from another file is the class an import names", async () => {
      const input = (
        await h.scan({
          "app/svc.ts": `export class Svc { send(v: any) { console.log(v) } }\n`,
          ...handler(`  new Svc().send(${USER}.email)`, `import { Svc } from "./svc.js";\n`),
        })
      ).input
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })
  })
})
