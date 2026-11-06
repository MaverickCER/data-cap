import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { facts, handler as baseHandler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/** `handler` glues its extra code straight onto `export function h`, so a declaration needs its newline. */
const handler = (body: string, extra = ""): Record<string, string> =>
  baseHandler(body, extra === "" || extra.endsWith("\n") ? extra : `${extra}\n`)

/** Cases for statements and for how a member is read off a value: accessors, methods read without a call, statics. */
describe("flow-scan statements: reading members", () => {
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
  }
  /** Each program is scanned on its own, with the code it names. */
  const each = async (cases: Readonly<Record<string, Case>>): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "" }] of Object.entries(cases)) {
      const { input } = await h.scan(handler(`  const x: any = ${u}\n${body}`, extra))
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("a getter on an object reads this as the object, and a getter on a class as the class", async () => {
    expect(
      await each({
        objectGetter: {
          body: "  const o = { v: x.email, get g() { return this.v } }; res.json(o.g)",
        },
        objectGetterOtherObject: {
          body: "  const o = { v: x.email, get g() { return this.v } }; const p = { v: x.name, get g() { return this.v } }; res.json(p.g)",
        },
        staticGetter: {
          body: "  res.json(K.g)",
          extra: `class K { static s = ${u}.id; static get g() { return this.s } }`,
        },
        instanceGetter: {
          body: "  res.json(new K(x.name).g)",
          extra: `class K { constructor(public p: any) {} get g() { return this.p } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- objectGetter
      E calls function:app/p.ts#h->function:app/p.ts#h>g@4:27 p=- static o= h= @app/p.ts:4:65
      E passes function:app/p.ts#h->parameter:app/p.ts#h>g@4:27.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:65
      E returns function:app/p.ts#h>g@4:27->return:app/p.ts#h>g@4:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
      E passes return:app/p.ts#h>g@4:27#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:56
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:56
      -- objectGetterOtherObject
      E calls function:app/p.ts#h->function:app/p.ts#h>g@4:79 p=- static o= h= @app/p.ts:4:117
      E passes function:app/p.ts#h->parameter:app/p.ts#h>g@4:79.this p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:117
      E returns function:app/p.ts#h>g@4:79->return:app/p.ts#h>g@4:79#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:89
      E passes return:app/p.ts#h>g@4:79#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:108
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:108
      -- staticGetter
      E calls function:app/p.ts#h->function:app/p.ts#K.get g p=- static o= h= @app/p.ts:5:12
      E returns function:app/p.ts#K.get g->return:app/p.ts#K.get g#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:78
      E passes return:app/p.ts#K.get g#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- instanceGetter
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.p p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E calls function:app/p.ts#h->function:app/p.ts#K.get g p=- static o= h= @app/p.ts:5:12
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.get g.this p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#K.get g->return:app/p.ts#K.get g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#K.get g#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("a method read without being called is that method, unless the instance has its own property of that name", async () => {
    expect(
      await each({
        methodRead: {
          body: "  const f = new K().m; res.json(f(x.email))",
          extra: `class K { m(v: any) { return v } }`,
        },
        ownPropertyShadows: {
          body: "  const k: any = new K(); k.m = (v: any) => 'own'; const f = k.m; res.json(f(x.email))",
          extra: `class K { m(v: any) { return v } }`,
        },
        staticMethodRead: {
          body: "  const f = K.m; res.json(f(x.email))",
          extra: `class K { static m(v: any) { return v } }`,
        },
        staticMethodDecoratedAway: {
          body: "  const f = K.m; res.json(f(x.email))",
          extra: `declare const ext: any\nclass K { @ext static m(v: any) { return v } }`,
        },
        instanceMethodDecoratedAway: {
          body: "  const f = new K().m; res.json(f(x.email))",
          extra: `declare const ext: any\nclass K { @ext m(v: any) { return v } }`,
        },
        missingStatic: {
          body: "  const f = K.nothing; res.json(f)",
          extra: `class K { static m(v: any) { return v } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- methodRead
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#K.m p=- static o= h= @app/p.ts:5:33
      E passes function:app/p.ts#h->parameter:app/p.ts#K.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:33
      E returns function:app/p.ts#K.m->return:app/p.ts#K.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:23
      E passes return:app/p.ts#K.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:24
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:24
      -- ownPropertyShadows
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:18
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@5:33 p=- static o= h= @app/p.ts:5:76
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@5:33.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:76
      -- staticMethodRead
      E calls function:app/p.ts#h->function:app/p.ts#K.m p=- static o= h= @app/p.ts:5:27
      E passes function:app/p.ts#h->parameter:app/p.ts#K.m.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:27
      E returns function:app/p.ts#K.m->return:app/p.ts#K.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:30
      E passes return:app/p.ts#K.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:18
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:18
      -- staticMethodDecoratedAway
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:18
      U unresolved-call app/p.ts:6:27 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- instanceMethodDecoratedAway
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:6:13
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:24
      U unresolved-call app/p.ts:6:33 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- missingStatic"
    `)
  })

  it("a namespace block at the top of a module is not a function and does not hide the statements after it", async () => {
    expect(
      await each({
        namespaceBlock: {
          body: "  res.json(after)",
          extra: `namespace N { export const inside = 1 }\nconst after = ${u}.email`,
        },
        overloads: {
          body: "  res.json(pick(x.email))",
          extra: `function pick(v: string): string\nfunction pick(v: any): any { return v }`,
        },
        loopAtTop: {
          body: "  res.json(out)",
          extra: `let out: any\nfor (const v of [${u}.name]) { out = v }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- namespaceBlock
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- overloads
      E calls function:app/p.ts#h->function:app/p.ts#pick p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#pick->return:app/p.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:30
      E passes return:app/p.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- loopAtTop
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
    `)
  })

  it("a namespace holding tracked data, an ambient function, and the ways of reaching a capability", async () => {
    expect(
      await each({
        namespaceHoldsData: {
          body: "  res.json(N.v)",
          extra: `namespace N { export const v = ${u}.email }`,
        },
        ambientFunction: {
          body: "  res.json(ext(x.email))",
          extra: `declare function ext(v: any): any`,
        },
        blockLevelFunction: {
          body: "  { function inner(v: any) { return v } res.json(inner(x.email)) }",
        },
        capabilityByElement: {
          body: "  res.json(userData['getSnapshot']().fields.user.name)",
        },
        capabilityDestructured: {
          body: "  const { getSnapshot } = userData; res.json(getSnapshot().fields.user.id)",
        },
        capabilityCallMethod: {
          body: "  res.json(userData.getSnapshot.call(userData).fields.user.email)",
        },
        unknownOperation: {
          body: "  res.json(userData.nothing(x.name))",
        },
        capabilityPassedAlong: {
          body: "  use(userData)",
          extra: `const use = (c: any) => console.log(c.getSnapshot().fields.user.name)`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- namespaceHoldsData
      -- ambientFunction
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- blockLevelFunction
      E calls function:app/p.ts#h->function:app/p.ts#h>inner@4:5 p=- static o= h= @app/p.ts:4:50
      E passes function:app/p.ts#h->parameter:app/p.ts#h>inner@4:5.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:50
      E returns function:app/p.ts#h>inner@4:5->return:app/p.ts#h>inner@4:5#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:30
      E passes return:app/p.ts#h>inner@4:5#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:41
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:41
      -- capabilityByElement
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      -- capabilityDestructured
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
      -- capabilityCallMethod
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      -- unknownOperation
      -- capabilityPassedAlong
      E calls function:app/p.ts#h->function:app/p.ts#use p=- static o= h= @app/p.ts:5:3
      E side-effect function:app/p.ts#use->boundary:boundary:code#console p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25"
    `)
  })

  it("a spread in every place a spread can stand", async () => {
    expect(
      await each({
        inArrayLiteral: { body: "  const a = [...x.list]; res.json(a[0])" },
        inCallToBuiltin: { body: "  res.json(Math.max(...x.list))" },
        inNew: {
          body: "  res.json(new K(...x.list).first)",
          extra: `class K { first: any; constructor(a: any) { this.first = a } }`,
        },
        inUnknownCall: { body: "  ext(...x.list)" },
        inArrayOfArrays: { body: "  const a = [[...x.list], [x.email]]; res.json(a[0][0])" },
        asObjectSpread: { body: "  const o = { ...x }; res.json(o.email)" },
        inYieldStar: {
          body: "  for (const v of g()) res.json(v)",
          extra: `function* inner(): any { yield ${u}.name }\nfunction* g(): any { yield* inner() }`,
        },
        plainYield: {
          body: "  for (const v of g()) res.json(v)",
          extra: `function* g(): any { yield ${u}.id }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- inArrayLiteral
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:26
      -- inCallToBuiltin
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list.[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      -- inNew
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.a p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:23
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- inUnknownCall
      U unresolved-call app/p.ts:4:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/list.[]
      -- inArrayOfArrays
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list.[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:39
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:39
      -- asObjectSpread
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      -- inYieldStar
      E returns function:app/p.ts#inner->return:app/p.ts#inner#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:26
      E calls function:app/p.ts#g->function:app/p.ts#inner p=- static o= h= @app/p.ts:3:29
      E passes return:app/p.ts#inner#return->function:app/p.ts#g p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:22
      E returns function:app/p.ts#g->return:app/p.ts#g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:22
      E calls function:app/p.ts#h->function:app/p.ts#g p=- static o= h= @app/p.ts:6:19
      E passes return:app/p.ts#g#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:24
      -- plainYield
      E returns function:app/p.ts#g->return:app/p.ts#g#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:22
      E calls function:app/p.ts#h->function:app/p.ts#g p=- static o= h= @app/p.ts:5:19
      E passes return:app/p.ts#g#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:24"
    `)
  })
})
