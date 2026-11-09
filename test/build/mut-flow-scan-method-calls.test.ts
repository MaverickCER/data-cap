import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { facts, handler as baseHandler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/** `handler` glues its extra code straight onto `export function h`, so a declaration needs its newline. */
const handler = (body: string, extra = ""): Record<string, string> =>
  baseHandler(body, extra === "" || extra.endsWith("\n") ? extra : `${extra}\n`)

/** Cases for calls on values: what `bind` fixes, and the rest of what a method call on a value does. */
describe("flow-scan method calls: bind", () => {
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
      const { input } = await h.scan(handler(`  const x: any = ${u}\n  ${statement}`, extra))
      out.push(`-- ${statement}`, ...facts(input))
    }
    return out.join("\n")
  }

  it("the this a function is bound to is what it reads this as", async () => {
    expect(
      await each(
        [
          "const g = who.bind(x); g()",
          "const g = who.bind({ v: x.email }); g()",
          "const g = who.bind(undefined); g()",
          "const g = who.bind(); g()",
          "const g = who.bind(null, 1); g()",
          "const g = who.bind({ v: x.email }).bind({ v: x.name }); g()",
        ],
        "function who(this: any) { res.json(this.v) }",
      ),
    ).toMatchInlineSnapshot(`
      "-- const g = who.bind(x); g()
      E calls function:app/p.ts#h->function:app/p.ts#who p=- static o= h= @app/p.ts:5:26
      E passes function:app/p.ts#h->parameter:app/p.ts#who.this p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
      E side-effect function:app/p.ts#who->boundary:boundary:code#http-response p=v static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      -- const g = who.bind({ v: x.email }); g()
      E calls function:app/p.ts#h->function:app/p.ts#who p=- static o= h= @app/p.ts:5:39
      E passes function:app/p.ts#h->parameter:app/p.ts#who.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:39
      E side-effect function:app/p.ts#who->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27
      -- const g = who.bind(undefined); g()
      E calls function:app/p.ts#h->function:app/p.ts#who p=- static o= h= @app/p.ts:5:34
      -- const g = who.bind(); g()
      E calls function:app/p.ts#h->function:app/p.ts#who p=- static o= h= @app/p.ts:5:25
      -- const g = who.bind(null, 1); g()
      E calls function:app/p.ts#h->function:app/p.ts#who p=- static o= h= @app/p.ts:5:32
      -- const g = who.bind({ v: x.email }).bind({ v: x.name }); g()
      E calls function:app/p.ts#h->function:app/p.ts#who p=- static o= h= @app/p.ts:5:59
      E passes function:app/p.ts#h->parameter:app/p.ts#who.this p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:59
      E side-effect function:app/p.ts#who->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:27"
    `)
  })

  it("a bound function handed to code the scan cannot read hands over what it was bound to", async () => {
    expect(
      await each(
        [
          "ext(who.bind({ v: x.email }))",
          "ext(who.bind(null, x.name))",
          "ext(who.bind({ v: x.email }, x.name))",
          "ext(who.bind(null))",
          "ext(who.bind())",
          "ext(who.bind(x))",
        ],
        "declare const ext: any\nfunction who(this: any, w?: any) { return this.v }",
      ),
    ).toMatchInlineSnapshot(`
      "-- ext(who.bind({ v: x.email }))
      U unresolved-call app/p.ts:6:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      -- ext(who.bind(null, x.name))
      U unresolved-call app/p.ts:6:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name
      -- ext(who.bind({ v: x.email }, x.name))
      U unresolved-call app/p.ts:6:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name,field:features/user/user.ts#userData.user/email
      -- ext(who.bind(null))
      -- ext(who.bind())
      -- ext(who.bind(x))
      U unresolved-call app/p.ts:6:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
    `)
  })
})
