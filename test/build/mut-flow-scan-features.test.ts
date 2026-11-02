import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { dump, IMPORT_CAP, makeHarness, USER } from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

/** How the scan treats each form of call, statement and loop: the exact facts it records for a small program. */
describe("flow-scan: calls, statements and loops", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const program = async (body: string) =>
    dump((await h.scan({ "app/p.ts": `${IMPORT_CAP}${body}\n` })).input).join("\n")

  it("an async function that throws tracked data rejects with it, and one that returns it resolves with it", async () => {
    expect(
      await program(`async function boom() { throw ${USER}.email }
async function fine() { return ${USER}.name }
export async function caught(res: any) { try { await boom() } catch (e) { res.json(e) } }
export async function resolved(res: any) { res.json(await fine()) }
export async function notAwaited(res: any) { const p = boom(); res.json(p) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts boom static bk= cl= src=2:1
      N return app/p.ts boom#return static bk= cl= src=
      N function app/p.ts fine static bk= cl= src=3:1
      N return app/p.ts fine#return static bk= cl= src=
      N function app/p.ts caught static bk= cl= src=4:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts resolved static bk= cl= src=5:1
      N function app/p.ts notAwaited static bk= cl= src=6:1
      N parameter app/p.ts caught.res static bk= cl= src=
      N return app/p.ts caught#return static bk= cl= src=
      N parameter app/p.ts resolved.res static bk= cl= src=
      N return app/p.ts resolved#return static bk= cl= src=
      N parameter app/p.ts notAwaited.res static bk= cl= src=
      N return app/p.ts notAwaited#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#boom p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#boom p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#boom->return:app/p.ts#boom#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#fine p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#fine p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
      E returns function:app/p.ts#fine->return:app/p.ts#fine#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
      E calls function:app/p.ts#caught->function:app/p.ts#boom p=- static o= h= @app/p.ts:4:54
      E passes return:app/p.ts#boom#return->function:app/p.ts#caught p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:75
      E side-effect function:app/p.ts#caught->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:75
      E calls function:app/p.ts#resolved->function:app/p.ts#fine p=- static o= h= @app/p.ts:5:59
      E passes return:app/p.ts#fine#return->function:app/p.ts#resolved p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:44
      E side-effect function:app/p.ts#resolved->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:44
      E calls function:app/p.ts#notAwaited->function:app/p.ts#boom p=- static o= h= @app/p.ts:6:56
      E passes return:app/p.ts#boom#return->function:app/p.ts#notAwaited p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:64
      E side-effect function:app/p.ts#notAwaited->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:64
      E discards function:app/p.ts#boom->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#boom->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#boom->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#boom->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fine->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fine->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fine->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fine->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("an object a callee fills in is the caller's object afterwards, through a name or through this", async () => {
    expect(
      await program(`function fill(o: any) { o.x = ${USER}.email }
class Box { v: any; set(v: any) { this.v = v } }
export function direct(res: any) { const obj: any = {}; fill(obj); res.json(obj) }
export function viaThis(res: any) { const box = new Box(); box.set(${USER}.name); res.json(box.v) }
export function nested(res: any) { const outer: any = { inner: {} }; fill(outer.inner); res.json(outer) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts fill static bk= cl= src=2:1
      N return app/p.ts fill#return static bk= cl= src=
      N function app/p.ts direct static bk= cl= src=4:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts viaThis static bk= cl= src=5:1
      N function app/p.ts Box.constructor static bk= cl= src=
      N function app/p.ts Box.set static bk= cl= src=3:21
      N parameter app/p.ts Box.set.v static bk= cl= src=
      N return app/p.ts Box.set#return static bk= cl= src=
      N function app/p.ts nested static bk= cl= src=6:1
      N parameter app/p.ts fill.o static bk= cl= src=
      N parameter app/p.ts direct.res static bk= cl= src=
      N return app/p.ts direct#return static bk= cl= src=
      N parameter app/p.ts viaThis.res static bk= cl= src=
      N return app/p.ts viaThis#return static bk= cl= src=
      N parameter app/p.ts nested.res static bk= cl= src=
      N return app/p.ts nested#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#fill p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#fill p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E calls function:app/p.ts#direct->function:app/p.ts#fill p=- static o= h= @app/p.ts:4:57
      E passes return:app/p.ts#fill#return->function:app/p.ts#direct p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:68
      E side-effect function:app/p.ts#direct->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:68
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#direct p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:68
      E calls function:app/p.ts#viaThis->function:app/p.ts#Box.constructor p=- static o= h= @app/p.ts:5:49
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#viaThis p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:68
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#viaThis p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:68
      E calls function:app/p.ts#viaThis->function:app/p.ts#Box.set p=- static o= h= @app/p.ts:5:60
      E passes function:app/p.ts#viaThis->parameter:app/p.ts#Box.set.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:60
      E reads parameter:app/p.ts#Box.set.v->function:app/p.ts#Box.set p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E returns function:app/p.ts#Box.set->return:app/p.ts#Box.set#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E passes return:app/p.ts#Box.set#return->function:app/p.ts#viaThis p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:119
      E reads parameter:app/p.ts#Box.set.v->function:app/p.ts#viaThis p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:119
      E side-effect function:app/p.ts#viaThis->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:110
      E calls function:app/p.ts#nested->function:app/p.ts#fill p=- static o= h= @app/p.ts:6:70
      E passes return:app/p.ts#fill#return->function:app/p.ts#nested p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:89
      E side-effect function:app/p.ts#nested->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:89
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#nested p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:89
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#viaThis->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#viaThis->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#viaThis->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#viaThis->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("an object another name may share, filled in by a call, is reported", async () => {
    expect(
      await program(`function fill(o: any) { o.x = ${USER}.email }
export function shared(res: any) { const a: any = {}; const b = a; fill(a); res.json(b) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts fill static bk= cl= src=2:1
      N return app/p.ts fill#return static bk= cl= src=
      N function app/p.ts shared static bk= cl= src=3:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/p.ts fill.o static bk= cl= src=
      N parameter app/p.ts shared.res static bk= cl= src=
      N return app/p.ts shared#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#fill p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#fill p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E calls function:app/p.ts#shared->function:app/p.ts#fill p=- static o= h= @app/p.ts:3:68
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#shared p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:77
      E side-effect function:app/p.ts#shared->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:77
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("this, arguments and the name of a function expression", async () => {
    expect(
      await program(`function usesArguments() { return arguments[0] }
const holder = { v: ${USER}.role, read() { return this.v } }
export function a(res: any) { res.json(usesArguments(${USER}.id)) }
export function b(res: any) { res.json(holder.read()) }
export function c(res: any) { const f = function named(v: any) { return named === f ? v : undefined }; res.json(f(${USER}.email)) }
export function d(res: any) { const g = (v: any) => arguments[0]; res.json(g(${USER}.name)) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts <module> static bk= cl= src=
      N function app/p.ts a static bk= cl= src=4:1
      N function app/p.ts usesArguments static bk= cl= src=2:1
      N parameter app/p.ts usesArguments.arg0 static bk= cl= src=
      N return app/p.ts usesArguments#return static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts b static bk= cl= src=5:1
      N function app/p.ts <module>>read@3:62 static bk= cl= src=3:62
      N parameter app/p.ts <module>>read@3:62.this static bk= cl= src=
      N return app/p.ts <module>>read@3:62#return static bk= cl= src=
      N function app/p.ts c static bk= cl= src=6:1
      N function app/p.ts c>anonymous@6:41 static bk= cl= src=6:41
      N parameter app/p.ts c>anonymous@6:41.v static bk= cl= src=
      N return app/p.ts c>anonymous@6:41#return static bk= cl= src=
      N function app/p.ts d static bk= cl= src=7:1
      N function app/p.ts d>anonymous@7:41 static bk= cl= src=7:41
      N parameter app/p.ts d>anonymous@7:41.v static bk= cl= src=
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      N parameter app/p.ts c.res static bk= cl= src=
      N return app/p.ts c#return static bk= cl= src=
      N parameter app/p.ts d.res static bk= cl= src=
      N return app/p.ts d#return static bk= cl= src=
      N return app/p.ts d>anonymous@7:41#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:54
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:54
      E calls function:app/p.ts#a->function:app/p.ts#usesArguments p=- static o= h= @app/p.ts:4:40
      E passes function:app/p.ts#a->parameter:app/p.ts#usesArguments.arg0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      E reads parameter:app/p.ts#usesArguments.arg0->function:app/p.ts#usesArguments p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
      E returns function:app/p.ts#usesArguments->return:app/p.ts#usesArguments#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:28
      E passes return:app/p.ts#usesArguments#return->function:app/p.ts#a p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E side-effect function:app/p.ts#a->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E calls function:app/p.ts#b->function:app/p.ts#<module>>read@3:62 p=- static o= h= @app/p.ts:5:40
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:40
      E passes function:app/p.ts#b->parameter:app/p.ts#<module>>read@3:62.this p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:40
      E reads parameter:app/p.ts#<module>>read@3:62.this->function:app/p.ts#<module>>read@3:62 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:78
      E returns function:app/p.ts#<module>>read@3:62->return:app/p.ts#<module>>read@3:62#return p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:71
      E passes return:app/p.ts#<module>>read@3:62#return->function:app/p.ts#b p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:31
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#c p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:115
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#c p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:115
      E calls function:app/p.ts#c->function:app/p.ts#c>anonymous@6:41 p=- static o= h= @app/p.ts:6:113
      E passes function:app/p.ts#c->parameter:app/p.ts#c>anonymous@6:41.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:113
      E reads parameter:app/p.ts#c>anonymous@6:41.v->function:app/p.ts#c>anonymous@6:41 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:66
      E returns function:app/p.ts#c>anonymous@6:41->return:app/p.ts#c>anonymous@6:41#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:66
      E passes return:app/p.ts#c>anonymous@6:41#return->function:app/p.ts#c p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:104
      E side-effect function:app/p.ts#c->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:104
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:78
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:78
      E calls function:app/p.ts#d->function:app/p.ts#d>anonymous@7:41 p=- static o= h= @app/p.ts:7:76
      E passes function:app/p.ts#d->parameter:app/p.ts#d>anonymous@7:41.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:76
      E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("declarations inside a function: hoisted functions, classes, enums, with, and import =", async () => {
    expect(
      await program(`export function go(res: any) {
  res.json(later(${USER}.email))
  function later(v: any) { return v }
  class Local { m(v: any) { return v } }
  res.json(new Local().m(${USER}.name))
  enum E { A = ${USER}.id.length }
  with (${USER}) { res.json(passwordHash) }
  if (true) { function inBlock(v: any) { return v }; res.json(inBlock(${USER}.role)) }
}`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=2:1
      N function app/p.ts go>later@4:3 static bk= cl= src=4:3
      N parameter app/p.ts go>later@4:3.v static bk= cl= src=
      N return app/p.ts go>later@4:3#return static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts go>Local.constructor static bk= cl= src=
      N function app/p.ts go>Local.m static bk= cl= src=5:17
      N parameter app/p.ts go>Local.m.v static bk= cl= src=
      N return app/p.ts go>Local.m#return static bk= cl= src=
      N function app/p.ts go>inBlock@9:15 static bk= cl= src=9:15
      N parameter app/p.ts go>inBlock@9:15.v static bk= cl= src=
      N return app/p.ts go>inBlock@9:15#return static bk= cl= src=
      N parameter app/p.ts go.res static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:18
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:18
      E calls function:app/p.ts#go->function:app/p.ts#go>later@4:3 p=- static o= h= @app/p.ts:3:12
      E passes function:app/p.ts#go->parameter:app/p.ts#go>later@4:3.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:12
      E reads parameter:app/p.ts#go>later@4:3.v->function:app/p.ts#go>later@4:3 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:28
      E returns function:app/p.ts#go>later@4:3->return:app/p.ts#go>later@4:3#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:28
      E passes return:app/p.ts#go>later@4:3#return->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
      E side-effect function:app/p.ts#go->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
      E calls function:app/p.ts#go->function:app/p.ts#go>Local.constructor p=- static o= h= @app/p.ts:6:12
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:26
      E calls function:app/p.ts#go->function:app/p.ts#go>Local.m p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#go->parameter:app/p.ts#go>Local.m.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E reads parameter:app/p.ts#go>Local.m.v->function:app/p.ts#go>Local.m p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29
      E returns function:app/p.ts#go>Local.m->return:app/p.ts#go>Local.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29
      E passes return:app/p.ts#go>Local.m#return->function:app/p.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#go->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:16
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=id.length static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:16
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:71
      E calls function:app/p.ts#go->function:app/p.ts#go>inBlock@9:15 p=- static o= h= @app/p.ts:9:63
      E passes function:app/p.ts#go->parameter:app/p.ts#go>inBlock@9:15.v p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:63
      E reads parameter:app/p.ts#go>inBlock@9:15.v->function:app/p.ts#go>inBlock@9:15 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:42
      E returns function:app/p.ts#go>inBlock@9:15->return:app/p.ts#go>inBlock@9:15#return p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:42
      E passes return:app/p.ts#go>inBlock@9:15#return->function:app/p.ts#go p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:54
      E side-effect function:app/p.ts#go->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:54
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      U unsupported-construct app/p.ts:8:3 subject=function:app/p.ts#go detail=names inside a with statement may be properties of tracked data data=field:features/user/user.ts#userData.user/"
    `)
  })

  it("for await over an async generator, for of over an object with an iterator, and over one with an async iterator", async () => {
    expect(
      await program(`async function* gen() { yield ${USER}.email }
const iterable = { [Symbol.iterator]() { return [${USER}.name][Symbol.iterator]() } }
const asyncIterable = { [Symbol.asyncIterator]() { return gen() } }
export async function a(res: any) { for await (const x of gen()) res.json(x) }
export function b(res: any) { for (const x of iterable as any) res.json(x) }
export async function c(res: any) { for await (const x of asyncIterable as any) res.json(x) }
export function d(res: any) { for (const x of [${USER}.id]) res.json(x) }
export async function e(res: any) { for await (const x of [Promise.resolve(${USER}.role)]) res.json(x) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts gen static bk= cl= src=2:1
      N return app/p.ts gen#return static bk= cl= src=
      N function app/p.ts a static bk= cl= src=5:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts b static bk= cl= src=6:1
      N function app/p.ts <module>>[Symbol.iterator]@3:20 static bk= cl= src=3:20
      N function app/p.ts c static bk= cl= src=7:1
      N function app/p.ts <module>>[Symbol.asyncIterator]@4:25 static bk= cl= src=4:25
      N return app/p.ts <module>>[Symbol.asyncIterator]@4:25#return static bk= cl= src=
      N function app/p.ts d static bk= cl= src=8:1
      N function app/p.ts e static bk= cl= src=9:1
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
      N return app/p.ts <module>>[Symbol.iterator]@3:20#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#gen p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#gen p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#gen->return:app/p.ts#gen#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
      E calls function:app/p.ts#a->function:app/p.ts#gen p=- static o= h= @app/p.ts:5:59
      E passes return:app/p.ts#gen#return->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:37
      E side-effect function:app/p.ts#a->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:66
      E calls function:app/p.ts#b->function:app/p.ts#<module>>[Symbol.iterator]@3:20 p=- static o= h= @app/p.ts:6:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module>>[Symbol.iterator]@3:20 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:50
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module>>[Symbol.iterator]@3:20 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:50
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module>>[Symbol.iterator]@3:20 p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:49
      E calls function:app/p.ts#c->function:app/p.ts#<module>>[Symbol.asyncIterator]@4:25 p=- static o= h= @app/p.ts:7:37
      E calls function:app/p.ts#<module>>[Symbol.asyncIterator]@4:25->function:app/p.ts#gen p=- static o= h= @app/p.ts:4:59
      E passes return:app/p.ts#gen#return->function:app/p.ts#<module>>[Symbol.asyncIterator]@4:25 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:52
      E returns function:app/p.ts#<module>>[Symbol.asyncIterator]@4:25->return:app/p.ts#<module>>[Symbol.asyncIterator]@4:25#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:52
      E passes return:app/p.ts#<module>>[Symbol.asyncIterator]@4:25#return->function:app/p.ts#c p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:37
      E side-effect function:app/p.ts#c->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:81
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:48
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:48
      E side-effect function:app/p.ts#d->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:88
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#e p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:76
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#e p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:76
      E side-effect function:app/p.ts#e->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:119
      E discards function:app/p.ts#gen->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#gen->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#gen->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#gen->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>>[Symbol.iterator]@3:20->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>>[Symbol.iterator]@3:20->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>>[Symbol.iterator]@3:20->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#<module>>[Symbol.iterator]@3:20->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      U dynamic-access app/p.ts:3:49 subject=function:app/p.ts#<module>>[Symbol.iterator]@3:20 detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/name"
    `)
  })

  it("reading a capability: its snapshot, its fields, an operation that is not declared, a name that is not one", async () => {
    expect(
      await program(`export function a(res: any) { res.json(userData.getSnapshot().fields.user.email) }
export function b(res: any) { const snap = userData.getSnapshot(); res.json(snap.fields.team) }
export function c(res: any) { res.json(userData.notAnOperation(${USER}.name)) }
export function d(res: any) { const { fields } = userData.getSnapshot(); res.json(fields.user.id) }
export function e(res: any) { res.json(userData["getSnapshot"]().fields.user.role) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts a static bk= cl= src=2:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts b static bk= cl= src=3:1
      N function app/p.ts c static bk= cl= src=4:1
      N function app/p.ts d static bk= cl= src=5:1
      N function app/p.ts e static bk= cl= src=6:1
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
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:40
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:40
      E side-effect function:app/p.ts#a->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.team->function:app/p.ts#b p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:3:77
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:3:68
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#c p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:64
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#c p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:64
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:83
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#d p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:83
      E side-effect function:app/p.ts#d->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:74
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#e p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:40
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#e p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:40
      E side-effect function:app/p.ts#e->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:31
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#c->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#d->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#e->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("an object filled in by a call that is not a plain name is not written back to anything", async () => {
    expect(
      await program(`function fill(o: any) { o.x = ${USER}.email }
function make() { return {} as any }
export function a(res: any) { fill(make()); fill({}); res.json(1) }
export function b(res: any) { const o: any = { p: { q: {} } }; fill(o.p.q); res.json(o.p) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts fill static bk= cl= src=2:1
      N return app/p.ts fill#return static bk= cl= src=
      N function app/p.ts a static bk= cl= src=4:1
      N function app/p.ts make static bk= cl= src=3:1
      N function app/p.ts b static bk= cl= src=5:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N return app/p.ts make#return static bk= cl= src=
      N parameter app/p.ts fill.o static bk= cl= src=
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#fill p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#fill p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E calls function:app/p.ts#a->function:app/p.ts#make p=- static o= h= @app/p.ts:4:36
      E calls function:app/p.ts#a->function:app/p.ts#fill p=- static o= h= @app/p.ts:4:31
      E calls function:app/p.ts#b->function:app/p.ts#fill p=- static o= h= @app/p.ts:5:64
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:69
      E passes return:app/p.ts#fill#return->function:app/p.ts#b p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:86
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:77
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#make p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:19
      E returns function:app/p.ts#make->return:app/p.ts#make#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:19
      E passes return:app/p.ts#make#return->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E passes function:app/p.ts#a->parameter:app/p.ts#fill.o p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E reads parameter:app/p.ts#fill.o->function:app/p.ts#fill p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes function:app/p.ts#b->parameter:app/p.ts#fill.o p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:64
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#fill->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("import = require inside a function, and a class that extends something the scan cannot see", async () => {
    expect(
      await h
        .scan({
          "app/lib.ts": `export function send(res: any, v: any) { res.json(v) }\n`,
          "app/p.ts": `${IMPORT_CAP}import { Ext } from "some-package"
export function a(res: any) { import lib = require("./lib.js"); lib.send(res, ${USER}.email) }
class Mine extends Ext { [Symbol.iterator]() { return [${USER}.name][Symbol.iterator]() } }
export function b(res: any) { for (const x of new Mine() as any) res.json(x) }
`,
        })
        .then((r) => dump(r.input).join("\n")),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts a static bk= cl= src=3:1
      N function app/lib.ts send static bk= cl= src=1:1
      N parameter app/lib.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts b static bk= cl= src=5:1
      N function app/p.ts Mine.constructor static bk= cl= src=
      N function app/p.ts Mine.[Symbol.iterator] static bk= cl= src=4:26
      N parameter app/lib.ts send.res static bk= cl= src=
      N return app/lib.ts send#return static bk= cl= src=
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N return app/p.ts Mine.[Symbol.iterator]#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:79
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:79
      E calls function:app/p.ts#a->function:app/lib.ts#send p=- static o= h= @app/p.ts:3:65
      E passes function:app/p.ts#a->parameter:app/lib.ts#send.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:65
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E calls function:app/p.ts#b->function:app/p.ts#Mine.constructor p=- static o= h= @app/p.ts:5:47
      E calls function:app/p.ts#b->function:app/p.ts#Mine.[Symbol.iterator] p=- static o= h= @app/p.ts:5:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Mine.[Symbol.iterator] p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:56
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Mine.[Symbol.iterator] p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:56
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#Mine.[Symbol.iterator] p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:55
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Mine.[Symbol.iterator]->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Mine.[Symbol.iterator]->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Mine.[Symbol.iterator]->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#Mine.[Symbol.iterator]->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U dynamic-access app/p.ts:4:55 subject=function:app/p.ts#Mine.[Symbol.iterator] detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/name"
    `)
  })

  it("a whole fields object nested inside an object literal takes every field with it", async () => {
    expect(
      await program(`export function a(res: any) { res.json({ all: userData.getSnapshot().fields }) }
export function b(res: any) { const { fields } = userData.getSnapshot(); res.json([fields]) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts a static bk= cl= src=2:1
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts b static bk= cl= src=3:1
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.team->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.tags->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.empty->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.empty h= @app/p.ts:2:31
      E side-effect function:app/p.ts#a->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:31
      E side-effect function:app/p.ts#a->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:2:31
      E side-effect function:app/p.ts#a->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:2:31
      E side-effect function:app/p.ts#a->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.empty h= @app/p.ts:2:31
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:74
      E reads field:features/user/user.ts#userData.team->function:app/p.ts#b p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:3:74
      E reads field:features/user/user.ts#userData.tags->function:app/p.ts#b p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:74
      E reads field:features/user/user.ts#userData.empty->function:app/p.ts#b p= static o=field:features/user/user.ts#userData.empty h= @app/p.ts:3:74
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:74
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:3:74
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:74
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p= static o=field:features/user/user.ts#userData.empty h= @app/p.ts:3:74"
    `)
  })

  it("static and instance getters, read through the class and through an instance", async () => {
    expect(
      await program(`class G {
  static get s() { return ${USER}.email }
  get i() { return ${USER}.name }
}
export function a(res: any) { res.json(G.s) }
export function b(res: any) { res.json(new G().i) }`),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts a static bk= cl= src=6:1
      N function app/p.ts G.get s static bk= cl= src=3:3
      N return app/p.ts G.get s#return static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts b static bk= cl= src=7:1
      N function app/p.ts G.constructor static bk= cl= src=
      N function app/p.ts G.get i static bk= cl= src=4:3
      N return app/p.ts G.get i#return static bk= cl= src=
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      E calls function:app/p.ts#a->function:app/p.ts#G.get s p=- static o= h= @app/p.ts:6:40
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#G.get s p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#G.get s p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
      E returns function:app/p.ts#G.get s->return:app/p.ts#G.get s#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:20
      E passes return:app/p.ts#G.get s#return->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:31
      E side-effect function:app/p.ts#a->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:31
      E calls function:app/p.ts#b->function:app/p.ts#G.constructor p=- static o= h= @app/p.ts:7:40
      E calls function:app/p.ts#b->function:app/p.ts#G.get i p=- static o= h= @app/p.ts:7:40
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#G.get i p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:20
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#G.get i p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:20
      E returns function:app/p.ts#G.get i->return:app/p.ts#G.get i#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
      E passes return:app/p.ts#G.get i#return->function:app/p.ts#b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:31
      E side-effect function:app/p.ts#b->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:31
      E discards function:app/p.ts#G.get s->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#G.get s->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#G.get s->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#G.get s->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#G.get i->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#G.get i->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#G.get i->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#G.get i->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("is the same for every one of its runs", async () => {
    const body = `export function a(res: any) { res.json(${USER}.email) }`
    expect(await program(body)).toBe(await program(body))
    expect(await program(body)).toContain("side-effect")
  })
})
