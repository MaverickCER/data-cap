import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { dump, USER } from "./mut-flow-scan-harness.js"
import { buildFlowModel } from "../../src/flow/flow-model.js"
import { analyzeRedundantTransforms } from "../../src/flow/redundant-transform.js"
import { facts, handler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * The facts the scan records for the smaller constructs added late: what a generator is sent, tagged templates, copies,
 * accessors in object literals, stores through names, setters and destructuring assignment. Each case is a small program
 * and the exact facts it must produce; a case where two forms look alike pairs them so a mix-up changes the output.
 */
describe("flow-scan: late constructs", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const run = async (body: string, extra = "") =>
    facts((await h.scan(handler(body, extra))).input).join("\n")
  const copies = async (body: string, extra = "") =>
    analyzeRedundantTransforms(buildFlowModel((await h.scan(handler(body, extra))).input)).map(
      (item) => [item.kind, item.via, item.paths.map((p) => p.join(".") || "(whole)")],
    )
  const u = USER

  describe("generators", () => {
    it("what next(x) sends reaches the yield it resumes, whether the generator or the sender is read first", async () => {
      expect(
        await run(
          `  const it = echo(res)\n  it.next()\n  it.next(${u}.email)`,
          `function* echo(res: any) { const got = yield 1; res.json(got) }`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#h->function:app/p.ts#echo p=- static o= h= @app/p.ts:3:14
        E passes function:app/p.ts#h->parameter:app/p.ts#echo.arg1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#echo->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:49"
      `)
      expect(
        await run(
          `  const it = echo(res)\n  it.next(${u}.name)`,
          `function* echo(res: any) { const got = yield 1; res.json(got) }`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#h->function:app/p.ts#echo p=- static o= h= @app/p.ts:3:14
        E passes function:app/p.ts#h->parameter:app/p.ts#echo.arg1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#echo->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:49"
      `)
    })

    it("yield* hands what is sent to the generator it delegates to", async () => {
      expect(
        await run(
          `  const it = outer(res)\n  it.next()\n  it.next(${u}.email)`,
          `function* inner(res: any) { const got = yield 1; res.json(got) }\nfunction* outer(res: any) { yield* inner(res) }`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#outer->function:app/p.ts#inner p=- static o= h= @app/p.ts:3:36
        E calls function:app/p.ts#h->function:app/p.ts#outer p=- static o= h= @app/p.ts:4:14
        E passes function:app/p.ts#h->parameter:app/p.ts#outer.arg1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E passes function:app/p.ts#outer->parameter:app/p.ts#inner.arg1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
        E side-effect function:app/p.ts#inner->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50"
      `)
    })

    it("next(x) on a generator the project does not define is an unknown", async () => {
      expect(await run(`  const it: any = other()\n  it.next(${u}.email)`)).toMatchInlineSnapshot(
        `"U unresolved-call app/p.ts:4:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"`,
      )
    })
  })

  describe("tagged templates", () => {
    it("String.raw keeps what is substituted; any other tag is called with it", async () => {
      expect(
        await run(
          `  res.json(String.raw\`a\${${u}.email}\`)\n  res.json(Other.raw\`a\${${u}.name}\`)\n  res.json(String.cooked\`a\${${u}.id}\`)`,
          `const Other = { raw(strings: any, ...values: any[]) { return "x" } }`,
        ),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E calls function:app/p.ts#h->function:app/p.ts#<module>>raw@2:17 p=- static o= h= @app/p.ts:4:12
        E passes function:app/p.ts#h->parameter:app/p.ts#<module>>raw@2:17.values p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
      `)
    })
  })

  describe("copies", () => {
    it("{ ...x } alone is a copy; a spread with anything else, or an object with one plain property, is not", async () => {
      expect(
        await copies(
          `  const a = { ...${u} }\n  const b = { ...${u}, extra: 1 }\n  const c = { only: ${u}.email }\n  res.json([a, b, c])`,
        ),
      ).toMatchInlineSnapshot(`[]`)
    })

    it("[...x] alone is a copy; an array of one plain element is not", async () => {
      expect(
        await copies(`  const a = [...[${u}.email]]\n  const b = [${u}.email]\n  res.json([a, b])`),
      ).toMatchInlineSnapshot(`[]`)
    })

    it("copying a copy is marked, copying anything else is not", async () => {
      expect(
        await copies(`  const once = { ...${u} }\n  const twice = { ...once }\n  res.json(twice)`),
      ).toMatchInlineSnapshot(`
        [
          [
            "round-trip",
            "copied",
            [
              "(whole)",
            ],
          ],
        ]
      `)
      expect(
        await copies(
          `  const once = JSON.parse(JSON.stringify(${u}))\n  const twice = structuredClone(once)\n  res.json(twice)`,
        ),
      ).toMatchInlineSnapshot(`
        [
          [
            "round-trip",
            "serialized",
            [
              "(whole)",
            ],
          ],
          [
            "round-trip",
            "copied",
            [
              "(whole)",
            ],
          ],
        ]
      `)
    })
  })

  describe("accessors in object literals", () => {
    it("a getter and a setter written in a literal run when read and written; one without a body does not exist", async () => {
      expect(
        await run(
          `  const o = { get a() { return ${u}.email }, set b(v: any) { res.json(v) } }\n  res.json(o.a)\n  o.b = ${u}.name`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#h->function:app/p.ts#h>a@3:15 p=- static o= h= @app/p.ts:4:12
        E returns function:app/p.ts#h>a@3:15->return:app/p.ts#h>a@3:15#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E passes return:app/p.ts#h>a@3:15#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E calls function:app/p.ts#h->function:app/p.ts#h>b@3:76 p=- static o= h= @app/p.ts:5:3
        E passes function:app/p.ts#h->parameter:app/p.ts#h>b@3:76.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h>b@3:76->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:92"
      `)
      expect(
        await run(
          `  const o: any = { get a(): any; set b(v: any); }\n  res.json(o.a)\n  o.b = ${u}.name`,
        ),
      ).toMatchInlineSnapshot(`""`)
    })

    it("an accessor whose name is computed from something unknown is not stored under a made-up name", async () => {
      expect(
        await run(
          `  const k: string = Math.random() > 1 ? "x" : "y"\n  const o: any = { get [k]() { return ${u}.email } }\n  res.json({ ...o })\n  res.json(o.undefined)`,
        ),
      ).toMatchInlineSnapshot(`
        "E returns function:app/p.ts#h>anonymous@4:20->return:app/p.ts#h>anonymous@4:20#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:32
        U unanalyzed-function app/p.ts:4:20 subject=function:app/p.ts#h>anonymous@4:20 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/email"
      `)
    })
  })

  describe("stores through names", () => {
    const two = async (files: Record<string, string>) => {
      const result = await h.scan(files)
      return facts(result.input).join("\n")
    }
    const lib = (extra: string) => `import { userData } from "../features/user/user.js";\n${extra}`

    it("an object filled in by a module analyzed before the one that exports it is still found by a reader", async () => {
      expect(
        await two({
          "app/w.ts": lib(
            `import { store } from "./store.js";\nexport function put() { store.v = ${u}.email }\n`,
          ),
          "app/store.ts": `export const store: any = {}\n`,
          "app/r.ts": `import { store } from "./store.js";\nexport function get(res: any) { res.json(store.v) }\n`,
        }),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:33"`,
      )
    })

    it("a property stored on an imported function or class is read back from any module", async () => {
      expect(
        await two({
          "app/w.ts": lib(
            `import { Foo, Bar } from "./lib.js";\nexport function put() { (Foo as any).token = ${u}.email; (Bar as any).shared = ${u}.name }\n`,
          ),
          "app/lib.ts": `export function Foo() {}\nexport class Bar {}\n`,
          "app/r.ts": `import { Foo, Bar } from "./lib.js";\nexport function get(res: any) { res.json((Foo as any).token); res.json((Bar as any).shared) }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:33
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:63"
      `)
    })

    it("a namespace import stores into the module it names", async () => {
      expect(
        await two({
          "app/w.ts": lib(
            `import * as ns from "./store.js";\nexport function put() { ns.box.deep.v = ${u}.email }\n`,
          ),
          "app/store.ts": `export const box: any = { deep: {} }\n`,
          "app/r.ts": `import { box } from "./store.js";\nexport function get(res: any) { res.json(box.deep.v) }\n`,
        }),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:33"`,
      )
    })

    it("Base.call(this, ...) leaves on this what the callee stored", async () => {
      expect(
        await run(
          `  const d = new Derived(${u}.email)\n  res.json(d.v)`,
          `function Base(this: any, v: any) { this.v = v }\nfunction Derived(this: any, v: any) { Base.call(this, v) }`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#Derived->function:app/p.ts#Base p=- static o= h= @app/p.ts:3:39
        E calls function:app/p.ts#h->function:app/p.ts#Derived p=- static o= h= @app/p.ts:4:13
        E passes function:app/p.ts#h->parameter:app/p.ts#Derived.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E passes function:app/p.ts#Derived->parameter:app/p.ts#Base.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
        E returns function:app/p.ts#Base->return:app/p.ts#Base#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
        E passes return:app/p.ts#Base#return->function:app/p.ts#Derived p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
        E returns function:app/p.ts#Derived->return:app/p.ts#Derived#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
        E passes return:app/p.ts#Derived#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
      `)
    })

    it("__proto__ is not a property, a computed key is reported, and a literal key is kept", async () => {
      expect(
        await run(
          `  const p: any = { inherited: ${u}.email }\n  const o: any = {}\n  o.__proto__ = p\n  res.json(o.inherited)`,
        ),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"`,
      )
      expect(
        await run(
          `  const k: string = String(Math.random())\n  const o: any = {}\n  o[k] = ${u}.email\n  res.json(o.x)`,
        ),
      ).toMatchInlineSnapshot(
        `"U dynamic-access app/p.ts:5:3 subject=function:app/p.ts#h detail=computed property key on a store of tracked data data=field:features/user/user.ts#userData.user/email"`,
      )
      expect(
        await run(`  const o: any = {}\n  o["lit"] = ${u}.email\n  res.json(o.lit)`),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"`,
      )
    })

    it("a store into an object the scan cannot see the origin of is reported once", async () => {
      expect(
        await run(`  const o: any = JSON.parse(String(Math.random()))\n  o.x = ${u}.email`),
      ).toMatchInlineSnapshot(`""`)
      expect(
        await run(`  const o: any = JSON.parse(String(Math.random()))\n  o.x = 1`),
      ).toMatchInlineSnapshot(`""`)
    })

    it("a property stored into a shared object is reported, and a store through a shared name sees both objects", async () => {
      expect(await run(`  const a: any = {}\n  const b = a\n  b.x = ${u}.email\n  res.json(a.x)`))
        .toMatchInlineSnapshot(`
        "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        U unsupported-construct app/p.ts:5:3 subject=function:app/p.ts#h detail=property stored into an object another name may share data=field:features/user/user.ts#userData.user/email"
      `)
    })

    it("an assignment target that is not a variable is reported", async () => {
      expect(await run(`  ;(Math.random() > 1 ? res : res).x = ${u}.email`)).toMatchInlineSnapshot(
        `"U unsupported-construct app/p.ts:3:4 subject=function:app/p.ts#h detail=assignment target is not a variable data=field:features/user/user.ts#userData.user/email"`,
      )
    })
  })

  describe("setters", () => {
    it("assigning to a property with a setter runs the setter with this as the object, and stores nothing itself", async () => {
      expect(
        await run(
          `  const o = new Cell()\n  o.v = ${u}.email\n  res.json(o.v)\n  res.json(o.seen)`,
          `class Cell { secret = ${u}.name; seen: any; set v(x: any) { this.seen = this.secret } }`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#h->function:app/p.ts#Cell.constructor p=- static o= h= @app/p.ts:3:13
        E returns function:app/p.ts#Cell.constructor->return:app/p.ts#Cell.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
        E calls function:app/p.ts#h->function:app/p.ts#Cell.set v p=- static o= h= @app/p.ts:4:3
        E passes return:app/p.ts#Cell.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E passes function:app/p.ts#h->parameter:app/p.ts#Cell.set v.this p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E passes function:app/p.ts#h->parameter:app/p.ts#Cell.set v.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E returns function:app/p.ts#Cell.set v->return:app/p.ts#Cell.set v#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:75
        E passes return:app/p.ts#Cell.set v#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
      `)
    })

    it("a setter in a literal and one inherited from a class are both run; an opaque or missing one is not", async () => {
      expect(
        await run(
          `  const o: any = { set v(x: any) { res.json(x) } }\n  o.v = ${u}.email\n  const c: any = new Child()\n  c.w = ${u}.name`,
          `class Parent { set w(x: any) { throw x } }\nclass Child extends Parent {}`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#h->function:app/p.ts#h>v@4:20 p=- static o= h= @app/p.ts:5:3
        E passes function:app/p.ts#h->parameter:app/p.ts#h>v@4:20.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h>v@4:20->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36
        E calls function:app/p.ts#h->function:app/p.ts#Child.constructor p=- static o= h= @app/p.ts:6:18
        E calls function:app/p.ts#Child.constructor->function:app/p.ts#Parent.constructor p=- static o= h= @app/p.ts:3:1
        E calls function:app/p.ts#h->function:app/p.ts#Parent.set w p=- static o= h= @app/p.ts:7:3
        E passes function:app/p.ts#h->parameter:app/p.ts#Parent.set w.x p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E returns function:app/p.ts#Parent.set w->return:app/p.ts#Parent.set w#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:32"
      `)
    })
  })

  describe("destructuring assignment", () => {
    it("array targets take their element, skip holes and take the rest from the whole", async () => {
      expect(
        await run(
          `  let a: any, b: any, rest: any\n  ;[, a, ...rest] = [${u}.id, ${u}.email, ${u}.name]\n  res.json(a)\n  res.json(rest)`,
        ),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
      `)
    })

    it("object targets take a named, shorthand, computed or rest part", async () => {
      expect(
        await run(
          `  let a: any, b: any, c: any, d: any\n  const k: string = String(Math.random())\n  ;({ email: a, name: b = 1, [k]: c, ...d } = ${u})\n  res.json(a)\n  res.json(b)\n  res.json(c)\n  res.json(d)`,
        ),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3"
      `)
      expect(
        await run(`  let email: any\n  ;({ email } = ${u})\n  res.json(email)`),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"`,
      )
    })
  })

  describe("copies and derivations", () => {
    it("a deep copy gives the copy its own nested objects; a shallow one shares them", async () => {
      expect(
        await copies(
          `  const once = JSON.parse(JSON.stringify({ n: { v: ${u}.email } }))\n  const twice = structuredClone(once)\n  res.json(twice)`,
        ),
      ).toMatchInlineSnapshot(`
        [
          [
            "round-trip",
            "serialized",
            [
              "email",
            ],
          ],
          [
            "round-trip",
            "copied",
            [
              "email",
            ],
          ],
        ]
      `)
      expect(
        await copies(
          `  const a = { n: { v: ${u}.email } }\n  const b = { ...a }\n  const c = { ...b }\n  res.json(c)`,
        ),
      ).toMatchInlineSnapshot(`
        [
          [
            "round-trip",
            "copied",
            [
              "email",
            ],
          ],
        ]
      `)
    })

    it("a derived name nothing reads is flagged; one that is read, reused, underscored or destructured is not", async () => {
      expect(
        await copies(
          `  const unused = ${u}.email.toUpperCase()\n  const used = ${u}.name.toUpperCase()\n  const _skipped = ${u}.id.toUpperCase()\n  const [x, y] = [${u}.role]\n  res.json(used)`,
        ),
      ).toMatchInlineSnapshot(`
        [
          [
            "dead-derivation",
            undefined,
            [
              "email",
            ],
          ],
          [
            "dead-derivation",
            undefined,
            [
              "role",
            ],
          ],
        ]
      `)
    })
  })

  describe("what an imported function, class or variable holds", () => {
    const lib = (extra: string) => `import { userData } from "../features/user/user.js";\n${extra}`
    const many = async (files: Record<string, string>) =>
      facts((await h.scan(files)).input).join("\n")

    it("a prototype stored on a function by a module analyzed first is found when the function is constructed", async () => {
      expect(
        await many({
          "app/proto.ts": lib(
            `import { Svc } from "./svc.js"\n;(Svc as any).prototype.out = function (this: any) { console.log(this.v) }\nexport function h() { new (Svc as any)(${u}.email).out() }\n`,
          ),
          "app/svc.ts": `export function Svc(this: any, v: any) { this.v = v }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "E calls function:app/proto.ts#h->function:app/svc.ts#Svc p=- static o= h= @app/proto.ts:4:23
        E passes function:app/proto.ts#h->parameter:app/svc.ts#Svc.v p=email static o=field:features/user/user.ts#userData.user h= @app/proto.ts:4:23
        E returns function:app/svc.ts#Svc->return:app/svc.ts#Svc#return p=email static o=field:features/user/user.ts#userData.user h= @app/svc.ts:1:1
        E calls function:app/proto.ts#h->function:app/proto.ts#<module>>anonymous@3:31 p=- static o= h= @app/proto.ts:4:23
        E passes return:app/svc.ts#Svc#return->function:app/proto.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/proto.ts:4:23
        E passes function:app/proto.ts#h->parameter:app/proto.ts#<module>>anonymous@3:31.this p=email static o=field:features/user/user.ts#userData.user h= @app/proto.ts:4:23
        E side-effect function:app/proto.ts#<module>>anonymous@3:31->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/proto.ts:3:54"
      `)
    })

    it("a prototype and a static stored on an imported class are found", async () => {
      expect(
        await many({
          "app/proto.ts": lib(
            `import { Box } from "./box.js"\n;(Box as any).prototype.out = function (this: any) { console.log(this.v) }\n;(Box as any).helper = function (x: any) { console.log(x) }\nexport function h() { new Box(${u}.email).out(); (Box as any).helper(${u}.name) }\n`,
          ),
          "app/box.ts": `export class Box { v: any; constructor(v: any) { this.v = v } }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "E calls function:app/proto.ts#h->function:app/box.ts#Box.constructor p=- static o= h= @app/proto.ts:5:23
        E passes function:app/proto.ts#h->parameter:app/box.ts#Box.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/proto.ts:5:23
        E returns function:app/box.ts#Box.constructor->return:app/box.ts#Box.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/box.ts:1:28
        E calls function:app/proto.ts#h->function:app/proto.ts#<module>>anonymous@3:31 p=- static o= h= @app/proto.ts:5:23
        E passes return:app/box.ts#Box.constructor#return->function:app/proto.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/proto.ts:5:23
        E passes function:app/proto.ts#h->parameter:app/proto.ts#<module>>anonymous@3:31.this p=email static o=field:features/user/user.ts#userData.user h= @app/proto.ts:5:23
        E side-effect function:app/proto.ts#<module>>anonymous@3:31->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/proto.ts:3:54
        E calls function:app/proto.ts#h->function:app/proto.ts#<module>>anonymous@4:24 p=- static o= h= @app/proto.ts:5:80
        E passes function:app/proto.ts#h->parameter:app/proto.ts#<module>>anonymous@4:24.x p=name static o=field:features/user/user.ts#userData.user h= @app/proto.ts:5:80
        E side-effect function:app/proto.ts#<module>>anonymous@4:24->boundary:boundary:code#console p=name static o=field:features/user/user.ts#userData.user h= @app/proto.ts:4:44"
      `)
    })

    it("a function a module rebinds is still the function that was exported", async () => {
      expect(
        await many({
          "app/svc.ts": `export function Svc(this: any, v: any) { this.v = v }\n;(Svc as any) = (function () {}) as any\n`,
          "app/use.ts": lib(
            `import { Svc } from "./svc.js"\nexport function h(res: any) { res.json(new (Svc as any)(${u}.email).v) }\n`,
          ),
        }),
      ).toMatchInlineSnapshot(`
        "E calls function:app/use.ts#h->function:app/svc.ts#Svc p=- static o= h= @app/use.ts:3:40
        E passes function:app/use.ts#h->parameter:app/svc.ts#Svc.v p=email static o=field:features/user/user.ts#userData.user h= @app/use.ts:3:40
        E returns function:app/svc.ts#Svc->return:app/svc.ts#Svc#return p=email static o=field:features/user/user.ts#userData.user h= @app/svc.ts:1:1
        E passes return:app/svc.ts#Svc#return->function:app/use.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/use.ts:3:40
        E side-effect function:app/use.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/use.ts:3:31"
      `)
    })

    it("a variable nothing initialised is filled in through a named or namespace import, whichever module is read first", async () => {
      expect(
        await many({
          "app/w.ts": lib(
            `import { slot } from "./store.js"\nimport * as ns from "./store.js"\nexport function put() { slot.a = ${u}.email; ns.other.b = ${u}.name }\n`,
          ),
          "app/store.ts": `export let slot: any\nexport let other: any\n`,
          "app/r.ts": `import { slot, other } from "./store.js"\nexport function get(res: any) { res.json(slot.a); res.json(other.b) }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:33
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:51"
      `)
      expect(
        await many({
          "app/store.ts": `export let slot: any\nexport let other: any\n`,
          "app/r.ts": `import { slot, other } from "./store.js"\nexport function get(res: any) { res.json(slot.a); res.json(other.b) }\n`,
          "app/w.ts": lib(
            `import { slot } from "./store.js"\nimport * as ns from "./store.js"\nexport function put() { slot.a = ${u}.email; ns.other.b = ${u}.name }\n`,
          ),
        }),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:33
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:51"
      `)
    })

    it("a namespace import of something that is not an exported variable stores nothing there", async () => {
      expect(
        await many({
          "app/w.ts": lib(
            `import * as ns from "./store.js"\nexport function put() { (ns as any).fn.x = ${u}.email; (ns as any).missing.y = ${u}.name }\n`,
          ),
          "app/store.ts": `export function fn() {}\n`,
        }),
      ).toMatchInlineSnapshot(`""`)
    })
  })

  describe("what an assignment does and does not reach", () => {
    it("reassigning a parameter does not write into the caller's object, but filling it in does", async () => {
      expect(
        await run(
          `  const a: any = {}\n  const b: any = {}\n  rebind(a)\n  fill(b)\n  res.json(a)\n  res.json(b)`,
          `function rebind(o: any) { o = ${u}.email }\nfunction fill(o: any) { o.x = ${u}.name }`,
        ),
      ).toMatchInlineSnapshot(`
        "E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
        E calls function:app/p.ts#h->function:app/p.ts#rebind p=- static o= h= @app/p.ts:6:3
        E calls function:app/p.ts#h->function:app/p.ts#fill p=- static o= h= @app/p.ts:7:3
        E passes return:app/p.ts#fill#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3"
      `)
    })

    it("__proto__ at the end of a longer chain sets the prototype of what the chain names, not a property of it", async () => {
      expect(
        await run(
          `  const o: any = { a: { b: {} } }\n  const alias = o.a.b\n  o.a.b.__proto__ = { inherited: ${u}.email }\n  res.json(o.a.b.inherited)\n  res.json(alias.b)\n  res.json(o.a.b.b)`,
        ),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"`,
      )
    })

    it("a store under a computed key somewhere in the chain is reported and shares nothing", async () => {
      expect(
        await run(
          `  const k: string = String(Math.random())\n  const o: any = { a: {} }\n  const alias = o.a\n  o.a[k].x = ${u}.email\n  res.json(alias.x)`,
        ),
      ).toMatchInlineSnapshot(
        `"U dynamic-access app/p.ts:6:3 subject=function:app/p.ts#h detail=computed property key on a store of tracked data data=field:features/user/user.ts#userData.user/email"`,
      )
    })

    it("a value nothing in a generator reads is discarded by it", async () => {
      const result = await h.scan(
        handler(`  const it = idle()\n  it.next(${u}.email)`, `function* idle() { yield 1 }`),
      )
      expect(dump(result.input).filter((line) => /discard|idle/.test(line))).toMatchInlineSnapshot(`
        [
          "N function app/p.ts idle static bk= cl= src=2:1",
          "N parameter app/p.ts idle.arg0 static bk= cl= src=",
          "N return app/p.ts idle#return static bk= cl= src=",
          "E calls function:app/p.ts#h->function:app/p.ts#idle p=- static o= h= @app/p.ts:3:14",
          "E passes function:app/p.ts#h->parameter:app/p.ts#idle.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @",
        ]
      `)
    })

    it("an array of one plain element is not a copy and raises nothing", async () => {
      expect(await run(`  const a = [${u}.email]\n  res.json(a)`)).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"`,
      )
    })
  })

  describe("module top-level code that reaches into a module not yet started, writer first in file order", () => {
    const lib = (extra: string) => `import { userData } from "../features/user/user.js";\n${extra}`
    const many = async (files: Record<string, string>) =>
      facts((await h.scan(files)).input).join("\n")

    it("a store, a namespace store and a prototype written at the top of one module survive the other module starting later", async () => {
      expect(
        await many({
          "app/aa-w.ts": lib(
            `import { slot, box } from "./store.js"\nimport * as ns from "./store.js"\nimport { Svc } from "./svc.js"\nslot.a = ${u}.email\nns.other.b = ${u}.name\n;(Svc as any).prototype.out = function (this: any) { console.log(this.v) }\n`,
          ),
          "app/store.ts": `export let slot: any = null\nexport let other: any = null\nexport let box: any = null\n`,
          "app/svc.ts": `export function Svc(this: any, v: any) { this.v = v }\n`,
          "app/r.ts": `import { slot, other } from "./store.js"\nimport { Svc } from "./svc.js"\nexport function get(res: any) { res.json(slot.a); res.json(other.b); new (Svc as any)(1).out() }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:3:33
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/r.ts:3:51
        E calls function:app/r.ts#get->function:app/svc.ts#Svc p=- static o= h= @app/r.ts:3:70
        E calls function:app/r.ts#get->function:app/aa-w.ts#<module>>anonymous@7:31 p=- static o= h= @app/r.ts:3:70"
      `)
    })

    it("a module that reads a function another module has already given a prototype sees it", async () => {
      expect(
        await many({
          "app/aa-w.ts": lib(
            `import { Svc } from "./svc.js"\n;(Svc as any).prototype.out = function (this: any) { console.log(this.v) }\nnew (Svc as any)(${u}.email).out()\n`,
          ),
          "app/svc.ts": `export function Svc(this: any, v: any) { this.v = v }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "E calls function:app/aa-w.ts#<module>->function:app/svc.ts#Svc p=- static o= h= @app/aa-w.ts:4:1
        E passes function:app/aa-w.ts#<module>->parameter:app/svc.ts#Svc.v p=email static o=field:features/user/user.ts#userData.user h= @app/aa-w.ts:4:1
        E returns function:app/svc.ts#Svc->return:app/svc.ts#Svc#return p=email static o=field:features/user/user.ts#userData.user h= @app/svc.ts:1:1
        E calls function:app/aa-w.ts#<module>->function:app/aa-w.ts#<module>>anonymous@3:31 p=- static o= h= @app/aa-w.ts:4:1
        E passes return:app/svc.ts#Svc#return->function:app/aa-w.ts#<module> p=email static o=field:features/user/user.ts#userData.user h= @app/aa-w.ts:4:1
        E passes function:app/aa-w.ts#<module>->parameter:app/aa-w.ts#<module>>anonymous@3:31.this p=email static o=field:features/user/user.ts#userData.user h= @app/aa-w.ts:4:1
        E side-effect function:app/aa-w.ts#<module>>anonymous@3:31->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/aa-w.ts:3:54"
      `)
    })

    it("a class and a function a module rebinds are still what was exported", async () => {
      expect(
        await many({
          "app/lib.ts": `export class Box { v: any; constructor(v: any) { this.v = v } }\n;(Box as any) = class Other {}\n`,
          "app/use.ts": lib(
            `import { Box } from "./lib.js"\nexport function h(res: any) { res.json(new Box(${u}.email).v) }\n`,
          ),
        }),
      ).toMatchInlineSnapshot(`
        "E calls function:app/use.ts#h->function:app/lib.ts#Box.constructor p=- static o= h= @app/use.ts:3:40
        E passes function:app/use.ts#h->parameter:app/lib.ts#Box.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/use.ts:3:40
        E returns function:app/lib.ts#Box.constructor->return:app/lib.ts#Box.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:28
        E passes return:app/lib.ts#Box.constructor#return->function:app/use.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/use.ts:3:40
        E side-effect function:app/use.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/use.ts:3:31"
      `)
    })
  })

  describe("more of what an assignment reaches", () => {
    it("storing under an import's other name reaches the module that exports it", async () => {
      const files = {
        "app/store.ts": `export let slot: any\nexport function Fn() {}\nexport class Cls {}\n`,
        "app/w.ts": `import { userData } from "../features/user/user.js";\nimport { slot as mine, Fn as F, Cls as C } from "./store.js"\nimport * as ns from "./store.js"\nexport function put() { mine.a = ${u}.email; (F as any).b = ${u}.name; (C as any).c = ${u}.role; ns.slot.d = ${u}.id }\n`,
        "app/r.ts": `import { slot as theirs, Fn as G, Cls as D } from "./store.js"\nexport function get(res: any) { res.json(theirs.a); res.json((G as any).b); res.json((D as any).c); res.json(theirs.d) }\n`,
      }
      expect(facts((await h.scan(files)).input).join("\n")).toMatchInlineSnapshot(`
        "E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:33
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:53
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:77
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:101"
      `)
    })

    it("pointing __proto__ at something does not write back through the parameter it is set on", async () => {
      expect(
        await run(
          `  const a: any = {}\n  setProto(a)\n  res.json(a.inherited)`,
          `function setProto(o: any) { o.__proto__ = { inherited: ${u}.email } }`,
        ),
      ).toMatchInlineSnapshot(
        `"E calls function:app/p.ts#h->function:app/p.ts#setProto p=- static o= h= @app/p.ts:4:3"`,
      )
    })

    it("an array of a spread and another element is not a copy of the spread", async () => {
      expect(
        await copies(
          `  const once = [...[${u}.email]]\n  const more = [...once, 1]\n  res.json(more)`,
        ),
      ).toMatchInlineSnapshot(`[]`)
    })
  })

  describe("what a store reaches, and what a copy keeps apart", () => {
    const lib = (extra: string) => `import { userData } from "../features/user/user.js";\n${extra}`
    const many = async (files: Record<string, string>) =>
      facts((await h.scan(files)).input).join("\n")

    it("a property stored on the second of two functions, an arrow, or an unnamed class is kept under the right owner", async () => {
      expect(
        await many({
          "app/aa-w.ts": lib(
            `import { First, Second, arrow } from "./lib.js"\nimport Anon from "./anon.js"\nexport function put() { (Second as any).token = ${u}.email; (arrow as any).p = ${u}.name; (Anon as any).q = ${u}.role }\n`,
          ),
          "app/lib.ts": `export function First() {}\nexport function Second() {}\nexport const arrow = (v: any) => v\n`,
          "app/anon.ts": `export default class {}\n`,
          "app/r.ts": `import { First, Second, arrow } from "./lib.js"\nimport Anon from "./anon.js"\nexport function get(res: any) { res.json((First as any).token); res.json((Second as any).token); res.json((arrow as any).p); res.json((Anon as any).q) }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:3:65
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/r.ts:3:98
        E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/r.ts:3:126"
      `)
    })

    it("a store under a local name that hides a namespace import stays local", async () => {
      expect(
        await many({
          "app/aa-w.ts": lib(
            `import * as ns from "./store.js"\nexport function put() { const ns: any = { box: {} }; ns.box.v = ${u}.email }\n`,
          ),
          "app/store.ts": `export let box: any = {}\n`,
          "app/r.ts": `import { box } from "./store.js"\nexport function get(res: any) { res.json(box.v) }\n`,
        }),
      ).toMatchInlineSnapshot(`""`)
    })

    it("only the first name after a namespace is looked up, and a computed key through it is not reported", async () => {
      expect(
        await many({
          "app/aa-w.ts": lib(
            `import * as ns from "./store.js"\nexport function put(k: string) { (ns as any).fn.other.x = ${u}.email; (ns as any).box[k].y = ${u}.name }\n`,
          ),
          "app/store.ts": `export function fn() {}\nexport let other: any = {}\nexport let box: any = {}\n`,
          "app/r.ts": `import { other } from "./store.js"\nexport function get(res: any) { res.json(other.x) }\n`,
        }),
      ).toMatchInlineSnapshot(
        `"U dynamic-access app/aa-w.ts:3:101 subject=function:app/aa-w.ts#put detail=computed property key on a store of tracked data data=field:features/user/user.ts#userData.user/name"`,
      )
    })

    it("a computed key does not store into the objects the key might name", async () => {
      expect(
        await run(
          `  const k: string = String(Math.random())\n  const o: any = { a: { p: {} } }\n  o.a[k].x = ${u}.email\n  res.json(o.a.p.x)`,
        ),
      ).toMatchInlineSnapshot(
        `"U dynamic-access app/p.ts:5:3 subject=function:app/p.ts#h detail=computed property key on a store of tracked data data=field:features/user/user.ts#userData.user/email"`,
      )
    })

    it("a copy of a value that is a copy only in some branches is not marked as a copy of a copy", async () => {
      expect(
        await copies(
          `  const a = { ...${u} }\n  const plain = { ...${u}, extra: 1 }\n  const mixed = Math.random() > 0.5 ? { ...a } : plain\n  const c = { ...mixed }\n  res.json(c)`,
        ),
      ).toMatchInlineSnapshot(`
        [
          [
            "round-trip",
            "copied",
            [
              "(whole)",
            ],
          ],
        ]
      `)
    })

    it("a deep copy keeps its nested objects apart from each other, from the original and from another copy", async () => {
      expect(
        await run(
          `  const a: any = { n1: {}, n2: {} }\n  const c1 = JSON.parse(JSON.stringify(a))\n  const c2 = JSON.parse(JSON.stringify(a))\n  c1.n1.x = ${u}.email\n  res.json(c1.n2.x)\n  res.json(c2.n1.x)\n  res.json(a.n1.x)\n  res.json(c1.n1.x)`,
        ),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3"`,
      )
    })

    it("tracked data stored into an object of unknown origin is reported, and two such objects are not one", async () => {
      expect(
        await run(
          `  const a: any = make()\n  const b: any = make()\n  a.x = ${u}.email\n  res.json(b.x)\n  const c: any = JSON.parse(JSON.stringify(make()))\n  c.y = ${u}.name`,
          `import { make } from "some-lib"`,
        ),
      ).toMatchInlineSnapshot(
        `"U unsupported-construct app/p.ts:5:3 subject=function:app/p.ts#h detail=tracked data stored into an object whose origin the analysis cannot see data=field:features/user/user.ts#userData.user/email"`,
      )
    })

    it("a name bound to nothing, or to an empty pattern, is not an unused derivation", async () => {
      expect(
        await copies(
          `  const {} = ${u}.email.toUpperCase()\n  const [] = ${u}.name.toUpperCase()\n  res.json(1)`,
        ),
      ).toMatchInlineSnapshot(`[]`)
    })
  })

  describe("setters and destructuring targets", () => {
    it("a computed key never runs a setter, a missing setter stores, and the instance of a class is found for its setter", async () => {
      expect(
        await run(
          `  const k: string = String(Math.random())\n  const o = new Cell()\n  o[k as "w"] = ${u}.email\n  o.plain = ${u}.name\n  res.json(o.plain)`,
          `class Cell { plain: any; set w(x: any) { console.log(x) } }`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#h->function:app/p.ts#Cell.constructor p=- static o= h= @app/p.ts:4:13
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        U dynamic-access app/p.ts:5:3 subject=function:app/p.ts#h detail=computed property key on a store of tracked data data=field:features/user/user.ts#userData.user/email"
      `)
    })

    it("a setter that is not a project function stores like a property", async () => {
      expect(
        await run(
          `  const o: any = Object.defineProperty({}, "v", { set: external })\n  o.v = ${u}.email\n  res.json(o.v)`,
          `import { external } from "some-lib"`,
        ),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"`,
      )
    })

    it("an object rest target takes what is left of the whole", async () => {
      expect(
        await run(
          `  let a: any, rest: any\n  ;({ email: a, ...rest } = ${u})\n  res.json(rest.name)\n  res.json(a)`,
        ),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
      `)
    })

    it("only an assignment inside a pattern is a default; any other operator is not", async () => {
      expect(
        await run(
          `  let a: any\n  let b: any\n  ;[a = 1] = [${u}.email]\n  ;[b || 0] = [${u}.name]\n  res.json(a)\n  res.json(b)`,
        ),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"`,
      )
    })
  })

  describe("the last details of stores, setters and generators", () => {
    const many = async (files: Record<string, string>) =>
      facts((await h.scan(files)).input).join("\n")
    const lib = (extra: string) => `import { userData } from "../features/user/user.js";\n${extra}`

    it("a whole object sent into a generator that reads only part of it discards the rest", async () => {
      const result = await h.scan(
        handler(
          `  const it = g(res)\n  it.next()\n  it.next(${u})`,
          `function* g(res: any) { const got = yield 1; res.json(got.email) }`,
        ),
      )
      expect(dump(result.input).filter((line) => line.startsWith("E discards function:app/p.ts#g")))
        .toMatchInlineSnapshot(`
        [
          "E discards function:app/p.ts#g->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#g->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#g->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#g->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @",
        ]
      `)
    })

    it("a property stored on a default-exported function with no name is kept", async () => {
      expect(
        await many({
          "app/aa-w.ts": lib(
            `import Anon from "./anon.js"\nexport function put() { (Anon as any).q = ${u}.email }\n`,
          ),
          "app/anon.ts": `export default function () {}\n`,
          "app/r.ts": `import Anon from "./anon.js"\nexport function get(res: any) { res.json((Anon as any).q) }\n`,
        }),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:33"`,
      )
    })

    it("a store on a longer chain is shared only into the object it names", async () => {
      expect(
        await run(
          `  const o: any = { a: {} }\n  const alias = o.a\n  o.a.b = ${u}.email\n  res.json(alias.a)\n  res.json(alias.b)`,
        ),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"`,
      )
    })

    it("a deep copy keeps an object of unknown origin unknown, so a store into it is reported", async () => {
      expect(
        await run(
          `  const o: any = { inner: make() }\n  const c = JSON.parse(JSON.stringify(o))\n  c.inner.x = ${u}.email`,
          `import { make } from "some-lib"`,
        ),
      ).toMatchInlineSnapshot(
        `"U unsupported-construct app/p.ts:5:3 subject=function:app/p.ts#h detail=tracked data stored into an object whose origin the analysis cannot see data=field:features/user/user.ts#userData.user/email"`,
      )
    })

    it("a setter inherited from a class the project cannot read is not run", async () => {
      expect(
        await run(
          `  const c: any = new Child()\n  c.w = ${u}.email\n  res.json(c.w)`,
          `import { Base } from "some-lib"\nclass Child extends Base {}`,
        ),
      ).toMatchInlineSnapshot(`
        "E calls function:app/p.ts#h->function:app/p.ts#Child.constructor p=- static o= h= @app/p.ts:4:18
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        U unsupported-construct app/p.ts:5:3 subject=function:app/p.ts#h detail=tracked data stored into an object whose origin the analysis cannot see data=field:features/user/user.ts#userData.user/email"
      `)
    })

    it("a method written where a destructuring target should be is ignored", async () => {
      expect(
        await run(`  ;({ m() {} } = ${u} as any)\n  res.json(${u}.name)`),
      ).toMatchInlineSnapshot(
        `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"`,
      )
    })

    it("a computed key after a namespace's first name does not reach another export", async () => {
      expect(
        await many({
          "app/aa-w.ts": lib(
            `import * as ns from "./store.js"\nexport function put() { (ns as any).fn.other.x = ${u}.email }\n`,
          ),
          "app/store.ts": `export function fn() {}\nexport let other: any = {}\n`,
          "app/r.ts": `import { other } from "./store.js"\nexport function get(res: any) { res.json(other.x) }\n`,
        }),
      ).toMatchInlineSnapshot(`""`)
    })
  })

  describe("a store through a namespace import is only that", () => {
    const lib = (extra: string) => `import { userData } from "../features/user/user.js";\n${extra}`
    const many = async (files: Record<string, string>) =>
      facts((await h.scan(files)).input).join("\n")

    it("is not also a store under the namespace's own name, reported as computed or as shared", async () => {
      expect(
        await many({
          "app/aa-w.ts": lib(
            `import * as ns from "./store.js"\nexport function put(k: string) { const same = ns; (ns as any).box[k].y = ${u}.email; (ns as any).box.z = ${u}.name; void same }\n`,
          ),
          "app/store.ts": `export let box: any = {}\n`,
          "app/r.ts": `import { box } from "./store.js"\nexport function get(res: any) { res.json(box.z) }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "E side-effect function:app/r.ts#get->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/r.ts:2:33
        U dynamic-access app/aa-w.ts:3:51 subject=function:app/aa-w.ts#put detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/email,field:features/user/user.ts#userData.user/name"
      `)
    })
  })
})
