import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { facts, handler as baseHandler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"
import { capability, edgeLine, inventoryOf, operation } from "./mut-flow-scan-harness.js"
import type { defaultScanLimits } from "../../src/build/flow-scan.js"

/** `handler` glues its extra code straight onto `export function h`, so a declaration needs its newline. */
const handler = (body: string, extra = ""): Record<string, string> =>
  baseHandler(body, extra === "" || extra.endsWith("\n") ? extra : `${extra}\n`)

/**
 * Cases for the evaluation driver: how many rounds data that moves between functions gets, which functions run on their
 * own, what an async function or a constructor hands back, and how `this` is bound. Each is a small program and the exact
 * facts it must produce.
 */
describe("flow-scan evaluation: rounds", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** A reader that comes first and `steps` writers, each copying the next one's variable; the last stores tracked data. */
  const chain = (steps: number): string => {
    const names = Array.from({ length: steps + 1 }, (_, i) => `g${String(i)}`)
    const lines = [
      `let ${names.join(", ")}: any`,
      `export function reader(res0: any) { res.json(g0) }`,
    ]
    for (let i = 0; i < steps; i++) {
      const to = names[i] ?? ""
      const from = names[i + 1] ?? ""
      lines.push(
        i === steps - 1
          ? `export function w${String(i)}() { ${to} = ${u}.email }`
          : `export function w${String(i)}() { ${to} = ${from} }`,
      )
    }
    return lines.join("\n")
  }

  it("data that moves between functions is followed for as many rounds as the scan allows, and a project still changing after that is reported", async () => {
    const table: Record<string, { reaches: boolean; unsettled: boolean }> = {}
    for (const steps of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { input } = await h.scan(handler("  reader(res)", chain(steps)))
      table[`${String(steps)} writers`] = {
        reaches: facts(input).some((line) => line.includes("p=email")),
        unsettled: input.unknowns.some((unknown) => unknown.reason === "unanalyzed-function"),
      }
    }
    expect(table).toMatchInlineSnapshot(`
      {
        "1 writers": {
          "reaches": true,
          "unsettled": false,
        },
        "2 writers": {
          "reaches": true,
          "unsettled": false,
        },
        "3 writers": {
          "reaches": true,
          "unsettled": false,
        },
        "4 writers": {
          "reaches": true,
          "unsettled": false,
        },
        "5 writers": {
          "reaches": true,
          "unsettled": false,
        },
        "6 writers": {
          "reaches": true,
          "unsettled": true,
        },
        "7 writers": {
          "reaches": false,
          "unsettled": true,
        },
        "8 writers": {
          "reaches": false,
          "unsettled": true,
        },
      }
    `)
  })
})

describe("flow-scan evaluation: calls, receivers and budgets", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** Each program is scanned on its own, with the code it names. */
  const each = async (
    cases: Readonly<Record<string, { body: string; extra?: string }>>,
    configure: { limits?: Partial<ReturnType<typeof defaultScanLimits>> } = {},
  ): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "" }] of Object.entries(cases)) {
      const { input } = await h.scan(
        handler(`  const x: any = ${u}\n${body}`, extra),
        {},
        undefined,
        configure.limits,
      )
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("the same method on two receivers is two calls, each with its own receiver's data", async () => {
    expect(
      await each({
        twoReceivers: {
          body: "  const a = new K(x.email); const b = new K(x.name); res.json(a.get()); res.json(b.get())",
          extra: `class K { constructor(public v: any) {} get() { return this.v } }`,
        },
        sameReceiverTwice: {
          body: "  const a = new K(x.email); res.json(a.get()); res.json(a.get())",
          extra: `class K { constructor(public v: any) {} get() { return this.v } }`,
        },
        plainFunctionTwice: {
          body: "  res.json(id(x.email)); res.json(id(x.name))",
          extra: `const id = (v: any) => v`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- twoReceivers
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:39
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E calls function:app/p.ts#h->function:app/p.ts#K.get p=- static o= h= @app/p.ts:5:63
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:63
      E passes function:app/p.ts#h->parameter:app/p.ts#K.get.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:63
      E returns function:app/p.ts#K.get->return:app/p.ts#K.get#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:49
      E passes return:app/p.ts#K.get#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:54
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:54
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:82
      E passes function:app/p.ts#h->parameter:app/p.ts#K.get.this p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:82
      E returns function:app/p.ts#K.get->return:app/p.ts#K.get#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:49
      E passes return:app/p.ts#K.get#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:73
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:73
      -- sameReceiverTwice
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E calls function:app/p.ts#h->function:app/p.ts#K.get p=- static o= h= @app/p.ts:5:38
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E passes function:app/p.ts#h->parameter:app/p.ts#K.get.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E returns function:app/p.ts#K.get->return:app/p.ts#K.get#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:49
      E passes return:app/p.ts#K.get#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29
      -- plainFunctionTwice
      E calls function:app/p.ts#h->function:app/p.ts#id p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#id.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#id->return:app/p.ts#id#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:24
      E passes return:app/p.ts#id#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#id.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:35
      E returns function:app/p.ts#id->return:app/p.ts#id#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:24
      E passes return:app/p.ts#id#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26"
    `)
  })

  it("a call that throws hands its throw to the nearest catch, and only an async function hands it back as a rejection", async () => {
    expect(
      await each({
        syncThrowCaught: {
          body: "  try { thrower(x.email) } catch (e) { res.json(e) }",
          extra: `function thrower(v: any): any { throw v }`,
        },
        syncThrowNotAPromise: {
          body: "  thrower(x.email).catch((e: any) => res.json(e))",
          extra: `function thrower(v: any): any { throw v }`,
        },
        asyncThrowIsARejection: {
          body: "  thrower(x.email).catch((e: any) => res.json(e))",
          extra: `async function thrower(v: any): Promise<any> { throw v }`,
        },
        asyncWithoutThrow: {
          body: "  quiet(x.email).catch((e: any) => res.json(e))",
          extra: `async function quiet(v: any): Promise<any> { return v }`,
        },
        throwOfNothingTracked: {
          body: "  try { thrower(1) } catch (e) { res.json(e) }",
          extra: `function thrower(v: any): any { throw v }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- syncThrowCaught
      E calls function:app/p.ts#h->function:app/p.ts#thrower p=- static o= h= @app/p.ts:5:9
      E passes function:app/p.ts#h->parameter:app/p.ts#thrower.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:9
      E returns function:app/p.ts#thrower->return:app/p.ts#thrower#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:33
      E passes return:app/p.ts#thrower#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:40
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:40
      -- syncThrowNotAPromise
      E calls function:app/p.ts#h->function:app/p.ts#thrower p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#thrower.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E returns function:app/p.ts#thrower->return:app/p.ts#thrower#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:33
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@5:26 p=- static o= h= @app/p.ts:5:3
      -- asyncThrowIsARejection
      E calls function:app/p.ts#h->function:app/p.ts#thrower p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#thrower.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E returns function:app/p.ts#thrower->return:app/p.ts#thrower#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:48
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@5:26 p=- static o= h= @app/p.ts:5:3
      E passes return:app/p.ts#thrower#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@5:26.e p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h>anonymous@5:26->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      -- asyncWithoutThrow
      E calls function:app/p.ts#h->function:app/p.ts#quiet p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#quiet.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E returns function:app/p.ts#quiet->return:app/p.ts#quiet#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:46
      E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@5:24 p=- static o= h= @app/p.ts:5:3
      -- throwOfNothingTracked
      E calls function:app/p.ts#h->function:app/p.ts#thrower p=- static o= h= @app/p.ts:5:9"
    `)
  })

  it("a call past the depth the scan allows is an unknown naming what it was handed, receiver included", async () => {
    const chain = {
      body: "  res.json(a(x.email))",
      extra: `const c = (v: any) => v\nconst b = (v: any) => c(v)\nconst a = (v: any) => b(v)`,
    }
    const method = {
      body: "  const k = new K(x.email); res.json(k.get())",
      extra: `class K { constructor(public v: any) {} get() { return this.v } }`,
    }
    expect({
      withinDepth: await each({ chain, method }),
      pastDepth: await each({ chain, method }, { limits: { maxCallDepth: 1 } }),
      atDepth: await each({ chain, method }, { limits: { maxCallDepth: 3 } }),
    }).toMatchInlineSnapshot(`
      {
        "atDepth": "-- chain
      E calls function:app/p.ts#b->function:app/p.ts#c p=- static o= h= @app/p.ts:3:23
      E calls function:app/p.ts#a->function:app/p.ts#b p=- static o= h= @app/p.ts:4:23
      E calls function:app/p.ts#h->function:app/p.ts#a p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#a.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E passes function:app/p.ts#a->parameter:app/p.ts#b.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes function:app/p.ts#b->parameter:app/p.ts#c.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:23
      E returns function:app/p.ts#b->return:app/p.ts#b#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:23
      E passes return:app/p.ts#b#return->function:app/p.ts#a p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E returns function:app/p.ts#a->return:app/p.ts#a#return p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes return:app/p.ts#a#return->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unanalyzed-function app/p.ts:3:23 subject=function:app/p.ts#b detail=call depth or analysis budget exceeded at c data=field:features/user/user.ts#userData.user/email
      -- method
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E calls function:app/p.ts#h->function:app/p.ts#K.get p=- static o= h= @app/p.ts:5:38
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E passes function:app/p.ts#h->parameter:app/p.ts#K.get.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E returns function:app/p.ts#K.get->return:app/p.ts#K.get#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:49
      E passes return:app/p.ts#K.get#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29",
        "pastDepth": "-- chain
      E calls function:app/p.ts#b->function:app/p.ts#c p=- static o= h= @app/p.ts:3:23
      E calls function:app/p.ts#a->function:app/p.ts#b p=- static o= h= @app/p.ts:4:23
      E calls function:app/p.ts#h->function:app/p.ts#a p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#a.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      U unanalyzed-function app/p.ts:3:23 subject=function:app/p.ts#b detail=call depth or analysis budget exceeded at c data=
      U unanalyzed-function app/p.ts:4:23 subject=function:app/p.ts#a detail=call depth or analysis budget exceeded at b data=
      U unanalyzed-function app/p.ts:7:12 subject=function:app/p.ts#h detail=call depth or analysis budget exceeded at a data=field:features/user/user.ts#userData.user/email
      -- method
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E calls function:app/p.ts#h->function:app/p.ts#K.get p=- static o= h= @app/p.ts:5:38
      E passes function:app/p.ts#h->parameter:app/p.ts#K.get.this p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29
      U unanalyzed-function app/p.ts:5:13 subject=function:app/p.ts#h detail=call depth or analysis budget exceeded at K.constructor data=field:features/user/user.ts#userData.user/email
      U unanalyzed-function app/p.ts:5:38 subject=function:app/p.ts#h detail=call depth or analysis budget exceeded at K.get data=field:features/user/user.ts#userData.user/email",
        "withinDepth": "-- chain
      E calls function:app/p.ts#b->function:app/p.ts#c p=- static o= h= @app/p.ts:3:23
      E calls function:app/p.ts#a->function:app/p.ts#b p=- static o= h= @app/p.ts:4:23
      E calls function:app/p.ts#h->function:app/p.ts#a p=- static o= h= @app/p.ts:7:12
      E passes function:app/p.ts#h->parameter:app/p.ts#a.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:12
      E passes function:app/p.ts#a->parameter:app/p.ts#b.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes function:app/p.ts#b->parameter:app/p.ts#c.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:23
      E returns function:app/p.ts#c->return:app/p.ts#c#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:23
      E passes return:app/p.ts#c#return->function:app/p.ts#b p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:23
      E returns function:app/p.ts#b->return:app/p.ts#b#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:23
      E passes return:app/p.ts#b#return->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E returns function:app/p.ts#a->return:app/p.ts#a#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:23
      E passes return:app/p.ts#a#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
      -- method
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:5:13
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E calls function:app/p.ts#h->function:app/p.ts#K.get p=- static o= h= @app/p.ts:5:38
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E passes function:app/p.ts#h->parameter:app/p.ts#K.get.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E returns function:app/p.ts#K.get->return:app/p.ts#K.get#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:49
      E passes return:app/p.ts#K.get#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:29",
      }
    `)
  })

  it("a call to a mutator of the capability is data that leaves through its operation", async () => {
    const inventory = inventoryOf(capability({ mutators: [operation("mutator", "save", {})] }))
    const { input } = await h.scan(
      handler(`  const x: any = ${u}\n  userData.save(x.email)\n  userData.other(x.name)`),
      {},
      inventory,
    )
    expect(facts(input).join("\n")).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:features/user/user.ts#userData.save p=- static o= h= @app/p.ts:4:3
      E passes function:app/p.ts#h->function:features/user/user.ts#userData.save p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
    `)
  })
})

describe("flow-scan evaluation: what a function is handed and never reads", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  /** The `discards` edges of each program: data a function received and never read. */
  const discards = async (
    cases: Readonly<Record<string, { body: string; extra?: string }>>,
  ): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "" }] of Object.entries(cases)) {
      const { input } = await h.scan(handler(`  const x: any = ${u}\n${body}`, extra))
      const lines = input.edges
        .map(edgeLine)
        .filter((line) => line.startsWith("discards"))
        .map((line) =>
          line
            .replace(/ @.*$/, "")
            .replace(/function:app\/p.ts#/g, "")
            .replace(/field:features\/user\/user.ts#userData.user/g, "F"),
        )
      out.push(`-- ${label}`, ...lines)
    }
    return out.join("\n")
  }

  it("a result, a throw and a stored value the caller never reads are discarded by the caller", async () => {
    expect(
      await discards({
        resultIgnored: { body: "  id(x.email)", extra: `const id = (v: any) => v` },
        resultRead: { body: "  res.json(id(x.email))", extra: `const id = (v: any) => v` },
        throwIgnored: {
          body: "  try { thrower(x.email) } catch (e) {}",
          extra: `function thrower(v: any): any { throw v }`,
        },
        throwRead: {
          body: "  try { thrower(x.email) } catch (e) { res.json(e) }",
          extra: `function thrower(v: any): any { throw v }`,
        },
        filledNeverRead: {
          body: "  const a: any = {}; fill(a, x.email)",
          extra: `const fill = (o: any, v: any) => { o.k = v }`,
        },
        filledAndRead: {
          body: "  const a: any = {}; fill(a, x.email); res.json(a.k)",
          extra: `const fill = (o: any, v: any) => { o.k = v }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- resultIgnored
      discards h->F p=id static o=F h=
      discards h->F p=name static o=F h=
      discards h->F p=passwordHash static o=F h=
      discards h->F p=role static o=F h=
      -- resultRead
      discards h->F p=id static o=F h=
      discards h->F p=name static o=F h=
      discards h->F p=passwordHash static o=F h=
      discards h->F p=role static o=F h=
      -- throwIgnored
      discards h->F p=id static o=F h=
      discards h->F p=name static o=F h=
      discards h->F p=passwordHash static o=F h=
      discards h->F p=role static o=F h=
      -- throwRead
      discards h->F p=id static o=F h=
      discards h->F p=name static o=F h=
      discards h->F p=passwordHash static o=F h=
      discards h->F p=role static o=F h=
      -- filledNeverRead
      discards h->F p=id static o=F h=
      discards h->F p=name static o=F h=
      discards h->F p=passwordHash static o=F h=
      discards h->F p=role static o=F h=
      -- filledAndRead
      discards h->F p=id static o=F h=
      discards h->F p=name static o=F h=
      discards h->F p=passwordHash static o=F h=
      discards h->F p=role static o=F h="
    `)
  })

  it("the fields an instance holds are discarded by a method that reads only some of them", async () => {
    expect(
      await discards({
        readsOne: {
          body: "  const k = new K(x.email, x.name); res.json(k.first())",
          extra: `class K { constructor(public a: any, public b: any) {} first() { return this.a } }`,
        },
        readsNone: {
          body: "  const k = new K(x.email, x.name); k.nothing()",
          extra: `class K { constructor(public a: any, public b: any) {} nothing() { return 1 } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- readsOne
      discards h->F p=id static o=F h=
      discards h->F p=passwordHash static o=F h=
      discards h->F p=role static o=F h=
      -- readsNone
      discards h->F p=id static o=F h=
      discards h->F p=passwordHash static o=F h=
      discards h->F p=role static o=F h="
    `)
  })
})

describe("flow-scan evaluation: functions the scan makes roots of, and what is run again", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  const each = async (
    cases: Readonly<Record<string, { body: string; extra?: string }>>,
  ): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "" }] of Object.entries(cases)) {
      const { input } = await h.scan(handler(`  const x: any = ${u}\n${body}`, extra))
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("a function made inside another and never called is run again each round, with the state the other functions have stored by then", async () => {
    expect(
      await each({
        uncalledNestedReadsLaterState: {
          body: "  res.json(1)",
          extra: `let g: any\nexport function reader() { const inner = () => console.log(g); return inner }\nexport function writer() { g = ${u}.email }`,
        },
        calledNestedReadsLaterState: {
          body: "  res.json(1)",
          extra: `let g: any\nexport function reader() { const inner = () => console.log(g); inner() }\nexport function writer() { g = ${u}.email }`,
        },
        uncalledNestedClassMethod: {
          body: "  res.json(1)",
          extra: `let g: any\nexport function reader() { return class { m() { console.log(g) } } }\nexport function writer() { g = ${u}.name }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- uncalledNestedReadsLaterState
      E side-effect function:app/p.ts#reader>anonymous@3:42->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:48
      -- calledNestedReadsLaterState
      E calls function:app/p.ts#reader->function:app/p.ts#reader>anonymous@3:42 p=- static o= h= @app/p.ts:3:64
      E side-effect function:app/p.ts#reader>anonymous@3:42->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:48
      -- uncalledNestedClassMethod
      E side-effect function:app/p.ts#reader>anonymous@3.m->boundary:boundary:code#console p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:49"
    `)
  })

  it("closures that make closures are all run, however deep", async () => {
    expect(
      await each({
        oneDeep: {
          body: "  make1()",
          extra: `const make1 = () => () => ${u}.email`,
        },
        twoDeep: {
          body: "  make2()",
          extra: `const make2 = () => () => () => ${u}.email`,
        },
        threeDeep: {
          body: "  make3()",
          extra: `const make3 = () => () => () => () => ${u}.email`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- oneDeep
      E calls function:app/p.ts#h->function:app/p.ts#make1 p=- static o= h= @app/p.ts:5:3
      E returns function:app/p.ts#make1>anonymous@2:21->return:app/p.ts#make1>anonymous@2:21#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      U unanalyzed-function app/p.ts:2:21 subject=function:app/p.ts#make1>anonymous@2:21 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/email
      -- twoDeep
      E calls function:app/p.ts#h->function:app/p.ts#make2 p=- static o= h= @app/p.ts:5:3
      E returns function:app/p.ts#make2>anonymous@2:21>anonymous@2:27->return:app/p.ts#make2>anonymous@2:21>anonymous@2:27#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:33
      U unanalyzed-function app/p.ts:2:27 subject=function:app/p.ts#make2>anonymous@2:21>anonymous@2:27 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/email
      -- threeDeep
      E calls function:app/p.ts#h->function:app/p.ts#make3 p=- static o= h= @app/p.ts:5:3
      E returns function:app/p.ts#make3>anonymous@2:21>anonymous@2:27>anonymous@2:33->return:app/p.ts#make3>anonymous@2:21>anonymous@2:27>anonymous@2:33#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:39
      U unanalyzed-function app/p.ts:2:33 subject=function:app/p.ts#make3>anonymous@2:21>anonymous@2:27>anonymous@2:33 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("the same function called as a constructor and as a plain function is two calls", async () => {
    expect(
      await each({
        constructedThenPlain: {
          body: "  res.json(new F(x.email)); res.json(F(x.email))",
          extra: `function F(this: any, v: any): any { this.v = v; return v }`,
        },
        plainThenConstructed: {
          body: "  res.json(F(x.email)); res.json(new F(x.email))",
          extra: `function F(this: any, v: any): any { this.v = v; return v }`,
        },
        constructedTwice: {
          body: "  res.json(new F(x.email).v); res.json(new F(x.name).v)",
          extra: `function F(this: any, v: any): any { this.v = v }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- constructedThenPlain
      E calls function:app/p.ts#h->function:app/p.ts#F p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- plainThenConstructed
      E calls function:app/p.ts#h->function:app/p.ts#F p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- constructedTwice
      E calls function:app/p.ts#h->function:app/p.ts#F p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:40
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:1
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:40
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:31"
    `)
  })

  it("a closure made by a static initializer is a closure of the class, run with what the class holds", async () => {
    expect(
      await each({
        staticClosure: {
          body: "  res.json(1)",
          extra: `class K { static f = () => console.log(${u}.email) }`,
        },
        staticClosureCalled: {
          body: "  K.f()",
          extra: `class K { static f = () => console.log(${u}.name) }`,
        },
        staticBlockClosure: {
          body: "  res.json(1)",
          extra: `class K { static { const f = () => console.log(${u}.id); f() } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- staticClosure
      E side-effect function:app/p.ts#K.static>anonymous@2:22->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:28
      -- staticClosureCalled
      E side-effect function:app/p.ts#K.static>anonymous@2:22->boundary:boundary:code#console p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:28
      -- staticBlockClosure
      E calls function:app/p.ts#K.static->function:app/p.ts#K.static>anonymous@2:30 p=- static o= h= @app/p.ts:2:88
      E side-effect function:app/p.ts#K.static>anonymous@2:30->boundary:boundary:code#console p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:36"
    `)
  })

  it("objects shared between functions carry what one stores to the others over several rounds", async () => {
    const chain = (steps: number): string => {
      const lines = [
        `const shared: any = {}`,
        `export function reader(res0: any) { res.json(shared.k0) }`,
      ]
      for (let i = 0; i < steps; i++)
        lines.push(
          i === steps - 1
            ? `export function w${String(i)}() { shared.k${String(i)} = ${u}.email }`
            : `export function w${String(i)}() { shared.k${String(i)} = shared.k${String(i + 1)} }`,
        )
      return lines.join("\n")
    }
    const table: Record<string, boolean> = {}
    for (const steps of [1, 2, 3, 4, 5, 6, 7]) {
      const { input } = await h.scan(handler("  reader(res)", chain(steps)))
      table[`${String(steps)} writers`] = facts(input).some((line) => line.includes("p=email"))
    }
    expect(table).toMatchInlineSnapshot(`
      {
        "1 writers": true,
        "2 writers": true,
        "3 writers": true,
        "4 writers": true,
        "5 writers": true,
        "6 writers": true,
        "7 writers": false,
      }
    `)
  })
})

describe("flow-scan evaluation: more shapes of closures, constructors and shared objects", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const u = "userData.getSnapshot().fields.user"
  const each = async (
    cases: Readonly<Record<string, { body: string; extra?: string }>>,
  ): Promise<string> => {
    const out: string[] = []
    for (const [label, { body, extra = "" }] of Object.entries(cases)) {
      const { input } = await h.scan(handler(`  const x: any = ${u}\n${body}`, extra))
      out.push(`-- ${label}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("closures nobody calls, in every place they can be made", async () => {
    expect(
      await each({
        asyncNested: {
          body: "  res.json(1)",
          extra: `let g: any\nexport function reader() { const inner = async () => console.log(g); return inner }\nexport function writer() { g = ${u}.email }`,
        },
        nestedInNested: {
          body: "  res.json(1)",
          extra: `let g: any\nexport function reader() { return () => () => console.log(g) }\nexport function writer() { g = ${u}.email }`,
        },
        handedToUnknown: {
          body: "  res.json(1)",
          extra: `declare const ext: any\nlet g: any\nexport function reader() { ext(() => console.log(g)) }\nexport function writer() { g = ${u}.email }`,
        },
        inObject: {
          body: "  res.json(1)",
          extra: `let g: any\nexport function reader() { return { f: () => console.log(g) } }\nexport function writer() { g = ${u}.email }`,
        },
        inArray: {
          body: "  res.json(1)",
          extra: `let g: any\nexport function reader() { return [() => console.log(g)] }\nexport function writer() { g = ${u}.email }`,
        },
        factoryOfFactories: {
          body: "  make(x.email)",
          extra: `const make = (v: any) => () => () => console.log(v)`,
        },
        factoryOfClasses: {
          body: "  make(x.email)",
          extra: `const make = (v: any) => () => class { m() { console.log(v) } }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- asyncNested
      E side-effect function:app/p.ts#reader>anonymous@3:42->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:54
      -- nestedInNested
      E side-effect function:app/p.ts#reader>anonymous@3:35>anonymous@3:41->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:47
      -- handedToUnknown
      E side-effect function:app/p.ts#reader>anonymous@4:32->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:38
      -- inObject
      E side-effect function:app/p.ts#reader>anonymous@3:40->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:46
      -- inArray
      E side-effect function:app/p.ts#reader>anonymous@3:36->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:42
      -- factoryOfFactories
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- factoryOfClasses
      E calls function:app/p.ts#h->function:app/p.ts#make p=- static o= h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
    `)
  })

  it("a function called as a constructor in each way it can be", async () => {
    expect(
      await each({
        reflectConstruct: {
          body: "  res.json(Reflect.construct(F, [x.email])); res.json(F(x.name))",
          extra: `function F(this: any, v: any): any { this.v = v; return v }`,
        },
        castConstruct: {
          body: "  res.json(new (F as any)(x.email)); res.json(F(x.name))",
          extra: `function F(this: any, v: any): any { this.v = v; return v }`,
        },
        applyThenNew: {
          body: "  res.json(F.call({}, x.name)); res.json(new F(x.name))",
          extra: `function F(this: any, v: any): any { this.v = v; return v }`,
        },
        classThenFunction: {
          body: "  res.json(new K(x.email).p); res.json(G(x.email))",
          extra: `class K { constructor(public p: any) {} }\nfunction G(v: any) { return v }`,
        },
        sameShapeConstructedAndPlainReadingThis: {
          body: "  const a: any = new F(x.email); const b: any = F.call({ v: 1 }, x.email); res.json(a.v); res.json(b)",
          extra: `function F(this: any, v: any): any { this.v = v; return this }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- reflectConstruct
      E calls function:app/p.ts#h->function:app/p.ts#F p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:55
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:46
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:46
      -- castConstruct
      E calls function:app/p.ts#h->function:app/p.ts#F p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:47
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:38
      -- applyThenNew
      E calls function:app/p.ts#h->function:app/p.ts#F p=- static o= h= @app/p.ts:5:12
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- classThenFunction
      E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:6:12
      E passes function:app/p.ts#h->parameter:app/p.ts#K.constructor.p p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E returns function:app/p.ts#K.constructor->return:app/p.ts#K.constructor#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:11
      E passes return:app/p.ts#K.constructor#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E calls function:app/p.ts#h->function:app/p.ts#G p=- static o= h= @app/p.ts:6:40
      E passes function:app/p.ts#h->parameter:app/p.ts#G.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:40
      E returns function:app/p.ts#G->return:app/p.ts#G#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:22
      E passes return:app/p.ts#G#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:31
      -- sameShapeConstructedAndPlainReadingThis
      E calls function:app/p.ts#h->function:app/p.ts#F p=- static o= h= @app/p.ts:5:18
      E passes function:app/p.ts#h->parameter:app/p.ts#F.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:18
      E returns function:app/p.ts#F->return:app/p.ts#F#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:50
      E passes return:app/p.ts#F#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:85
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:76"
    `)
  })

  it("objects shared between functions, filled by recursion, aliases, arrays and closures", async () => {
    expect(
      await each({
        recursion: {
          body: "  reader(res)",
          extra: `const shared: any = {}\nfunction fill(n: number): any { if (n > 0) { shared.v = fill(n - 1); return shared.v } return ${u}.email }\nexport function reader(res0: any) { res.json(shared.v) }\nexport function writer() { fill(3) }`,
        },
        alias: {
          body: "  reader(res)",
          extra: `const shared: any = {}\nconst alias = shared\nexport function reader(res0: any) { res.json(shared.k) }\nexport function writer() { alias.k = ${u}.name }`,
        },
        arrayPush: {
          body: "  reader(res)",
          extra: `const list: any[] = []\nexport function reader(res0: any) { res.json(list[0]) }\nexport function writer() { list.push(${u}.id) }`,
        },
        closureOverObject: {
          body: "  reader(res)",
          extra: `const shared: any = {}\nexport function reader(res0: any) { const get = () => shared.k; res.json(get()) }\nexport function writer() { shared.k = ${u}.email }`,
        },
        objectOfObjects: {
          body: "  reader(res)",
          extra: `const shared: any = { inner: {} }\nexport function reader(res0: any) { res.json(shared.inner.k) }\nexport function writer() { shared.inner.k = ${u}.name }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- recursion
      E calls function:app/p.ts#fill->function:app/p.ts#fill p=- static o= h= @app/p.ts:3:57
      E returns function:app/p.ts#fill->return:app/p.ts#fill#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:88
      E passes return:app/p.ts#fill#return->function:app/p.ts#fill p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:77
      E passes return:app/p.ts#fill#return->function:app/p.ts#reader p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:46
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
      E calls function:app/p.ts#writer->function:app/p.ts#fill p=- static o= h= @app/p.ts:5:28
      E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:8:3
      -- alias
      E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:8:3
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
      -- arrayPush
      E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:7:3
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:37
      -- closureOverObject
      E calls function:app/p.ts#reader->function:app/p.ts#reader>anonymous@3:49 p=- static o= h= @app/p.ts:3:74
      E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:7:3
      E returns function:app/p.ts#reader>anonymous@3:49->return:app/p.ts#reader>anonymous@3:49#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:55
      E passes return:app/p.ts#reader>anonymous@3:49#return->function:app/p.ts#reader p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:65
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:65
      -- objectOfObjects
      E calls function:app/p.ts#h->function:app/p.ts#reader p=- static o= h= @app/p.ts:7:3
      E side-effect function:app/p.ts#reader->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:37"
    `)
  })

  it("a class made while a class is being set up, and what its static initializers do", async () => {
    expect(
      await each({
        staticFieldMakesObject: {
          body: "  res.json(K.o.k)",
          extra: `class K { static o: any = { k: ${u}.email } }`,
        },
        staticBlockStoresInModuleState: {
          body: "  res.json(g)",
          extra: `let g: any\nclass K { static { g = ${u}.name } }`,
        },
        staticMakesClass: {
          body: "  res.json(new K.Inner().v)",
          extra: `class K { static Inner = class { v = ${u}.id } }`,
        },
        staticFieldCallsFunction: {
          body: "  res.json(K.v)",
          extra: `const id = (v: any) => v\nclass K { static v = id(${u}.email) }`,
        },
      }),
    ).toMatchInlineSnapshot(`
      "-- staticFieldMakesObject
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- staticBlockStoresInModuleState
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      -- staticMakesClass
      E calls function:app/p.ts#h->function:app/p.ts#K.static>anonymous@2.constructor p=- static o= h= @app/p.ts:5:12
      E returns function:app/p.ts#K.static>anonymous@2.constructor->return:app/p.ts#K.static>anonymous@2.constructor#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:26
      E passes return:app/p.ts#K.static>anonymous@2.constructor#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      -- staticFieldCallsFunction
      E calls function:app/p.ts#K.static->function:app/p.ts#id p=- static o= h= @app/p.ts:3:22
      E passes function:app/p.ts#K.static->parameter:app/p.ts#id.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:22
      E returns function:app/p.ts#id->return:app/p.ts#id#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:24
      E passes return:app/p.ts#id#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
    `)
  })
})

describe("flow-scan evaluation: what a sink takes with it", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  it("a whole fields object sent to a boundary, an operation or a log takes every field with it, and one returned does not", async () => {
    const inventory = inventoryOf(capability({ mutators: [operation("mutator", "save", {})] }))
    const run = async (body: string): Promise<string> => {
      const { input } = await h.scan(handler(body), {}, inventory)
      return facts(input)
        .filter(
          (line) =>
            line.startsWith("E side-effect") ||
            line.startsWith("U ") ||
            line.includes("userData.save"),
        )
        .map((line) =>
          line
            .replace(
              /function:app\/p.ts#|boundary:boundary:code#|o=field:features\/user\/user.ts#userData.user h=/g,
              "",
            )
            .replace(/ @.*$/, ""),
        )
        .join("\n")
    }
    expect({
      boundary: await run("  res.json(userData.getSnapshot().fields)"),
      boundaryOneField: await run("  res.json(userData.getSnapshot().fields.team)"),
      log: await run("  console.log(userData.getSnapshot().fields)"),
      operation: await run("  userData.save(userData.getSnapshot().fields)"),
      operationOneField: await run("  userData.save(userData.getSnapshot().fields.user)"),
      returned: await run("  return userData.getSnapshot().fields"),
      nothingTracked: await run("  res.json({ a: 1 })"),
    }).toMatchInlineSnapshot(`
      {
        "boundary": "E side-effect h->http-response p= static 
      E side-effect h->http-response p= static o=field:features/user/user.ts#userData.team h=
      E side-effect h->http-response p= static o=field:features/user/user.ts#userData.tags h=
      E side-effect h->http-response p= static o=field:features/user/user.ts#userData.empty h=",
        "boundaryOneField": "E side-effect h->http-response p= static o=field:features/user/user.ts#userData.team h=",
        "log": "E side-effect h->console p= static 
      E side-effect h->console p= static o=field:features/user/user.ts#userData.team h=
      E side-effect h->console p= static o=field:features/user/user.ts#userData.tags h=
      E side-effect h->console p= static o=field:features/user/user.ts#userData.empty h=",
        "nothingTracked": "",
        "operation": "E calls h->function:features/user/user.ts#userData.save p=- static o= h=
      E passes h->function:features/user/user.ts#userData.save p= static 
      E passes h->function:features/user/user.ts#userData.save p= static o=field:features/user/user.ts#userData.team h=
      E passes h->function:features/user/user.ts#userData.save p= static o=field:features/user/user.ts#userData.tags h=
      E passes h->function:features/user/user.ts#userData.save p= static o=field:features/user/user.ts#userData.empty h=",
        "operationOneField": "E calls h->function:features/user/user.ts#userData.save p=- static o= h=
      E passes h->function:features/user/user.ts#userData.save p= static ",
        "returned": "",
      }
    `)
  })
})
