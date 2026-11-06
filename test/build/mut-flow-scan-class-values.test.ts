import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { facts, handler as baseHandler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/** `handler` glues its extra code straight onto `export function h`, so a declaration needs its newline. */
const handler = (body: string, extra = ""): Record<string, string> =>
  baseHandler(body, extra === "" || extra.endsWith("\n") ? extra : `${extra}\n`)

/** Cases for classes and functions as values at run time: when their methods run on their own, statics, and names. */
describe("flow-scan class values", () => {
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

  it("a class a call made, and nothing used, still has its methods run with what the call gave it", async () => {
    expect(
      await each({
        madeByACallNeverUsed: {
          body: "  make(x.email)",
          extra: `const make = (v: any) => class { m(res: any) { res.json(v) } }`,
        },
        madeAndUsed: {
          body: "  const K = make(x.email); new K().m(res)",
          extra: `const make = (v: any) => class { m(res: any) { res.json(v) } }`,
        },
        madeOnlyByTheRootRun: {
          body: "  res.json(1)",
          extra: `export const make = (v: any) => class { m(res: any) { res.json(v) } }`,
        },
        twoMadeNeverUsed: {
          body: "  make(x.email); make(x.name)",
          extra: `const make = (v: any) => class { m(res: any) { res.json(v) } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- madeByACallNeverUsed
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#make>anonymous@2.m->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:48
      -- madeAndUsed
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:5:28
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.m p=- static o= h= @app/p.ts:5:28
      E side-effect function:app/p.ts#make>anonymous@2.m->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:48
      -- madeOnlyByTheRootRun
      -- twoMadeNeverUsed
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:18
      E side-effect function:app/p.ts#make>anonymous@2.m->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:48
      E side-effect function:app/p.ts#make>anonymous@2.m->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:48"
    `)
  })

  it("a member a decorator replaced on a parent class is unknown on its subclass too", async () => {
    expect(
      await each({
        decoratedOnParent: {
          body: "  res.json(new C(x.email).g)",
          extra: `declare const ext: any\nclass P { constructor(public p: any) {} @ext get g() { return this.p } }\nclass C extends P {}`,
        },
        decoratedOnSubclass: {
          body: "  res.json(new C(x.email).g)",
          extra: `declare const ext: any\nclass P { constructor(public p: any) {} get g() { return this.p } }\nclass C extends P { @ext get g() { return 1 } }`,
        },
        undecorated: {
          body: "  res.json(new C(x.email).g)",
          extra: `class P { constructor(public p: any) {} get g() { return this.p } }\nclass C extends P {}`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- decoratedOnParent
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E calls function:app/p.ts#C.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:4:1
      E passes function:app/p.ts#C.constructor->parameter:app/p.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#C.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:7:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- decoratedOnSubclass
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E calls function:app/p.ts#C.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:4:1
      E passes function:app/p.ts#C.constructor->parameter:app/p.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#C.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:1
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unresolved-call app/p.ts:7:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- undecorated
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#C.constructor.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#C.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:1
      E passes function:app/p.ts#C.constructor->parameter:app/p.ts#P.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#C.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:1
      E calls function:app/p.ts#h->function:app/p.ts#P.get g p=- static o= h= @app/p.ts:6:12
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#P.get g.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#P.get g->return:app/p.ts#P.get g#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#P.get g#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
    `)
  })

  it("static initializers see this as the class and the module's own statements", async () => {
    expect(
      await each({
        thisInStatic: {
          body: "  res.json(K.b)",
          extra: `class K { static a = ${u}.email; static b = this.a }`,
        },
        moduleStateInStatic: {
          body: "  res.json(K.v)",
          extra: `let held: any\nheld = ${u}.name\nclass K { static v = held }`,
        },
        staticBlock: {
          body: "  res.json(K.c)",
          extra: `class K { static c: any; static { K.c = ${u}.id } }`,
        },
        computedStaticName: {
          body: "  res.json(K.a)",
          extra: `const key = 'a' as string\nclass K { static [key] = ${u}.email; static a = 1 }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- thisInStatic
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- moduleStateInStatic
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- staticBlock
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- computedStaticName"
    `)
  })

  it("a subclass without a constructor hands its arguments to the parent, whose stores into them reach the caller's variable only when it names it", async () => {
    expect(
      await each({
        implicitSuperFills: {
          body: "  const a: any = {}; new C(a); res.json(a.k)",
          extra: `class P { constructor(o: any) { o.k = ${u}.email } }\nclass C extends P {}`,
        },
        explicitSuperFills: {
          body: "  const a: any = {}; new C(a); res.json(a.k)",
          extra: `class P { constructor(o: any) { o.k = ${u}.email } }\nclass C extends P { constructor(o: any) { super(o) } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- implicitSuperFills
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:22
      E calls function:app/p.ts#C.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:1
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:32
      -- explicitSuperFills
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:22
      E calls function:app/p.ts#C.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:3:43
      E returns function:app/p.ts#P.constructor->return:app/p.ts#P.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#P.constructor#return->function:app/p.ts#C.constructor p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:41
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:32"
    `)
  })

  it("a function declared later in the file can be called from the module's own statements", async () => {
    expect(
      await each({
        hoisted: {
          body: "  res.json(out)",
          extra: `const out = early(${u}.email)\nfunction early(v: any) { return v }`,
        },
        importedByName: {
          body: "  res.json(out)",
          extra: `import { pick } from "./lib"\nconst out = pick(${u}.name)`,
          files: { "app/lib.ts": "export const pick = (v: any) => v" },
        },
        classHoistedForExtends: {
          body: "  res.json(new Sub(x.id).p)",
          extra: `class Sub extends Base {}\nclass Base { constructor(public p: any) {} }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- hoisted
      E calls function:app/p.ts#<module>->function:app/p.ts#early p=- static o= h= @app/p.ts:2:13
      E passes function:app/p.ts#<module>->parameter:app/p.ts#early.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:13
      E returns function:app/p.ts#early->return:app/p.ts#early#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:26
      E passes return:app/p.ts#early#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- importedByName
      E calls function:app/p.ts#<module>->function:app/lib.ts#pick p=- static o= h= @app/p.ts:3:13
      E passes function:app/p.ts#<module>->parameter:app/lib.ts#pick.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:13
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- classHoistedForExtends
      E calls function:app/p.ts#h->function:app/p.ts#Sub.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Sub.constructor.arg0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E calls function:app/p.ts#Sub.constructor->function:app/p.ts#Base.constructor p=- static o= h= @app/p.ts:2:1
      E passes function:app/p.ts#Sub.constructor->parameter:app/p.ts#Base.constructor.p p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E returns function:app/p.ts#Base.constructor->return:app/p.ts#Base.constructor#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:14
      E passes return:app/p.ts#Base.constructor#return->function:app/p.ts#Sub.constructor p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E returns function:app/p.ts#Sub.constructor->return:app/p.ts#Sub.constructor#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#Sub.constructor#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
    `)
  })

  it("super() is only a call of a parent's constructor in a class that has one", async () => {
    expect(
      await each({
        outsideAnyClass: {
          body: "  plain(x.email)",
          extra: `function plain(v: any) { (super as any)(v) }`,
        },
        classWithoutParent: {
          body: "  res.json(new A(x.email).p)",
          extra: `class A { p: any; constructor(v: any) { (super as any)(v); this.p = v } }`,
        },
        classWithOpaqueParent: {
          body: "  res.json(new A(x.email).p)",
          extra: `class A extends (ext as any) { p: any; constructor(v: any) { super(v); this.p = v } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- outsideAnyClass
      E calls function:app/p.ts#h->function:app/p.ts#plain p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#plain.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- classWithoutParent
      E calls function:app/p.ts#h->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#A.constructor->return:app/p.ts#A.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:19
      E passes return:app/p.ts#A.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- classWithOpaqueParent
      E calls function:app/p.ts#h->function:app/p.ts#A.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#A.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#A.constructor->return:app/p.ts#A.constructor#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:2:40
      E returns function:app/p.ts#A.constructor->return:app/p.ts#A.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:40
      E passes return:app/p.ts#A.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes return:app/p.ts#A.constructor#return->function:app/p.ts#h p=email.p inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email.p inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:2:62 subject=function:app/p.ts#A.constructor detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unsupported-construct app/p.ts:2:72 subject=function:app/p.ts#A.constructor detail=tracked data stored into an object whose origin the analysis cannot see data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("a function handed along as a callback is found by name, through a namespace, and through a re-exported namespace", async () => {
    const lib = { "app/lib.ts": "export const pick = (v: any) => console.log(v)" }
    expect(
      await each({
        importedByName: {
          body: "  [x.email].forEach(pick)",
          extra: `import { pick } from "./lib"`,
          files: lib,
        },
        namespaceMember: {
          body: "  [x.email].forEach(lib.pick)",
          extra: `import * as lib from "./lib"`,
          files: lib,
        },
        reExportedNamespace: {
          body: "  [x.email].forEach(ns.pick)",
          extra: `import { ns } from "./barrel"`,
          files: { ...lib, "app/barrel.ts": `export * as ns from "./lib"` },
        },
        topLevelDeclaredLater: {
          body: "  [x.email].forEach(later)",
          extra: `function later(v: any) { console.log(v) }`,
        },
        classIsNotCallable: {
          body: "  [x.email].forEach(K)",
          extra: `class K { constructor(v: any) { console.log(v) } }`,
        },
        localShadowsModuleFunction: {
          body: "  const later: any = 5; [x.email].forEach(later)",
          extra: `function later(v: any) { console.log(v) }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- importedByName
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:18
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
      E side-effect function:app/lib.ts#pick->boundary:boundary:code#console p=[] inferred o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      U dynamic-access app/p.ts:4:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- namespaceMember
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:18
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
      E side-effect function:app/lib.ts#pick->boundary:boundary:code#console p=[] inferred o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      U dynamic-access app/p.ts:4:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- reExportedNamespace
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:18
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
      E side-effect function:app/lib.ts#pick->boundary:boundary:code#console p=[] inferred o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      U dynamic-access app/p.ts:4:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- topLevelDeclaredLater
      E calls function:app/p.ts#h->function:app/p.ts#later p=- static o= h= @app/p.ts:4:18
      E passes function:app/p.ts#h->parameter:app/p.ts#later.v p=[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
      E side-effect function:app/p.ts#later->boundary:boundary:code#console p=[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:2:26
      U dynamic-access app/p.ts:4:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      -- classIsNotCallable
      U dynamic-access app/p.ts:4:18 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
      U unresolved-call app/p.ts:4:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
      -- localShadowsModuleFunction
      U unresolved-call app/p.ts:5:25 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("two routes to the same re-exported name are one export", async () => {
    expect(
      await each({
        diamond: {
          body: "  res.json(pick(x.email))",
          extra: `import { pick } from "./top"`,
          files: {
            "app/top.ts": `export * from "./left"\nexport * from "./right"`,
            "app/left.ts": `export * from "./base"`,
            "app/right.ts": `export * from "./base"`,
            "app/base.ts": "export const pick = (v: any) => v",
          },
        },
        namedThroughTwo: {
          body: "  res.json(pick(x.email))",
          extra: `import { pick } from "./top"`,
          files: {
            "app/top.ts": `export { pick } from "./mid"`,
            "app/mid.ts": `export { pick } from "./base"`,
            "app/base.ts": "export const pick = (v: any) => v",
          },
        },
        absentEverywhere: {
          body: "  res.json(pick(x.email))",
          extra: `import { pick } from "./top"`,
          files: {
            "app/top.ts": `export * from "./left"\nexport * from "./right"`,
            "app/left.ts": `export * from "./base"`,
            "app/right.ts": `export * from "./base"`,
            "app/base.ts": "export const other = 1",
          },
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- diamond
      E calls function:app/p.ts#h->function:app/base.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/base.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/base.ts#pick->return:app/base.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/base.ts:1:33
      E passes return:app/base.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- namedThroughTwo
      E calls function:app/p.ts#h->function:app/base.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/base.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/base.ts#pick->return:app/base.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/base.ts:1:33
      E passes return:app/base.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- absentEverywhere
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("a field or a static with a name only known at run time is read by anything that reads every property", async () => {
    expect(
      await each({
        computedInstanceField: {
          body: "  res.json(Object.values(new C()))",
          extra: `const key = Math.random() > 1 ? 'a' : 'b'\nclass C { [key as string] = ${u}.email }`,
        },
        computedStaticField: {
          body: "  res.json(Object.values(C))",
          extra: `const key = Math.random() > 1 ? 'a' : 'b'\nclass C { static [key as string] = ${u}.name }`,
        },
        symbolField: {
          body: "  res.json(Object.values(new C()))",
          extra: `class C { [Symbol.iterator as any] = ${u}.id }`,
        },
        namedField: {
          body: "  res.json(Object.values(new C()))",
          extra: `class C { a = ${u}.email }`,
        },
        namedStatic: {
          body: "  res.json(Object.values(C))",
          extra: `class C { static a = ${u}.name }`,
        },
        computedFieldRead: {
          body: "  res.json(new C().a)",
          extra: `class C { ['a'] = ${u}.email }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- computedInstanceField
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:6:26
      -- computedStaticField
      -- symbolField
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:5:26
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- namedField
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:5:26
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- namedStatic
      -- computedFieldRead
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:5:12"
    `)
  })
})
