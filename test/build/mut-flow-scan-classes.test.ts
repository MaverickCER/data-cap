import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  capability,
  dump,
  IMPORT_CAP,
  inventoryOf,
  makeHarness,
  operation,
  USER,
} from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

const FIELDS = "userData.getSnapshot().fields"

describe("flow-scan: classes and how the analysis runs", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const lines = async (files: Record<string, string>) =>
    dump((await h.scan(files)).input).join("\n")
  const edgesOf = async (files: Record<string, string>) =>
    (await h.scan(files)).input.edges
      .filter((e) => e.kind === "side-effect")
      .map((e) => (e.path ?? []).join("."))
      .sort()

  it("every kind of class member: constructor, accessors, computed names, statics, fields and members without a body", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}declare const dyn: string
abstract class Base { abstract area(): number; overloaded(a: string): void; overloaded(a: any): void {} }
class Sender extends Base {
  label = "x"
  noInit: string
  static shared = ${USER}.id
  static { Sender.cached = ${USER}.role }
  static cached: any
  stored: any
  constructor(v: any) { super(); this.stored = v }
  area() { return 1 }
  get value() { return this.stored }
  set value(x: any) { this.stored = x }
  run(res: any) { res.json(this.value) }
  static make(res: any, v: any) { res.json(v) }
  [Symbol.iterator]() { return this.stored }
  [dyn]() { return this.stored }
}
export function go(res: any) {
  const s = new Sender(${USER}.email)
  s.run(res)
  Sender.make(res, ${USER}.name)
  res.json(Sender.shared)
  res.json(Sender.cached)
}
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=20:1
      N function app/p.ts Sender.constructor static bk= cl= src=11:3
      N parameter app/p.ts Sender.constructor.v static bk= cl= src=
      N function app/p.ts Base.constructor static bk= cl= src=
      N return app/p.ts Sender.constructor#return static bk= cl= src=
      N function app/p.ts Sender.run static bk= cl= src=15:3
      N parameter app/p.ts Sender.run.this static bk= cl= src=
      N function app/p.ts Sender.get value static bk= cl= src=13:3
      N parameter app/p.ts Sender.get value.this static bk= cl= src=
      N return app/p.ts Sender.get value#return static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts Sender.make static bk= cl= src=16:3
      N parameter app/p.ts Sender.make.v static bk= cl= src=
      N function app/p.ts Sender.static static bk= cl= src=
      N parameter app/p.ts Sender.make.this static bk= cl= src=
      N function app/p.ts Base.overloaded static bk= cl= src=3:77
      N parameter app/p.ts Base.overloaded.a static bk= cl= src=
      N return app/p.ts Base.overloaded#return static bk= cl= src=
      N function app/p.ts Sender.area static bk= cl= src=12:3
      N return app/p.ts Sender.area#return static bk= cl= src=
      N function app/p.ts Sender.set value static bk= cl= src=14:3
      N parameter app/p.ts Sender.set value.x static bk= cl= src=
      N return app/p.ts Sender.set value#return static bk= cl= src=
      N parameter app/p.ts Sender.run.res static bk= cl= src=
      N return app/p.ts Sender.run#return static bk= cl= src=
      N parameter app/p.ts Sender.make.res static bk= cl= src=
      N return app/p.ts Sender.make#return static bk= cl= src=
      N function app/p.ts Sender.[Symbol.iterator] static bk= cl= src=17:3
      N return app/p.ts Sender.[Symbol.iterator]#return static bk= cl= src=
      N function app/p.ts Sender.<computed> static bk= cl= src=18:3
      N return app/p.ts Sender.<computed>#return static bk= cl= src=
      N parameter app/p.ts go.res static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:21:24
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:21:24
      E calls function:app/p.ts#go->function:app/p.ts#Sender.constructor p=- static o= h= @app/p.ts:21:13
      E passes function:app/p.ts#go->parameter:app/p.ts#Sender.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:21:13
      E calls function:app/p.ts#Sender.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:11:25
      E reads parameter:app/p.ts#Sender.constructor.v->function:app/p.ts#Sender.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
      E returns function:app/p.ts#Sender.constructor->return:app/p.ts#Sender.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
      E calls function:app/p.ts#go->function:app/p.ts#Sender.run p=- static o= h= @app/p.ts:22:3
      E passes return:app/p.ts#Sender.constructor#return->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:22:3
      E passes function:app/p.ts#go->parameter:app/p.ts#Sender.run.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:22:3
      E reads parameter:app/p.ts#Sender.constructor.v->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:22:3
      E calls function:app/p.ts#Sender.run->function:app/p.ts#Sender.get value p=- static o= h= @app/p.ts:15:28
      E reads parameter:app/p.ts#Sender.run.this->function:app/p.ts#Sender.run p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:28
      E passes function:app/p.ts#Sender.run->parameter:app/p.ts#Sender.get value.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:28
      E reads parameter:app/p.ts#Sender.constructor.v->function:app/p.ts#Sender.run p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:28
      E reads parameter:app/p.ts#Sender.get value.this->function:app/p.ts#Sender.get value p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:13:24
      E reads parameter:app/p.ts#Sender.constructor.v->function:app/p.ts#Sender.get value p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:13:24
      E returns function:app/p.ts#Sender.get value->return:app/p.ts#Sender.get value#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:13:17
      E passes return:app/p.ts#Sender.get value#return->function:app/p.ts#Sender.run p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:19
      E side-effect function:app/p.ts#Sender.run->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:19
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:23:20
      E calls function:app/p.ts#go->function:app/p.ts#Sender.make p=- static o= h= @app/p.ts:23:3
      E passes function:app/p.ts#go->parameter:app/p.ts#Sender.make.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:23:3
      E reads parameter:app/p.ts#Sender.make.v->function:app/p.ts#Sender.make p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:16:35
      E side-effect function:app/p.ts#Sender.make->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:16:35
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Sender.static p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:19
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Sender.static p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:19
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Sender.static p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:28
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:24:3
      E side-effect function:app/p.ts#go->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:24:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:25:12
      E side-effect function:app/p.ts#go->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:25:3
      E passes function:app/p.ts#go->parameter:app/p.ts#Sender.make.this p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:23:3
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Sender.static->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Sender.static->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Sender.static->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a class with no constructor of its own, and one with a field that reads a tracked field", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}class Plain { f = ${USER}.role; show(res: any) { res.json(this.f) } }
export function go(res: any) { new Plain().show(res) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=3:1
      N function app/p.ts Plain.constructor static bk= cl= src=
      N return app/p.ts Plain.constructor#return static bk= cl= src=
      N function app/p.ts Plain.show static bk= cl= src=2:60
      N parameter app/p.ts Plain.show.this static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/p.ts Plain.show.res static bk= cl= src=
      N return app/p.ts Plain.show#return static bk= cl= src=
      N parameter app/p.ts go.res static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      E calls function:app/p.ts#go->function:app/p.ts#Plain.constructor p=- static o= h= @app/p.ts:3:32
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Plain.constructor p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:19
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Plain.constructor p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:19
      E returns function:app/p.ts#Plain.constructor->return:app/p.ts#Plain.constructor#return p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E calls function:app/p.ts#go->function:app/p.ts#Plain.show p=- static o= h= @app/p.ts:3:32
      E passes return:app/p.ts#Plain.constructor#return->function:app/p.ts#go p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      E passes function:app/p.ts#go->parameter:app/p.ts#Plain.show.this p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      E reads parameter:app/p.ts#Plain.show.this->function:app/p.ts#Plain.show p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:86
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Plain.show p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:86
      E side-effect function:app/p.ts#Plain.show->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:77
      E discards function:app/p.ts#Plain.constructor->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Plain.constructor->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Plain.constructor->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Plain.constructor->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a class that is never constructed still has its methods analyzed on their own", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}export class Idle {
  field = ${USER}.name
  static s(res: any) { res.json(${USER}.id) }
  m(res: any) { res.json(this.field) }
  constructor() { console.log(${USER}.email) }
}
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts Idle.constructor static bk= cl= src=6:3
      N boundary boundary:code console static bk=log cl= src=
      N return app/p.ts Idle.constructor#return static bk= cl= src=
      N function app/p.ts Idle.s static bk= cl= src=4:3
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts Idle.m static bk= cl= src=5:3
      N parameter app/p.ts Idle.s.res static bk= cl= src=
      N return app/p.ts Idle.s#return static bk= cl= src=
      N parameter app/p.ts Idle.m.res static bk= cl= src=
      N return app/p.ts Idle.m#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Idle.constructor p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Idle.constructor p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Idle.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:31
      E side-effect function:app/p.ts#Idle.constructor->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:19
      E returns function:app/p.ts#Idle.constructor->return:app/p.ts#Idle.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Idle.s p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Idle.s p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
      E side-effect function:app/p.ts#Idle.s->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:24
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Idle.m p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
      E side-effect function:app/p.ts#Idle.m->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:17
      E discards function:app/p.ts#Idle.constructor->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Idle.constructor->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Idle.constructor->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Idle.s->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Idle.s->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Idle.s->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Idle.s->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a class written inside a function that nothing calls, and one a call made but nothing used", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}function make(v: any) { return class { m(res: any) { res.json(v) } } }
export function build() { return make(${USER}.email) }
export function viaChain() { const C = make(${USER}.name); return function () { return new C() } }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts build static bk= cl= src=3:1
      N function app/p.ts make static bk= cl= src=2:1
      N parameter app/p.ts make.v static bk= cl= src=
      N function app/p.ts viaChain static bk= cl= src=4:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts make>anonymous@2.m static bk= cl= src=2:40
      N function app/p.ts viaChain>anonymous@4:94 static bk= cl= src=4:94
      N function app/p.ts make>anonymous@2.constructor static bk= cl= src=
      N return app/p.ts make#return static bk= cl= src=
      N return app/p.ts build#return static bk= cl= src=
      N return app/p.ts viaChain#return static bk= cl= src=
      N parameter app/p.ts make>anonymous@2.m.res static bk= cl= src=
      N return app/p.ts make>anonymous@2.m#return static bk= cl= src=
      N return app/p.ts viaChain>anonymous@4:94#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#build p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#build p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:39
      E calls function:app/p.ts#build->function:app/p.ts#make p=- static o= h= @app/p.ts:3:34
      E passes function:app/p.ts#build->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:34
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#viaChain p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:45
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#viaChain p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:45
      E calls function:app/p.ts#viaChain->function:app/p.ts#make p=- static o= h= @app/p.ts:4:40
      E passes function:app/p.ts#viaChain->parameter:app/p.ts#make.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      E reads parameter:app/p.ts#make.v->function:app/p.ts#make>anonymous@2.m p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:54
      E side-effect function:app/p.ts#make>anonymous@2.m->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:54
      E reads parameter:app/p.ts#make.v->function:app/p.ts#make>anonymous@2.m p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:54
      E side-effect function:app/p.ts#make>anonymous@2.m->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:54
      E calls function:app/p.ts#viaChain>anonymous@4:94->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:4:115
      E discards function:app/p.ts#build->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#build->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#build->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#build->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#viaChain->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#viaChain->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#viaChain->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#viaChain->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("an instance method that makes another class, which is analyzed in a later round", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}function outer(v: any) {
  return class A {
    m() {
      return class B { n(res: any) { res.json(v) } }
    }
  }
}
export function go() { return outer(${USER}.email) }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=9:1
      N function app/p.ts outer static bk= cl= src=2:1
      N parameter app/p.ts outer.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts outer>A.m>B.n static bk= cl= src=5:24
      N return app/p.ts outer#return static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      N function app/p.ts outer>A.m static bk= cl= src=4:5
      N return app/p.ts outer>A.m#return static bk= cl= src=
      N parameter app/p.ts outer>A.m>B.n.res static bk= cl= src=
      N return app/p.ts outer>A.m>B.n#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:37
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:37
      E calls function:app/p.ts#go->function:app/p.ts#outer p=- static o= h= @app/p.ts:9:31
      E passes function:app/p.ts#go->parameter:app/p.ts#outer.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:31
      E reads parameter:app/p.ts#outer.v->function:app/p.ts#outer>A.m>B.n p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E side-effect function:app/p.ts#outer>A.m>B.n->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("data that moves one function per round settles when it takes fewer rounds than there are, and reports it when not", async () => {
    const chain = (hops: number) => {
      // f0 sends v1; f1 sets v1 from v2; ... the last one sets its variable from the field. Declared in the order
      // that makes every round move the data one step.
      const names = Array.from({ length: hops }, (_, i) => i)
      const vars = names.map((i) => `let v${i}: any`).join("\\n")
      const fns = names
        .map((i) =>
          i === 0
            ? `export function f0(res: any) { res.json(v0) }`
            : i === hops - 1
              ? `export function f${i}() { v${i - 1} = ${USER}.passwordHash }`
              : `export function f${i}() { v${i - 1} = v${i} }`,
        )
        .join("\\n")
      return { "app/p.ts": `${IMPORT_CAP}${vars}\\n${fns}\\n` }
    }
    const short = await h.scan(chain(6))
    expect(short.input.edges.filter((e) => e.kind === "side-effect").map((e) => e.path)).toEqual([
      ["passwordHash"],
    ])
    expect(short.input.unknowns.map((u) => u.reason)).toEqual([])
    const long = await h.scan(chain(7))
    expect(long.input.unknowns.map((u) => [u.reason, u.detail])).toEqual([
      [
        "unanalyzed-function",
        "the analysis did not settle after 6 rounds: data written by one function was still reaching others",
      ],
    ])
  })

  it("a whole fields object sent across a boundary takes every field with it, one returned does not", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}export function sendAll(res: any) { res.json(${FIELDS}) }
export function giveBack() { return ${FIELDS} }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts sendAll static bk= cl= src=2:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/p.ts sendAll.res static bk= cl= src=
      N return app/p.ts sendAll#return static bk= cl= src=
      N function app/p.ts giveBack static bk= cl= src=3:1
      N return app/p.ts giveBack#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#sendAll p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:37
      E reads field:features/user/user.ts#userData.team->function:app/p.ts#sendAll p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:2:37
      E reads field:features/user/user.ts#userData.tags->function:app/p.ts#sendAll p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:2:37
      E reads field:features/user/user.ts#userData.empty->function:app/p.ts#sendAll p= static o=field:features/user/user.ts#userData.empty h= @app/p.ts:2:37
      E side-effect function:app/p.ts#sendAll->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:37
      E side-effect function:app/p.ts#sendAll->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:2:37
      E side-effect function:app/p.ts#sendAll->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:2:37
      E side-effect function:app/p.ts#sendAll->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.empty h= @app/p.ts:2:37"
    `)
  })

  it("a method of a class is run with its own receiver, and a static one with the class", async () => {
    expect(
      await edgesOf({
        "app/p.ts": `${IMPORT_CAP}export class K {
  v = ${USER}.email
  static w = ${USER}.name
  inst(res: any) { res.json(this.v) }
  static stat(res: any) { res.json(this.w) }
}
`,
      }),
    ).toEqual(["email", "name"])
  })

  it("a constructor with overload signatures runs the one that has a body", async () => {
    expect(
      await edgesOf({
        "app/p.ts": `${IMPORT_CAP}export class C {
  v: any
  constructor(a: string)
  constructor(a: any) { this.v = a }
  show(res: any) { res.json(this.v) }
}
export function go(res: any) { new C(${USER}.email).show(res) }
`,
      }),
    ).toEqual(["email"])
  })

  it("classes made inside classes made inside classes are all analyzed", async () => {
    expect(
      await edgesOf({
        "app/p.ts": `${IMPORT_CAP}function one(v: any) {
  return class A {
    a() {
      return class B {
        b() {
          return class C {
            c(res: any) { res.json(v) }
          }
        }
      }
    }
  }
}
export function go() { return one(${USER}.email) }
`,
      }),
    ).toEqual(["email"])
  })

  it("the same function called and constructed with the same data is two different evaluations", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}function F(this: any, v: any) { this.kept = v; return { returned: v } }
export function go(res: any) {
  const called = F.call({}, ${USER}.email)
  const made = new (F as any)(${USER}.email)
  res.json(called)
  res.json(made)
}
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=3:1
      N function app/p.ts F static bk= cl= src=2:1
      N parameter app/p.ts F.v static bk= cl= src=
      N return app/p.ts F#return static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/p.ts go.res static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:29
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:29
      E calls function:app/p.ts#go->function:app/p.ts#F p=- static o= h= @app/p.ts:4:18
      E passes function:app/p.ts#go->parameter:app/p.ts#F.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
      E reads parameter:app/p.ts#F.v->function:app/p.ts#F p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:48
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:48
      E passes return:app/p.ts#F#return->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#go->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E reads parameter:app/p.ts#F.v->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a whole fields object handed to a declared operation takes every field with it", async () => {
    const r = await h.scan(
      {
        "app/p.ts": `${IMPORT_CAP}export function go() { userData.save(${FIELDS}) }\nexport function keep() { return ${FIELDS} }\n`,
      },
      {},
      inventoryOf(
        capability({
          mutators: [operation("mutator", "save", { writes: [["user"]] })],
        }),
      ),
    )
    const operationEdges = r.input.edges.filter(
      (e) => e.kind === "passes" || e.kind === "side-effect" || e.kind === "crosses-boundary",
    )
    expect(operationEdges.map((e) => `${e.kind}:${(e.path ?? []).join(".")}`).sort())
      .toMatchInlineSnapshot(`
      [
        "passes:",
        "passes:",
        "passes:",
        "passes:",
      ]
    `)
  })

  it("a class written at the top of a module is made once, however many rounds the analysis takes", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}let v0: any
let v1: any
export const Named = class Inner { run(res: any) { res.json(${USER}.id) } }
export function f0(res: any) { res.json(v0) }
export function f1() { v0 = v1 }
export function f2() { v1 = ${USER}.passwordHash }
`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts f2 static bk= cl= src=7:1
      N function app/p.ts <module>>Inner.run static bk= cl= src=4:36
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts f0 static bk= cl= src=5:1
      N parameter app/p.ts f0.res static bk= cl= src=
      N return app/p.ts f0#return static bk= cl= src=
      N function app/p.ts f1 static bk= cl= src=6:1
      N return app/p.ts f1#return static bk= cl= src=
      N return app/p.ts f2#return static bk= cl= src=
      N parameter app/p.ts <module>>Inner.run.res static bk= cl= src=
      N return app/p.ts <module>>Inner.run#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#f2 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:29
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#f2 p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:29
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module>>Inner.run p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:61
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module>>Inner.run p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:61
      E side-effect function:app/p.ts#<module>>Inner.run->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:52
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#f0 p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:32
      E side-effect function:app/p.ts#f0->boundary:boundary:code#http-response p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:32
      E discards function:app/p.ts#f2->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#f2->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#f2->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#f2->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>>Inner.run->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>>Inner.run->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>>Inner.run->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>>Inner.run->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })
})
