import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { facts, handler as baseHandler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"
import { defaultScanLimits } from "../../src/build/flow-scan.js"
import { IMPORT_CAP, edgeLine } from "./mut-flow-scan-harness.js"

/** `handler` glues its extra code straight onto `export function h`, so a declaration needs its newline. */
const handler = (body: string, extra = ""): Record<string, string> =>
  baseHandler(body, extra === "" || extra.endsWith("\n") ? extra : `${extra}\n`)

/**
 * Cases that pin down what the scan does with module state, CommonJS, ambient and exported classes, the rounds of the analysis
 * and the rest of what a program can do. Each is a small program and the exact facts it must produce; a case where two forms
 * look alike pairs them so a mix-up changes the output.
 */
describe("flow-scan: module state and exports", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  const run = async (body: string, extra = "", more: Record<string, string> = {}) =>
    facts((await h.scan({ ...handler(body, extra), ...more })).input).join("\n")

  it("a function analyzed first sees what a later one stores in an undeclared global", async () => {
    expect(
      await run(
        `  reader(res)`,
        `export function reader(res: any) { res.json(leaked) }\nexport function writer() { leaked = ${u}.email }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:5:3
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:36"
    `)
  })

  it("a function analyzed first sees what a later one stores in a variable of the module", async () => {
    expect(
      await run(
        `  reader(res)`,
        `let state: any\nexport function reader(res: any) { res.json(state) }\nexport function writer() { state = ${u}.name }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:6:3
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:36"
    `)
  })

  it("CommonJS exports and module.exports hold what the module writes to them", async () => {
    expect(
      await run(
        `  reader(res)`,
        `exports.a = ${u}.email\nmodule.exports.b = ${u}.name\nexport function reader(res: any) { res.json(exports.a); res.json(module.exports.b) }`,
      ),
    ).toMatchInlineSnapshot(`
      "E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:57
      E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:6:3"
    `)
  })

  it("a capability imported by a file is bound for the module's own statements", async () => {
    expect(await run(`  res.json(snap.email)`, `const snap: any = ${u}`)).toMatchInlineSnapshot(
      `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"`,
    )
  })

  it("a call on an ambient class is code the scan cannot see", async () => {
    expect(
      await run(
        `  res.json(Ext.make(${u}.email))`,
        `declare class Ext { static make(x: any): any }`,
      ),
    ).toMatchInlineSnapshot(`
      "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      U unresolved-call app/p.ts:4:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("export * from a package outside the project adds nothing, and does not break an import of the file", async () => {
    expect(
      await run(`  res.json(lib.pick(${u}.email))`, `import * as lib from "./barrel"`, {
        "app/barrel.ts": `export * from "lodash"\nexport * as lo from "lodash"\nexport const pick = (x: any) => x`,
      }),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/barrel.ts#pick p=- static o= h= @app/p.ts:4:12
      E passes function:app/p.ts#h->parameter:app/barrel.ts#pick.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
      E returns function:app/barrel.ts#pick->return:app/barrel.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/barrel.ts:3:33
      E passes return:app/barrel.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
    `)
  })

  it("export default of a name hands the importer that name's function", async () => {
    expect(
      await run(`  target(res, ${u}.email)`, `import target from "./lib"`, {
        "app/lib.ts": `const target = (res: any, x: any) => res.json(x)\nexport default target`,
      }),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/lib.ts#target p=- static o= h= @app/p.ts:4:3
      E passes function:app/p.ts#h->parameter:app/lib.ts#target.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/lib.ts#target->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:38"
    `)
  })
})

describe("flow-scan: which function a method call runs", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  const run = async (body: string, extra = "", more: Record<string, string> = {}) =>
    facts((await h.scan({ ...handler(body, extra), ...more })).input).join("\n")

  it("an instance method runs on an instance, a static one on the class, and neither answers to the other", async () => {
    expect(
      await run(
        `  res.json(new Svc().inst(${u}.email)); res.json(Svc.stat(${u}.name)); res.json(Svc.inst(${u}.id)); res.json(new Svc().stat(${u}.id))`,
        `class Svc { inst(x: any) { return x } static stat(x: any) { return x } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Svc.constructor p=- static o= h= @app/p.ts:4:12
      E calls function:app/p.ts#h->function:app/p.ts#Svc.inst p=- static o= h= @app/p.ts:4:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Svc.inst.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
      E returns function:app/p.ts#Svc.inst->return:app/p.ts#Svc.inst#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:28
      E passes return:app/p.ts#Svc.inst#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E calls function:app/p.ts#h->function:app/p.ts#Svc.stat p=- static o= h= @app/p.ts:4:80
      E passes function:app/p.ts#h->parameter:app/p.ts#Svc.stat.x p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:80
      E returns function:app/p.ts#Svc.stat->return:app/p.ts#Svc.stat#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:61
      E passes return:app/p.ts#Svc.stat#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:71
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:71
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:132
      U unresolved-call app/p.ts:4:141 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
      U unresolved-call app/p.ts:4:200 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
    `)
  })

  it("a method stored on the prototype from outside the class body is still the class's method", async () => {
    expect(
      await run(
        `  res.json(new Svc().viaProto(${u}.email)); res.json(new Svc().viaAssign(${u}.name)); res.json(new Svc().missing(${u}.id))`,
        `class Svc {}\nSvc.prototype.viaProto = (x: any) => x\nObject.assign(Svc.prototype, { viaAssign: (x: any) => x })`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Svc.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@3:26 p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@3:26.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#<module>>anonymous@3:26->return:app/p.ts#<module>>anonymous@3:26#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:38
      E passes return:app/p.ts#<module>>anonymous@3:26#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@4:43 p=- static o= h= @app/p.ts:6:84
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@4:43.x p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:84
      E returns function:app/p.ts#<module>>anonymous@4:43->return:app/p.ts#<module>>anonymous@4:43#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:55
      E passes return:app/p.ts#<module>>anonymous@4:43#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:75
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:75
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:147
      U unresolved-call app/p.ts:6:156 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
    `)
  })

  it("a prototype method of a superclass is found from a subclass", async () => {
    expect(
      await run(
        `  res.json(new Sub().viaProto(${u}.email))`,
        `class Base {}\nBase.prototype.viaProto = (x: any) => x\nclass Sub extends Base {}`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:4:1
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@3:27.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
    `)
  })

  it("a method of the class wins over the same name stored on its prototype", async () => {
    expect(
      await run(
        `  res.json(new Svc().m(${u}.email))`,
        `class Svc { m(x: any) { return 'own' } }\nSvc.prototype.m = (x: any) => x`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Svc.constructor p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#h->function:app/p.ts#Svc.m p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Svc.m.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12"
    `)
  })

  it("super.method runs the superclass's method, static for static and instance for instance", async () => {
    expect(
      await run(
        `  res.json(new Sub().m(${u}.email)); res.json(Sub.s(${u}.name))`,
        `class Base { m(x: any) { return x } static s(x: any) { return x } }\nclass Sub extends Base { m(x: any) { return super.m(x) } static s(x: any) { return super.s(x) } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E calls function:app/p.ts#Sub.m->function:app/p.ts#Base.m p=- static o= h= @app/p.ts:3:45
      E passes function:app/p.ts#Sub.m->parameter:app/p.ts#Base.m.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:45
      E returns function:app/p.ts#Base.m->return:app/p.ts#Base.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:26
      E passes return:app/p.ts#Base.m#return->function:app/p.ts#Sub.m p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:38
      E returns function:app/p.ts#Sub.m->return:app/p.ts#Sub.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:38
      E passes return:app/p.ts#Sub.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E calls function:app/p.ts#h->function:app/p.ts#Sub.s p=- static o= h= @app/p.ts:5:77
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.s.x p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:77
      E calls function:app/p.ts#Sub.s->function:app/p.ts#Base.s p=- static o= h= @app/p.ts:3:84
      E passes function:app/p.ts#Sub.s->parameter:app/p.ts#Base.s.x p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:84
      E returns function:app/p.ts#Base.s->return:app/p.ts#Base.s#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:56
      E passes return:app/p.ts#Base.s#return->function:app/p.ts#Sub.s p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:77
      E returns function:app/p.ts#Sub.s->return:app/p.ts#Sub.s#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:77
      E passes return:app/p.ts#Sub.s#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:68
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:68"
    `)
  })

  it("super.method with no superclass, or one that has no such method, is code the scan cannot see", async () => {
    expect(
      await run(
        `  res.json(new A().m(${u}.email)); res.json(new B().m(${u}.name))`,
        `class A { m(x: any) { return super.m(x) } }\nclass Base {}\nclass B extends Base { m(x: any) { return super.m(x) } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#A.m p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.m.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#A.m->return:app/p.ts#A.m#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:2:23
      E passes return:app/p.ts#A.m#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:75
      E calls function:app/p.ts#B.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:4:1
      E calls function:app/p.ts#h->function:app/p.ts#B.m p=- static o= h= @app/p.ts:6:75
      E passes function:app/p.ts#h->parameter:app/p.ts#B.m.x p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:75
      E returns function:app/p.ts#B.m->return:app/p.ts#B.m#return p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36
      E passes return:app/p.ts#B.m#return->function:app/p.ts#h p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:66
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:66
      U unresolved-call app/p.ts:2:30 subject=function:app/p.ts#A.m detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:4:43 subject=function:app/p.ts#B.m detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
    `)
  })

  it("super.method in an object literal, or on a parent the scan cannot see, is code it cannot see", async () => {
    expect(
      await run(
        `  res.json(o.m(${u}.email)); res.json(new Sub().m(${u}.name))`,
        `declare class Ext { m(x: any): any }\nconst o: any = { m(x: any) { return super.m(x) } }\nclass Sub extends Ext { m(x: any) { return super.m(x) } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#<module>>m@3:18 p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>m@3:18.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#<module>>m@3:18->return:app/p.ts#<module>>m@3:18#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:30
      E passes return:app/p.ts#<module>>m@3:18#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:69
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m p=- static o= h= @app/p.ts:6:69
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m.x p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:69
      E returns function:app/p.ts#Sub.m->return:app/p.ts#Sub.m#return p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
      E passes return:app/p.ts#Sub.m#return->function:app/p.ts#h p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:60
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:60
      U unresolved-call app/p.ts:3:37 subject=function:app/p.ts#<module>>m@3:18 detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:4:44 subject=function:app/p.ts#Sub.m detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
    `)
  })

  it("super.method through a parent whose own parent the scan cannot see is code it cannot see", async () => {
    expect(
      await run(
        `  res.json(new Sub().m(${u}.email))`,
        `declare class Ext { m(x: any): any }\nclass Base extends Ext {}\nclass Sub extends Base { m(x: any) { return super.m(x) } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:4:1
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#Sub.m->return:app/p.ts#Sub.m#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:38
      E passes return:app/p.ts#Sub.m#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      U unresolved-call app/p.ts:4:45 subject=function:app/p.ts#Sub.m detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("what the instance holds is handed to a super call the scan cannot follow", async () => {
    expect(
      await run(
        `  res.json(new Sub().m())`,
        `declare class Ext { m(): any }\nclass Sub extends Ext { v: any; constructor() { super(); this.v = ${u}.email } m() { return super.m() } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:5:12
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:33
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m p=- static o= h= @app/p.ts:5:12
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#Sub.m->return:app/p.ts#Sub.m#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:116
      E returns function:app/p.ts#Sub.m->return:app/p.ts#Sub.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:116
      E passes return:app/p.ts#Sub.m#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes return:app/p.ts#Sub.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unsupported-construct app/p.ts:3:58 subject=function:app/p.ts#Sub.constructor detail=tracked data stored into an object whose origin the analysis cannot see data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:3:123 subject=function:app/p.ts#Sub.m detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("super.method runs on this instance, and what the subclass stored on it is what the parent's method sees", async () => {
    expect(
      await run(
        `  res.json(new Sub().m())`,
        `class Base { v: any; m() { return this.v } }\nclass Sub extends Base { constructor() { super(); this.v = ${u}.email } m() { return super.m() } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:42
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:26
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m p=- static o= h= @app/p.ts:5:12
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E calls function:app/p.ts#Sub.m->function:app/p.ts#Base.m p=- static o= h= @app/p.ts:3:116
      E passes function:app/p.ts#Sub.m->parameter:app/p.ts#Base.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:116
      E returns function:app/p.ts#Base.m->return:app/p.ts#Base.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:28
      E passes return:app/p.ts#Base.m#return->function:app/p.ts#Sub.m p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:109
      E returns function:app/p.ts#Sub.m->return:app/p.ts#Sub.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:109
      E passes return:app/p.ts#Sub.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("super.method on a class that extends something the scan cannot see is code it cannot see", async () => {
    expect(
      await run(
        `  res.json(new C().m(${u}.email))`,
        `import { Ext } from "lodash"\nclass C extends (Ext as any) { m(x: any) { return super.m(x) } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:44
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:3:51 subject=function:app/p.ts#C.m detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("super.method runs with this of the instance, and one outside any class is unresolved", async () => {
    expect(
      await run(
        `  res.json(new Sub().m2()); res.json(o.m(${u}.id))`,
        `class Base { m() { return this.v } }\nclass Sub extends Base { v = ${u}.email; m2() { return super.m() } }\nconst o: any = { m(x: any) { return super.m(x) } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m2 p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m2.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.m2->function:app/p.ts#Base.m p=- static o= h= @app/p.ts:3:86
      E passes function:app/p.ts#Sub.m2->parameter:app/p.ts#Base.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:86
      E returns function:app/p.ts#Base.m->return:app/p.ts#Base.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:20
      E passes return:app/p.ts#Base.m#return->function:app/p.ts#Sub.m2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:79
      E returns function:app/p.ts#Sub.m2->return:app/p.ts#Sub.m2#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:79
      E passes return:app/p.ts#Sub.m2#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E calls function:app/p.ts#h->function:app/p.ts#<module>>m@4:18 p=- static o= h= @app/p.ts:6:38
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>m@4:18.x p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:38
      E returns function:app/p.ts#<module>>m@4:18->return:app/p.ts#<module>>m@4:18#return p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:30
      E passes return:app/p.ts#<module>>m@4:18#return->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:29
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:29
      U unresolved-call app/p.ts:4:37 subject=function:app/p.ts#<module>>m@4:18 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
    `)
  })

  it("super.method that finds nothing still hands back the data of this", async () => {
    expect(
      await run(
        `  res.json(new B().m())`,
        `class Base {}\nclass B extends Base { v = ${u}.email; m() { return super.nope() } }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#B.m p=- static o= h= @app/p.ts:5:12
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#B.m->return:app/p.ts#B.m#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:76
      E returns function:app/p.ts#B.m->return:app/p.ts#B.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:76
      E passes return:app/p.ts#B.m#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes return:app/p.ts#B.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:3:83 subject=function:app/p.ts#B.m detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("a function stored under a property name is what a call on that property runs", async () => {
    expect(
      await run(
        `  res.json(o.f(${u}.email)); res.json(o.g(${u}.name))`,
        `const o: any = { f: (x: any) => x }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@2:21 p=- static o= h= @app/p.ts:4:12
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@2:21.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
      E returns function:app/p.ts#<module>>anonymous@2:21->return:app/p.ts#<module>>anonymous@2:21#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:33
      E passes return:app/p.ts#<module>>anonymous@2:21#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:60
      U unresolved-call app/p.ts:4:69 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
    `)
  })

  it("fn.call(this, x) runs fn with x, and a method named call on something else does not", async () => {
    expect(
      await run(
        `  res.json(target.call(null, ${u}.email)); res.json(other.call(${u}.name))`,
        `const target = (x: any) => x\nconst other: any = { call: (x: any) => x }`,
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#target p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#target.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#target->return:app/p.ts#target#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:28
      E passes return:app/p.ts#target#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@3:28 p=- static o= h= @app/p.ts:5:83
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@3:28.x p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:83
      E returns function:app/p.ts#<module>>anonymous@3:28->return:app/p.ts#<module>>anonymous@3:28#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:40
      E passes return:app/p.ts#<module>>anonymous@3:28#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:74
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:74"
    `)
  })

  it("a call on a namespace import reaches the module's export, or the package's declared summary", async () => {
    expect(
      await run(
        `  res.json(lib.pick(${u}.email)); res.json(lib.nope(${u}.name)); res.json(lo.pick(${u}.id))`,
        `import * as lib from "./lib"\nimport * as lo from "lodash"`,
        { "app/lib.ts": `export const pick = (x: any) => x` },
      ),
    ).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.x p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:65
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:126
      U unresolved-call app/p.ts:5:74 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name
      U unresolved-call app/p.ts:5:135 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
    `)
  })
})

describe("flow-scan: calls on the built-in objects", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  const defs = `const reviver = (k: string, v: any) => v\nconst replacer = (k: string, v: any) => v\nconst wrap = (v: any) => v\nconst Other: any = { entries: (v: any) => v, stringify: (v: any) => v }\nconst entries = (v: any) => v\nconst make = (): any => ({})`
  /** Each statement is scanned as a program of its own, since two sites with the same fact would be one edge. */
  const each = async (statements: readonly string[]): Promise<string> => {
    const out: string[] = []
    for (const statement of statements) {
      const body = `  const x: any = ${u}\n  ${statement}`
      const { input } = await h.scan(handler(body, defs))
      const tags = (input.edgeTags ?? []).map(
        (tag) =>
          `T ${tag.via}${tag.fresh === true ? " fresh" : ""} @${tag.source.line}:${tag.source.column}`,
      )
      out.push(`-- ${statement}`, ...facts(input), ...tags)
    }
    return out.join("\n")
  }

  it("JSON.parse(JSON.stringify(x)) is a copy, and only that exact pair is", async () => {
    expect(
      await each([
        "res.json(JSON.parse(JSON.stringify(x)))",
        "res.json(JSON.parse(JSON.stringify(x), reviver))",
        "res.json(JSON.parse(JSON.stringify(x, replacer)))",
        "res.json(JSON.parse(JSON.stringify(x), reviver, 1))",
        "res.json(JSON.parse(wrap(x)))",
        "res.json(JSON.parse(Other.stringify(x)))",
        "res.json(JSON.parse(JSON.other(x)))",
        "res.json(JSON.parse(a.JSON.stringify(x)))",
        "res.json(JSON.parse())",
        "res.json(JSON.parse(JSON.stringify()))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- res.json(JSON.parse(JSON.stringify(x)))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      T serialize-roundtrip @10:12
      -- res.json(JSON.parse(JSON.stringify(x), reviver))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(JSON.parse(JSON.stringify(x, replacer)))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(JSON.parse(JSON.stringify(x), reviver, 1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(JSON.parse(wrap(x)))
      E calls function:app/p.ts#h->function:app/p.ts#wrap p=- static o= h= @app/p.ts:10:23
      E passes function:app/p.ts#h->parameter:app/p.ts#wrap.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:23
      E returns function:app/p.ts#wrap->return:app/p.ts#wrap#return p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:26
      E passes return:app/p.ts#wrap#return->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(JSON.parse(Other.stringify(x)))
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@5:57 p=- static o= h= @app/p.ts:10:23
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@5:57.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:23
      E returns function:app/p.ts#<module>>anonymous@5:57->return:app/p.ts#<module>>anonymous@5:57#return p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:69
      E passes return:app/p.ts#<module>>anonymous@5:57#return->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(JSON.parse(JSON.other(x)))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(JSON.parse(a.JSON.stringify(x)))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      U unresolved-call app/p.ts:10:23 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- res.json(JSON.parse())
      T derive @9:9
      -- res.json(JSON.parse(JSON.stringify()))
      T derive @9:9"
    `)
  })

  it("Object.values and Object.entries give the elements of an array, Object.keys does not", async () => {
    expect(
      await each([
        "for (const v of Object.values(x)) res.json(v)",
        "for (const [k, v] of Object.entries(x)) res.json(v)",
        "for (const [k, v] of Object.entries(x)) res.json(k)",
        "for (const k of Object.keys(x)) res.json(k)",
        "res.json(Object.values(x)[0])",
        "res.json(Object.entries(x)[0])",
        "res.json(Object.entries(x)[0][1])",
        "res.json(Object.entries(x)[0][0])",
        "res.json(Object.values(x)[0].email)",
        "res.json(Object.entries(x)[0][1].email)",
        "res.json(Math.max(x.a, x.b))",
        "res.json(Array.of(JSON.stringify(x)))",
        "res.json(Number.parseInt(x))",
        "res.json(Date.parse(x))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- for (const v of Object.values(x)) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:37
      -- for (const [k, v] of Object.entries(x)) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:43
      -- for (const [k, v] of Object.entries(x)) res.json(k)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:43
      -- for (const k of Object.keys(x)) res.json(k)
      -- res.json(Object.values(x)[0])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.entries(x)[0])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.entries(x)[0][1])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.entries(x)[0][0])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.values(x)[0].email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.entries(x)[0][1].email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Math.max(x.a, x.b))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=a inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=b inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Array.of(JSON.stringify(x)))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Number.parseInt(x))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Date.parse(x))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3"
    `)
  })

  it("Object.fromEntries(Object.entries(x)) puts x back as it was, and any other pair does not", async () => {
    expect(
      await each([
        "res.json(Object.fromEntries(Object.entries(x)))",
        "res.json(Object.fromEntries(Object.entries(x), 1))",
        "res.json(Object.fromEntries(Object.entries(x, 1)))",
        "res.json(Object.fromEntries(Object.values(x)))",
        "res.json(Object.fromEntries(Other.entries(x)))",
        "res.json(Object.fromEntries(entries(x)))",
        "res.json(Object.fromEntries(x))",
        "res.json(Object.fromEntries())",
      ]),
    ).toMatchInlineSnapshot(`
      "-- res.json(Object.fromEntries(Object.entries(x)))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      T serialize-roundtrip @10:12
      -- res.json(Object.fromEntries(Object.entries(x), 1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.fromEntries(Object.entries(x, 1)))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.fromEntries(Object.values(x)))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.fromEntries(Other.entries(x)))
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@5:31 p=- static o= h= @app/p.ts:10:31
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@5:31.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:31
      E returns function:app/p.ts#<module>>anonymous@5:31->return:app/p.ts#<module>>anonymous@5:31#return p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:43
      E passes return:app/p.ts#<module>>anonymous@5:31#return->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.fromEntries(entries(x)))
      E calls function:app/p.ts#h->function:app/p.ts#entries p=- static o= h= @app/p.ts:10:31
      E passes function:app/p.ts#h->parameter:app/p.ts#entries.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:31
      E returns function:app/p.ts#entries->return:app/p.ts#entries#return p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:29
      E passes return:app/p.ts#entries#return->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.fromEntries(x))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      -- res.json(Object.fromEntries())
      T derive @9:9"
    `)
  })

  it("Array.from(x) copies the elements of x, and with a map function it is not just a copy", async () => {
    expect(await each(["res.json(Array.from(x))", "res.json(Array.from(x, (v: any) => v))"]))
      .toMatchInlineSnapshot(`
        "-- res.json(Array.from(x))
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        T copy @10:12
        -- res.json(Array.from(x, (v: any) => v))
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3"
      `)
  })

  it("Promise.reject holds its argument as a rejection, and Promise.resolve as a value", async () => {
    expect(
      await each([
        "Promise.reject(x).catch((e: any) => res.json(e))",
        "Promise.reject(x).then((v: any) => res.json(v))",
        "Promise.resolve(x).then((v: any) => res.json(v))",
        "Promise.resolve(x).catch((e: any) => res.json(e))",
        "Promise.other(x)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- Promise.reject(x).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@10:27 p=- static o= h= @app/p.ts:10:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@10:27.e p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#h>anonymous@10:27->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:39
      -- Promise.reject(x).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@10:26 p=- static o= h= @app/p.ts:10:3
      -- Promise.resolve(x).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@10:27 p=- static o= h= @app/p.ts:10:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@10:27.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#h>anonymous@10:27->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:39
      -- Promise.resolve(x).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@10:28 p=- static o= h= @app/p.ts:10:3
      -- Promise.other(x)"
    `)
  })

  it("Object.assign, setPrototypeOf and defineProperty store into their first argument, and Object.keys does not", async () => {
    expect(
      await each([
        "const t: any = {}; Object.assign(t, { a: x.email }); res.json(t.a)",
        "const t: any = {}; Object.setPrototypeOf(t, x); res.json(t.a)",
        'const t: any = {}; Object.defineProperty(t, "b", { value: x.name }); res.json(t.b)',
        "const t: any = {}; Object.defineProperties(t, { d: { value: x.email } }); res.json(t.d)",
        "const t: any = {}; Object.keys(t, x.id); res.json(t.c)",
        "const t: any = {}; Object.freeze(t, x.id); res.json(t.c)",
        "Object.assign()",
        "Object.defineProperty()",
        "Object.assign({}, x)",
        "Object.assign([], x)",
        "Object.assign(make(), x)",
        'Object.defineProperty(make(), "e", { value: x.id })',
        "Object.assign(res.locals, x)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const t: any = {}; Object.assign(t, { a: x.email }); res.json(t.a)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:56
      -- const t: any = {}; Object.setPrototypeOf(t, x); res.json(t.a)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=a static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:51
      -- const t: any = {}; Object.defineProperty(t, "b", { value: x.name }); res.json(t.b)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name.b inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:72
      -- const t: any = {}; Object.defineProperties(t, { d: { value: x.email } }); res.json(t.d)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.d inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:77
      -- const t: any = {}; Object.keys(t, x.id); res.json(t.c)
      -- const t: any = {}; Object.freeze(t, x.id); res.json(t.c)
      -- Object.assign()
      T derive @9:9
      -- Object.defineProperty()
      T derive @9:9
      -- Object.assign({}, x)
      -- Object.assign([], x)
      -- Object.assign(make(), x)
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:10:17
      E returns function:app/p.ts#make->return:app/p.ts#make#return p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:25
      U unsupported-construct app/p.ts:10:3 subject=function:app/p.ts#h detail=assignment target is not a variable data=field:features/user/user.ts#userData.user/
      -- Object.defineProperty(make(), "e", { value: x.id })
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:10:25
      U unsupported-construct app/p.ts:10:3 subject=function:app/p.ts#h detail=assignment target is not a variable data=field:features/user/user.ts#userData.user/id
      -- Object.assign(res.locals, x)
      E returns function:app/p.ts#h->return:app/p.ts#h#return p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:1
      U unsupported-construct app/p.ts:10:17 subject=function:app/p.ts#h detail=tracked data stored on an object the caller owns data=field:features/user/user.ts#userData.user/"
    `)
  })
})

describe("flow-scan: bind, container fills and generator next", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  const defs = [
    `const f = (a: any, b: any) => res0.json(a)`,
    `const res0: any = { json: (v: any) => v }`,
    `function* gen(): any { const got = yield 1; sink(got); yield 2 }`,
    `const sink = (v: any) => v`,
    `const make = (): any[] => []`,
    `const keep = (v: any) => v`,
    `const o: any = { cb: (v: any) => v }`,
    `const list: any[] = [(v: any) => v]`,
    `const pick = () => (v: any) => v`,
    `const a = (v: any) => v`,
    `const b = (v: any) => v`,
  ].join("\n")
  /** Each statement is scanned as a program of its own, since two sites with the same fact would be one edge. */
  const each = async (statements: readonly string[]): Promise<string> => {
    const out: string[] = []
    for (const statement of statements) {
      const body = `  const x: any = ${u}\n  ${statement}`
      const { input } = await h.scan(handler(body, defs))
      out.push(`-- ${statement}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("bind fixes the arguments and the this of a function, and binding again adds to them", async () => {
    expect(
      await each([
        "const g = f.bind(null, x.email); g(1)",
        "const g = f.bind(null).bind(null, x.name); g(1)",
        "const g = f.bind(null, x.email).bind(null, x.name); g(1)",
        "const o = { v: x.email, m() { return this.v } }; res.json(o.m.bind(o)())",
        "const j = res.json.bind(res); j(x.email)",
        "const g = res.json.bind(res).bind(res); g(x.name)",
        "const g = unknownFn.bind(null, x.email)",
        "const g = f.bind(); g(x.email)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const g = f.bind(null, x.email); g(1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:36
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:36
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- const g = f.bind(null).bind(null, x.name); g(1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:46
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:46
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- const g = f.bind(null, x.email).bind(null, x.name); g(1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:55
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:55
      E passes function:app/p.ts#h->parameter:app/p.ts#f.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:55
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- const o = { v: x.email, m() { return this.v } }; res.json(o.m.bind(o)())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>m@15:27 p=- static o= h= @app/p.ts:15:61
      E passes function:app/p.ts#h->parameter:app/p.ts#h>m@15:27.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:61
      E returns function:app/p.ts#h>m@15:27->return:app/p.ts#h>m@15:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:33
      E passes return:app/p.ts#h>m@15:27#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:52
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:52
      -- const j = res.json.bind(res); j(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:33 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- const g = res.json.bind(res).bind(res); g(x.name)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:43 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name
      -- const g = unknownFn.bind(null, x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:13 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- const g = f.bind(); g(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:23
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:23
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31"
    `)
  })

  it("push, unshift, splice and fill store into an array, and only into one a later read can find", async () => {
    expect(
      await each([
        "const a: any[] = []; a.push(x.email); res.json(a[0])",
        "const a: any[] = []; a.unshift(x.email); res.json(a[0])",
        "const a: any[] = []; a.splice(0, 0, x.email); res.json(a[0])",
        "const a: any[] = [1]; a.fill(x.email); res.json(a[0])",
        "make().push(x.email)",
        "const a: any[] = []; const b = a; a.push(x.email); res.json(b[0])",
        "const a: any[] = []; res.json(a.push(x.email))",
        "const a: any[] = []; res.json(a.unshift(x.email))",
        "const a: any[] = []; res.json(a.splice(0, 0, x.email))",
        "const a: any[] = [1]; res.json(a.fill(x.name))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const a: any[] = []; a.push(x.email); res.json(a[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:41
      -- const a: any[] = []; a.unshift(x.email); res.json(a[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:44
      -- const a: any[] = []; a.splice(0, 0, x.email); res.json(a[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:49
      -- const a: any[] = [1]; a.fill(x.email); res.json(a[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:42
      -- make().push(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:15:3
      E returns function:app/p.ts#make->return:app/p.ts#make#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:27
      U unresolved-call app/p.ts:15:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- const a: any[] = []; const b = a; a.push(x.email); res.json(b[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:54
      -- const a: any[] = []; res.json(a.push(x.email))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      -- const a: any[] = []; res.json(a.unshift(x.email))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      -- const a: any[] = []; res.json(a.splice(0, 0, x.email))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:24
      -- const a: any[] = [1]; res.json(a.fill(x.name))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:25"
    `)
  })

  it("array methods are told apart by what they hand back", async () => {
    expect(
      await each([
        "res.json([x.email].includes(1))",
        "res.json([x.email].slice())",
        "res.json([x.email].concat([x.name]))",
        "res.json([x.email].map((v: any) => v))",
        "res.json([x.email].reverse())",
        "res.json([x.email].unknownThing())",
      ]),
    ).toMatchInlineSnapshot(`
      "-- res.json([x.email].includes(1))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      -- res.json([x.email].slice())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].concat([x.name]))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].map((v: any) => v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:26 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:26.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:26->return:app/p.ts#h>anonymous@15:26#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:38
      E passes return:app/p.ts#h>anonymous@15:26#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].reverse())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].unknownThing())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("bind of the same function twice makes two functions, and a bound this alone still carries", async () => {
    expect(
      await each([
        "const g1 = f.bind(null, x.email); const g2 = f.bind(null, x.name); g1(1); g2(1)",
        "const g = f.bind(undefined, x.email); g(1)",
        "const o = { v: x.email }; const g = f.bind(o); g(1)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const g1 = f.bind(null, x.email); const g2 = f.bind(null, x.name); g1(1); g2(1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:70
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:70
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:77
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- const g = f.bind(undefined, x.email); g(1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:41
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:41
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- const o = { v: x.email }; const g = f.bind(o); g(1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:50
      E passes function:app/p.ts#h->parameter:app/p.ts#f.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:50"
    `)
  })

  it("a push into an array another name may hold, or into a parameter, is followed or flagged", async () => {
    expect(
      await each([
        "const a: any[] = []; const b = [a]; a.push(x.email); res.json(b[0][0])",
        "const a: any[] = []; keep(a); a.push(x.email)",
        "const a: any = { list: [] }; const l = a.list; a.list.push(x.email); res.json(l[0])",
        "const fill = (arr: any[], v: any) => { arr.push(v) }; const a: any[] = []; fill(a, x.email); res.json(a[0])",
        "const fill = (arr: any[], v: any) => { arr.push(v) }; const a: any[] = []; fill(a, 1); res.json(a[0])",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const a: any[] = []; const b = [a]; a.push(x.email); res.json(b[0][0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:56
      -- const a: any[] = []; keep(a); a.push(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#keep p=- static o= h= @app/p.ts:15:24
      -- const a: any = { list: [] }; const l = a.list; a.list.push(x.email); res.json(l[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:72
      -- const fill = (arr: any[], v: any) => { arr.push(v) }; const a: any[] = []; fill(a, x.email); res.json(a[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:16 p=- static o= h= @app/p.ts:15:78
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:16.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:78
      E returns function:app/p.ts#h>anonymous@15:16->return:app/p.ts#h>anonymous@15:16#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:16
      E passes return:app/p.ts#h>anonymous@15:16#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:105
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:96
      -- const fill = (arr: any[], v: any) => { arr.push(v) }; const a: any[] = []; fill(a, 1); res.json(a[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:16 p=- static o= h= @app/p.ts:15:78"
    `)
  })

  it("then, catch and finally each hand the callbacks the settled value or the rejection", async () => {
    expect(
      await each([
        "Promise.resolve(x.email).then((v: any) => res.json(v))",
        "Promise.reject(x.email).then((v: any) => res.json(v), (e: any) => res.json(e))",
        "Promise.reject(x.email).then((v: any) => res.json(v)).catch((e: any) => res.json(e))",
        "Promise.reject(x.email).finally(() => 1).catch((e: any) => res.json(e))",
        "Promise.resolve(x.email).finally((v: any) => res.json(v))",
        "Promise.resolve(x.email).catch((e: any) => e).then((v: any) => res.json(v))",
        "Promise.resolve(x.email).then((v: any) => x.name).then((v: any) => res.json(v))",
        "Promise.resolve(x.email).then((v: any) => v).catch((e: any) => res.json(e))",
        "Promise.resolve(x.email).then(undefined, (e: any) => res.json(e))",
        "Promise.resolve(x.email).then().then((v: any) => res.json(v))",
        "Promise.resolve(x.email).catch((e: any) => 1).then((v: any) => res.json(v))",
        "Promise.reject(x.name).catch((e: any) => 1).then((v: any) => res.json(v))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- Promise.resolve(x.email).then((v: any) => res.json(v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:33 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:33.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:33->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:45
      -- Promise.reject(x.email).then((v: any) => res.json(v), (e: any) => res.json(e))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:32 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:57 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:57.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:57->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:69
      -- Promise.reject(x.email).then((v: any) => res.json(v)).catch((e: any) => res.json(e))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:32 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:63 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:63.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:63->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:75
      -- Promise.reject(x.email).finally(() => 1).catch((e: any) => res.json(e))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:35 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:50 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:50.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:50->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:62
      -- Promise.resolve(x.email).finally((v: any) => res.json(v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:36 p=- static o= h= @app/p.ts:15:3
      -- Promise.resolve(x.email).catch((e: any) => e).then((v: any) => res.json(v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:34 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:54 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:54.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:54->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:66
      -- Promise.resolve(x.email).then((v: any) => x.name).then((v: any) => res.json(v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:33 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:33.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E returns function:app/p.ts#h>anonymous@15:33->return:app/p.ts#h>anonymous@15:33#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:58 p=- static o= h= @app/p.ts:15:3
      E passes return:app/p.ts#h>anonymous@15:33#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:58.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:58->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:70
      -- Promise.resolve(x.email).then((v: any) => v).catch((e: any) => res.json(e))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:33 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:33.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E returns function:app/p.ts#h>anonymous@15:33->return:app/p.ts#h>anonymous@15:33#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:54 p=- static o= h= @app/p.ts:15:3
      -- Promise.resolve(x.email).then(undefined, (e: any) => res.json(e))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:44 p=- static o= h= @app/p.ts:15:3
      -- Promise.resolve(x.email).then().then((v: any) => res.json(v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:40 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:40.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:40->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:52
      -- Promise.resolve(x.email).catch((e: any) => 1).then((v: any) => res.json(v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:34 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:54 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:54.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:54->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:66
      -- Promise.reject(x.name).catch((e: any) => 1).then((v: any) => res.json(v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:32 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:32.e p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:52 p=- static o= h= @app/p.ts:15:3"
    `)
  })

  it("array callbacks run with an element, and find, findLast and at give one element back", async () => {
    expect(
      await each([
        "res.json([x.email, x.name].find((v: any) => v))",
        "res.json([x.email].findLast((v: any) => v))",
        "res.json([x.email].at(0))",
        "res.json([x.email].filter((v: any) => v))",
        "res.json([x.email].some((v: any) => v))",
        "res.json([x.email].reduce((acc: any, v: any) => v, x.name))",
        "res.json([x.email].map((v: any) => x.name))",
        "res.json([x.email].flatMap((v: any) => [v]))",
        "[x.email].forEach((v: any) => res.json(v))",
        "res.json([x.email].map(unknownCb))",
        "res.json([x.email].map(Boolean))",
        "res.json([x.email].map(o.cb))",
        "res.json([x.email].map(flag ? a : b))",
        "res.json([x.email].map(a || b))",
        "res.json([x.email].map(pick()))",
        "res.json([x.email].map(list[0]))",
        "res.json([x.email].map())",
        "res.json([x.email].sort())",
        "res.json([x.email].filter())",
      ]),
    ).toMatchInlineSnapshot(`
      "-- res.json([x.email, x.name].find((v: any) => v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:35 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:35.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:35.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:35->return:app/p.ts#h>anonymous@15:35#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:47
      E returns function:app/p.ts#h>anonymous@15:35->return:app/p.ts#h>anonymous@15:35#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:47
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].findLast((v: any) => v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:31 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:31.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:31->return:app/p.ts#h>anonymous@15:31#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:43
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].at(0))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].filter((v: any) => v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:29 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:29.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:29->return:app/p.ts#h>anonymous@15:29#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:41
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].some((v: any) => v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:27 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:27->return:app/p.ts#h>anonymous@15:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:39
      -- res.json([x.email].reduce((acc: any, v: any) => v, x.name))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:29 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:29.acc p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:29.acc p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:29.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:29->return:app/p.ts#h>anonymous@15:29#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:51
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes return:app/p.ts#h>anonymous@15:29#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].map((v: any) => x.name))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:26 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:26.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:26->return:app/p.ts#h>anonymous@15:26#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:38
      E passes return:app/p.ts#h>anonymous@15:26#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].flatMap((v: any) => [v]))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:30 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:30.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:30->return:app/p.ts#h>anonymous@15:30#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:42
      E passes return:app/p.ts#h>anonymous@15:30#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- [x.email].forEach((v: any) => res.json(v))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:21 p=- static o= h= @app/p.ts:14:18
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:21.v p=[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:14:18
      E side-effect function:app/p.ts#h>anonymous@15:21->boundary:boundary:code#http-response p=[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:33
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- res.json([x.email].map(unknownCb))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json([x.email].map(Boolean))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json([x.email].map(o.cb))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@8:22 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@8:22.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#<module>>anonymous@8:22->return:app/p.ts#<module>>anonymous@8:22#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:34
      E passes return:app/p.ts#<module>>anonymous@8:22#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].map(flag ? a : b))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json([x.email].map(a || b))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json([x.email].map(pick()))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#pick p=- static o= h= @app/p.ts:15:26
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json([x.email].map(list[0]))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json([x.email].map())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json([x.email].sort())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].filter())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3"
    `)
  })

  it("call and apply run a project function with this and the arguments given", async () => {
    expect(
      await each([
        "f.call(null, x.email)",
        "f.apply(null, [x.email])",
        "f.apply(null, [x.email, x.name])",
        "f.call()",
        "f.apply(null)",
        "function Base(this: any, v: any) { this.v = v }; const o: any = {}; Base.call(o, x.email); res.json(o.v)",
        "function Base(this: any, v: any) { this.v = v }; const o: any = {}; Base.apply(o, [x.email]); res.json(o.v)",
        "res.json.call(res, x.email)",
        "const j = res.json.bind(res); j.call(null, x.email)",
        "unknownFn.call(null, x.email)",
        "(flag ? f : f).call(null, x.email)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- f.call(null, x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- f.apply(null, [x.email])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f.b p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- f.apply(null, [x.email, x.name])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f.b p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E passes function:app/p.ts#f->parameter:app/p.ts#<module>>anonymous@3:27.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#f p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#f->return:app/p.ts#f#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- f.call()
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:3
      -- f.apply(null)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:15:3
      -- function Base(this: any, v: any) { this.v = v }; const o: any = {}; Base.call(o, x.email); res.json(o.v)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>Base@15:3 p=- static o= h= @app/p.ts:15:71
      E passes function:app/p.ts#h->parameter:app/p.ts#h>Base@15:3.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:71
      E returns function:app/p.ts#h>Base@15:3->return:app/p.ts#h>Base@15:3#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes return:app/p.ts#h>Base@15:3#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:103
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:94
      -- function Base(this: any, v: any) { this.v = v }; const o: any = {}; Base.apply(o, [x.email]); res.json(o.v)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>Base@15:3 p=- static o= h= @app/p.ts:15:71
      E passes function:app/p.ts#h->parameter:app/p.ts#h>Base@15:3.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:71
      E returns function:app/p.ts#h>Base@15:3->return:app/p.ts#h>Base@15:3#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E passes return:app/p.ts#h>Base@15:3#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:106
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:97
      -- res.json.call(res, x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- const j = res.json.bind(res); j.call(null, x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:33 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- unknownFn.call(null, x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- (flag ? f : f).call(null, x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:14:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/,field:features/user/user.ts#userData.team/,field:features/user/user.ts#userData.tags/,field:features/user/user.ts#userData.empty/"
    `)
  })

  it("a rejection is handled by the first catch and is gone for the next", async () => {
    expect(
      await each([
        "Promise.reject(x.email).catch((e: any) => 1).catch((e2: any) => res.json(e2))",
        "Promise.reject(x.email).then((v: any) => 1).catch((e2: any) => res.json(e2))",
        "Promise.reject(x.email).then((v: any) => 1).then((v: any) => 2).catch((e2: any) => res.json(e2))",
        "Promise.reject(x.email).finally(() => 1).then((v: any) => 1).catch((e2: any) => res.json(e2))",
        "Promise.reject(x.email).then((v: any) => 1, (e: any) => 2).catch((e2: any) => res.json(e2))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- Promise.reject(x.email).catch((e: any) => 1).catch((e2: any) => res.json(e2))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:33 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:33.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:54 p=- static o= h= @app/p.ts:15:3
      -- Promise.reject(x.email).then((v: any) => 1).catch((e2: any) => res.json(e2))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:32 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:53 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:53.e2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:53->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:66
      -- Promise.reject(x.email).then((v: any) => 1).then((v: any) => 2).catch((e2: any) => res.json(e2))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:32 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:52 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:73 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:73.e2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:73->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:86
      -- Promise.reject(x.email).finally(() => 1).then((v: any) => 1).catch((e2: any) => res.json(e2))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:35 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:49 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:70 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:70.e2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:70->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:83
      -- Promise.reject(x.email).then((v: any) => 1, (e: any) => 2).catch((e2: any) => res.json(e2))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:32 p=- static o= h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:47 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:47.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:68 p=- static o= h= @app/p.ts:15:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:68.e2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      E side-effect function:app/p.ts#h>anonymous@15:68->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:81"
    `)
  })

  it("next on an iterator of the project's array sends nothing a generator could take", async () => {
    expect(
      await each([
        "const it = [x.email][Symbol.iterator](); it.next(1)",
        "const it = [x.email][Symbol.iterator](); it.next(x.name)",
        "const it = [x.email][Symbol.iterator](); it.next()",
        "res.json([x.email].next(1))",
        "res.json([x.email].next(x.name))",
        "res.json([x.email].next())",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const it = [x.email][Symbol.iterator](); it.next(1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:15:14 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/email
      -- const it = [x.email][Symbol.iterator](); it.next(x.name)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:15:14 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:15:44 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name
      -- const it = [x.email][Symbol.iterator](); it.next()
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:15:14 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/email
      -- res.json([x.email].next(1))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([x.email].next(x.name))
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      U unresolved-call app/p.ts:15:12 subject=function:app/p.ts#h detail=value sent into a generator is not followed data=field:features/user/user.ts#userData.user/name
      -- res.json([x.email].next())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3"
    `)
  })

  it("find, findLast and at give one element, filter and the rest give the array", async () => {
    expect(
      await each([
        "res.json([{ a: x.email }].find((v: any) => v).a)",
        "res.json([{ a: x.email }].findLast((v: any) => v).a)",
        "res.json([{ a: x.email }].at(0).a)",
        "res.json([{ a: x.email }].filter((v: any) => v).a)",
        "res.json([{ a: x.email }].slice().a)",
        "res.json([{ a: x.email }].find().a)",
        "res.json([{ a: x.email }].findLast().a)",
        "res.json([{ a: x.email }].find((v: any) => v)[0])",
      ]),
    ).toMatchInlineSnapshot(`
      "-- res.json([{ a: x.email }].find((v: any) => v).a)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:34 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:34.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:34->return:app/p.ts#h>anonymous@15:34#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:46
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([{ a: x.email }].findLast((v: any) => v).a)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:38 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:38.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:38->return:app/p.ts#h>anonymous@15:38#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:50
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([{ a: x.email }].at(0).a)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([{ a: x.email }].filter((v: any) => v).a)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:36 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:36.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:36->return:app/p.ts#h>anonymous@15:36#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:48
      -- res.json([{ a: x.email }].slice().a)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      -- res.json([{ a: x.email }].find().a)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([{ a: x.email }].findLast().a)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
      -- res.json([{ a: x.email }].find((v: any) => v)[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:34 p=- static o= h= @app/p.ts:15:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:34.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:12
      E returns function:app/p.ts#h>anonymous@15:34->return:app/p.ts#h>anonymous@15:34#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:46"
    `)
  })

  it("a callback the scan cannot resolve is an unknown only when it could be a function", async () => {
    expect(
      await each([
        "[x.email].forEach(ext.cb)",
        "[x.email].forEach(ext[0])",
        "[x.email].forEach(extFn())",
        "[x.email].forEach(flag ? ext1 : ext2)",
        "[x.email].forEach(ext1 || ext2)",
        "[x.email].forEach(ext1)",
        "[x.email].forEach(5)",
        "[x.email].forEach('s')",
        "[x.email].forEach(Boolean)",
        "[x.email].forEach()",
        "[x.email].some(ext1)",
        "[x.email].some(5)",
        "[x.email].some(Boolean)",
        "[x.email].some()",
      ]),
    ).toMatchInlineSnapshot(`
      "-- [x.email].forEach(ext.cb)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      U unresolved-call app/p.ts:14:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach(ext[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      U unresolved-call app/p.ts:14:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach(extFn())
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      U unresolved-call app/p.ts:14:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach(flag ? ext1 : ext2)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      U unresolved-call app/p.ts:14:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach(ext1 || ext2)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      U unresolved-call app/p.ts:14:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach(ext1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      U unresolved-call app/p.ts:14:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach(5)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach('s')
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach(Boolean)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- [x.email].forEach()
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- [x.email].some(ext1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      U unresolved-call app/p.ts:14:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- [x.email].some(5)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- [x.email].some(Boolean)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- [x.email].some()
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:14:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/"
    `)
  })

  it("a store into a name another name holds is flagged, and so is one a function makes on its parameter", async () => {
    expect(
      await each([
        "const a: any[] = []; const b = a; b.push(x.email)",
        "const a: any[] = []; const [c] = [a]; c.push(x.email)",
        "const a: any[] = []; for (const e of [a]) e.push(x.email)",
        "const a: any[] = []; a.push(x.email)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const a: any[] = []; const b = a; b.push(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unsupported-construct app/p.ts:15:37 subject=function:app/p.ts#h detail=property stored into an object another name may share data=field:features/user/user.ts#userData.user/email
      -- const a: any[] = []; const [c] = [a]; c.push(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unsupported-construct app/p.ts:15:41 subject=function:app/p.ts#h detail=property stored into an object another name may share data=field:features/user/user.ts#userData.user/email
      -- const a: any[] = []; for (const e of [a]) e.push(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unsupported-construct app/p.ts:15:45 subject=function:app/p.ts#h detail=property stored into an object another name may share data=field:features/user/user.ts#userData.user/email
      -- const a: any[] = []; a.push(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45"
    `)
  })

  it("a function that stores tracked data into its own parameter hands that to its callers as an unknown", async () => {
    const scan = async (extra: string) =>
      facts((await h.scan(handler("  res.json(1)", extra))).input).join("\n")
    expect({
      pushed: await scan(`export function fill(arr: any[]) { arr.push(${u}.email) }`),
      assigned: await scan(`export function fill(arr: any) { arr.k = ${u}.email }`),
      untracked: await scan(`export function fill(arr: any[]) { arr.push(1) }`),
      local: await scan(`export function fill() { const arr: any[] = []; arr.push(${u}.email) }`),
    }).toMatchInlineSnapshot(`
      {
        "assigned": "E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      U unsupported-construct app/p.ts:2:34 subject=function:app/p.ts#fill detail=tracked data stored on an object the caller owns data=field:features/user/user.ts#userData.user/email",
        "local": "",
        "pushed": "E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      U unsupported-construct app/p.ts:2:36 subject=function:app/p.ts#fill detail=tracked data stored on an object the caller owns data=field:features/user/user.ts#userData.user/email",
        "untracked": "",
      }
    `)
  })

  it("call hands each parameter its own argument, and apply hands every parameter the elements of the array", async () => {
    expect(
      await each([
        "const g = (p: any, q: any) => { res.json(p); res.json(q) }; g.call(null, x.email, x.name)",
        "const g = (p: any, q: any) => { res.json(p); res.json(q) }; g.apply(null, [x.email, x.name])",
        "const g = (p: any) => res.json(p); g.apply(null, [x.email, x.name])",
        "const g = (p: any, q: any) => { res.json(p); res.json(q) }; g.apply(null, x.list)",
        "const g = (p: any) => res.json(p); g.call(null, x.email, x.name)",
        "const g = (p: any) => res.json(p); g.apply(null)",
        "function who(this: any) { res.json(this.v) }; who.call({ v: x.email })",
        "function who(this: any) { res.json(this.v) }; who.apply({ v: x.email })",
        "function who(this: any) { res.json(this.v) }; who.call()",
        "const fill = (arr: any[], v: any) => { arr.push(v) }; const a: any[] = []; fill.call(null, a, x.email); res.json(a[0])",
        "const fill = (arr: any[], v: any) => { arr.push(v) }; const a: any[] = []; fill.apply(null, [a, x.email]); res.json(a[0])",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const g = (p: any, q: any) => { res.json(p); res.json(q) }; g.call(null, x.email, x.name)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:13 p=- static o= h= @app/p.ts:15:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.q p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:63
      E side-effect function:app/p.ts#h>anonymous@15:13->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:35
      E side-effect function:app/p.ts#h>anonymous@15:13->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:48
      -- const g = (p: any, q: any) => { res.json(p); res.json(q) }; g.apply(null, [x.email, x.name])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:13 p=- static o= h= @app/p.ts:15:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.p p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.q p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.q p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:63
      E side-effect function:app/p.ts#h>anonymous@15:13->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:35
      E side-effect function:app/p.ts#h>anonymous@15:13->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:35
      -- const g = (p: any) => res.json(p); g.apply(null, [x.email, x.name])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:13 p=- static o= h= @app/p.ts:15:38
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:38
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.p p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:38
      E side-effect function:app/p.ts#h>anonymous@15:13->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:25
      E side-effect function:app/p.ts#h>anonymous@15:13->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:25
      -- const g = (p: any, q: any) => { res.json(p); res.json(q) }; g.apply(null, x.list)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:13 p=- static o= h= @app/p.ts:15:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.p p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.q p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:63
      E side-effect function:app/p.ts#h>anonymous@15:13->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:35
      -- const g = (p: any) => res.json(p); g.call(null, x.email, x.name)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:13 p=- static o= h= @app/p.ts:15:38
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:38
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:13.arg1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:38
      E side-effect function:app/p.ts#h>anonymous@15:13->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:25
      -- const g = (p: any) => res.json(p); g.apply(null)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:13 p=- static o= h= @app/p.ts:15:38
      -- function who(this: any) { res.json(this.v) }; who.call({ v: x.email })
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>who@15:3 p=- static o= h= @app/p.ts:15:49
      E passes function:app/p.ts#h->parameter:app/p.ts#h>who@15:3.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:49
      E side-effect function:app/p.ts#h>who@15:3->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:29
      -- function who(this: any) { res.json(this.v) }; who.apply({ v: x.email })
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>who@15:3 p=- static o= h= @app/p.ts:15:49
      E passes function:app/p.ts#h->parameter:app/p.ts#h>who@15:3.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:49
      E side-effect function:app/p.ts#h>who@15:3->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:29
      -- function who(this: any) { res.json(this.v) }; who.call()
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>who@15:3 p=- static o= h= @app/p.ts:15:49
      -- const fill = (arr: any[], v: any) => { arr.push(v) }; const a: any[] = []; fill.call(null, a, x.email); res.json(a[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:16 p=- static o= h= @app/p.ts:15:78
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:16.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:78
      E returns function:app/p.ts#h>anonymous@15:16->return:app/p.ts#h>anonymous@15:16#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:16
      E passes return:app/p.ts#h>anonymous@15:16#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:116
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:107
      -- const fill = (arr: any[], v: any) => { arr.push(v) }; const a: any[] = []; fill.apply(null, [a, x.email]); res.json(a[0])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@15:16 p=- static o= h= @app/p.ts:15:78
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:16.arr p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:78
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@15:16.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:78
      E returns function:app/p.ts#h>anonymous@15:16->return:app/p.ts#h>anonymous@15:16#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:16
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:110"
    `)
  })

  it("call on a capability itself, or on a method of it, is not a call of a project function", async () => {
    expect(
      await each([
        "res.call(null, x.email)",
        "res.json.call(res, x.email)",
        "res.json.apply(res, [x.email])",
        "userData.getSnapshot.call(userData)",
        "const s = userData.getSnapshot.call(userData); res.json(s.fields.user.email)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- res.call(null, x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json.call(res, x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json.apply(res, [x.email])
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- userData.getSnapshot.call(userData)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      -- const s = userData.getSnapshot.call(userData); res.json(s.fields.user.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:50"
    `)
  })

  it("generator.next sends to a generator of the project and hands out what it yielded", async () => {
    expect(
      await each([
        "const it = gen(); it.next(x.email); it.next(1)",
        "function* y(): any { yield x.name }\n  const it = y(); res.json(it.next().value)",
        "function* y(): any { yield x.name }\n  const it = y(); res.json(it.next().done)",
        "const it = [x.email][Symbol.iterator](); res.json(it.next().value)",
        "const it: any = unknownIterator; it.next(x.email)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const it = gen(); it.next(x.email); it.next(1)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#gen p=- static o= h= @app/p.ts:15:14
      E passes function:app/p.ts#h->parameter:app/p.ts#gen.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:21
      E passes function:app/p.ts#gen->parameter:app/p.ts#sink.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:45
      E returns function:app/p.ts#sink->return:app/p.ts#sink#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
      -- function* y(): any { yield x.name }
        const it = y(); res.json(it.next().value)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>y@15:3 p=- static o= h= @app/p.ts:16:14
      E returns function:app/p.ts#h>y@15:3->return:app/p.ts#h>y@15:3#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:24
      E passes return:app/p.ts#h>y@15:3#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:16:28
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:16:19
      -- function* y(): any { yield x.name }
        const it = y(); res.json(it.next().done)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      E calls function:app/p.ts#h->function:app/p.ts#h>y@15:3 p=- static o= h= @app/p.ts:16:14
      E returns function:app/p.ts#h>y@15:3->return:app/p.ts#h>y@15:3#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:24
      E passes return:app/p.ts#h>y@15:3#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:16:28
      -- const it = [x.email][Symbol.iterator](); res.json(it.next().value)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U dynamic-access app/p.ts:15:14 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/email
      -- const it: any = unknownIterator; it.next(x.email)
      E calls function:app/p.ts#f->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:31
      E calls function:app/p.ts#gen->function:app/p.ts#sink p=- static o= h= @app/p.ts:4:45
      U unresolved-call app/p.ts:15:36 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })
})

describe("flow-scan: decorators and declared package summaries", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** Each program is scanned on its own, with the class and decorators it names. */
  const each = async (
    cases: Readonly<
      Record<string, { body: string; extra: string; files?: Readonly<Record<string, string>> }>
    >,
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra, files = {} }] of Object.entries(cases)) {
      const { input } = await h.scan(
        { ...handler(`  const x: any = ${u}\n${body}`, extra), ...files },
        overrides,
      )
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("class decorators run last to first, and one that is not the project's makes the class opaque", async () => {
    expect(
      await each({
        order: {
          body: "  res.json(new C().m(x.email))",
          extra: `const first = (c: any) => c\nconst second = (c: any) => c\n@first\n@second\nclass C { m(v: any) { return v } }`,
        },
        opaque: {
          body: "  res.json(new C().m(x.email))",
          extra: `declare const external: any\n@external\nclass C { m(v: any) { return v } }`,
        },
        same: {
          body: "  res.json(new C().m(x.email))",
          extra: `const keep = (c: any) => c\n@keep\nclass C { m(v: any) { return v } }`,
        },
        swapped: {
          body: "  res.json(new C().m(x.email))",
          extra: `class Other { m(v: any) { return 'other' } }\nconst swap = (c: any) => Other\n@swap\nclass C { m(v: any) { return v } }`,
        },
        unnamed: {
          body: "  res.json(new (Unnamed as any)().m(x.email))",
          extra: `const swap = (c: any) => class { m(v: any) { return v } }\nconst Unnamed = (@swap class { m(v: any) { return 1 } })`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- order
      E calls function:app/p.ts#C.decorators->function:app/p.ts#second p=- static o= h= @app/p.ts:5:1
      E calls function:app/p.ts#C.decorators->function:app/p.ts#first p=- static o= h= @app/p.ts:4:1
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:9:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:9:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:12
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:23
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
      -- opaque
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:7:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- same
      E calls function:app/p.ts#C.decorators->function:app/p.ts#keep p=- static o= h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- swapped
      E calls function:app/p.ts#C.decorators->function:app/p.ts#swap p=- static o= h= @app/p.ts:4:1
      E calls function:app/p.ts#h->function:app/p.ts#Other.constructor p=- static o= h= @app/p.ts:8:12
      E calls function:app/p.ts#h->function:app/p.ts#Other.m p=- static o= h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Other.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      -- unnamed
      E calls function:app/p.ts#<module>>anonymous@3.decorators->function:app/p.ts#swap p=- static o= h= @app/p.ts:3:18
      E calls function:app/p.ts#h->function:app/p.ts#swap>anonymous@2.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#swap>anonymous@2.m p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#swap>anonymous@2.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#swap>anonymous@2.m->return:app/p.ts#swap>anonymous@2.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:46
      E passes return:app/p.ts#swap>anonymous@2.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
    `)
  })

  it("parameter, property and accessor decorators run as the language runs them", async () => {
    expect(
      await each({
        parameter: {
          body: "  new C().m(1)",
          extra: `const p = (t: any, k: any, i: any) => 1\nclass C { m(@p a: any) {} }`,
        },
        constructorParameter: {
          body: "  new C(1)",
          extra: `const p = (t: any, k: any, i: any) => 1\nclass C { constructor(@p a: any) {} }`,
        },
        property: {
          body: "  new C()",
          extra: `const p1 = (t: any, k: any) => 1\nconst p2 = (t: any, k: any) => 2\nclass C { @p1 @p2 v = 1 }`,
        },
        notAProperty: {
          body: "  new C().m()",
          extra: `const p = (t: any, k: any) => 1\nclass C { @p m() {} }`,
        },
        accessors: {
          body: "  res.json(new C().g); new C().s = x.email",
          extra: `const keep = (t: any, k: any, d: any) => d\nclass C { @keep get g() { return 1 } @keep set s(v: any) {} }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- parameter
      E calls function:app/p.ts#C.decorators->function:app/p.ts#p p=- static o= h= @app/p.ts:3:13
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:3
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:6:3
      -- constructorParameter
      E calls function:app/p.ts#C.decorators->function:app/p.ts#p p=- static o= h= @app/p.ts:3:23
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:3
      -- property
      E calls function:app/p.ts#C.decorators->function:app/p.ts#p2 p=- static o= h= @app/p.ts:4:15
      E calls function:app/p.ts#C.decorators->function:app/p.ts#p1 p=- static o= h= @app/p.ts:4:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:3
      -- notAProperty
      E calls function:app/p.ts#C.decorators->function:app/p.ts#p p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:3
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:6:3
      -- accessors
      E calls function:app/p.ts#C.decorators->function:app/p.ts#keep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#C.get g p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#C.set s p=- static o= h= @app/p.ts:6:24
      E passes function:app/p.ts#h->parameter:app/p.ts#C.set s.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:24"
    `)
  })

  it("a method decorator may replace the method, with a function or a descriptor, or hide it", async () => {
    expect(
      await each({
        returnsFunction: {
          body: "  res.json(new C().m(x.email))",
          extra: `const rep = (t: any, k: any, d: any) => (v: any) => v\nclass C { @rep m(v: any) { return 'own' } }`,
        },
        returnsDescriptor: {
          body: "  res.json(new C().m(x.email))",
          extra: `const rep = (t: any, k: any, d: any) => ({ value: (v: any) => v })\nclass C { @rep m(v: any) { return 'own' } }`,
        },
        sameDescriptor: {
          body: "  res.json(new C().m(x.email))",
          extra: `const keep = (t: any, k: any, d: any) => ({ value: t })\nclass C { @keep m(v: any) { return v } }`,
        },
        foreignDescriptor: {
          body: "  res.json(new C().m(x.email))",
          extra: `declare const foreign: any\nconst rep = (t: any, k: any, d: any) => ({ value: foreign })\nclass C { @rep m(v: any) { return v } }`,
        },
        returnsNothing: {
          body: "  res.json(new C().m(x.email))",
          extra: `const keep = (t: any, k: any, d: any) => undefined\nclass C { @keep m(v: any) { return v } }`,
        },
        notProject: {
          body: "  res.json(new C().m(x.email))",
          extra: `declare const ext: any\nclass C { @ext m(v: any) { return v } }`,
        },
        twoDecorators: {
          body: "  res.json(new C().m(x.email))",
          extra: `const a = (t: any, k: any, d: any) => (v: any) => v\nconst b = (t: any, k: any, d: any) => (v: any) => 'b'\nclass C { @a @b m(v: any) { return 'own' } }`,
        },
        staticMethod: {
          body: "  res.json(C.m(x.email))",
          extra: `const rep = (t: any, k: any, d: any) => (v: any) => v\nclass C { @rep static m(v: any) { return 'own' } }`,
        },
        computedName: {
          body: "  res.json(new C().m(x.email))",
          extra: `const rep = (t: any, k: any, d: any) => (v: any) => v\nconst key = Math.random() > 1 ? 'a' : 'b'\nclass C { @rep [key as any](v: any) { return 'own' } m(v: any) { return v } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- returnsFunction
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#rep>anonymous@2:41 p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#rep>anonymous@2:41.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#rep>anonymous@2:41->return:app/p.ts#rep>anonymous@2:41#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:53
      E passes return:app/p.ts#rep>anonymous@2:41#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- returnsDescriptor
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#rep>anonymous@2:51 p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#rep>anonymous@2:51.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#rep>anonymous@2:51->return:app/p.ts#rep>anonymous@2:51#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:63
      E passes return:app/p.ts#rep>anonymous@2:51#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- sameDescriptor
      E calls function:app/p.ts#C.decorators->function:app/p.ts#keep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- foreignDescriptor
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:4:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:7:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- returnsNothing
      E calls function:app/p.ts#C.decorators->function:app/p.ts#keep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- notProject
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      U unresolved-call app/p.ts:6:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- twoDecorators
      E calls function:app/p.ts#C.decorators->function:app/p.ts#b p=- static o= h= @app/p.ts:4:14
      E calls function:app/p.ts#C.decorators->function:app/p.ts#a p=- static o= h= @app/p.ts:4:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E calls function:app/p.ts#h->function:app/p.ts#a>anonymous@2:39 p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#a>anonymous@2:39.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#a>anonymous@2:39->return:app/p.ts#a>anonymous@2:39#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#a>anonymous@2:39#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- staticMethod
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#rep>anonymous@2:41 p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#rep>anonymous@2:41.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#rep>anonymous@2:41->return:app/p.ts#rep>anonymous@2:41#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:53
      E passes return:app/p.ts#rep>anonymous@2:41#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- computedName
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:66
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"
    `)
  })

  it("decorators that reach the class they decorate, or return what is not a class, leave it as it is", async () => {
    expect(
      await each({
        selfInstantiating: {
          body: "  res.json(new C().m(x.email)); res.json(new C().m(x.name))",
          extra: `const dec = (c: any) => { new c(); return c }\n@dec\nclass C { m(v: any) { return v } }`,
        },
        returnsNonClass: {
          body: "  res.json(new C().m(x.email))",
          extra: `const bad = (c: any) => 1\n@bad\nclass C { m(v: any) { return v } }`,
        },
        abstractMember: {
          body: "  res.json(new D().m(x.email))",
          extra: `const dec = (t: any, k: any, d: any) => d\nabstract class C { @dec abstract m(v: any): any }\nclass D extends C { m(v: any) { return v } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- selfInstantiating
      E calls function:app/p.ts#C.decorators->function:app/p.ts#dec p=- static o= h= @app/p.ts:3:1
      E calls function:app/p.ts#dec->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:2:27
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:42
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:33
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:33
      -- returnsNonClass
      E calls function:app/p.ts#C.decorators->function:app/p.ts#bad p=- static o= h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#C.m->return:app/p.ts#C.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes return:app/p.ts#C.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- abstractMember
      E calls function:app/p.ts#h->function:app/p.ts#D.constructor p=- static o= h= @app/p.ts:7:12
      E calls function:app/p.ts#D.constructor->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:4:1
      E calls function:app/p.ts#h->function:app/p.ts#D.m p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#D.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#D.m->return:app/p.ts#D.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      E passes return:app/p.ts#D.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"
    `)
  })

  it("an assignment in a decorator's arguments writes beyond the decorator's own scope", async () => {
    expect(
      await each({
        shared: {
          body: "  r(res)",
          extra: `let shared: any\nconst dec = (v: any) => (c: any) => c\n@dec(shared = ${u}.email)\nclass C {}\nexport function r(res: any) { res.json(shared) }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- shared
      E calls function:app/p.ts#C.decorators->function:app/p.ts#dec p=- static o= h= @app/p.ts:4:2
      E passes function:app/p.ts#C.decorators->parameter:app/p.ts#dec.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:2
      E calls function:app/p.ts#C.decorators->function:app/p.ts#dec>anonymous@3:25 p=- static o= h= @app/p.ts:4:1
      E side-effect function:app/p.ts#r->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:31
      E calls function:app/p.ts#h->function:app/p.ts#r p=- static o= h= @app/p.ts:9:3"
    `)
  })

  it("a getter and a setter can be replaced, and the replacement is what is called", async () => {
    expect(
      await each({
        getterByDescriptor: {
          body: "  res.json(new C().g)",
          extra: `const rep = (t: any, k: any, d: any) => ({ get: () => ${u}.email })\nclass C { @rep get g() { return 1 } }`,
        },
        getterByFunction: {
          body: "  res.json(new C().g)",
          extra: `const rep = (t: any, k: any, d: any) => () => ${u}.email\nclass C { @rep get g() { return 1 } }`,
        },
        setterByDescriptor: {
          body: "  new C().s = x.email",
          extra: `const rep = (t: any, k: any, d: any) => ({ set: (v: any) => res0.json(v) })\nconst res0: any = { json: (v: any) => v }\nclass C { @rep set s(v: any) {} }`,
        },
        setterByFunction: {
          body: "  new C().s = x.email",
          extra: `const rep = (t: any, k: any, d: any) => (v: any) => res0.json(v)\nconst res0: any = { json: (v: any) => v }\nclass C { @rep set s(v: any) {} }`,
        },
        methodDescriptorWithGetOnly: {
          body: "  res.json(new C().m(x.email))",
          extra: `const rep = (t: any, k: any, d: any) => ({ get: (v: any) => v })\nclass C { @rep m(v: any) { return 'own' } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- getterByDescriptor
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#rep>anonymous@2:49 p=- static o= h= @app/p.ts:6:12
      E returns function:app/p.ts#rep>anonymous@2:49->return:app/p.ts#rep>anonymous@2:49#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:55
      E passes return:app/p.ts#rep>anonymous@2:49#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- getterByFunction
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#rep>anonymous@2:41 p=- static o= h= @app/p.ts:6:12
      E returns function:app/p.ts#rep>anonymous@2:41->return:app/p.ts#rep>anonymous@2:41#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:47
      E passes return:app/p.ts#rep>anonymous@2:41#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- setterByDescriptor
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:4:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:3
      E calls function:app/p.ts#h->function:app/p.ts#rep>anonymous@2:49 p=- static o= h= @app/p.ts:7:3
      E passes function:app/p.ts#h->parameter:app/p.ts#rep>anonymous@2:49.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E calls function:app/p.ts#rep>anonymous@2:49->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:61
      E passes function:app/p.ts#rep>anonymous@2:49->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:61
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#rep>anonymous@2:49 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:61
      E returns function:app/p.ts#rep>anonymous@2:49->return:app/p.ts#rep>anonymous@2:49#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:61
      -- setterByFunction
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:4:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:3
      E calls function:app/p.ts#h->function:app/p.ts#rep>anonymous@2:41 p=- static o= h= @app/p.ts:7:3
      E passes function:app/p.ts#h->parameter:app/p.ts#rep>anonymous@2:41.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E calls function:app/p.ts#rep>anonymous@2:41->function:app/p.ts#<module>>anonymous@3:27 p=- static o= h= @app/p.ts:2:53
      E passes function:app/p.ts#rep>anonymous@2:41->parameter:app/p.ts#<module>>anonymous@3:27.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:53
      E returns function:app/p.ts#<module>>anonymous@3:27->return:app/p.ts#<module>>anonymous@3:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E passes return:app/p.ts#<module>>anonymous@3:27#return->function:app/p.ts#rep>anonymous@2:41 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:53
      E returns function:app/p.ts#rep>anonymous@2:41->return:app/p.ts#rep>anonymous@2:41#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:53
      -- methodDescriptorWithGetOnly
      E calls function:app/p.ts#C.decorators->function:app/p.ts#rep p=- static o= h= @app/p.ts:3:11
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#C.m p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12"
    `)
  })

  it("a function is exposed when the file exports it itself, and not when the export is another file's", async () => {
    expect(
      await each({
        exported: {
          body: "  use([])",
          extra: `import { use } from "./lib"`,
          files: {
            "app/lib.ts": `${IMPORT_CAP}function fill(arr: any[]) { arr.push(${u}.email) }\nexport { fill }\nexport function use(a: any[]) { fill(a) }`,
          },
        },
        reexportedElsewhere: {
          body: "  use([])",
          extra: `import { use } from "./lib"`,
          files: {
            "app/lib.ts": `${IMPORT_CAP}function fill(arr: any[]) { arr.push(${u}.email) }\nexport { fill } from "./third"\nexport function use(a: any[]) { fill(a) }`,
            "app/third.ts": `export const fill = () => 1`,
          },
        },
        notExported: {
          body: "  use([])",
          extra: `import { use } from "./lib"`,
          files: {
            "app/lib.ts": `${IMPORT_CAP}function fill(arr: any[]) { arr.push(${u}.email) }\nexport function use(a: any[]) { fill(a) }`,
          },
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- exported
      E returns function:app/lib.ts#fill->return:app/lib.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:1
      E calls function:app/lib.ts#use->function:app/lib.ts#fill p=- static o= h= @app/lib.ts:4:33
      E passes return:app/lib.ts#fill#return->function:app/lib.ts#use p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:4:1
      E returns function:app/lib.ts#use->return:app/lib.ts#use#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:4:1
      E calls function:app/p.ts#h->function:app/lib.ts#use p=- static o= h= @app/p.ts:5:3
      U unsupported-construct app/lib.ts:2:29 subject=function:app/lib.ts#fill detail=tracked data stored on an object the caller owns data=field:features/user/user.ts#userData.user/email
      -- reexportedElsewhere
      E returns function:app/lib.ts#fill->return:app/lib.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:1
      E calls function:app/lib.ts#use->function:app/lib.ts#fill p=- static o= h= @app/lib.ts:4:33
      E passes return:app/lib.ts#fill#return->function:app/lib.ts#use p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:4:1
      E returns function:app/lib.ts#use->return:app/lib.ts#use#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:4:1
      E calls function:app/p.ts#h->function:app/lib.ts#use p=- static o= h= @app/p.ts:5:3
      -- notExported
      E returns function:app/lib.ts#fill->return:app/lib.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:1
      E calls function:app/lib.ts#use->function:app/lib.ts#fill p=- static o= h= @app/lib.ts:3:33
      E passes return:app/lib.ts#fill#return->function:app/lib.ts#use p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:3:1
      E returns function:app/lib.ts#use->return:app/lib.ts#use#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:3:1
      E calls function:app/p.ts#h->function:app/lib.ts#use p=- static o= h= @app/p.ts:5:3"
    `)
  })

  it("a summary call reads the data of its arguments, which the function that makes it has then received", async () => {
    const { input } = await h.scan(
      handler(
        `  res.json(use(${u}))`,
        `import { pick } from "some-lib"\nexport function use(a: any) { return pick(a.email) }`,
      ),
      { summaries: [{ module: "some-lib", export: "pick", effect: "pass-through" }] },
    )
    expect(input.edges.map(edgeLine).join("\n")).toMatchInlineSnapshot(`
      "reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:16
      calls function:app/p.ts#h->function:app/p.ts#use p=- static o= h= @app/p.ts:5:12
      passes function:app/p.ts#h->parameter:app/p.ts#use.a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      reads parameter:app/p.ts#use.a->function:app/p.ts#use p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:43
      reads parameter:app/p.ts#use.a->function:app/p.ts#use p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:3:31
      returns function:app/p.ts#use->return:app/p.ts#use#return p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:3:31
      passes return:app/p.ts#use#return->function:app/p.ts#h p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      discards function:app/p.ts#use->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      discards function:app/p.ts#use->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      discards function:app/p.ts#use->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      discards function:app/p.ts#use->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a summary call that is handed the whole parameter leaves none of its fields unread", async () => {
    const { input } = await h.scan(
      handler(
        `  res.json(use(${u}))`,
        `import { pick } from "some-lib"\nexport function use(a: any) { return pick(a) }`,
      ),
      { summaries: [{ module: "some-lib", export: "pick", effect: "pass-through" }] },
    )
    expect(
      input.edges
        .map(edgeLine)
        .filter((line) => line.startsWith("discards"))
        .join("\n"),
    ).toMatchInlineSnapshot(`""`)
  })

  it("a summary reads what it is handed, and approximate summaries keep the data but not its path", async () => {
    expect(
      await each(
        {
          touchedParameter: {
            body: "  res.json(use(x))",
            extra: `import { pick } from "some-lib"\nexport function use(a: any) { return pick(a.email) }`,
          },
          approximatePass: {
            body: "  res.json(pick(x.email))",
            extra: `import { pick } from "some-lib"`,
          },
          approximateReturnsArg: {
            body: "  res.json(second(x.id, x.email))",
            extra: `import { second } from "some-lib"`,
          },
          approximateProperty: {
            body: "  res.json(pick(x).email)",
            extra: `import { pick } from "some-lib"`,
          },
          approximateObject: {
            body: "  res.json(pick({ a: x.email, b: x.name }).a)",
            extra: `import { pick } from "some-lib"`,
          },
          exactObject: {
            body: "  res.json(keep({ a: x.email, b: x.name }).a)",
            extra: `import { keep } from "some-lib"`,
          },
          exactProperty: {
            body: "  res.json(keep(x).email)",
            extra: `import { keep } from "some-lib"`,
          },
          exactReturnsArg: {
            body: "  res.json(exact(x.id, x.email))",
            extra: `import { exact } from "some-lib"`,
          },
        },
        {
          summaries: [
            { module: "some-lib", export: "pick", effect: "pass-through", approximate: true },
            {
              module: "some-lib",
              export: "second",
              effect: "returns-arg",
              arg: 1,
              approximate: true,
            },
            { module: "some-lib", export: "exact", effect: "returns-arg", arg: 1 },
            { module: "some-lib", export: "keep", effect: "pass-through" },
          ],
        },
      ),
    ).toMatchInlineSnapshot(`
      "-- touchedParameter
      E calls function:app/p.ts#h->function:app/p.ts#use p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#use.a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#use->return:app/p.ts#use#return p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:3:31
      E passes return:app/p.ts#use#return->function:app/p.ts#h p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- approximatePass
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- approximateReturnsArg
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- approximateProperty
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- approximateObject
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- exactObject
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- exactProperty
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- exactReturnsArg
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("a declared summary is found by its export, by the default export's member, and not by a shifted name", async () => {
    const pick = { module: "some-lib", export: "pick", effect: "pass-through" }
    expect(
      await each(
        {
          named: {
            body: "  res.json(pick(x.email))",
            extra: `import { pick } from "some-lib"`,
          },
          defaultMember: {
            body: "  res.json(lib.pick(x.email))",
            extra: `import lib from "some-lib"`,
          },
          namespaceMember: {
            body: "  res.json(lib.pick(x.email))",
            extra: `import * as lib from "some-lib"`,
          },
          shifted: {
            body: "  res.json(lib.xxxxxxxxpick(x.email))",
            extra: `import * as lib from "some-lib"`,
          },
          shiftedByDefaultPrefix: {
            body: "  res.json(lib.xxxxxxxpick(x.email))",
            extra: `import lib from "some-lib"`,
          },
          otherModule: {
            body: "  res.json(pick(x.email))",
            extra: `import { pick } from "other-lib"`,
          },
        },
        { summaries: [pick] },
      ),
    ).toMatchInlineSnapshot(`
      "-- named
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- defaultMember
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- namespaceMember
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- shifted
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- shiftedByDefaultPrefix
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- otherModule
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })
})

describe("flow-scan: new Map, Set and Promise", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** Each statement is scanned as a program of its own, since two sites with the same fact would be one edge. */
  const each = async (statements: readonly string[], extra = ""): Promise<string> => {
    const out: string[] = []
    for (const statement of statements) {
      const body = `  const x: any = ${u}\n  ${statement}`
      const { input } = await h.scan(handler(body, extra))
      out.push(`-- ${statement}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("a map keeps its keys and its values apart when it is made from pairs or from another map", async () => {
    expect(
      await each([
        "const m = new Map([[x.email, x.name]]); res.json(m.get(1))",
        "const m = new Map([[x.email, x.name]]); for (const k of m.keys()) res.json(k)",
        "const base = new Map([[x.email, x.name]]); const m = new Map(base); res.json(m.get(1))",
        "const base = new Map([[x.email, x.name]]); const m = new Map(base); for (const k of m.keys()) res.json(k)",
        "const m = new Map(x.list); res.json(m.get(1))",
        "const m = new Map(); m.set(1, x.email); res.json(m.get(1))",
        "const m = new WeakMap(); m.set(res, x.email); res.json(m.get(res))",
        "const m = new Map(); res.json(m.get(1))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const m = new Map([[x.email, x.name]]); res.json(m.get(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:43
      -- const m = new Map([[x.email, x.name]]); for (const k of m.keys()) res.json(k)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:69
      -- const base = new Map([[x.email, x.name]]); const m = new Map(base); res.json(m.get(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:71
      -- const base = new Map([[x.email, x.name]]); const m = new Map(base); for (const k of m.keys()) res.json(k)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:97
      -- const m = new Map(x.list); res.json(m.get(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list.[].[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:30
      -- const m = new Map(); m.set(1, x.email); res.json(m.get(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:43
      -- const m = new WeakMap(); m.set(res, x.email); res.json(m.get(res))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:49
      -- const m = new Map(); res.json(m.get(1))"
    `)
  })

  it("a set holds what is added to it, and a weak set the same", async () => {
    expect(
      await each([
        "const s = new Set(); s.add(x.email); for (const v of s) res.json(v)",
        "const s = new WeakSet(); s.add(x.email); res.json(s.has(1))",
        "const s = new Set([x.email, x.name]); for (const v of s) res.json(v)",
        "const s = new Set(x.list); for (const v of s) res.json(v)",
        "const s = new Set(); for (const v of s) res.json(v)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const s = new Set(); s.add(x.email); for (const v of s) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:59
      -- const s = new WeakSet(); s.add(x.email); res.json(s.has(1))
      -- const s = new Set([x.email, x.name]); for (const v of s) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:60
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:60
      -- const s = new Set(x.list); for (const v of s) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:49
      -- const s = new Set(); for (const v of s) res.json(v)"
    `)
  })

  it("a constructor written without parentheses is the same constructor", async () => {
    expect(
      await each([
        "const m = new Map; m.set(1, x.email); res.json(m.get(1))",
        "const s = new Set; s.add(x.email); for (const v of s) res.json(v)",
        "new Promise; res.json(1)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const m = new Map; m.set(1, x.email); res.json(m.get(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:41
      -- const s = new Set; s.add(x.email); for (const v of s) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:57
      -- new Promise; res.json(1)"
    `)
  })

  it("a promise settled from two places holds both outcomes", async () => {
    expect(
      await each([
        "new Promise((resolve: any) => { if (x.flag) resolve(x.email); else resolve(x.name) }).then((v: any) => res.json(v))",
        "new Promise((_: any, reject: any) => { if (x.flag) reject(x.email); else reject(x.name) }).catch((e: any) => res.json(e))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- new Promise((resolve: any) => { if (x.flag) resolve(x.email); else resolve(x.name) }).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:15 p=- static o= h= @app/p.ts:4:3
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:47
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:70
      E passes return:app/p.ts#h>anonymous@4:15#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E passes return:app/p.ts#h>anonymous@4:15#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:94 p=- static o= h= @app/p.ts:4:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:94.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:94.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h>anonymous@4:94->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:106
      E side-effect function:app/p.ts#h>anonymous@4:94->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:106
      -- new Promise((_: any, reject: any) => { if (x.flag) reject(x.email); else reject(x.name) }).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:15 p=- static o= h= @app/p.ts:4:3
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:54
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:76
      E passes return:app/p.ts#h>anonymous@4:15#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E passes return:app/p.ts#h>anonymous@4:15#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:100 p=- static o= h= @app/p.ts:4:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:100.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:100.e p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h>anonymous@4:100->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:112
      E side-effect function:app/p.ts#h>anonymous@4:100->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:112"
    `)
  })

  it("a built-in name imported from the project is the project's", async () => {
    const { input } = await h.scan({
      ...handler(
        `  const x: any = ${u}\n  res.json(new Set().has(x.email))`,
        `import { Set } from "./mine"\n`,
      ),
      "app/mine.ts": `export class Set { has(v: any) { return v } }`,
    })
    expect(facts(input).join("\n")).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/mine.ts#Set.constructor p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#h->function:app/mine.ts#Set.has p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/mine.ts#Set.has.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/mine.ts#Set.has->return:app/mine.ts#Set.has#return p=email static o=field:features/user/user.ts#userData.user h= @app/mine.ts:1:34
      E passes return:app/mine.ts#Set.has#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("what an awaited promise hands over is received by the function that reads it, field by field", async () => {
    const { input } = await h.scan(
      handler(
        `  const x: any = ${u}\n  new Promise((resolve: any) => resolve(x)).then((v: any) => res.json(v.email))`,
      ),
    )
    expect(
      input.edges
        .map(edgeLine)
        .filter((line) => /^(discards|reads)/.test(line))
        .join("\n"),
    ).toMatchInlineSnapshot(`
      "reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:18
      reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@4:15 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      reads parameter:app/p.ts#h>anonymous@4:50.v->function:app/p.ts#h>anonymous@4:50 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:71
      reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@4:15 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      discards function:app/p.ts#h>anonymous@4:50->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      discards function:app/p.ts#h>anonymous@4:50->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      discards function:app/p.ts#h>anonymous@4:50->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      discards function:app/p.ts#h>anonymous@4:50->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a name the project defines for itself is not the built-in", async () => {
    expect(
      await each(
        [
          "const m = new Map(); res.json(m.get(x.email))",
          "const Set: any = class { has(v: any) { return v } }; res.json(new Set().has(x.email))",
          "res.json(new Foo(x.email))",
        ],
        "class Map { get(k: any) { return k } }\n",
      ),
    ).toMatchInlineSnapshot(`
      "-- const m = new Map(); res.json(m.get(x.email))
      E calls function:app/p.ts#h->function:app/p.ts#Map.constructor p=- static o= h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#Map.get p=- static o= h= @app/p.ts:5:33
      E passes function:app/p.ts#h->parameter:app/p.ts#Map.get.k p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:33
      E returns function:app/p.ts#Map.get->return:app/p.ts#Map.get#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      E passes return:app/p.ts#Map.get#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:24
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:24
      -- const Set: any = class { has(v: any) { return v } }; res.json(new Set().has(x.email))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@5.constructor p=- static o= h= @app/p.ts:5:65
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@5.has p=- static o= h= @app/p.ts:5:65
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@5.has.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:65
      E returns function:app/p.ts#h>anonymous@5.has->return:app/p.ts#h>anonymous@5.has#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:42
      E passes return:app/p.ts#h>anonymous@5.has#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:56
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:56
      -- res.json(new Foo(x.email))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("a promise made with an executor settles as the executor says, and an executor the scan cannot read is an unknown", async () => {
    expect(
      await each([
        "new Promise((resolve: any) => resolve(x.email)).then((v: any) => res.json(v))",
        "new Promise((_: any, reject: any) => reject(x.email)).catch((e: any) => res.json(e))",
        "new Promise(() => { throw x.email }).catch((e: any) => res.json(e))",
        "new Promise((resolve: any) => resolve(x.email)).catch((e: any) => res.json(e))",
        "new Promise(ext).then((v: any) => res.json(v))",
        "new Promise(ext)",
        "new Promise(); res.json(1)",
        "new Promise(() => 1).then((v: any) => res.json(v))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- new Promise((resolve: any) => resolve(x.email)).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:15 p=- static o= h= @app/p.ts:4:3
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      E passes return:app/p.ts#h>anonymous@4:15#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:56 p=- static o= h= @app/p.ts:4:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:56.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h>anonymous@4:56->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:68
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      -- new Promise((_: any, reject: any) => reject(x.email)).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:15 p=- static o= h= @app/p.ts:4:3
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      E passes return:app/p.ts#h>anonymous@4:15#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:63 p=- static o= h= @app/p.ts:4:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:63.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h>anonymous@4:63->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:75
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      -- new Promise(() => { throw x.email }).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:15 p=- static o= h= @app/p.ts:4:3
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes return:app/p.ts#h>anonymous@4:15#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E returns function:app/p.ts#h->return:app/p.ts#h#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E passes return:app/p.ts#h#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:46 p=- static o= h= @app/p.ts:4:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:46.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h>anonymous@4:46->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:58
      -- new Promise((resolve: any) => resolve(x.email)).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:15 p=- static o= h= @app/p.ts:4:3
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      E passes return:app/p.ts#h>anonymous@4:15#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:57 p=- static o= h= @app/p.ts:4:3
      E returns function:app/p.ts#h>anonymous@4:15->return:app/p.ts#h>anonymous@4:15#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      -- new Promise(ext).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:25 p=- static o= h= @app/p.ts:4:3
      -- new Promise(ext)
      -- new Promise(); res.json(1)
      -- new Promise(() => 1).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:15 p=- static o= h= @app/p.ts:4:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:29 p=- static o= h= @app/p.ts:4:3"
    `)
  })
})

describe("flow-scan: Reflect, Promise statics and Object.create", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** Each statement is scanned as a program of its own, since two sites with the same fact would be one edge. */
  const each = async (statements: readonly string[], extra = ""): Promise<string> => {
    const out: string[] = []
    for (const statement of statements) {
      const body = `  const x: any = ${u}\n  ${statement}`
      const { input } = await h.scan(handler(body, extra))
      out.push(`-- ${statement}`, ...facts(input))
    }
    return out.join("\n")
  }
  const defs = [
    `const fn = (a: any, b: any) => a`,
    `class K { constructor(public p: any, public q: any) {} }`,
    `class Plain {}`,
    `function who(this: any) { return this.v }`,
  ].join("\n")

  it("Reflect.get, set and getOwnPropertyDescriptor are a read, a store and a wrapped read", async () => {
    expect(
      await each(
        [
          "res.json(Reflect.get(x, 'email'))",
          "res.json(Reflect.get(x))",
          "res.json(Reflect.getOwnPropertyDescriptor(x, 'email'))",
          "res.json(Reflect.getOwnPropertyDescriptor(x, 'email').value)",
          "const o: any = {}; Reflect.set(o, 'k', x.email); res.json(o.k)",
          "const o: any = {}; Reflect.set(o, dyn, x.email); res.json(o.k)",
          "const o: any = {}; Reflect.set(o, 0, x.email); res.json(o[0])",
          "const o: any = {}; Reflect.set(o, 'k'); res.json(o.k)",
          "const o: any = {}; Reflect.set(o); res.json(o.k)",
          "res.json(Reflect.get(x, dyn))",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- res.json(Reflect.get(x, 'email'))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      -- res.json(Reflect.get(x))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      U unresolved-call app/p.ts:8:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- res.json(Reflect.getOwnPropertyDescriptor(x, 'email'))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      -- res.json(Reflect.getOwnPropertyDescriptor(x, 'email').value)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      -- const o: any = {}; Reflect.set(o, 'k', x.email); res.json(o.k)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:52
      -- const o: any = {}; Reflect.set(o, dyn, x.email); res.json(o.k)
      U dynamic-access app/p.ts:8:22 subject=function:app/p.ts#h detail=computed property key on a store of tracked data data=field:features/user/user.ts#userData.user/email
      -- const o: any = {}; Reflect.set(o, 0, x.email); res.json(o[0])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:50
      -- const o: any = {}; Reflect.set(o, 'k'); res.json(o.k)
      -- const o: any = {}; Reflect.set(o); res.json(o.k)
      -- res.json(Reflect.get(x, dyn))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      U dynamic-access app/p.ts:8:12 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/"
    `)
  })

  it("Reflect's predicates hold no data, and its other operations are the ones they name", async () => {
    expect(
      await each(
        [
          "res.json(Reflect.has(x, 'email'))",
          "res.json(Reflect.deleteProperty(x, 'email'))",
          "res.json(Reflect.ownKeys(x))",
          "res.json(Reflect.isExtensible(x))",
          "const o: any = {}; Reflect.defineProperty(o, 'k', { value: x.email }); res.json(o.k)",
          "const o: any = {}; Reflect.setPrototypeOf(o, x); res.json(o.email)",
          "res.json(Reflect.getPrototypeOf(x))",
          "res.json(Reflect.nonsense(x))",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- res.json(Reflect.has(x, 'email'))
      -- res.json(Reflect.deleteProperty(x, 'email'))
      -- res.json(Reflect.ownKeys(x))
      -- res.json(Reflect.isExtensible(x))
      -- const o: any = {}; Reflect.defineProperty(o, 'k', { value: x.email }); res.json(o.k)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.k inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:74
      -- const o: any = {}; Reflect.setPrototypeOf(o, x); res.json(o.email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:52
      -- res.json(Reflect.getPrototypeOf(x))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      -- res.json(Reflect.nonsense(x))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      U unresolved-call app/p.ts:8:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
    `)
  })

  it("Reflect.apply and Reflect.construct call the function and the class with the elements of the list", async () => {
    expect(
      await each(
        [
          "res.json(Reflect.apply(fn, null, [x.email, x.name]))",
          "res.json(Reflect.apply(fn, null))",
          "res.json(Reflect.apply())",
          "res.json(Reflect.apply(ext, null, [x.email]))",
          "res.json(Reflect.apply(who, { v: x.email }, []))",
          "res.json(Reflect.apply(who, undefined, []))",
          "res.json(Reflect.construct(K, [x.email, x.name]).p)",
          "res.json(Reflect.construct(K, [x.email, x.name]).q)",
          "res.json(Reflect.construct(Plain, [x.email]))",
          "res.json(Reflect.construct(ext, [x.email]))",
          "res.json(Reflect.construct(K))",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- res.json(Reflect.apply(fn, null, [x.email, x.name]))
      E calls function:app/p.ts#h->function:app/p.ts#fn p=- static o= h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#fn.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#fn.a p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#fn.b p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#fn.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E returns function:app/p.ts#fn->return:app/p.ts#fn#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:32
      E returns function:app/p.ts#fn->return:app/p.ts#fn#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:32
      E passes return:app/p.ts#fn#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E passes return:app/p.ts#fn#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      -- res.json(Reflect.apply(fn, null))
      E calls function:app/p.ts#h->function:app/p.ts#fn p=- static o= h= @app/p.ts:8:12
      -- res.json(Reflect.apply())
      -- res.json(Reflect.apply(ext, null, [x.email]))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      U unresolved-call app/p.ts:8:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json(Reflect.apply(who, { v: x.email }, []))
      E calls function:app/p.ts#h->function:app/p.ts#who p=- static o= h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#who.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E returns function:app/p.ts#who->return:app/p.ts#who#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:27
      E passes return:app/p.ts#who#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      -- res.json(Reflect.apply(who, undefined, []))
      E calls function:app/p.ts#h->function:app/p.ts#who p=- static o= h= @app/p.ts:8:12
      -- res.json(Reflect.construct(K, [x.email, x.name]).p)
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.p p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.q p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.q p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      -- res.json(Reflect.construct(K, [x.email, x.name]).q)
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.p p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.q p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.q p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      -- res.json(Reflect.construct(Plain, [x.email]))
      E calls function:app/p.ts#h->function:app/p.ts#Plain.constructor p=- static o= h= @app/p.ts:8:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Plain.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:12
      -- res.json(Reflect.construct(ext, [x.email]))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      U unresolved-call app/p.ts:8:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json(Reflect.construct(K))
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:8:12"
    `)
  })

  it("Promise.all, allSettled, race and any each give back what the promises settled with", async () => {
    expect(
      await each(
        [
          "Promise.all([Promise.resolve(x.email), Promise.resolve(x.name)]).then((v: any) => res.json(v))",
          "Promise.all([Promise.resolve(x.email)]).then(([v]: any) => res.json(v))",
          "Promise.allSettled([Promise.resolve(x.email)]).then((r: any) => res.json(r[0].value))",
          "Promise.allSettled([Promise.reject(x.email)]).then((r: any) => res.json(r[0].reason))",
          "Promise.race([Promise.resolve(x.email), Promise.resolve(x.name)]).then((v: any) => res.json(v))",
          "Promise.any([Promise.resolve(x.email)]).then((v: any) => res.json(v))",
          "Promise.race([Promise.resolve(x.email)]).then(([v]: any) => res.json(v))",
          "Promise.any([Promise.resolve(x.email)]).then(([v]: any) => res.json(v))",
          "Promise.allSettled([Promise.resolve(x.email)]).then(([v]: any) => res.json(v.value))",
          "Promise.all([Promise.reject(x.email)]).catch((e: any) => res.json(e))",
          "Promise.race([Promise.reject(x.email)]).catch((e: any) => res.json(e))",
          "Promise.all().then((v: any) => res.json(v))",
          "Promise.all([Promise.resolve(1)]).then((v: any) => res.json(v))",
          "Promise.all([Promise.resolve(1)]).catch((e: any) => res.json(e))",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- Promise.all([Promise.resolve(x.email), Promise.resolve(x.name)]).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:73 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:73.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:73.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:73->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:85
      E side-effect function:app/p.ts#h>anonymous@8:73->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:85
      -- Promise.all([Promise.resolve(x.email)]).then(([v]: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:48 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:48.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:48->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:62
      -- Promise.allSettled([Promise.resolve(x.email)]).then((r: any) => res.json(r[0].value))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:55 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:55.r p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:55->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:67
      -- Promise.allSettled([Promise.reject(x.email)]).then((r: any) => res.json(r[0].reason))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:54 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:54.r p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:54->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:66
      -- Promise.race([Promise.resolve(x.email), Promise.resolve(x.name)]).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:74 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:74.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:74.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:74->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:86
      E side-effect function:app/p.ts#h>anonymous@8:74->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:86
      -- Promise.any([Promise.resolve(x.email)]).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:48 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:48.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:48->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:60
      -- Promise.race([Promise.resolve(x.email)]).then(([v]: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:49 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:49.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:49->boundary:boundary:code#http-response p=email.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:63
      -- Promise.any([Promise.resolve(x.email)]).then(([v]: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:48 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:48.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:48->boundary:boundary:code#http-response p=email.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:62
      -- Promise.allSettled([Promise.resolve(x.email)]).then(([v]: any) => res.json(v.value))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:55 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:55.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:55->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:69
      -- Promise.all([Promise.reject(x.email)]).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:48 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:48.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:48->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:60
      -- Promise.race([Promise.reject(x.email)]).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:49 p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:49.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:49->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:61
      -- Promise.all().then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:22 p=- static o= h= @app/p.ts:8:3
      -- Promise.all([Promise.resolve(1)]).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:42 p=- static o= h= @app/p.ts:8:3
      -- Promise.all([Promise.resolve(1)]).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:43 p=- static o= h= @app/p.ts:8:3"
    `)
  })

  it("Object.create answers to what its prototype and its descriptors hold", async () => {
    expect(
      await each(
        [
          "const o: any = Object.create({ k: x.email }); res.json(o.k)",
          "const o: any = Object.create(null, { k: { value: x.email } }); res.json(o.k)",
          "const o: any = Object.create({ k: x.name }, { j: { value: x.email } }); res.json(o.k); res.json(o.j)",
          "const o: any = Object.create(); res.json(o.k)",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- const o: any = Object.create({ k: x.email }); res.json(o.k)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:49
      -- const o: any = Object.create(null, { k: { value: x.email } }); res.json(o.k)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.k inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:66
      -- const o: any = Object.create({ k: x.name }, { j: { value: x.email } }); res.json(o.k); res.json(o.j)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:75
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.k inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:75
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.j inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:90
      -- const o: any = Object.create(); res.json(o.k)"
    `)
  })
})

describe("flow-scan: the methods of a Map and a Set, and groupBy", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** Each statement is scanned as a program of its own, since two sites with the same fact would be one edge. */
  const each = async (statements: readonly string[], extra = ""): Promise<string> => {
    const out: string[] = []
    for (const statement of statements) {
      const body = `  const x: any = ${u}\n  ${statement}`
      const { input } = await h.scan(handler(body, extra))
      out.push(`-- ${statement}`, ...facts(input))
    }
    return out.join("\n")
  }
  const defs = [`const keyOf = (v: any) => v.id`, `const make = (): any => new Map()`].join("\n")
  const MAP = "const m = new Map([[x.email, x.name]]); "
  const SET = "const s = new Set([x.email]); "

  it("a map answers get with its values and keys with its keys, and has, delete and clear hold no data", async () => {
    expect(
      await each(
        [
          `${MAP}res.json(m.get(1))`,
          `${MAP}res.json(m.has(x.id))`,
          `${MAP}res.json(m.delete(x.id))`,
          `${MAP}res.json(m.clear())`,
          `${MAP}for (const v of m.values()) res.json(v)`,
          `${MAP}for (const k of m.keys()) res.json(k)`,
          `${MAP}for (const [k, v] of m.entries()) { res.json(k); res.json(v) }`,
          `${MAP}m.forEach((v: any, k: any, self: any) => { res.json(v); res.json(k) })`,
          `${MAP}m.forEach((v: any, k: any, self: any) => res.json(self.get(1)))`,
          `${MAP}res.json(m.size)`,
          `${MAP}res.json(m.nonsense(1))`,
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- const m = new Map([[x.email, x.name]]); res.json(m.get(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      -- const m = new Map([[x.email, x.name]]); res.json(m.has(x.id))
      -- const m = new Map([[x.email, x.name]]); res.json(m.delete(x.id))
      -- const m = new Map([[x.email, x.name]]); res.json(m.clear())
      -- const m = new Map([[x.email, x.name]]); for (const v of m.values()) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:71
      -- const m = new Map([[x.email, x.name]]); for (const k of m.keys()) res.json(k)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:69
      -- const m = new Map([[x.email, x.name]]); for (const [k, v] of m.entries()) { res.json(k); res.json(v) }
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:79
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:79
      -- const m = new Map([[x.email, x.name]]); m.forEach((v: any, k: any, self: any) => { res.json(v); res.json(k) })
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@6:53 p=- static o= h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.k p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.self p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.self p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E side-effect function:app/p.ts#h>anonymous@6:53->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:86
      E side-effect function:app/p.ts#h>anonymous@6:53->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:99
      -- const m = new Map([[x.email, x.name]]); m.forEach((v: any, k: any, self: any) => res.json(self.get(1)))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@6:53 p=- static o= h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.k p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.self p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.self p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E side-effect function:app/p.ts#h>anonymous@6:53->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:84
      -- const m = new Map([[x.email, x.name]]); res.json(m.size)
      -- const m = new Map([[x.email, x.name]]); res.json(m.nonsense(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      U unresolved-call app/p.ts:6:52 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email,field:features/user/user.ts#userData.user/name"
    `)
  })

  it("a set answers values and keys with its items, entries with pairs, and its algebra with what both hold", async () => {
    expect(
      await each(
        [
          `${SET}res.json(s.has(x.id))`,
          `${SET}res.json(s.delete(x.id))`,
          `${SET}res.json(s.clear())`,
          `${SET}for (const v of s.values()) res.json(v)`,
          `${SET}for (const v of s.keys()) res.json(v)`,
          `${SET}res.json(s.keys()[0])`,
          `${SET}res.json(s.entries()[0])`,
          `${SET}res.json(s.values()[0])`,
          "const s = new Set([x]); for (const v of s.keys()) res.json(v.email)",
          "const s = new Set([x]); for (const v of s.values()) res.json(v.email)",
          "const s = new Set([x]); for (const [a, b] of s.entries()) res.json(a.email)",
          `${SET}for (const [a, b] of s.entries()) { res.json(a); res.json(b) }`,
          `${SET}s.forEach((v: any, w: any, self: any) => { res.json(v); res.json(w) })`,
          `${SET}s.forEach((v: any, w: any, self: any) => { for (const q of self) res.json(q) })`,
          `${SET}const t = new Set([x.name]); for (const v of s.union(t)) res.json(v)`,
          `${SET}const t = new Set([x.name]); for (const v of s.intersection(t)) res.json(v)`,
          `${SET}const t = new Set([x.name]); for (const v of s.difference(t)) res.json(v)`,
          `${SET}const t = new Set([x.name]); res.json(s.isSubsetOf(t))`,
          `${SET}for (const v of s.union()) res.json(v)`,
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- const s = new Set([x.email]); res.json(s.has(x.id))
      -- const s = new Set([x.email]); res.json(s.delete(x.id))
      -- const s = new Set([x.email]); res.json(s.clear())
      -- const s = new Set([x.email]); for (const v of s.values()) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:61
      -- const s = new Set([x.email]); for (const v of s.keys()) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:59
      -- const s = new Set([x.email]); res.json(s.keys()[0])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      -- const s = new Set([x.email]); res.json(s.entries()[0])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      -- const s = new Set([x.email]); res.json(s.values()[0])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      -- const s = new Set([x]); for (const v of s.keys()) res.json(v.email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:53
      -- const s = new Set([x]); for (const v of s.values()) res.json(v.email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:55
      -- const s = new Set([x]); for (const [a, b] of s.entries()) res.json(a.email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:61
      -- const s = new Set([x.email]); for (const [a, b] of s.entries()) { res.json(a); res.json(b) }
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:69
      -- const s = new Set([x.email]); s.forEach((v: any, w: any, self: any) => { res.json(v); res.json(w) })
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@6:43 p=- static o= h= @app/p.ts:6:33
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:43.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:43.w p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:43.self p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      E side-effect function:app/p.ts#h>anonymous@6:43->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:76
      -- const s = new Set([x.email]); s.forEach((v: any, w: any, self: any) => { for (const q of self) res.json(q) })
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@6:43 p=- static o= h= @app/p.ts:6:33
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:43.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:43.w p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:43.self p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
      E side-effect function:app/p.ts#h>anonymous@6:43->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:98
      -- const s = new Set([x.email]); const t = new Set([x.name]); for (const v of s.union(t)) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:90
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:90
      -- const s = new Set([x.email]); const t = new Set([x.name]); for (const v of s.intersection(t)) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:97
      -- const s = new Set([x.email]); const t = new Set([x.name]); for (const v of s.difference(t)) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:95
      -- const s = new Set([x.email]); const t = new Set([x.name]); res.json(s.isSubsetOf(t))
      -- const s = new Set([x.email]); for (const v of s.union()) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:60"
    `)
  })

  it("forEach on a collection runs a callback the project defines, and an unresolved one is an unknown only when it could be a function", async () => {
    expect(
      await each(
        [
          `${MAP}m.forEach(ext)`,
          `${MAP}m.forEach(5)`,
          `${MAP}m.forEach()`,
          `${SET}s.forEach(ext)`,
          `${SET}s.forEach(5)`,
          `${SET}s.forEach()`,
          `${MAP}m.forEach((v: any) => res.json(v))`,
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- const m = new Map([[x.email, x.name]]); m.forEach(ext)
      U unresolved-call app/p.ts:6:43 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email,field:features/user/user.ts#userData.user/name
      -- const m = new Map([[x.email, x.name]]); m.forEach(5)
      -- const m = new Map([[x.email, x.name]]); m.forEach()
      -- const s = new Set([x.email]); s.forEach(ext)
      U unresolved-call app/p.ts:6:33 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- const s = new Set([x.email]); s.forEach(5)
      -- const s = new Set([x.email]); s.forEach()
      -- const m = new Map([[x.email, x.name]]); m.forEach((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@6:53 p=- static o= h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.arg1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.arg2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:53.arg2 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:43
      E side-effect function:app/p.ts#h>anonymous@6:53->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:65"
    `)
  })

  it("an array method borrowed with call is the method called on the first argument", async () => {
    expect(
      await each(
        [
          "Array.prototype.map.call(x.list, (v: any) => res.json(v))",
          "res.json(Array.prototype.slice.call(x.list))",
          "const a: any[] = []; Array.prototype.push.call(a, x.email); res.json(a[0])",
          "res.json([].concat.call(x.list, []))",
          "Array.prototype.map.call()",
          "res.json(Array.prototype.slice.call())",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- Array.prototype.map.call(x.list, (v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@6:36 p=- static o= h= @app/p.ts:6:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@6:36.v p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h>anonymous@6:36->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:48
      -- res.json(Array.prototype.slice.call(x.list))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- const a: any[] = []; Array.prototype.push.call(a, x.email); res.json(a[0])
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:63
      -- res.json([].concat.call(x.list, []))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- Array.prototype.map.call()
      -- res.json(Array.prototype.slice.call())"
    `)
  })

  it("the model carries tags only when the scan made some", async () => {
    const plain = (await h.scan(handler(`  res.json(${u}.email)`))).input
    const tagged = (await h.scan(handler(`  res.json(JSON.parse(JSON.stringify(${u})))`))).input
    expect({
      plainHasTags: "edgeTags" in plain,
      taggedTags: tagged.edgeTags?.map((tag) => tag.via),
    }).toMatchInlineSnapshot(`
      {
        "plainHasTags": false,
        "taggedTags": [
          "serialize-roundtrip",
        ],
      }
    `)
  })

  it("set and add store into the variable the chain starts from, and into nothing else", async () => {
    expect(
      await each(
        [
          "const m = new Map(); m.set(1, x.email).set(2, x.name); res.json(m.get(1))",
          "const m = new Map(); const r = m.set(1, x.email); res.json(r.get(1))",
          "const s = new Set(); s.add(x.email).add(x.name); for (const v of s) res.json(v)",
          "make().set(1, x.email)",
          "new Map().set(1, x.email)",
          "const m = new Map(); m.set(x.email); res.json(m.get(1))",
          "const m = new Map(); m.set(); res.json(m.get(1))",
          "const s = new Set(); s.add(); for (const v of s) res.json(v)",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- const m = new Map(); m.set(1, x.email).set(2, x.name); res.json(m.get(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:58
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:58
      -- const m = new Map(); const r = m.set(1, x.email); res.json(r.get(1))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:53
      -- const s = new Set(); s.add(x.email).add(x.name); for (const v of s) res.json(v)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:71
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:71
      -- make().set(1, x.email)
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:6:3
      E returns function:app/p.ts#make->return:app/p.ts#make#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
      U unresolved-call app/p.ts:6:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- new Map().set(1, x.email)
      -- const m = new Map(); m.set(x.email); res.json(m.get(1))
      -- const m = new Map(); m.set(); res.json(m.get(1))
      -- const s = new Set(); s.add(); for (const v of s) res.json(v)"
    `)
  })

  it("groupBy groups the items by what the callback returns", async () => {
    expect(
      await each(
        [
          "const g = Object.groupBy([x], keyOf); res.json(g.k)",
          "const g = Map.groupBy([x], keyOf); for (const k of g.keys()) res.json(k)",
          "const g = Map.groupBy([x], keyOf); for (const v of g.values()) res.json(v)",
          "const g = Object.groupBy([x], ext); res.json(g.k)",
          "const g = Object.groupBy([x]); res.json(g.k)",
          "const g = Object.groupBy(); res.json(g.k)",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- const g = Object.groupBy([x], keyOf); res.json(g.k)
      E calls function:app/p.ts#h->function:app/p.ts#keyOf p=- static o= h= @app/p.ts:6:13
      E passes function:app/p.ts#h->parameter:app/p.ts#keyOf.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:13
      E returns function:app/p.ts#keyOf->return:app/p.ts#keyOf#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:41
      -- const g = Map.groupBy([x], keyOf); for (const k of g.keys()) res.json(k)
      E calls function:app/p.ts#h->function:app/p.ts#keyOf p=- static o= h= @app/p.ts:6:13
      E passes function:app/p.ts#h->parameter:app/p.ts#keyOf.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:13
      E returns function:app/p.ts#keyOf->return:app/p.ts#keyOf#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      E passes return:app/p.ts#keyOf#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:38
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:64
      -- const g = Map.groupBy([x], keyOf); for (const v of g.values()) res.json(v)
      E calls function:app/p.ts#h->function:app/p.ts#keyOf p=- static o= h= @app/p.ts:6:13
      E passes function:app/p.ts#h->parameter:app/p.ts#keyOf.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:13
      E returns function:app/p.ts#keyOf->return:app/p.ts#keyOf#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:66
      -- const g = Object.groupBy([x], ext); res.json(g.k)
      U unresolved-call app/p.ts:6:13 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- const g = Object.groupBy([x]); res.json(g.k)
      U unresolved-call app/p.ts:6:13 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- const g = Object.groupBy(); res.json(g.k)"
    `)
  })
})

describe("flow-scan: members and inheritance of classes", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  interface Case {
    body: string
    extra?: string
    files?: Readonly<Record<string, string>>
  }
  /** Each program is scanned on its own, with the classes it names. */
  const each = async (cases: Readonly<Record<string, Case>>): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "", files = {} }] of Object.entries(cases)) {
      const { input } = await h.scan({
        ...handler(`  const x: any = ${u}\n${body}`, extra),
        ...files,
      })
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }
  const A = `class A { constructor(public p: any) {} get g() { return this.p } m(v: any) { return v } }\n`

  it("a getter answers with what it returns, from the class or from a superclass, and a property of the instance wins over a method", async () => {
    expect(
      await each({
        own: { body: "  res.json(new A(x.email).g)", extra: A },
        inherited: { body: "  res.json(new B(x.email).g)", extra: `${A}class B extends A {}` },
        propertyShadowsMethod: {
          body: "  const a: any = new A(1); a.m = (v: any) => 'prop'; res.json(a.m(x.email))",
          extra: A,
        },
        methodFetched: { body: "  const f = new A(1).m; res.json(f(x.email))", extra: A },
        mixedIn: {
          body: "  const f = new A(1).extra; res.json(f(x.email))",
          extra: `${A}A.prototype.extra = (v: any) => v`,
        },
        missing: { body: "  res.json(new A(1).nothing)", extra: A },
        getterOnlyInSubclass: {
          body: "  res.json(new B(1).g2)",
          extra: `${A}class B extends A { get g2() { return ${u}.email } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- own
      E calls function:app/p.ts#h->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#A.constructor->return:app/p.ts#A.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E calls function:app/p.ts#h->function:app/p.ts#A.get g p=- static o= h= @app/p.ts:5:12
      E passes return:app/p.ts#A.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.get g.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#A.get g->return:app/p.ts#A.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#A.get g#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- inherited
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:3:1
      E passes function:app/p.ts#B.constructor->parameter:app/p.ts#A.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#A.constructor->return:app/p.ts#A.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#A.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#A.get g p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.get g.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#A.get g->return:app/p.ts#A.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#A.get g#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- propertyShadowsMethod
      E calls function:app/p.ts#h->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:5:18
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@5:34 p=- static o= h= @app/p.ts:5:63
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@5:34.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:63
      -- methodFetched
      E calls function:app/p.ts#h->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#A.m p=- static o= h= @app/p.ts:5:34
      E passes function:app/p.ts#h->parameter:app/p.ts#A.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:34
      E returns function:app/p.ts#A.m->return:app/p.ts#A.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:79
      E passes return:app/p.ts#A.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:25
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:25
      -- mixedIn
      E calls function:app/p.ts#h->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:6:13
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@3:21 p=- static o= h= @app/p.ts:6:38
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@3:21.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:38
      E returns function:app/p.ts#<module>>anonymous@3:21->return:app/p.ts#<module>>anonymous@3:21#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:33
      E passes return:app/p.ts#<module>>anonymous@3:21#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:29
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:29
      -- missing
      E calls function:app/p.ts#h->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:5:12
      -- getterOnlyInSubclass
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#B.get g2 p=- static o= h= @app/p.ts:6:12
      E returns function:app/p.ts#B.get g2->return:app/p.ts#B.get g2#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      E passes return:app/p.ts#B.get g2#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
    `)
  })

  it("a getter a decorator replaced with something the scan cannot read is an unknown", async () => {
    expect(
      await each({
        opaque: {
          body: "  res.json(new C(x.email).g)",
          extra: `declare const ext: any\nclass C { constructor(public p: any) {} @ext get g() { return this.p } }`,
        },
        opaqueButUndecorated: {
          body: "  res.json(new D(x.email).g)",
          extra: `class Base {}\nclass D extends (Base as any) { constructor(public p: any) { super() } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- opaque
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      U unresolved-call app/p.ts:6:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- opaqueButUndecorated
      E calls function:app/p.ts#h->function:app/p.ts#D.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#D.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#D.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:62
      E returns function:app/p.ts#D.constructor->return:app/p.ts#D.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:33"
    `)
  })

  it("static members: a stored value, a getter and a method, own or from a superclass", async () => {
    const S = `class S { static v = ${u}.email; static get g() { return ${u}.name } static m(v: any) { return v } }\n`
    expect(
      await each({
        value: { body: "  res.json(S.v)", extra: S },
        getter: { body: "  res.json(S.g)", extra: S },
        method: { body: "  const f = S.m; res.json(f(x.id))", extra: S },
        inheritedValue: { body: "  res.json(T.v)", extra: `${S}class T extends S {}` },
        inheritedGetter: { body: "  res.json(T.g)", extra: `${S}class T extends S {}` },
        inheritedMethod: {
          body: "  const f = T.m; res.json(f(x.id))",
          extra: `${S}class T extends S {}`,
        },
        missing: { body: "  res.json(S.nothing)", extra: S },
        instanceDoesNotSeeStatic: { body: "  res.json(new S().v)", extra: S },
      }),
    ).toMatchInlineSnapshot(`
      "-- value
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E returns function:app/p.ts#S.get g->return:app/p.ts#S.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:81
      -- getter
      E calls function:app/p.ts#h->function:app/p.ts#S.get g p=- static o= h= @app/p.ts:5:12
      E returns function:app/p.ts#S.get g->return:app/p.ts#S.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:81
      E passes return:app/p.ts#S.get g#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- method
      E calls function:app/p.ts#h->function:app/p.ts#S.m p=- static o= h= @app/p.ts:5:27
      E passes function:app/p.ts#h->parameter:app/p.ts#S.m.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:27
      E returns function:app/p.ts#S.m->return:app/p.ts#S.m#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:149
      E passes return:app/p.ts#S.m#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:18
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:18
      E returns function:app/p.ts#S.get g->return:app/p.ts#S.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:81
      -- inheritedValue
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E returns function:app/p.ts#S.get g->return:app/p.ts#S.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:81
      E calls function:app/p.ts#T.constructor->function:app/p.ts#S.constructor p=- static o= h= @app/p.ts:3:1
      -- inheritedGetter
      E calls function:app/p.ts#h->function:app/p.ts#S.get g p=- static o= h= @app/p.ts:6:12
      E returns function:app/p.ts#S.get g->return:app/p.ts#S.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:81
      E passes return:app/p.ts#S.get g#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E calls function:app/p.ts#T.constructor->function:app/p.ts#S.constructor p=- static o= h= @app/p.ts:3:1
      -- inheritedMethod
      E calls function:app/p.ts#h->function:app/p.ts#S.m p=- static o= h= @app/p.ts:6:27
      E passes function:app/p.ts#h->parameter:app/p.ts#S.m.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:27
      E returns function:app/p.ts#S.m->return:app/p.ts#S.m#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:149
      E passes return:app/p.ts#S.m#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:18
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:18
      E returns function:app/p.ts#S.get g->return:app/p.ts#S.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:81
      E calls function:app/p.ts#T.constructor->function:app/p.ts#S.constructor p=- static o= h= @app/p.ts:3:1
      -- missing
      E returns function:app/p.ts#S.get g->return:app/p.ts#S.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:81
      -- instanceDoesNotSeeStatic
      E calls function:app/p.ts#h->function:app/p.ts#S.constructor p=- static o= h= @app/p.ts:5:12
      E returns function:app/p.ts#S.get g->return:app/p.ts#S.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:81"
    `)
  })

  it("a superclass is found by name, through a namespace import, and is opaque when it cannot be read", async () => {
    expect(
      await each({
        byName: { body: "  res.json(new B(x.email).m(x.name))", extra: `${A}class B extends A {}` },
        byNamespace: {
          body: "  res.json(new B(x.email).m(x.name))",
          extra: `import * as lib from "./lib"\nclass B extends lib.A {}`,
          files: { "app/lib.ts": `export ${A}` },
        },
        namespaceMissing: {
          body: "  res.json(new B(x.email).m(x.name))",
          extra: `import * as lib from "./lib"\nclass B extends lib.Nope {}`,
          files: { "app/lib.ts": `export ${A}` },
        },
        notANamespace: {
          body: "  res.json(new B(x.email).m(x.name))",
          extra: `const lib: any = {}\nclass B extends lib.A {}`,
        },
        unknownBase: {
          body: "  res.json(new B(x.email).other(x.name))",
          extra: `class B extends (ext as any) { m(v: any) { return v } }`,
        },
        ownMethodBeforeOpaqueParent: {
          body: "  res.json(new B(x.email).m(x.name))",
          extra: `class B extends (ext as any) { m(v: any) { return v } }`,
        },
        cycle: {
          body: "  res.json(new P().m(x.name))",
          extra: `class P extends Q { m(v: any) { return v } }\nclass Q extends P {}`,
        },
        deepChain: {
          body: "  res.json(new E().m(x.name))",
          extra: `${A}class B extends A {}\nclass C extends B {}\nclass D extends C {}\nclass E extends D {}`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- byName
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:3:1
      E passes function:app/p.ts#B.constructor->parameter:app/p.ts#A.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#A.constructor->return:app/p.ts#A.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#A.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#A.m p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.m.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#A.m->return:app/p.ts#A.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:79
      E passes return:app/p.ts#A.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- byNamespace
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/lib.ts#A.constructor p=- static o= h= @app/p.ts:3:1
      E passes function:app/p.ts#B.constructor->parameter:app/lib.ts#A.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/lib.ts#A.constructor->return:app/lib.ts#A.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:18
      E passes return:app/lib.ts#A.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/lib.ts#A.m p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#A.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#A.m.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/lib.ts#A.m->return:app/lib.ts#A.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:86
      E passes return:app/lib.ts#A.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- namespaceMissing
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      U unresolved-call app/p.ts:3:1 subject=function:app/p.ts#B.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:6:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email,field:features/user/user.ts#userData.user/name
      -- notANamespace
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      U unresolved-call app/p.ts:3:1 subject=function:app/p.ts#B.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:6:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email,field:features/user/user.ts#userData.user/name
      -- unknownBase
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:2:1 subject=function:app/p.ts#B.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email,field:features/user/user.ts#userData.user/name
      -- ownMethodBeforeOpaqueParent
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E calls function:app/p.ts#h->function:app/p.ts#B.m p=- static o= h= @app/p.ts:5:12
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.m.this p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.m.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#B.m->return:app/p.ts#B.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:44
      E passes return:app/p.ts#B.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:2:1 subject=function:app/p.ts#B.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- cycle
      E calls function:app/p.ts#h->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#P.constructor->function:app/p.ts#Q.constructor p=- static o= h= @app/p.ts:2:1
      E calls function:app/p.ts#Q.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#P.m p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#P.m.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#P.m->return:app/p.ts#P.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:33
      E passes return:app/p.ts#P.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- deepChain
      E calls function:app/p.ts#h->function:app/p.ts#E.constructor p=- static o= h= @app/p.ts:9:12
      E calls function:app/p.ts#E.constructor->function:app/p.ts#D.constructor p=- static o= h= @app/p.ts:6:1
      E calls function:app/p.ts#D.constructor->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:5:1
      E calls function:app/p.ts#C.constructor->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:4:1
      E calls function:app/p.ts#B.constructor->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#A.m p=- static o= h= @app/p.ts:9:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.m.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:12
      E returns function:app/p.ts#A.m->return:app/p.ts#A.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:79
      E passes return:app/p.ts#A.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3"
    `)
  })
})

describe("flow-scan: super members, spreads, generators, loading and new", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  interface Case {
    body: string
    extra?: string
    files?: Readonly<Record<string, string>>
  }
  /** Each program is scanned on its own, with the code it names. */
  const each = async (cases: Readonly<Record<string, Case>>): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "", files = {} }] of Object.entries(cases)) {
      const { input } = await h.scan({
        ...handler(`  const x: any = ${u}\n${body}`, extra),
        ...files,
      })
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }
  const BASE = `class Base { v = ${u}.email; get g() { return this.v } m(w: any) { return w } static sv = ${u}.name; static get sg() { return ${u}.id } static sm(w: any) { return w } }\n`

  it("super.member reads the superclass's accessor or fetches its method, as the instance or as the class", async () => {
    expect(
      await each({
        accessor: {
          body: "  res.json(new Sub().g2)",
          extra: `${BASE}class Sub extends Base { get g2() { return super.g } }`,
        },
        method: {
          body: "  res.json(new Sub().m2(x.name))",
          extra: `${BASE}class Sub extends Base { m2(w: any) { const f = super.m; return f(w) } }`,
        },
        staticAccessor: {
          body: "  res.json(Sub.sg2)",
          extra: `${BASE}class Sub extends Base { static get sg2() { return super.sg } }`,
        },
        staticMethod: {
          body: "  res.json(Sub.sm2(x.name))",
          extra: `${BASE}class Sub extends Base { static sm2(w: any) { const f = super.sm; return f(w) } }`,
        },
        instanceDoesNotReadStatic: {
          body: "  res.json(new Sub().m3())",
          extra: `${BASE}class Sub extends Base { m3() { return super.sv } }`,
        },
        noSuperclass: {
          body: "  res.json(new Solo().m3())",
          extra: `class Solo { m3() { return super.nothing } }`,
        },
        unreadableSuperclass: {
          body: "  res.json(new Odd().m3())",
          extra: `class Odd extends (ext as any) { m3() { return super.nothing } }`,
        },
        missingMember: {
          body: "  res.json(new Sub().m3())",
          extra: `${BASE}class Sub extends Base { m3() { return super.nothing } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- accessor
      E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E returns function:app/p.ts#Base.constructor->return:app/p.ts#Base.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#Base.constructor#return->function:app/p.ts#Sub.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#Sub.get g2 p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.get g2.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.get g2->function:app/p.ts#Base.get g p=- static o= h= @app/p.ts:3:44
      E passes function:app/p.ts#Sub.get g2->parameter:app/p.ts#Base.get g.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:44
      E returns function:app/p.ts#Base.get g->return:app/p.ts#Base.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:70
      E passes return:app/p.ts#Base.get g#return->function:app/p.ts#Sub.get g2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:37
      E returns function:app/p.ts#Sub.get g2->return:app/p.ts#Sub.get g2#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:37
      E passes return:app/p.ts#Sub.get g2#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E returns function:app/p.ts#Base.get sg->return:app/p.ts#Base.get sg#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:180
      -- method
      E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E returns function:app/p.ts#Base.constructor->return:app/p.ts#Base.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#Base.constructor#return->function:app/p.ts#Sub.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m2 p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m2.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m2.w p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.m2->function:app/p.ts#Base.m p=- static o= h= @app/p.ts:3:65
      E passes function:app/p.ts#Sub.m2->parameter:app/p.ts#Base.m.w p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:65
      E returns function:app/p.ts#Base.m->return:app/p.ts#Base.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:98
      E passes return:app/p.ts#Base.m#return->function:app/p.ts#Sub.m2 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:58
      E returns function:app/p.ts#Sub.m2->return:app/p.ts#Sub.m2#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:58
      E passes return:app/p.ts#Sub.m2#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E returns function:app/p.ts#Base.get g->return:app/p.ts#Base.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:70
      E returns function:app/p.ts#Base.get sg->return:app/p.ts#Base.get sg#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:180
      -- staticAccessor
      E calls function:app/p.ts#h->function:app/p.ts#Sub.get sg2 p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.get sg2->function:app/p.ts#Base.get sg p=- static o= h= @app/p.ts:3:52
      E returns function:app/p.ts#Base.get sg->return:app/p.ts#Base.get sg#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:180
      E passes return:app/p.ts#Base.get sg#return->function:app/p.ts#Sub.get sg2 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:45
      E returns function:app/p.ts#Sub.get sg2->return:app/p.ts#Sub.get sg2#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:45
      E passes return:app/p.ts#Sub.get sg2#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E returns function:app/p.ts#Base.constructor->return:app/p.ts#Base.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E returns function:app/p.ts#Base.get g->return:app/p.ts#Base.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:70
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E passes return:app/p.ts#Base.constructor#return->function:app/p.ts#Sub.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      -- staticMethod
      E calls function:app/p.ts#h->function:app/p.ts#Sub.sm2 p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.sm2.w p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.sm2->function:app/p.ts#Base.sm p=- static o= h= @app/p.ts:3:74
      E passes function:app/p.ts#Sub.sm2->parameter:app/p.ts#Base.sm.w p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:74
      E returns function:app/p.ts#Base.sm->return:app/p.ts#Base.sm#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:247
      E passes return:app/p.ts#Base.sm#return->function:app/p.ts#Sub.sm2 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:67
      E returns function:app/p.ts#Sub.sm2->return:app/p.ts#Sub.sm2#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:67
      E passes return:app/p.ts#Sub.sm2#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E returns function:app/p.ts#Base.constructor->return:app/p.ts#Base.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E returns function:app/p.ts#Base.get g->return:app/p.ts#Base.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:70
      E returns function:app/p.ts#Base.get sg->return:app/p.ts#Base.get sg#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:180
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E passes return:app/p.ts#Base.constructor#return->function:app/p.ts#Sub.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      -- instanceDoesNotReadStatic
      E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E returns function:app/p.ts#Base.constructor->return:app/p.ts#Base.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#Base.constructor#return->function:app/p.ts#Sub.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m3 p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m3.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#Base.get g->return:app/p.ts#Base.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:70
      E returns function:app/p.ts#Base.get sg->return:app/p.ts#Base.get sg#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:180
      -- noSuperclass
      E calls function:app/p.ts#h->function:app/p.ts#Solo.constructor p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#h->function:app/p.ts#Solo.m3 p=- static o= h= @app/p.ts:5:12
      -- unreadableSuperclass
      E calls function:app/p.ts#h->function:app/p.ts#Odd.constructor p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#h->function:app/p.ts#Odd.m3 p=- static o= h= @app/p.ts:5:12
      -- missingMember
      E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:3:1
      E returns function:app/p.ts#Base.constructor->return:app/p.ts#Base.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#Base.constructor#return->function:app/p.ts#Sub.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#Sub.m3 p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.m3.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#Base.get g->return:app/p.ts#Base.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:70
      E returns function:app/p.ts#Base.get sg->return:app/p.ts#Base.get sg#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:180"
    `)
  })

  it("a spread argument stands for each parameter from its place on", async () => {
    const F = `const f3 = (res: any, a: any, b: any, c: any) => { res.json(a); res.json(b); res.json(c) }\n`
    expect(
      await each({
        wholeList: { body: "  f3(res, ...x.list)", extra: F },
        afterOne: { body: "  f3(res, x.email, ...x.list)", extra: F },
        literal: { body: "  f3(res, ...[x.email, x.name, x.id])", extra: F },
        afterAll: { body: "  f3(res, x.email, x.name, x.id, ...x.list)", extra: F },
        spreadOnly: { body: "  const g = (a: any) => a; res.json(g(...x.list))", extra: "" },
      }),
    ).toMatchInlineSnapshot(`
      "-- wholeList
      E calls function:app/p.ts#h->function:app/p.ts#f3 p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.a p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.b p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.c p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      -- afterOne
      E calls function:app/p.ts#h->function:app/p.ts#f3 p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.b p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.c p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:65
      -- literal
      E calls function:app/p.ts#h->function:app/p.ts#f3 p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.a p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.a p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.b p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.b p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.c p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.c p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.c p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      -- afterAll
      E calls function:app/p.ts#h->function:app/p.ts#f3 p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.c p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#f3.arg4 p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:65
      E side-effect function:app/p.ts#f3->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:78
      -- spreadOnly
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:13 p=- static o= h= @app/p.ts:4:37
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:13.a p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
      E returns function:app/p.ts#h>anonymous@4:13->return:app/p.ts#h>anonymous@4:13#return p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:25
      E passes return:app/p.ts#h>anonymous@4:13#return->function:app/p.ts#h p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:28
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:28"
    `)
  })

  it("a generator yields what it is given to yield, and a plain function does not", async () => {
    expect(
      await each({
        generator: {
          body: "  for (const v of gen()) res.json(v)",
          extra: `function* gen(): any { yield ${u}.email }`,
        },
        delegating: {
          body: "  for (const v of gen()) res.json(v)",
          extra: `function* inner(): any { yield ${u}.email }\nfunction* gen(): any { yield* inner() }`,
        },
        asyncGenerator: {
          body: "  for await (const v of gen()) res.json(v)",
          extra: `async function* gen(): any { yield ${u}.email }`,
        },
        plain: {
          body: "  for (const v of fn()) res.json(v)",
          extra: `function fn(): any { return [${u}.email] }`,
        },
        method: {
          body: "  for (const v of new G().items()) res.json(v)",
          extra: `class G { *items(): any { yield ${u}.email } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- generator
      E returns function:app/p.ts#gen->return:app/p.ts#gen#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:24
      E calls function:app/p.ts#h->function:app/p.ts#gen p=- static o= h= @app/p.ts:5:19
      E passes return:app/p.ts#gen#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
      -- delegating
      E returns function:app/p.ts#inner->return:app/p.ts#inner#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:26
      E calls function:app/p.ts#gen->function:app/p.ts#inner p=- static o= h= @app/p.ts:3:31
      E passes return:app/p.ts#inner#return->function:app/p.ts#gen p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:24
      E returns function:app/p.ts#gen->return:app/p.ts#gen#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:24
      E calls function:app/p.ts#h->function:app/p.ts#gen p=- static o= h= @app/p.ts:6:19
      E passes return:app/p.ts#gen#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:26
      -- asyncGenerator
      E returns function:app/p.ts#gen->return:app/p.ts#gen#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:30
      E calls function:app/p.ts#h->function:app/p.ts#gen p=- static o= h= @app/p.ts:5:25
      E passes return:app/p.ts#gen#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:32
      -- plain
      E returns function:app/p.ts#fn->return:app/p.ts#fn#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:22
      E calls function:app/p.ts#h->function:app/p.ts#fn p=- static o= h= @app/p.ts:5:19
      E passes return:app/p.ts#fn#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:25
      -- method
      E calls function:app/p.ts#h->function:app/p.ts#G.constructor p=- static o= h= @app/p.ts:5:19
      E calls function:app/p.ts#h->function:app/p.ts#G.items p=- static o= h= @app/p.ts:5:19
      E returns function:app/p.ts#G.items->return:app/p.ts#G.items#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      E passes return:app/p.ts#G.items#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:36"
    `)
  })

  it("require and import() load a module of the project, and nothing else", async () => {
    const lib = { "app/lib.ts": `export const pick = (v: any) => v\nexport default (v: any) => v` }
    expect(
      await each({
        require: {
          body: "  const m = require('./lib'); res.json(m.pick(x.email))",
          files: lib,
        },
        dynamicImport: {
          body: "  const m = await import('./lib'); res.json(m.pick(x.email))",
          files: lib,
        },
        requireNoArgument: {
          body: "  const m = (require as any)(); res.json(m.pick(x.email))",
          files: lib,
        },
        requireDynamic: {
          body: "  const m = require(dyn); res.json(m.pick(x.email))",
          files: lib,
        },
        requireMissingFile: {
          body: "  const m = require('./nope'); res.json(m.pick(x.email))",
          files: lib,
        },
        requireOfPackage: {
          body: "  const m = require('lodash'); res.json(m.pick(x.email))",
          files: lib,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- require
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:40
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      -- dynamicImport
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:45
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:45
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36
      -- requireNoArgument
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      U unresolved-call app/p.ts:4:42 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- requireDynamic
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:27
      U unresolved-call app/p.ts:4:36 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- requireMissingFile
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:32
      U unresolved-call app/p.ts:4:41 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- requireOfPackage
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:32
      U unresolved-call app/p.ts:4:41 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("new runs the constructor of a class, and of whatever expression names one", async () => {
    expect(
      await each({
        plain: {
          body: "  res.json(new K(x.email).p)",
          extra: `class K { constructor(public p: any) {} }`,
        },
        noParentheses: {
          body: "  res.json((new K).p)",
          extra: `class K { p = ${u}.email }`,
        },
        throughFunction: {
          body: "  res.json(new (make())(x.email).p)",
          extra: `class K { constructor(public p: any) {} }\nconst make = () => K`,
        },
        notAClass: {
          body: "  res.json(new notClass(x.email))",
          extra: `const notClass = (v: any) => v`,
        },
        unknown: { body: "  res.json(new Unknown(x.email))" },
        withoutConstructor: {
          body: "  res.json(new K(x.email).p)",
          extra: `class K { p: any }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- plain
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- noParentheses
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:13
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- throughFunction
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:6:17
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- notAClass
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- unknown
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      U unresolved-call app/p.ts:4:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- withoutConstructor
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12"
    `)
  })
})

describe("flow-scan: rounds and entry points", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  interface Case {
    body: string
    extra?: string
    files?: Readonly<Record<string, string>>
  }
  /** Each program is scanned on its own, with the code it names. */
  const each = async (cases: Readonly<Record<string, Case>>): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "", files = {} }] of Object.entries(cases)) {
      const { input } = await h.scan({ ...handler(body, extra), ...files })
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("state written by a later function reaches an earlier one, through as many functions as it takes", async () => {
    expect(
      await each({
        oneStep: {
          body: "  readOne(res)",
          extra: `let g1: any\nexport function readOne(res: any) { res.json(g1) }\nexport function writeOne() { g1 = ${u}.email }`,
        },
        threeSteps: {
          body: "  readThree(res)",
          extra: `let g1: any, g2: any, g3: any\nexport function readThree(res: any) { res.json(g1) }\nexport function mid1() { g1 = g2 }\nexport function mid2() { g2 = g3 }\nexport function writeThree() { g3 = ${u}.name }`,
        },
        neverWritten: {
          body: "  readNone(res)",
          extra: `let g1: any\nexport function readNone(res: any) { res.json(g1) }`,
        },
        writerBeforeReader: {
          body: "  readLater(res)",
          extra: `let g1: any\nexport function writeFirst() { g1 = ${u}.id }\nexport function readLater(res: any) { res.json(g1) }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- oneStep
      E calls function:app/p.ts#h->function:app/p.ts#readOne p=- static o= h= @app/p.ts:6:3
      E side-effect function:app/p.ts#readOne->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:37
      -- threeSteps
      E calls function:app/p.ts#h->function:app/p.ts#readThree p=- static o= h= @app/p.ts:8:3
      E side-effect function:app/p.ts#readThree->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      -- neverWritten
      E calls function:app/p.ts#h->function:app/p.ts#readNone p=- static o= h= @app/p.ts:5:3
      -- writerBeforeReader
      E side-effect function:app/p.ts#readLater->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:39
      E calls function:app/p.ts#h->function:app/p.ts#readLater p=- static o= h= @app/p.ts:6:3"
    `)
  })

  it("recursion and mutual recursion end, and carry the data around once", async () => {
    expect(
      await each({
        selfRecursive: {
          body: `  res.json(self(${u}.email, 3))`,
          extra: `function self(v: any, n: number): any { return n > 0 ? self(v, n - 1) : v }`,
        },
        mutual: {
          body: `  res.json(ping(${u}.email, 3))`,
          extra: `function ping(v: any, n: number): any { return n > 0 ? pong(v, n - 1) : v }\nfunction pong(v: any, n: number): any { return ping(v, n - 1) }`,
        },
        recursiveThroughState: {
          body: "  loop(res)",
          extra: `let acc: any\nexport function loop(res: any): any { acc = [acc, ${u}.email]; res.json(acc); return loop(res) }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- selfRecursive
      E calls function:app/p.ts#self->function:app/p.ts#self p=- static o= h= @app/p.ts:2:56
      E calls function:app/p.ts#h->function:app/p.ts#self p=- static o= h= @app/p.ts:4:12
      E passes function:app/p.ts#h->parameter:app/p.ts#self.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
      E passes function:app/p.ts#self->parameter:app/p.ts#self.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:56
      E returns function:app/p.ts#self->return:app/p.ts#self#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:41
      E passes return:app/p.ts#self#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      -- mutual
      E calls function:app/p.ts#ping->function:app/p.ts#pong p=- static o= h= @app/p.ts:2:56
      E calls function:app/p.ts#pong->function:app/p.ts#ping p=- static o= h= @app/p.ts:3:48
      E calls function:app/p.ts#h->function:app/p.ts#ping p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#ping.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#ping->parameter:app/p.ts#pong.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:56
      E passes function:app/p.ts#pong->parameter:app/p.ts#ping.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:48
      E returns function:app/p.ts#ping->return:app/p.ts#ping#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:41
      E passes return:app/p.ts#ping#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- recursiveThroughState
      E side-effect function:app/p.ts#loop->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:94
      E calls function:app/p.ts#loop->function:app/p.ts#loop p=- static o= h= @app/p.ts:3:116
      E calls function:app/p.ts#h->function:app/p.ts#loop p=- static o= h= @app/p.ts:5:3"
    `)
  })

  it("exported functions and the methods of exported classes are entry points, and hidden ones are not", async () => {
    expect(
      await each({
        exportedFunction: {
          body: "  res.json(1)",
          extra: `export function other(res: any) { res.json(${u}.name) }`,
        },
        exportedClassMethod: {
          body: "  res.json(1)",
          extra: `export class S { m(res: any) { res.json(${u}.name) } static s(res: any) { res.json(${u}.id) } }`,
        },
        hiddenFunction: {
          body: "  res.json(1)",
          extra: `function hidden(res: any) { res.json(${u}.name) }`,
        },
        hiddenClassMethod: {
          body: "  res.json(1)",
          extra: `class Hidden { m(res: any) { res.json(${u}.name) } }`,
        },
        exportedByName: {
          body: "  res.json(1)",
          extra: `function late(res: any) { res.json(${u}.name) }\nexport { late }`,
        },
        defaultExport: {
          body: "  res.json(1)",
          extra: `export default function (res: any) { res.json(${u}.name) }`,
        },
        nestedNeverCalled: {
          body: "  const inner = (res0: any) => res.json(" + u + ".name)",
        },
        nestedCalled: {
          body: "  const inner = () => res.json(" + u + ".name); inner()",
        },
        calledOnlyFromHidden: {
          body: "  res.json(1)",
          extra: `function leaf(res: any) { res.json(${u}.name) }\nfunction hidden(res: any) { leaf(res) }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- exportedFunction
      E side-effect function:app/p.ts#other->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      -- exportedClassMethod
      E side-effect function:app/p.ts#S.m->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:32
      E side-effect function:app/p.ts#S.s->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:105
      -- hiddenFunction
      E side-effect function:app/p.ts#hidden->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:29
      -- hiddenClassMethod
      E side-effect function:app/p.ts#Hidden.m->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:30
      -- exportedByName
      E side-effect function:app/p.ts#late->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      -- defaultExport
      E side-effect function:app/p.ts#default->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:38
      -- nestedNeverCalled
      E side-effect function:app/p.ts#h>anonymous@3:17->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      -- nestedCalled
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@3:17 p=- static o= h= @app/p.ts:3:74
      E side-effect function:app/p.ts#h>anonymous@3:17->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:23
      -- calledOnlyFromHidden
      E side-effect function:app/p.ts#leaf->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      E calls function:app/p.ts#hidden->function:app/p.ts#leaf p=- static o= h= @app/p.ts:3:29"
    `)
  })
})

describe("flow-scan: throws, iteration, labels and objects filled by a call", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** Each statement is scanned as a program of its own, since two sites with the same fact would be one edge. */
  const each = async (statements: readonly string[], extra = ""): Promise<string> => {
    const out: string[] = []
    for (const statement of statements) {
      const body = `  const x: any = ${u}\n  ${statement}`
      const { input } = await h.scan(handler(body, extra))
      out.push(`-- ${statement}`, ...facts(input))
    }
    return out.join("\n")
  }
  const defs = [
    `function thrower(v: any): any { throw v }`,
    `async function asyncThrower(v: any): Promise<any> { throw v }`,
    `async function asyncNoThrow(v: any): Promise<any> { return 1 }`,
    `const fill = (o: any, v: any) => { o.k = v }`,
  ].join("\n")

  it("a throw is caught where it lands, and an async function hands its throw back as a rejection", async () => {
    expect(
      await each(
        [
          "try { thrower(x.email) } catch (e) { res.json(e) }",
          "try { res.json(1) } catch (e) { res.json(e) }",
          "asyncThrower(x.email).catch((e: any) => res.json(e))",
          "asyncThrower(x.email).then((v: any) => res.json(v))",
          "asyncNoThrow(x.email).catch((e: any) => res.json(e))",
          "try { asyncThrower(x.email) } catch (e) { res.json(e) }",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- try { thrower(x.email) } catch (e) { res.json(e) }
      E calls function:app/p.ts#h->function:app/p.ts#thrower p=- static o= h= @app/p.ts:8:9
      E passes function:app/p.ts#h->parameter:app/p.ts#thrower.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:9
      E returns function:app/p.ts#thrower->return:app/p.ts#thrower#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:33
      E passes return:app/p.ts#thrower#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:40
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:40
      -- try { res.json(1) } catch (e) { res.json(e) }
      -- asyncThrower(x.email).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#asyncThrower p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#asyncThrower.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E returns function:app/p.ts#asyncThrower->return:app/p.ts#asyncThrower#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:53
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:31 p=- static o= h= @app/p.ts:8:3
      E passes return:app/p.ts#asyncThrower#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@8:31.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E side-effect function:app/p.ts#h>anonymous@8:31->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:43
      -- asyncThrower(x.email).then((v: any) => res.json(v))
      E calls function:app/p.ts#h->function:app/p.ts#asyncThrower p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#asyncThrower.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E returns function:app/p.ts#asyncThrower->return:app/p.ts#asyncThrower#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:53
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:30 p=- static o= h= @app/p.ts:8:3
      -- asyncNoThrow(x.email).catch((e: any) => res.json(e))
      E calls function:app/p.ts#h->function:app/p.ts#asyncNoThrow p=- static o= h= @app/p.ts:8:3
      E passes function:app/p.ts#h->parameter:app/p.ts#asyncNoThrow.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:31 p=- static o= h= @app/p.ts:8:3
      -- try { asyncThrower(x.email) } catch (e) { res.json(e) }
      E calls function:app/p.ts#h->function:app/p.ts#asyncThrower p=- static o= h= @app/p.ts:8:9
      E passes function:app/p.ts#h->parameter:app/p.ts#asyncThrower.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:9
      E returns function:app/p.ts#asyncThrower->return:app/p.ts#asyncThrower#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:53
      E passes return:app/p.ts#asyncThrower#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:45
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:45"
    `)
  })

  it("for await takes the async iterator of a value, and for of takes the sync one", async () => {
    const run = async (extra: string) =>
      facts((await h.scan(handler("  res.json(1)", extra))).input).join("\n")
    expect({
      forAwaitOverPromises: await run(
        `export async function fa(res: any) { for await (const v of [Promise.resolve(${u}.email)]) res.json(v) }`,
      ),
      forOfOverPromises: await run(
        `export function fo(res: any) { for (const v of [Promise.resolve(${u}.email)]) res.json(v) }`,
      ),
      asyncIterable: await run(
        `class AsyncIt { async *[Symbol.asyncIterator]() { yield ${u}.email } }\nexport async function fa(res: any) { for await (const v of new AsyncIt()) res.json(v) }`,
      ),
      syncIterable: await run(
        `class Sync { *[Symbol.iterator]() { yield ${u}.email } }\nexport function fo(res: any) { for (const v of new Sync()) res.json(v) }`,
      ),
      syncIterableInForAwait: await run(
        `class Sync { *[Symbol.iterator]() { yield ${u}.email } }\nexport async function fa(res: any) { for await (const v of new Sync()) res.json(v) }`,
      ),
      asyncIterableInForOf: await run(
        `class AsyncIt { async *[Symbol.asyncIterator]() { yield ${u}.email } }\nexport function fo(res: any) { for (const v of new AsyncIt()) res.json(v) }`,
      ),
    }).toMatchInlineSnapshot(`
      {
        "asyncIterable": "E calls function:app/p.ts#fa->function:app/p.ts#AsyncIt.constructor p=- static o= h= @app/p.ts:3:60
      E calls function:app/p.ts#fa->function:app/p.ts#AsyncIt.[Symbol.asyncIterator] p=- static o= h= @app/p.ts:3:38
      E returns function:app/p.ts#AsyncIt.[Symbol.asyncIterator]->return:app/p.ts#AsyncIt.[Symbol.asyncIterator]#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#AsyncIt.[Symbol.asyncIterator]#return->function:app/p.ts#fa p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:38
      E side-effect function:app/p.ts#fa->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:75",
        "asyncIterableInForOf": "E calls function:app/p.ts#fo->function:app/p.ts#AsyncIt.constructor p=- static o= h= @app/p.ts:3:48
      E calls function:app/p.ts#fo->function:app/p.ts#AsyncIt.[Symbol.asyncIterator] p=- static o= h= @app/p.ts:3:32
      E returns function:app/p.ts#AsyncIt.[Symbol.asyncIterator]->return:app/p.ts#AsyncIt.[Symbol.asyncIterator]#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#AsyncIt.[Symbol.asyncIterator]#return->function:app/p.ts#fo p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      E side-effect function:app/p.ts#fo->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:63",
        "forAwaitOverPromises": "E side-effect function:app/p.ts#fa->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:121",
        "forOfOverPromises": "E side-effect function:app/p.ts#fo->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:109",
        "syncIterable": "E calls function:app/p.ts#fo->function:app/p.ts#Sync.constructor p=- static o= h= @app/p.ts:3:48
      E calls function:app/p.ts#fo->function:app/p.ts#Sync.[Symbol.iterator] p=- static o= h= @app/p.ts:3:32
      E returns function:app/p.ts#Sync.[Symbol.iterator]->return:app/p.ts#Sync.[Symbol.iterator]#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:37
      E passes return:app/p.ts#Sync.[Symbol.iterator]#return->function:app/p.ts#fo p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      E side-effect function:app/p.ts#fo->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:60",
        "syncIterableInForAwait": "E calls function:app/p.ts#fa->function:app/p.ts#Sync.constructor p=- static o= h= @app/p.ts:3:60
      E calls function:app/p.ts#fa->function:app/p.ts#Sync.[Symbol.iterator] p=- static o= h= @app/p.ts:3:38
      E returns function:app/p.ts#Sync.[Symbol.iterator]->return:app/p.ts#Sync.[Symbol.iterator]#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:37
      E passes return:app/p.ts#Sync.[Symbol.iterator]#return->function:app/p.ts#fa p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:38
      E side-effect function:app/p.ts#fa->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:72",
      }
    `)
  })

  it("a label names a statement and the statement still runs", async () => {
    expect(
      await each([
        "outer: for (const v of [x.email]) { res.json(v); break outer }",
        "label: res.json(x.name)",
        "a: b: res.json(x.id)",
      ]),
    ).toMatchInlineSnapshot(`
      "-- outer: for (const v of [x.email]) { res.json(v); break outer }
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:39
      -- label: res.json(x.name)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:10
      -- a: b: res.json(x.id)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:9"
    `)
  })

  it("a named function expression is called by the name it is bound to, and sees its own name inside", async () => {
    expect(
      await each([
        "const f = function named(v: any): any { return v }; res.json(f(x.email))",
        "const f = function named(v: any, n: number): any { return n > 0 ? named(v, n - 1) : v }; res.json(f(x.email, 2))",
        "const f = function (v: any): any { return v }; res.json(f(x.email))",
        "res.json((function iife(v: any) { return v })(x.email))",
      ]),
    ).toMatchInlineSnapshot(`
      "-- const f = function named(v: any): any { return v }; res.json(f(x.email))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:13 p=- static o= h= @app/p.ts:4:64
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:13.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:64
      E returns function:app/p.ts#h>anonymous@4:13->return:app/p.ts#h>anonymous@4:13#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:43
      E passes return:app/p.ts#h>anonymous@4:13#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:55
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:55
      -- const f = function named(v: any, n: number): any { return n > 0 ? named(v, n - 1) : v }; res.json(f(x.email, 2))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:13 p=- static o= h= @app/p.ts:4:101
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:13.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:101
      E calls function:app/p.ts#h>anonymous@4:13->function:app/p.ts#h>anonymous@4:13 p=- static o= h= @app/p.ts:4:69
      E passes function:app/p.ts#h>anonymous@4:13->parameter:app/p.ts#h>anonymous@4:13.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:69
      E returns function:app/p.ts#h>anonymous@4:13->return:app/p.ts#h>anonymous@4:13#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:54
      E passes return:app/p.ts#h>anonymous@4:13#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:92
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:92
      -- const f = function (v: any): any { return v }; res.json(f(x.email))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:13 p=- static o= h= @app/p.ts:4:59
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:13.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:59
      E returns function:app/p.ts#h>anonymous@4:13->return:app/p.ts#h>anonymous@4:13#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:38
      E passes return:app/p.ts#h>anonymous@4:13#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:50
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:50
      -- res.json((function iife(v: any) { return v })(x.email))
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:13 p=- static o= h= @app/p.ts:4:12
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:13.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
      E returns function:app/p.ts#h>anonymous@4:13->return:app/p.ts#h>anonymous@4:13#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
      E passes return:app/p.ts#h>anonymous@4:13#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
    `)
  })

  it("a call that fills an object another name holds is flagged, and one that fills an object nobody else holds is followed", async () => {
    expect(
      await each(
        [
          "const a: any = {}; fill(a, x.email); res.json(a.k)",
          "const a: any = {}; const b = a; fill(a, x.email); res.json(b.k)",
          "const a: any = {}; const b = a; fill(b, x.email)",
          "const a: any = {}; fill(a, 1); res.json(a.k)",
          "fill(make(), x.email)",
        ],
        defs + `\nconst make = (): any => ({})`,
      ),
    ).toMatchInlineSnapshot(`
      "-- const a: any = {}; fill(a, x.email); res.json(a.k)
      E calls function:app/p.ts#h->function:app/p.ts#fill p=- static o= h= @app/p.ts:9:22
      E passes function:app/p.ts#h->parameter:app/p.ts#fill.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:22
      E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      E passes return:app/p.ts#fill#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:49
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:40
      -- const a: any = {}; const b = a; fill(a, x.email); res.json(b.k)
      E calls function:app/p.ts#h->function:app/p.ts#fill p=- static o= h= @app/p.ts:9:35
      E passes function:app/p.ts#h->parameter:app/p.ts#fill.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:35
      E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:53
      -- const a: any = {}; const b = a; fill(b, x.email)
      E calls function:app/p.ts#h->function:app/p.ts#fill p=- static o= h= @app/p.ts:9:35
      E passes function:app/p.ts#h->parameter:app/p.ts#fill.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:35
      E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      U unsupported-construct app/p.ts:9:35 subject=function:app/p.ts#h detail=an object another name may share was filled in by a call data=field:features/user/user.ts#userData.user/email
      -- const a: any = {}; fill(a, 1); res.json(a.k)
      E calls function:app/p.ts#h->function:app/p.ts#fill p=- static o= h= @app/p.ts:9:22
      -- fill(make(), x.email)
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:9:8
      E calls function:app/p.ts#h->function:app/p.ts#fill p=- static o= h= @app/p.ts:9:3
      E passes function:app/p.ts#h->parameter:app/p.ts#fill.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
      E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      E returns function:app/p.ts#make->return:app/p.ts#make#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:25
      E passes return:app/p.ts#make#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
      E passes function:app/p.ts#h->parameter:app/p.ts#fill.o p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3"
    `)
  })
})

describe("flow-scan: calls whose callee is a value", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** Each statement is scanned as a program of its own; the copy tags come with the facts. */
  const each = async (statements: readonly string[], extra = ""): Promise<string> => {
    const out: string[] = []
    for (const statement of statements) {
      const body = `  const x: any = ${u}\n  ${statement}`
      const { input } = await h.scan(handler(body, extra))
      const tags = (input.edgeTags ?? []).map((tag) => `T ${tag.via}${tag.fresh ? " fresh" : ""}`)
      out.push(`-- ${statement}`, ...facts(input), ...tags)
    }
    return out.join("\n")
  }
  const defs = [
    `const idf = (v: any) => v`,
    `const other = (v: any) => 'other'`,
    `class Base { constructor(public p: any) {} }`,
  ].join("\n")

  it("a global builtin gives back what it was handed, and structuredClone a deep copy", async () => {
    expect(
      await each(
        [
          "res.json(String(x.email))",
          "res.json(parseInt(x.id))",
          "res.json(Number(x.id))",
          "res.json(structuredClone(x))",
          "res.json(structuredClone(x).email)",
          "const structuredClone2 = structuredClone; res.json(structuredClone2(x).email)",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- res.json(String(x.email))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- res.json(parseInt(x.id))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- res.json(Number(x.id))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- res.json(structuredClone(x))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      T copy
      -- res.json(structuredClone(x).email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      T copy
      -- const structuredClone2 = structuredClone; res.json(structuredClone2(x).email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:45
      U unresolved-call app/p.ts:7:54 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
    `)
  })

  it("a function held in a variable, an array, an object or either arm of a condition is the function that is called", async () => {
    expect(
      await each(
        [
          "const f = idf; res.json(f(x.email))",
          "const fns = [idf]; res.json(fns[0](x.email))",
          "const o: any = { f: idf }; res.json(o['f'](x.email))",
          "const key = 'f'; const o: any = { f: idf }; res.json(o[key](x.email))",
          "res.json((0, idf)(x.email))",
          "res.json((flag ? idf : other)(x.email))",
          "res.json((flag ? other : idf)(x.email))",
          "res.json(ext(x.email))",
          "res.json((() => x.email)())",
          "res.json((function () { return x.name })())",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- const f = idf; res.json(f(x.email))
      E calls function:app/p.ts#h->function:app/p.ts#idf p=- static o= h= @app/p.ts:7:27
      E passes function:app/p.ts#h->parameter:app/p.ts#idf.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:27
      E returns function:app/p.ts#idf->return:app/p.ts#idf#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
      E passes return:app/p.ts#idf#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:18
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:18
      -- const fns = [idf]; res.json(fns[0](x.email))
      E calls function:app/p.ts#h->function:app/p.ts#idf p=- static o= h= @app/p.ts:7:31
      E passes function:app/p.ts#h->parameter:app/p.ts#idf.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:31
      E returns function:app/p.ts#idf->return:app/p.ts#idf#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
      E passes return:app/p.ts#idf#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:22
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:22
      -- const o: any = { f: idf }; res.json(o['f'](x.email))
      E calls function:app/p.ts#h->function:app/p.ts#idf p=- static o= h= @app/p.ts:7:39
      E passes function:app/p.ts#h->parameter:app/p.ts#idf.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:39
      E returns function:app/p.ts#idf->return:app/p.ts#idf#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
      E passes return:app/p.ts#idf#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:30
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:30
      -- const key = 'f'; const o: any = { f: idf }; res.json(o[key](x.email))
      E calls function:app/p.ts#h->function:app/p.ts#idf p=- static o= h= @app/p.ts:7:56
      E passes function:app/p.ts#h->parameter:app/p.ts#idf.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:56
      E returns function:app/p.ts#idf->return:app/p.ts#idf#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
      E passes return:app/p.ts#idf#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:47
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:47
      -- res.json((0, idf)(x.email))
      E calls function:app/p.ts#h->function:app/p.ts#idf p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#idf.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#idf->return:app/p.ts#idf#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
      E passes return:app/p.ts#idf#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- res.json((flag ? idf : other)(x.email))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:7:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json((flag ? other : idf)(x.email))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:7:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json(ext(x.email))
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:7:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- res.json((() => x.email)())
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@7:13 p=- static o= h= @app/p.ts:7:12
      E returns function:app/p.ts#h>anonymous@7:13->return:app/p.ts#h>anonymous@7:13#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:19
      E passes return:app/p.ts#h>anonymous@7:13#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- res.json((function () { return x.name })())
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@7:13 p=- static o= h= @app/p.ts:7:12
      E returns function:app/p.ts#h>anonymous@7:13->return:app/p.ts#h>anonymous@7:13#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:27
      E passes return:app/p.ts#h>anonymous@7:13#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"
    `)
  })

  it("a capability method held in a variable is still that method", async () => {
    expect(
      await each(
        [
          "const get = userData.getSnapshot; res.json(get().fields.user.email)",
          "const get = userData.getSnapshot.bind(userData); res.json(get().fields.user.name)",
          "const get = userData['getSnapshot']; res.json(get().fields.user.id)",
          "const get = userData.nothing; res.json(get())",
        ],
        defs,
      ),
    ).toMatchInlineSnapshot(`
      "-- const get = userData.getSnapshot; res.json(get().fields.user.email)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:37
      T derive
      -- const get = userData.getSnapshot.bind(userData); res.json(get().fields.user.name)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:52
      T derive
      -- const get = userData['getSnapshot']; res.json(get().fields.user.id)
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:40
      T derive
      -- const get = userData.nothing; res.json(get())
      T derive"
    `)
  })

  it("super(...) hands its arguments to the constructor of the superclass", async () => {
    expect(
      await each(
        [
          "res.json(new Sub(x.email).p)",
          "res.json(new Sub2(x.email).p)",
          "res.json(new Sub3(x.email).q)",
        ],
        `${defs}\nclass Sub extends Base { constructor(v: any) { super(v) } }\nclass Sub2 extends Base { constructor(v: any) { super(1) } }\nclass Sub3 extends (ext as any) { q: any; constructor(v: any) { super(v); this.q = v } }`,
      ),
    ).toMatchInlineSnapshot(`
      "-- res.json(new Sub(x.email).p)
      E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:10:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:5:48
      E passes function:app/p.ts#Sub.constructor->parameter:app/p.ts#Base.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:48
      E returns function:app/p.ts#Base.constructor->return:app/p.ts#Base.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:14
      E passes return:app/p.ts#Base.constructor#return->function:app/p.ts#Sub.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E calls function:app/p.ts#Sub2.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:6:49
      -- res.json(new Sub2(x.email).p)
      E calls function:app/p.ts#h->function:app/p.ts#Sub2.constructor p=- static o= h= @app/p.ts:10:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub2.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:12
      E calls function:app/p.ts#Sub2.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:6:49
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:5:48
      -- res.json(new Sub3(x.email).q)
      E calls function:app/p.ts#h->function:app/p.ts#Sub3.constructor p=- static o= h= @app/p.ts:10:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub3.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:12
      E returns function:app/p.ts#Sub3.constructor->return:app/p.ts#Sub3.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:43
      E returns function:app/p.ts#Sub3.constructor->return:app/p.ts#Sub3.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:43
      E passes return:app/p.ts#Sub3.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:12
      E passes return:app/p.ts#Sub3.constructor#return->function:app/p.ts#h p=email.q inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.q inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:5:48
      E calls function:app/p.ts#Sub2.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:6:49
      U unresolved-call app/p.ts:7:65 subject=function:app/p.ts#Sub3.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unsupported-construct app/p.ts:7:75 subject=function:app/p.ts#Sub3.constructor detail=tracked data stored into an object whose origin the analysis cannot see data=field:features/user/user.ts#userData.user/email"
    `)
  })
})

describe("flow-scan: the bound on re-exports, and the names a project shadows", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  const defaults = defaultScanLimits()
  /** A chain of `length` files, each re-exporting the next with `export *`; the last holds `pick`. */
  const chain = (length: number): Record<string, string> => {
    const files: Record<string, string> = {}
    for (let i = 0; i < length; i++)
      files[`app/c${String(i)}.ts`] =
        i === length - 1
          ? "export const pick = (v: any) => v"
          : `export * from "./c${String(i + 1)}.js"`
    return files
  }
  const resolves = async (length: number, maxExportHops: number): Promise<boolean> => {
    const { input } = await h.scan(
      {
        ...handler(
          `  const x: any = ${u}\n  res.json(pick(x.email))`,
          `import { pick } from "./c0.js"\n`,
        ),
        ...chain(length),
      },
      {},
      undefined,
      { ...defaults, maxExportHops },
    )
    return input.unknowns.length === 0
  }

  it("a chain of re-exports is followed up to the bound and not past it", async () => {
    const table: Record<string, boolean[]> = {}
    for (const bound of [2, 3, 4]) {
      const row: boolean[] = []
      // One after the other: every scan writes its files into the same directory.
      for (const length of [1, 2, 3, 4, 5, 6]) row.push(await resolves(length, bound))
      table[`bound ${String(bound)}`] = row
    }
    expect(table).toMatchInlineSnapshot(`
      {
        "bound 2": [
          true,
          true,
          false,
          false,
          false,
          false,
        ],
        "bound 3": [
          true,
          true,
          true,
          false,
          false,
          false,
        ],
        "bound 4": [
          true,
          true,
          true,
          true,
          false,
          false,
        ],
      }
    `)
  })

  it("a cycle of re-exports ends the search, and a name in the cycle is still found", async () => {
    const files = {
      "app/a.ts": `export * from "./b.js"\nexport const fromA = (v: any) => v`,
      "app/b.ts": `export * from "./a.js"\nexport const fromB = (v: any) => v`,
    }
    const run = async (name: string) =>
      facts(
        (
          await h.scan({
            ...handler(
              `  const x: any = ${u}\n  res.json(${name}(x.email))`,
              `import { ${name} } from "./a.js"\n`,
            ),
            ...files,
          })
        ).input,
      ).join("\n")
    expect({
      inCycle: await run("fromB"),
      own: await run("fromA"),
      missing: await run("nope"),
    }).toMatchInlineSnapshot(`
      {
        "inCycle": "E calls function:app/p.ts#h->function:app/b.ts#fromB p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/b.ts#fromB.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/b.ts#fromB->return:app/b.ts#fromB#return p=email static o=field:features/user/user.ts#userData.user h= @app/b.ts:2:34
      E passes return:app/b.ts#fromB#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3",
        "missing": "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email",
        "own": "E calls function:app/p.ts#h->function:app/a.ts#fromA p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/a.ts#fromA.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/a.ts#fromA->return:app/a.ts#fromA#return p=email static o=field:features/user/user.ts#userData.user h= @app/a.ts:2:34
      E passes return:app/a.ts#fromA#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3",
      }
    `)
  })

  it("Array.prototype.m.call is the array method, and a project's own Array is not", async () => {
    const run = async (extra: string) =>
      facts(
        (
          await h.scan(
            handler(
              `  const x: any = ${u}\n  const a: any[] = []\n  Array.prototype.push.call(a, x.email)\n  res.json(a[0])`,
              extra,
            ),
          )
        ).input,
      ).join("\n")
    expect({
      builtin: await run(""),
      shadowedAtModule: await run(
        `const Array: any = { prototype: { push: { call: (a: any, v: any) => v } } }\n`,
      ),
    }).toMatchInlineSnapshot(`
      {
        "builtin": "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3",
        "shadowedAtModule": "E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@2:49 p=- static o= h= @app/p.ts:6:3
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@2:49.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E returns function:app/p.ts#<module>>anonymous@2:49->return:app/p.ts#<module>>anonymous@2:49#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:69",
      }
    `)
  })

  it("import() and require() take a literal specifier of a file in the project, and nothing else", async () => {
    const lib = { "app/lib.ts": "export const pick = (v: any) => v" }
    const run = async (body: string) =>
      facts((await h.scan({ ...handler(`  const x: any = ${u}\n${body}`), ...lib })).input).join(
        "\n",
      )
    expect({
      literal: await run("  const m = await import('./lib'); res.json(m.pick(x.email))"),
      template: await run("  const m = await import(`./lib`); res.json(m.pick(x.email))"),
      dynamic: await run("  const m = await import(name); res.json(m.pick(x.email))"),
      noArgument: await run("  const m = await (import as any)(); res.json(m.pick(x.email))"),
      unresolved: await run("  const m = await import('./nowhere'); res.json(m.pick(x.email))"),
      requireLiteral: await run("  const m = require('./lib'); res.json(m.pick(x.email))"),
      requireTemplate: await run("  const m = require(`./lib`); res.json(m.pick(x.email))"),
    }).toMatchInlineSnapshot(`
      {
        "dynamic": "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      U unresolved-call app/p.ts:4:42 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email",
        "literal": "E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:45
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:45
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36",
        "noArgument": "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:38
      U unresolved-call app/p.ts:4:47 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email",
        "requireLiteral": "E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:40
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31",
        "requireTemplate": "E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:40
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31",
        "template": "E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:45
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:45
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36",
        "unresolved": "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      U unresolved-call app/p.ts:4:49 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email",
      }
    `)
  })
})

describe("flow-scan: superclasses of different shapes, constructors, and closures made per call", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  interface Case {
    body: string
    extra?: string
    files?: Readonly<Record<string, string>>
  }
  /** Each program is scanned on its own, with the code it names. */
  const each = async (cases: Readonly<Record<string, Case>>): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "", files = {} }] of Object.entries(cases)) {
      const { input } = await h.scan({
        ...handler(`  const x: any = ${u}\n${body}`, extra),
        ...files,
      })
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }
  const P = `class P { constructor(public p: any) {} m(w: any) { return w } }\n`

  it("only an extends clause names a superclass, and the shapes it may take", async () => {
    expect(
      await each({
        implementsOnly: {
          body: "  res.json(new B(x.email).m(x.name)); res.json(new B(x.email).missing(x.id))",
          extra: `interface I { m(w: any): any }\nclass B implements I { constructor(public p: any) {} m(w: any) { return w } }`,
        },
        extendsAndImplements: {
          body: "  res.json(new B(x.email).p)",
          extra: `${P}interface I {}\nclass B extends P implements I {}`,
        },
        callExpressionBase: {
          body: "  res.json(new B(x.email).p)",
          extra: `${P}const mixin = (c: any) => c\nclass B extends mixin(P) {}`,
        },
        nestedPropertyBase: {
          body: "  res.json(new B(x.email).p)",
          extra: `${P}const ns: any = { inner: { P } }\nclass B extends ns.inner.P {}`,
        },
        propertyOfObjectBase: {
          body: "  res.json(new B(x.email).p)",
          extra: `${P}const ns: any = { P }\nclass B extends ns.P {}`,
        },
        namespaceBase: {
          body: "  res.json(new B(x.email).p)",
          extra: `import * as lib from "./lib"\nclass B extends lib.P {}`,
          files: { "app/lib.ts": P.replace("class P", "export class P") },
        },
        importedNameBase: {
          body: "  res.json(new B(x.email).p)",
          extra: `import { P } from "./lib"\nclass B extends P {}`,
          files: { "app/lib.ts": P.replace("class P", "export class P") },
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- implementsOnly
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:24
      E calls function:app/p.ts#h->function:app/p.ts#B.m p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.m.w p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#B.m->return:app/p.ts#B.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:66
      E passes return:app/p.ts#B.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:39
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:39
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:39
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:39
      U unresolved-call app/p.ts:6:48 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id,field:features/user/user.ts#userData.user/email
      -- extendsAndImplements
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:4:1
      E passes function:app/p.ts#B.constructor->parameter:app/p.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- callExpressionBase
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email.p inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.p inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:4:1 subject=function:app/p.ts#B.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- nestedPropertyBase
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email.p inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.p inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:4:1 subject=function:app/p.ts#B.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- propertyOfObjectBase
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email.p inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.p inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:4:1 subject=function:app/p.ts#B.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- namespaceBase
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/lib.ts#P.constructor p=- static o= h= @app/p.ts:3:1
      E passes function:app/p.ts#B.constructor->parameter:app/lib.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/lib.ts#P.constructor->return:app/lib.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:18
      E passes return:app/lib.ts#P.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- importedNameBase
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/lib.ts#P.constructor p=- static o= h= @app/p.ts:3:1
      E passes function:app/p.ts#B.constructor->parameter:app/lib.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/lib.ts#P.constructor->return:app/lib.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:18
      E passes return:app/lib.ts#P.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
    `)
  })

  it("a subclass without a constructor passes its arguments up, and one with a constructor passes what super() is given", async () => {
    expect(
      await each({
        implicit: { body: "  res.json(new B(x.email).p)", extra: `${P}class B extends P {}` },
        explicit: {
          body: "  res.json(new B(x.email, x.name).p)",
          extra: `${P}class B extends P { constructor(a: any, b: any) { super(b) } }`,
        },
        explicitSwap: {
          body: "  res.json(new B(x.email, x.name).p)",
          extra: `${P}class B extends P { constructor(a: any, b: any) { super(a) } }`,
        },
        superWithNothing: {
          body: "  res.json(new B(x.email).p)",
          extra: `${P}class B extends P { constructor(a: any) { super() } }`,
        },
        grandparent: {
          body: "  res.json(new C(x.email).p)",
          extra: `${P}class B extends P {}\nclass C extends B {}`,
        },
        superInStaticBlock: {
          body: "  res.json(B.s)",
          extra: `class A0 { static s = ${u}.email }\nclass B extends A0 {}`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- implicit
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:1
      E passes function:app/p.ts#B.constructor->parameter:app/p.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- explicit
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:51
      E passes function:app/p.ts#B.constructor->parameter:app/p.ts#P.constructor.p p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:51
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#B.constructor p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- explicitSwap
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:51
      E passes function:app/p.ts#B.constructor->parameter:app/p.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:51
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- superWithNothing
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#B.constructor.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#B.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:43
      -- grandparent
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E calls function:app/p.ts#C.constructor->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:4:1
      E passes function:app/p.ts#C.constructor->parameter:app/p.ts#B.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E calls function:app/p.ts#B.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:1
      E passes function:app/p.ts#B.constructor->parameter:app/p.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#B.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#B.constructor->return:app/p.ts#B.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E passes return:app/p.ts#B.constructor#return->function:app/p.ts#C.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- superInStaticBlock
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E calls function:app/p.ts#B.constructor->function:app/p.ts#A0.constructor p=- static o= h= @app/p.ts:3:1"
    `)
  })

  it("a function made inside another is a closure of each call, with that call's data", async () => {
    expect(
      await each({
        callTwice: {
          body: "  const f1 = outer(x.email); const f2 = outer(x.name); res.json(f1()); res.json(f2())",
          extra: `function outer(v: any) { return function inner() { return v } }`,
        },
        arrow: {
          body: "  const f1 = outer(x.email); const f2 = outer(x.name); res.json(f1()); res.json(f2())",
          extra: `const outer = (v: any) => () => v`,
        },
        counterShared: {
          body: "  const f = outer(); f(x.email); res.json(f())",
          extra: `function outer() { let held: any; return (v?: any) => { if (v) held = v; return held } }`,
        },
        storedInObject: {
          body: "  const o = make(x.email); res.json(o.get())",
          extra: `const make = (v: any) => ({ get: () => v, set: (w: any) => w })`,
        },
        passedAsCallback: {
          body: "  run(() => x.email)",
          extra: `function run(cb: () => any) { return cb() }\n`,
        },
        returnedFromCallback: {
          body: "  res.json(run(() => x.email))",
          extra: `function run(cb: () => any) { return cb() }\n`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- callTwice
      E calls function:app/p.ts#h->function:app/p.ts#outer p=- static o= h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#outer.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#outer.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:41
      E calls function:app/p.ts#h->function:app/p.ts#outer>anonymous@2:33 p=- static o= h= @app/p.ts:5:65
      E returns function:app/p.ts#outer>anonymous@2:33->return:app/p.ts#outer>anonymous@2:33#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E passes return:app/p.ts#outer>anonymous@2:33#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:56
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:56
      E returns function:app/p.ts#outer>anonymous@2:33->return:app/p.ts#outer>anonymous@2:33#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E passes return:app/p.ts#outer>anonymous@2:33#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:72
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:72
      -- arrow
      E calls function:app/p.ts#h->function:app/p.ts#outer p=- static o= h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#outer.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#outer.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:41
      E calls function:app/p.ts#h->function:app/p.ts#outer>anonymous@2:27 p=- static o= h= @app/p.ts:5:65
      E returns function:app/p.ts#outer>anonymous@2:27->return:app/p.ts#outer>anonymous@2:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:33
      E passes return:app/p.ts#outer>anonymous@2:27#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:56
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:56
      E returns function:app/p.ts#outer>anonymous@2:27->return:app/p.ts#outer>anonymous@2:27#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:33
      E passes return:app/p.ts#outer>anonymous@2:27#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:72
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:72
      -- counterShared
      E calls function:app/p.ts#h->function:app/p.ts#outer p=- static o= h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#outer>anonymous@2:42 p=- static o= h= @app/p.ts:5:22
      E passes function:app/p.ts#h->parameter:app/p.ts#outer>anonymous@2:42.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:22
      E returns function:app/p.ts#outer>anonymous@2:42->return:app/p.ts#outer>anonymous@2:42#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:74
      E passes return:app/p.ts#outer>anonymous@2:42#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:34
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:34
      -- storedInObject
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2:34 p=- static o= h= @app/p.ts:5:37
      E returns function:app/p.ts#make>anonymous@2:34->return:app/p.ts#make>anonymous@2:34#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:40
      E passes return:app/p.ts#make>anonymous@2:34#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:28
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:28
      -- passedAsCallback
      E calls function:app/p.ts#h->function:app/p.ts#run p=- static o= h= @app/p.ts:5:3
      E calls function:app/p.ts#run->function:app/p.ts#h>anonymous@5:7 p=- static o= h= @app/p.ts:2:38
      E returns function:app/p.ts#h>anonymous@5:7->return:app/p.ts#h>anonymous@5:7#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E passes return:app/p.ts#h>anonymous@5:7#return->function:app/p.ts#run p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#run->return:app/p.ts#run#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      -- returnedFromCallback
      E calls function:app/p.ts#h->function:app/p.ts#run p=- static o= h= @app/p.ts:5:12
      E calls function:app/p.ts#run->function:app/p.ts#h>anonymous@5:16 p=- static o= h= @app/p.ts:2:38
      E returns function:app/p.ts#h>anonymous@5:16->return:app/p.ts#h>anonymous@5:16#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:22
      E passes return:app/p.ts#h>anonymous@5:16#return->function:app/p.ts#run p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#run->return:app/p.ts#run#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E passes return:app/p.ts#run#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })
})
