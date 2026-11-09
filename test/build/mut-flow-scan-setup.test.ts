import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { facts, handler as baseHandler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"
import { USER_SHAPE, capability, dump, field, inventoryOf } from "./mut-flow-scan-harness.js"

/** `handler` glues its extra code straight onto `export function h`, so a declaration needs its newline. */
const handler = (body: string, extra = ""): Record<string, string> =>
  baseHandler(body, extra === "" || extra.endsWith("\n") ? extra : `${extra}\n`)

/**
 * Cases for how a scan is set up: the nodes it makes for a capability's fields, classes made by a function each time it
 * runs, and what a module exports and re-exports. Each is a small program and the exact facts it must produce.
 */
describe("flow-scan setup: field nodes", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  it("a field becomes a node with its classification and where it was declared, each only when it has one", async () => {
    const inventory = inventoryOf(
      capability({
        fields: [
          field("user", USER_SHAPE, { declarationPosition: { line: 7, column: 3 } }, "secret"),
          field("team", { name: "" }, { declarationPosition: { line: 9, column: 5 } }),
          field("tags", [{ label: "" }], {}, "personal"),
          field("empty", []),
        ],
      }),
    )
    const { input } = await h.scan(
      handler("  res.json(userData.getSnapshot().fields.user.email)"),
      {},
      inventory,
    )
    expect(
      dump(input)
        .filter((line) => line.startsWith("N field"))
        .join("\n"),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=7:3
      N field features/user/user.ts userData.team static bk= cl= src=9:5
      N field features/user/user.ts userData.tags static bk= cl=personal src=
      N field features/user/user.ts userData.empty static bk= cl= src="
    `)
  })
})

describe("flow-scan setup: classes made by a function, and exports", () => {
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

  it("a class a function makes is a new class each time the function runs, with its own captured data", async () => {
    expect(
      await each({
        twoEvaluations: {
          body: "  const K1 = make(x.email); const K2 = make(x.name); res.json(new K1().m()); res.json(new K2().m())",
          extra: `const make = (v: any) => class { m() { return v } }`,
        },
        namedFactory: {
          body: "  const K1 = make(x.email); const K2 = make(x.name); res.json(new K1().m()); res.json(new K2().m())",
          extra: `function make(v: any) { return class Inner { m() { return v } } }`,
        },
        sameNameAsModuleClass: {
          body: "  const K = make(x.email); res.json(new K().m()); res.json(new Local().m())",
          extra: `class Local { m() { return 'module' } }\nfunction make(v: any) { class Local { m() { return v } } return Local }`,
        },
        declaredOnce: {
          body: "  res.json(new Local(x.email).m()); res.json(new Local(x.name).m())",
          extra: `class Local { constructor(public p: any) {} m() { return this.p } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- twoEvaluations
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:40
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:5:63
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.m p=- static o= h= @app/p.ts:5:63
      E returns function:app/p.ts#make>anonymous@2.m->return:app/p.ts#make>anonymous@2.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:40
      E passes return:app/p.ts#make>anonymous@2.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:54
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:54
      E returns function:app/p.ts#make>anonymous@2.m->return:app/p.ts#make>anonymous@2.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:40
      E passes return:app/p.ts#make>anonymous@2.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:78
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:78
      -- namedFactory
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:40
      E calls function:app/p.ts#h->function:app/p.ts#make>Inner.constructor p=- static o= h= @app/p.ts:5:63
      E calls function:app/p.ts#h->function:app/p.ts#make>Inner.m p=- static o= h= @app/p.ts:5:63
      E returns function:app/p.ts#make>Inner.m->return:app/p.ts#make>Inner.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E passes return:app/p.ts#make>Inner.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:54
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:54
      E returns function:app/p.ts#make>Inner.m->return:app/p.ts#make>Inner.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E passes return:app/p.ts#make>Inner.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:78
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:78
      -- sameNameAsModuleClass
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:6:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:13
      E calls function:app/p.ts#h->function:app/p.ts#make>Local.constructor p=- static o= h= @app/p.ts:6:37
      E calls function:app/p.ts#h->function:app/p.ts#make>Local.m p=- static o= h= @app/p.ts:6:37
      E returns function:app/p.ts#make>Local.m->return:app/p.ts#make>Local.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:45
      E passes return:app/p.ts#make>Local.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:28
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:28
      E calls function:app/p.ts#h->function:app/p.ts#Local.constructor p=- static o= h= @app/p.ts:6:60
      E calls function:app/p.ts#h->function:app/p.ts#Local.m p=- static o= h= @app/p.ts:6:60
      -- declaredOnce
      E calls function:app/p.ts#h->function:app/p.ts#Local.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Local.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#Local.constructor->return:app/p.ts#Local.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:15
      E calls function:app/p.ts#h->function:app/p.ts#Local.m p=- static o= h= @app/p.ts:5:12
      E passes return:app/p.ts#Local.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#Local.m.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#Local.m->return:app/p.ts#Local.m#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#Local.m#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#Local.constructor.p p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:46
      E returns function:app/p.ts#Local.constructor->return:app/p.ts#Local.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:15
      E passes return:app/p.ts#Local.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:46
      E passes function:app/p.ts#h->parameter:app/p.ts#Local.m.this p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:46
      E returns function:app/p.ts#Local.m->return:app/p.ts#Local.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:51
      E passes return:app/p.ts#Local.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:37
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:37"
    `)
  })

  it("the methods of a class a function makes are told apart, each with its own captured data", async () => {
    expect(
      await each({
        twoMethods: {
          body: "  const K = make(x.email, x.name); const k = new K(); res.json(k.first()); res.json(k.second())",
          extra: `const make = (a: any, b: any) => class { first() { return a } second() { return b } }`,
        },
        twoClassesTwoMethods: {
          body: "  const K1 = make(x.email, 1); const K2 = make(x.name, x.id); res.json(new K1().first()); res.json(new K2().second())",
          extra: `const make = (a: any, b: any) => class { first() { return a } second() { return b } }`,
        },
        staticAndInstance: {
          body: "  const K = make(x.email, x.name); res.json(K.s()); res.json(new K().m())",
          extra: `const make = (a: any, b: any) => class { static s() { return a } m() { return b } }`,
        },
        constructorOfFactoryClass: {
          body: "  const K = make(x.email); res.json(new K(x.name).p); res.json(new K(x.name).captured())",
          extra: `const make = (a: any) => class { constructor(public p: any) {} captured() { return a } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- twoMethods
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:5:46
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.first p=- static o= h= @app/p.ts:5:64
      E returns function:app/p.ts#make>anonymous@2.first->return:app/p.ts#make>anonymous@2.first#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E passes return:app/p.ts#make>anonymous@2.first#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:55
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:55
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.second p=- static o= h= @app/p.ts:5:85
      E returns function:app/p.ts#make>anonymous@2.second->return:app/p.ts#make>anonymous@2.second#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:74
      E passes return:app/p.ts#make>anonymous@2.second#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:76
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:76
      -- twoClassesTwoMethods
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#make.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
      E passes function:app/p.ts#h->parameter:app/p.ts#make.a p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:43
      E passes function:app/p.ts#h->parameter:app/p.ts#make.b p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:43
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:5:72
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.first p=- static o= h= @app/p.ts:5:72
      E returns function:app/p.ts#make>anonymous@2.first->return:app/p.ts#make>anonymous@2.first#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      E passes return:app/p.ts#make>anonymous@2.first#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:63
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:63
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.second p=- static o= h= @app/p.ts:5:100
      E returns function:app/p.ts#make>anonymous@2.second->return:app/p.ts#make>anonymous@2.second#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:74
      E passes return:app/p.ts#make>anonymous@2.second#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:91
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:91
      E returns function:app/p.ts#make>anonymous@2.first->return:app/p.ts#make>anonymous@2.first#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:52
      U unanalyzed-function app/p.ts:2:42 subject=function:app/p.ts#make>anonymous@2.first detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/name
      -- staticAndInstance
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.s p=- static o= h= @app/p.ts:5:45
      E returns function:app/p.ts#make>anonymous@2.s->return:app/p.ts#make>anonymous@2.s#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:55
      E passes return:app/p.ts#make>anonymous@2.s#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:36
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:36
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:5:62
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.m p=- static o= h= @app/p.ts:5:62
      E returns function:app/p.ts#make>anonymous@2.m->return:app/p.ts#make>anonymous@2.m#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:72
      E passes return:app/p.ts#make>anonymous@2.m#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:53
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:53
      -- constructorOfFactoryClass
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:5:37
      E passes function:app/p.ts#h->parameter:app/p.ts#make>anonymous@2.constructor.p p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:37
      E returns function:app/p.ts#make>anonymous@2.constructor->return:app/p.ts#make>anonymous@2.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:34
      E passes return:app/p.ts#make>anonymous@2.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:37
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:28
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.captured p=- static o= h= @app/p.ts:5:64
      E passes function:app/p.ts#h->parameter:app/p.ts#make>anonymous@2.captured.this p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:64
      E returns function:app/p.ts#make>anonymous@2.captured->return:app/p.ts#make>anonymous@2.captured#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:77
      E passes return:app/p.ts#make>anonymous@2.captured#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:55
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:55"
    `)
  })

  it("export default of a name is that name, as it is when the importer reads it", async () => {
    expect(
      await each({
        reassignedLater: {
          body: "  set(x.email); res.json(d)",
          extra: `import d, { set } from "./lib"`,
          files: {
            "app/lib.ts": `let held: any\nexport function set(v: any) { held = v }\nexport default held`,
          },
        },
        constantName: {
          body: "  res.json(d)",
          extra: `import d from "./lib"`,
          files: {
            "app/lib.ts": `import { userData } from "../features/user/user.js"\nconst held = userData.getSnapshot().fields.user.email\nexport default held`,
          },
        },
        classByName: {
          body: "  res.json(new D(x.email).p)",
          extra: `import D from "./lib"`,
          files: {
            "app/lib.ts": `class K { constructor(public p: any) {} }\nexport default K`,
          },
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- reassignedLater
      E calls function:app/p.ts#h->function:app/lib.ts#set p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/lib.ts#set.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:17
      -- constantName
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- classByName
      E calls function:app/p.ts#h->function:app/lib.ts#K.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#K.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#K.constructor->return:app/lib.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:11
      E passes return:app/lib.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("a class a function makes without a constructor of its own has the implicit one, which no one needs to call", async () => {
    expect(
      await each({
        fieldInitializerNeverInstantiated: {
          body: "  make(x.email)",
          extra: `const make = (v: any) => class { f = v }`,
        },
        fieldInitializerInstantiated: {
          body: "  const K = make(x.email); res.json(new K().f)",
          extra: `const make = (v: any) => class { f = v }`,
        },
        explicitConstructorNeverInstantiated: {
          body: "  make(x.email)",
          extra: `const make = (v: any) => class { f: any; constructor() { this.f = v } }`,
        },
        declaredClassNoConstructor: {
          body: "  res.json(new K().f)",
          extra: `class K { f = ${u}.name }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- fieldInitializerNeverInstantiated
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E returns function:app/p.ts#make>anonymous@2.constructor->return:app/p.ts#make>anonymous@2.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:26
      U unanalyzed-function app/p.ts:2:14 subject=function:app/p.ts#make detail=the analysis did not settle after 6 rounds: data written by one function was still reaching others data=
      -- fieldInitializerInstantiated
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:5:37
      E returns function:app/p.ts#make>anonymous@2.constructor->return:app/p.ts#make>anonymous@2.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:26
      E passes return:app/p.ts#make>anonymous@2.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:37
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:28
      U unanalyzed-function app/p.ts:2:14 subject=function:app/p.ts#make detail=the analysis did not settle after 6 rounds: data written by one function was still reaching others data=
      -- explicitConstructorNeverInstantiated
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E returns function:app/p.ts#make>anonymous@2.constructor->return:app/p.ts#make>anonymous@2.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:42
      U unanalyzed-function app/p.ts:2:14 subject=function:app/p.ts#make detail=the analysis did not settle after 6 rounds: data written by one function was still reaching others data=
      U unanalyzed-function app/p.ts:2:42 subject=function:app/p.ts#make>anonymous@2.constructor detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/email
      -- declaredClassNoConstructor
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:12
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("export default of a name, of a function, of a class and of a value", async () => {
    expect(
      await each({
        name: {
          body: "  res.json(d(x.email))",
          extra: `import d from "./lib"`,
          files: { "app/lib.ts": `const f = (v: any) => v\nexport default f` },
        },
        arrowExpression: {
          body: "  res.json(d(x.email))",
          extra: `import d from "./lib"`,
          files: { "app/lib.ts": `export default (v: any) => v` },
        },
        functionDeclaration: {
          body: "  res.json(d(x.email))",
          extra: `import d from "./lib"`,
          files: { "app/lib.ts": `export default function (v: any) { return v }` },
        },
        classDeclaration: {
          body: "  res.json(new D(x.email).p)",
          extra: `import D from "./lib"`,
          files: { "app/lib.ts": `export default class { constructor(public p: any) {} }` },
        },
        valueExpression: {
          body: "  res.json(d.k)",
          extra: `import d from "./lib"`,
          files: {
            "app/lib.ts": `import { userData } from "../features/user/user.js"\nexport default { k: userData.getSnapshot().fields.user.email }`,
          },
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- name
      E calls function:app/p.ts#h->function:app/lib.ts#f p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#f.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#f->return:app/lib.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:23
      E passes return:app/lib.ts#f#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- arrowExpression
      E calls function:app/p.ts#h->function:app/lib.ts#default p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#default.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#default->return:app/lib.ts#default#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:28
      E passes return:app/lib.ts#default#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- functionDeclaration
      E calls function:app/p.ts#h->function:app/lib.ts#default p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#default.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#default->return:app/lib.ts#default#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:36
      E passes return:app/lib.ts#default#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- classDeclaration
      E calls function:app/p.ts#h->function:app/lib.ts#default.constructor p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#default.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#default.constructor->return:app/lib.ts#default.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:24
      E passes return:app/lib.ts#default.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- valueExpression
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("a re-export from a module the project cannot resolve points at nothing, and one it can points at that module", async () => {
    expect(
      await each({
        starUnresolved: {
          body: "  res.json(lib.pick(x.email))",
          extra: `import * as lib from "./barrel"`,
          files: { "app/barrel.ts": `export * from "nowhere"\nexport const pick = (v: any) => v` },
        },
        namedUnresolved: {
          body: "  res.json(pick(x.email))",
          extra: `import { pick } from "./barrel"\nconst pick2 = 1`,
          files: {
            "app/barrel.ts": `export { pick } from "nowhere"\nconst pick = (v: any) => 'local'`,
          },
        },
        namedResolved: {
          body: "  res.json(pick(x.email))",
          extra: `import { pick } from "./barrel"`,
          files: {
            "app/barrel.ts": `export { pick } from "./lib"`,
            "app/lib.ts": `export const pick = (v: any) => v`,
          },
        },
        renamed: {
          body: "  res.json(other(x.email))",
          extra: `import { other } from "./barrel"`,
          files: {
            "app/barrel.ts": `export { pick as other } from "./lib"`,
            "app/lib.ts": `export const pick = (v: any) => v`,
          },
        },
        starResolved: {
          body: "  res.json(pick(x.email))",
          extra: `import { pick } from "./barrel"`,
          files: {
            "app/barrel.ts": `export * from "./lib"`,
            "app/lib.ts": `export const pick = (v: any) => v`,
          },
        },
        namespaceReExport: {
          body: "  res.json(ns.pick(x.email))",
          extra: `import { ns } from "./barrel"`,
          files: {
            "app/barrel.ts": `export * as ns from "./lib"`,
            "app/lib.ts": `export const pick = (v: any) => v`,
          },
        },
        namespaceReExportUnresolved: {
          body: "  res.json(ns.pick(x.email))",
          extra: `import { ns } from "./barrel"`,
          files: { "app/barrel.ts": `export * as ns from "nowhere"` },
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- starUnresolved
      E calls function:app/p.ts#h->function:app/barrel.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/barrel.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/barrel.ts#pick->return:app/barrel.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/barrel.ts:2:33
      E passes return:app/barrel.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- namedUnresolved
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      U unresolved-call app/p.ts:6:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- namedResolved
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- renamed
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- starResolved
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- namespaceReExport
      E calls function:app/p.ts#h->function:app/lib.ts#pick p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/lib.ts#pick.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/lib.ts#pick->return:app/lib.ts#pick#return p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:33
      E passes return:app/lib.ts#pick#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- namespaceReExportUnresolved
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("what a module's own statements store reaches the functions that read it, in a global or in a CommonJS export", async () => {
    expect(
      await each({
        undeclaredGlobalWrittenAtModuleLevel: {
          body: "  reader(res)",
          extra: `leaked = ${u}.email\nexport function reader(res0: any) { res.json(leaked) }`,
        },
        declaredModuleVariable: {
          body: "  reader(res)",
          extra: `let held: any\nheld = ${u}.name\nexport function reader(res0: any) { res.json(held) }`,
        },
        commonJsRequire: {
          body: '  const m = require("./cjs"); res.json(m.a); res.json(m.b)',
          files: {
            "app/cjs.ts": `import { userData } from "../features/user/user.js"\nexports.a = userData.getSnapshot().fields.user.email\nmodule.exports.b = userData.getSnapshot().fields.user.name`,
          },
        },
        commonJsReplaced: {
          body: '  const m = require("./cjs"); res.json(m.c)',
          files: {
            "app/cjs.ts": `import { userData } from "../features/user/user.js"\nmodule.exports = { c: userData.getSnapshot().fields.user.id }`,
          },
        },
        moduleStatementUsesCapability: {
          body: "  res.json(snap.email)",
          extra: `const snap: any = ${u}`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- undeclaredGlobalWrittenAtModuleLevel
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:37
      E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:6:3
      -- declaredModuleVariable
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
      E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:7:3
      -- commonJsRequire
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:46
      -- commonJsReplaced
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
      -- moduleStatementUsesCapability
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("an ambient class, and a CommonJS module, are set up as the code they are", async () => {
    expect(
      await each({
        ambient: {
          body: "  res.json(new Ext().m(x.email))",
          extra: `declare class Ext { m(v: any): any }`,
        },
        commonJsExports: {
          body: "  res.json(lib.a); res.json(lib.b)",
          extra: `import * as lib from "./cjs"`,
          files: {
            "app/cjs.ts": `import { userData } from "../features/user/user.js"\nexports.a = userData.getSnapshot().fields.user.email\nmodule.exports.b = userData.getSnapshot().fields.user.name`,
          },
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- ambient
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- commonJsExports"
    `)
  })
})
