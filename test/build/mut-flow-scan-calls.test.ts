import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { facts, handler as baseHandler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/** `handler` glues its extra code straight onto `export function h`, so a declaration needs its newline. */
const handler = (body: string, extra = ""): Record<string, string> =>
  baseHandler(body, extra === "" || extra.endsWith("\n") ? extra : `${extra}\n`)

/**
 * Cases for how a call is resolved: what is called when the callee is not a plain name, what `new` is given, how a
 * module is loaded, and where a method comes from. Each is a small program and the exact facts it must produce.
 */
describe("flow-scan calls: callees that are not plain names", () => {
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
  const each = async (
    cases: Readonly<Record<string, Case>>,
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "", files = {} }] of Object.entries(cases)) {
      const { input } = await h.scan(
        {
          ...handler(`  const x: any = ${u}\n${body}`, extra),
          ...files,
        },
        overrides,
      )
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }
  const lib = { "app/lib.ts": "export const pick = (v: any) => v" }
  const generated = {
    "app/lib.ts": "// GENERATED FILE -- do not edit by hand\nexport const pick = (v: any) => v",
  }

  it("a capability called as a function is not a call of one of its methods", async () => {
    expect(
      await each({
        capability: { body: "  res.json(userData(x.email))" },
        method: { body: "  res.json(userData.getSnapshot().fields.user.email)" },
        stringNamedRequire: { body: '  res.json("require"("./lib").pick(x.email))', files: lib },
        realRequire: { body: '  res.json(require("./lib").pick(x.email))', files: lib },
      }),
    ).toMatchInlineSnapshot(`
      "-- capability
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      U unresolved-call app/p.ts:4:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- method
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      -- stringNamedRequire
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      U unresolved-call app/p.ts:4:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- realRequire
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
    `)
  })

  it("a module the scan skips because it is generated is loaded as the package it cannot read", async () => {
    expect(
      await each({
        project: { body: '  const m = require("./lib"); res.json(m.pick(x.email))', files: lib },
        generated: {
          body: '  const m = require("./lib"); res.json(m.pick(x.email))',
          files: generated,
        },
        generatedDynamic: {
          body: '  const m = await import("./lib"); res.json(m.pick(x.email))',
          files: generated,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- project
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:4:40
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:40
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      -- generated
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      U unresolved-call app/p.ts:4:40 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- generatedDynamic
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:36
      U unresolved-call app/p.ts:4:45 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("what a constructor stores into its argument is stored into the variable the caller passed", async () => {
    expect(
      await each({
        argumentFilled: {
          body: "  const a: any = {}; new C(a); res.json(a.k)",
          extra: `class C { constructor(o: any) { o.k = ${u}.email } }`,
        },
        noArgument: {
          body: "  const a: any = {}; new C(); res.json(a.k)",
          extra: `class C { constructor(o: any) { if (o) o.k = ${u}.email } }`,
        },
        noParentheses: {
          body: "  const a: any = new C; res.json(a.k)",
          extra: `class C { k = ${u}.email }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- argumentFilled
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:5:22
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:41
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:32
      -- noArgument
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:5:22
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      -- noParentheses
      E calls function:app/p.ts#h->function:app/p.ts#C.constructor p=- static o= h= @app/p.ts:5:18
      E returns function:app/p.ts#C.constructor->return:app/p.ts#C.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#C.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:34
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:25"
    `)
  })

  it("call is the only method that borrows an array method, and a namespace import is not shadowed by a local", async () => {
    expect(
      await each({
        protoCall: { body: "  res.json(Array.prototype.slice.call(x.list))" },
        protoApply: { body: "  res.json(Array.prototype.slice.apply(x.list))" },
        protoBind: { body: "  const f = Array.prototype.slice.bind(x.list); res.json(f())" },
        namespaceShadowedByLocal: {
          body: "  const lib: any = { pick: (v: any) => 'local' }; res.json(lib.pick(x.email))",
          extra: `import * as lib from "./lib"`,
          files: lib,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- protoCall
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      -- protoApply
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=list inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      U unresolved-call app/p.ts:4:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/list
      -- protoBind
      U unresolved-call app/p.ts:4:13 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/list
      -- namespaceShadowedByLocal
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:5:60
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:60
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:51
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:51"
    `)
  })

  it("a member a project module does not export can still be declared, under the specifier it was imported by", async () => {
    expect(
      await each(
        {
          declaredMember: {
            body: "  res.json(lib.extra(x.email))",
            extra: `import * as lib from "./lib"`,
            files: lib,
          },
          undeclaredMember: {
            body: "  res.json(lib.other(x.email))",
            extra: `import * as lib from "./lib"`,
            files: lib,
          },
          exportedMember: {
            body: "  res.json(lib.pick(x.email))",
            extra: `import * as lib from "./lib"`,
            files: lib,
          },
        },
        { summaries: [{ module: "./lib", export: "extra", effect: "pass-through" }] },
      ),
    ).toMatchInlineSnapshot(`
      "-- declaredMember
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email declared o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- undeclaredMember
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- exportedMember
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("a method stored on the prototype is found on an opaque parent's subclass, on an anonymous class, and not through a rebound name", async () => {
    expect(
      await each({
        opaqueParent: {
          body: "  res.json(new B().m(x.email))",
          extra: `class B extends (ext as any) {}\nB.prototype.m = (v: any) => v`,
        },
        anonymousClass: {
          body: "  const K: any = class {}; K.prototype.m = (v: any) => v; res.json(new K().m(x.email))",
        },
        reboundName: {
          body: "  res.json(new K().m(x.email))",
          extra: `class K {}\nK.prototype.m = (v: any) => v\nconst keep = K`,
        },
        inherited: {
          body: "  res.json(new S().m(x.email))",
          extra: `class P {}\nP.prototype.m = (v: any) => v\nclass S extends P {}`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- opaqueParent
      E calls function:app/p.ts#h->function:app/p.ts#B.constructor p=- static o= h= @app/p.ts:6:12
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@3:17 p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@3:17.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#<module>>anonymous@3:17->return:app/p.ts#<module>>anonymous@3:17#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
      E passes return:app/p.ts#<module>>anonymous@3:17#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- anonymousClass
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4.constructor p=- static o= h= @app/p.ts:4:68
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:59
      U unresolved-call app/p.ts:4:68 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- reboundName
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:7:12
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@3:17 p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@3:17.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#<module>>anonymous@3:17->return:app/p.ts#<module>>anonymous@3:17#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
      E passes return:app/p.ts#<module>>anonymous@3:17#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- inherited
      E calls function:app/p.ts#h->function:app/p.ts#S.constructor p=- static o= h= @app/p.ts:7:12
      E calls function:app/p.ts#S.constructor->function:app/p.ts#P.constructor p=- static o= h= @app/p.ts:4:1
      E calls function:app/p.ts#h->function:app/p.ts#<module>>anonymous@3:17 p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#<module>>anonymous@3:17.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E returns function:app/p.ts#<module>>anonymous@3:17->return:app/p.ts#<module>>anonymous@3:17#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
      E passes return:app/p.ts#<module>>anonymous@3:17#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"
    `)
  })
})
