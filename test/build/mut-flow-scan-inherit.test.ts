import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { dump, IMPORT_CAP, makeHarness, USER } from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

/** Inheritance, `super`, re-export chains and the limits on them. */
describe("flow-scan: classes that extend, and the files that re-export", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const files = async (input: Record<string, string>) =>
    dump((await h.scan(input)).input).join("\n")
  const leaks = async (input: Record<string, string>) =>
    (await h.scan(input)).input.edges
      .filter((e) => e.kind === "side-effect")
      .map((e) => (e.path ?? []).join("."))
      .sort()
  const SEND = "(res: any, v: any) { res.json(v) }"

  it("a class extends one from another file by name, and overrides, inherits and calls super", async () => {
    expect(
      await files({
        "app/base.ts": `export class Base {
  static base = ${USER}.id
  static sbase(res: any) { res.json(Base.base) }
  get g() { return ${USER}.role }
  send${SEND}
  hello(res: any) { res.json(${USER}.name) }
}
`.replace("export class", `${IMPORT_CAP}export class`),
        "app/main.ts": `${IMPORT_CAP}import { Base } from "./base.js"
class Derived extends Base {
  hello(res: any) { super.hello(res); res.json(${USER}.email) }
}
export function a(res: any) { new Derived().hello(res) }
export function b(res: any) { new Derived().send(res, ${USER}.passwordHash) }
export function c(res: any) { res.json(new Derived().g) }
export function d(res: any) { res.json(Derived.base) }
export function e(res: any) { Derived.sbase(res) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts a static bk= cl= src=6:1
      N function app/main.ts Derived.constructor static bk= cl= src=
      N function app/base.ts Base.constructor static bk= cl= src=
      N function app/main.ts Derived.hello static bk= cl= src=4:3
      N function app/base.ts Base.hello static bk= cl= src=7:3
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/main.ts b static bk= cl= src=7:1
      N function app/base.ts Base.send static bk= cl= src=6:3
      N parameter app/base.ts Base.send.v static bk= cl= src=
      N function app/main.ts c static bk= cl= src=8:1
      N function app/base.ts Base.get g static bk= cl= src=5:3
      N return app/base.ts Base.get g#return static bk= cl= src=
      N function app/base.ts Base.static static bk= cl= src=
      N function app/main.ts d static bk= cl= src=9:1
      N function app/main.ts e static bk= cl= src=10:1
      N function app/base.ts Base.sbase static bk= cl= src=4:3
      N parameter app/base.ts Base.sbase.res static bk= cl= src=
      N return app/base.ts Base.sbase#return static bk= cl= src=
      N parameter app/base.ts Base.send.res static bk= cl= src=
      N return app/base.ts Base.send#return static bk= cl= src=
      N parameter app/base.ts Base.hello.res static bk= cl= src=
      N return app/base.ts Base.hello#return static bk= cl= src=
      N parameter app/main.ts Derived.hello.res static bk= cl= src=
      N return app/main.ts Derived.hello#return static bk= cl= src=
      N parameter app/main.ts a.res static bk= cl= src=
      N return app/main.ts a#return static bk= cl= src=
      N parameter app/main.ts b.res static bk= cl= src=
      N return app/main.ts b#return static bk= cl= src=
      N parameter app/main.ts c.res static bk= cl= src=
      N return app/main.ts c#return static bk= cl= src=
      N parameter app/main.ts d.res static bk= cl= src=
      N return app/main.ts d#return static bk= cl= src=
      N parameter app/main.ts e.res static bk= cl= src=
      N return app/main.ts e#return static bk= cl= src=
      E calls function:app/main.ts#a->function:app/main.ts#Derived.constructor p=- static o= h= @app/main.ts:6:31
      E calls function:app/main.ts#Derived.constructor->function:app/base.ts#Base.constructor p=- static o= h= @app/main.ts:3:1
      E calls function:app/main.ts#a->function:app/main.ts#Derived.hello p=- static o= h= @app/main.ts:6:31
      E calls function:app/main.ts#Derived.hello->function:app/base.ts#Base.hello p=- static o= h= @app/main.ts:4:21
      E reads field:features/user/user.ts#userData.user->function:app/base.ts#Base.hello p= static o=field:features/user/user.ts#userData.user h= @app/base.ts:7:30
      E reads field:features/user/user.ts#userData.user->function:app/base.ts#Base.hello p=name static o=field:features/user/user.ts#userData.user h= @app/base.ts:7:30
      E side-effect function:app/base.ts#Base.hello->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/base.ts:7:21
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#Derived.hello p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:48
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#Derived.hello p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:48
      E side-effect function:app/main.ts#Derived.hello->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:39
      E calls function:app/main.ts#b->function:app/main.ts#Derived.constructor p=- static o= h= @app/main.ts:7:31
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#b p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:7:55
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#b p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/main.ts:7:55
      E calls function:app/main.ts#b->function:app/base.ts#Base.send p=- static o= h= @app/main.ts:7:31
      E passes function:app/main.ts#b->parameter:app/base.ts#Base.send.v p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/main.ts:7:31
      E reads parameter:app/base.ts#Base.send.v->function:app/base.ts#Base.send p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/base.ts:6:28
      E side-effect function:app/base.ts#Base.send->boundary:boundary:code#http-response p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/base.ts:6:28
      E calls function:app/main.ts#c->function:app/main.ts#Derived.constructor p=- static o= h= @app/main.ts:8:40
      E calls function:app/main.ts#c->function:app/base.ts#Base.get g p=- static o= h= @app/main.ts:8:40
      E reads field:features/user/user.ts#userData.user->function:app/base.ts#Base.get g p= static o=field:features/user/user.ts#userData.user h= @app/base.ts:5:20
      E reads field:features/user/user.ts#userData.user->function:app/base.ts#Base.get g p=role static o=field:features/user/user.ts#userData.user h= @app/base.ts:5:20
      E returns function:app/base.ts#Base.get g->return:app/base.ts#Base.get g#return p=role static o=field:features/user/user.ts#userData.user h= @app/base.ts:5:13
      E passes return:app/base.ts#Base.get g#return->function:app/main.ts#c p=role static o=field:features/user/user.ts#userData.user h= @app/main.ts:8:31
      E side-effect function:app/main.ts#c->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/main.ts:8:31
      E reads field:features/user/user.ts#userData.user->function:app/base.ts#Base.static p= static o=field:features/user/user.ts#userData.user h= @app/base.ts:3:17
      E reads field:features/user/user.ts#userData.user->function:app/base.ts#Base.static p=id static o=field:features/user/user.ts#userData.user h= @app/base.ts:3:17
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#d p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:9:31
      E side-effect function:app/main.ts#d->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:9:31
      E calls function:app/main.ts#e->function:app/base.ts#Base.sbase p=- static o= h= @app/main.ts:10:31
      E reads field:features/user/user.ts#userData.user->function:app/base.ts#Base.sbase p=id static o=field:features/user/user.ts#userData.user h= @app/base.ts:4:28
      E side-effect function:app/base.ts#Base.sbase->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/base.ts:4:28
      E discards function:app/base.ts#Base.hello->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.hello->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.hello->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.hello->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#Derived.hello->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#Derived.hello->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#Derived.hello->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#Derived.hello->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#b->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#b->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#b->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#b->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.get g->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.get g->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.get g->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.get g->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.static->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.static->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.static->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/base.ts#Base.static->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a class extends one reached through a namespace import", async () => {
    expect(
      await files({
        "app/base.ts": `export class Base { send${SEND} }\n`,
        "app/main.ts": `${IMPORT_CAP}import * as ns from "./base.js"
class D extends ns.Base {}
export function go(res: any) { new D().send(res, ${USER}.email) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=4:1
      N function app/main.ts D.constructor static bk= cl= src=
      N function app/base.ts Base.constructor static bk= cl= src=
      N function app/base.ts Base.send static bk= cl= src=1:21
      N parameter app/base.ts Base.send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/base.ts Base.send.res static bk= cl= src=
      N return app/base.ts Base.send#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E calls function:app/main.ts#go->function:app/main.ts#D.constructor p=- static o= h= @app/main.ts:4:32
      E calls function:app/main.ts#D.constructor->function:app/base.ts#Base.constructor p=- static o= h= @app/main.ts:3:1
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:50
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:50
      E calls function:app/main.ts#go->function:app/base.ts#Base.send p=- static o= h= @app/main.ts:4:32
      E passes function:app/main.ts#go->parameter:app/base.ts#Base.send.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:32
      E reads parameter:app/base.ts#Base.send.v->function:app/base.ts#Base.send p=email static o=field:features/user/user.ts#userData.user h= @app/base.ts:1:46
      E side-effect function:app/base.ts#Base.send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/base.ts:1:46
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a class that extends something the scan cannot see: a member it does not declare is not known", async () => {
    expect(
      await files({
        "app/p.ts": `${IMPORT_CAP}import { Ext } from "some-package"
class Mine extends Ext { own(res: any, v: any) { res.json(v) } }
export function a(res: any) { new Mine().inherited(${USER}.email) }
export function b(res: any) { new Mine().own(res, ${USER}.name) }
export function c(res: any) { res.json(new Mine().prop) }
export function d(res: any) { res.json(Mine.staticInherited(${USER}.id)) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts a static bk= cl= src=4:1
      N function app/p.ts Mine.constructor static bk= cl= src=
      N function app/p.ts b static bk= cl= src=5:1
      N function app/p.ts Mine.own static bk= cl= src=3:26
      N parameter app/p.ts Mine.own.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts c static bk= cl= src=6:1
      N function app/p.ts d static bk= cl= src=7:1
      N parameter app/p.ts Mine.own.res static bk= cl= src=
      N return app/p.ts Mine.own#return static bk= cl= src=
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      N parameter app/p.ts c.res static bk= cl= src=
      N return app/p.ts c#return static bk= cl= src=
      N parameter app/p.ts d.res static bk= cl= src=
      N return app/p.ts d#return static bk= cl= src=
      E calls function:app/p.ts#a->function:app/p.ts#Mine.constructor p=- static o= h= @app/p.ts:4:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:52
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:52
      E calls function:app/p.ts#b->function:app/p.ts#Mine.constructor p=- static o= h= @app/p.ts:5:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:51
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:51
      E calls function:app/p.ts#b->function:app/p.ts#Mine.own p=- static o= h= @app/p.ts:5:31
      E passes function:app/p.ts#b->parameter:app/p.ts#Mine.own.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:31
      E reads parameter:app/p.ts#Mine.own.v->function:app/p.ts#Mine.own p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:50
      E side-effect function:app/p.ts#Mine.own->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:50
      E calls function:app/p.ts#c->function:app/p.ts#Mine.constructor p=- static o= h= @app/p.ts:6:40
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:61
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:61
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:31
      E side-effect function:app/p.ts#d->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:31
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/p.ts:4:31 subject=function:app/p.ts#a detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:7:40 subject=function:app/p.ts#d detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
    `)
  })

  it("members a decorator the scan cannot follow may have replaced are not known", async () => {
    expect(
      await files({
        "app/p.ts": `${IMPORT_CAP}declare function dec(...a: any[]): any
class K {
  @dec get g() { return ${USER}.email }
  @dec m(v: any) { return v }
  plain(v: any) { return v }
}
export function a(res: any) { res.json(new K().g) }
export function b(res: any) { res.json(new K().m(${USER}.name)) }
export function c(res: any) { res.json(new K().plain(${USER}.id)) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts a static bk= cl= src=8:1
      N function app/p.ts K.constructor static bk= cl= src=
      N function app/p.ts b static bk= cl= src=9:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts c static bk= cl= src=10:1
      N function app/p.ts K.plain static bk= cl= src=6:3
      N parameter app/p.ts K.plain.v static bk= cl= src=
      N return app/p.ts K.plain#return static bk= cl= src=
      N function app/p.ts K.get g static bk= cl= src=4:3
      N return app/p.ts K.get g#return static bk= cl= src=
      N function app/p.ts K.m static bk= cl= src=5:3
      N parameter app/p.ts K.m.v static bk= cl= src=
      N return app/p.ts K.m#return static bk= cl= src=
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      N parameter app/p.ts c.res static bk= cl= src=
      N return app/p.ts c#return static bk= cl= src=
      E calls function:app/p.ts#a->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:8:40
      E calls function:app/p.ts#b->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:9:40
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:50
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:50
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:9:31
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:9:31
      E calls function:app/p.ts#c->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:10:40
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#c p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:54
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#c p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:54
      E calls function:app/p.ts#c->function:app/p.ts#K.plain p=- static o= h= @app/p.ts:10:40
      E passes function:app/p.ts#c->parameter:app/p.ts#K.plain.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:40
      E reads parameter:app/p.ts#K.plain.v->function:app/p.ts#K.plain p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:19
      E returns function:app/p.ts#K.plain->return:app/p.ts#K.plain#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:19
      E passes return:app/p.ts#K.plain#return->function:app/p.ts#c p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:31
      E side-effect function:app/p.ts#c->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#K.get g p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:25
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#K.get g p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:25
      E returns function:app/p.ts#K.get g->return:app/p.ts#K.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#K.get g->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#K.get g->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#K.get g->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#K.get g->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/p.ts:9:40 subject=function:app/p.ts#b detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
    `)
  })

  it("two classes that extend each other end the search instead of looping", async () => {
    expect(
      await files({
        "app/p.ts": `${IMPORT_CAP}class A extends (B as any) { a() { return 1 } }
class B extends A { b() { return 2 } }
export function go(res: any) { res.json(new B().missing(${USER}.email)) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=4:1
      N function app/p.ts B.constructor static bk= cl= src=
      N function app/p.ts A.constructor static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts A.a static bk= cl= src=2:30
      N return app/p.ts A.a#return static bk= cl= src=
      N function app/p.ts B.b static bk= cl= src=3:21
      N return app/p.ts B.b#return static bk= cl= src=
      N parameter app/p.ts go.res static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      E calls function:app/p.ts#go->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:4:41
      E calls function:app/p.ts#B.constructor->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:3:1
      E calls function:app/p.ts#A.constructor->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:2:1
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:57
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:57
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:32
      E side-effect function:app/p.ts#go->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:32
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/p.ts:4:41 subject=function:app/p.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("an instance property that holds a function shadows a method of the same name", async () => {
    expect(
      await files({
        "app/p.ts": `${IMPORT_CAP}class P { send(res: any, v: any) { res.json(v) } }
export function go(res: any) { const p: any = new P(); p.send = (r: any, v: any) => r.json(v); p.send(res, ${USER}.email) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=3:1
      N function app/p.ts P.constructor static bk= cl= src=
      N function app/p.ts go>anonymous@3:65 static bk= cl= src=3:65
      N parameter app/p.ts go>anonymous@3:65.v static bk= cl= src=
      N return app/p.ts go>anonymous@3:65#return static bk= cl= src=
      N function app/p.ts P.send static bk= cl= src=2:11
      N parameter app/p.ts P.send.res static bk= cl= src=
      N parameter app/p.ts P.send.v static bk= cl= src=
      N return app/p.ts P.send#return static bk= cl= src=
      N parameter app/p.ts go.res static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      N parameter app/p.ts go>anonymous@3:65.r static bk= cl= src=
      E calls function:app/p.ts#go->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:47
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:108
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:108
      E calls function:app/p.ts#go->function:app/p.ts#go>anonymous@3:65 p=- static o= h= @app/p.ts:3:96
      E passes function:app/p.ts#go->parameter:app/p.ts#go>anonymous@3:65.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:96
      E reads parameter:app/p.ts#go>anonymous@3:65.v->function:app/p.ts#go>anonymous@3:65 p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:85
      E returns function:app/p.ts#go>anonymous@3:65->return:app/p.ts#go>anonymous@3:65#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:85
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/p.ts:3:85 subject=function:app/p.ts#go>anonymous@3:65 detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  describe("limits", () => {
    const chain = (length: number) => {
      const classes = Array.from({ length }, (_, i) =>
        i === 0 ? `class C0 { send${SEND} }` : `class C${i} extends C${i - 1} {}`,
      ).join("\n")
      return {
        "app/p.ts": `${IMPORT_CAP}${classes}\nexport function go(res: any) { new C${length - 1}().send(res, ${USER}.email) }\n`,
      }
    }

    it("finds a method through a chain of classes up to the limit, and not beyond it", async () => {
      const found = [] as number[]
      for (const length of [30, 36, 37, 40]) {
        if ((await leaks(chain(length))).length > 0) found.push(length)
      }
      expect(found).toEqual([30, 36])
    })

    const reexports = (hops: number) => {
      const input: Record<string, string> = {
        "app/f0.ts": `export function send${SEND}\n`,
        "app/main.ts": `${IMPORT_CAP}import { send } from "./f${hops}.js"\nexport function go(res: any) { send(res, ${USER}.email) }\n`,
      }
      for (let i = 1; i <= hops; i += 1) input[`app/f${i}.ts`] = `export * from "./f${i - 1}.js"\n`
      return input
    }

    it("follows a chain of re-exports up to the limit, and not beyond it", async () => {
      const found = [] as number[]
      for (const hops of [5, 8, 9, 10, 12]) {
        if ((await leaks(reexports(hops))).length > 0) found.push(hops)
      }
      expect(found).toEqual([5, 8])
    })

    it("ends a cycle of re-exports instead of looping, and finds nothing in it", async () => {
      expect(
        await leaks({
          "app/a.ts": `export * from "./b.js"\n`,
          "app/b.ts": `export * from "./a.js"\n`,
          "app/main.ts": `${IMPORT_CAP}import { send } from "./a.js"\nexport function go(res: any) { send(res, ${USER}.email) }\n`,
        }),
      ).toEqual([])
    })
  })

  it("spread arguments, yield* and the call, apply and bind forms", async () => {
    expect(
      await files({
        "app/p.ts": `${IMPORT_CAP}function send${SEND}
function* inner() { yield ${USER}.email }
function* outer() { yield* inner() }
class Q { constructor(public v: any) {} show(res: any) { res.json(this.v) } }
export function a(res: any) { const args = [res, ${USER}.name]; send(...(args as [any, any])) }
export function b(res: any) { for (const x of outer()) res.json(x) }
export function c(res: any) { send.call(undefined, res, ${USER}.id) }
export function d(res: any) { send.apply(undefined, [res, ${USER}.role]) }
export function e(res: any) { const bound = send.bind(undefined, res); bound(${USER}.passwordHash) }
export function f(res: any) { new Q(...([${USER}.email] as [any])).show(res) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts inner static bk= cl= src=3:1
      N return app/p.ts inner#return static bk= cl= src=
      N function app/p.ts outer static bk= cl= src=4:1
      N return app/p.ts outer#return static bk= cl= src=
      N function app/p.ts a static bk= cl= src=6:1
      N function app/p.ts send static bk= cl= src=2:1
      N parameter app/p.ts send.res static bk= cl= src=
      N parameter app/p.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts b static bk= cl= src=7:1
      N function app/p.ts c static bk= cl= src=8:1
      N function app/p.ts d static bk= cl= src=9:1
      N function app/p.ts e static bk= cl= src=10:1
      N function app/p.ts f static bk= cl= src=11:1
      N function app/p.ts Q.constructor static bk= cl= src=5:11
      N parameter app/p.ts Q.constructor.v static bk= cl= src=
      N return app/p.ts Q.constructor#return static bk= cl= src=
      N function app/p.ts Q.show static bk= cl= src=5:41
      N parameter app/p.ts Q.show.this static bk= cl= src=
      N return app/p.ts send#return static bk= cl= src=
      N parameter app/p.ts Q.show.res static bk= cl= src=
      N return app/p.ts Q.show#return static bk= cl= src=
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      N parameter app/p.ts c.res static bk= cl= src=
      N return app/p.ts c#return static bk= cl= src=
      N parameter app/p.ts d.res static bk= cl= src=
      N return app/p.ts d#return static bk= cl= src=
      N parameter app/p.ts e.res static bk= cl= src=
      N return app/p.ts e#return static bk= cl= src=
      N parameter app/p.ts f.res static bk= cl= src=
      N return app/p.ts f#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#inner p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#inner p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
      E returns function:app/p.ts#inner->return:app/p.ts#inner#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E calls function:app/p.ts#outer->function:app/p.ts#inner p=- static o= h= @app/p.ts:4:28
      E passes return:app/p.ts#inner#return->function:app/p.ts#outer p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:21
      E returns function:app/p.ts#outer->return:app/p.ts#outer#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:21
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:50
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:50
      E calls function:app/p.ts#a->function:app/p.ts#send p=- static o= h= @app/p.ts:6:92
      E passes function:app/p.ts#a->parameter:app/p.ts#send.res p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:92
      E passes function:app/p.ts#a->parameter:app/p.ts#send.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:92
      E reads parameter:app/p.ts#send.v->function:app/p.ts#send p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E side-effect function:app/p.ts#send->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E calls function:app/p.ts#b->function:app/p.ts#outer p=- static o= h= @app/p.ts:7:47
      E passes return:app/p.ts#outer#return->function:app/p.ts#b p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:31
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:56
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#c p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:57
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#c p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:57
      E calls function:app/p.ts#c->function:app/p.ts#send p=- static o= h= @app/p.ts:8:31
      E passes function:app/p.ts#c->parameter:app/p.ts#send.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:31
      E reads parameter:app/p.ts#send.v->function:app/p.ts#send p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E side-effect function:app/p.ts#send->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:59
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:59
      E calls function:app/p.ts#d->function:app/p.ts#send p=- static o= h= @app/p.ts:9:31
      E passes function:app/p.ts#d->parameter:app/p.ts#send.res p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:31
      E passes function:app/p.ts#d->parameter:app/p.ts#send.v p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:31
      E reads parameter:app/p.ts#send.v->function:app/p.ts#send p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E side-effect function:app/p.ts#send->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#e p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:78
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#e p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:78
      E calls function:app/p.ts#e->function:app/p.ts#send p=- static o= h= @app/p.ts:10:72
      E passes function:app/p.ts#e->parameter:app/p.ts#send.v p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:72
      E reads parameter:app/p.ts#send.v->function:app/p.ts#send p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E side-effect function:app/p.ts#send->boundary:boundary:code#http-response p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#f p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:42
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:42
      E calls function:app/p.ts#f->function:app/p.ts#Q.constructor p=- static o= h= @app/p.ts:11:31
      E passes function:app/p.ts#f->parameter:app/p.ts#Q.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:31
      E reads parameter:app/p.ts#Q.constructor.v->function:app/p.ts#Q.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
      E returns function:app/p.ts#Q.constructor->return:app/p.ts#Q.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
      E calls function:app/p.ts#f->function:app/p.ts#Q.show p=- static o= h= @app/p.ts:11:31
      E passes return:app/p.ts#Q.constructor#return->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:31
      E passes function:app/p.ts#f->parameter:app/p.ts#Q.show.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:31
      E reads parameter:app/p.ts#Q.constructor.v->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:31
      E reads parameter:app/p.ts#Q.show.this->function:app/p.ts#Q.show p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:67
      E reads parameter:app/p.ts#Q.constructor.v->function:app/p.ts#Q.show p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:67
      E side-effect function:app/p.ts#Q.show->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:58
      E discards function:app/p.ts#inner->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#inner->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#inner->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#inner->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#f->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#f->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#f->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#f->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })
})
