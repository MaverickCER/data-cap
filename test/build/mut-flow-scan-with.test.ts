import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { facts, handler as baseHandler, makeHarness } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

const handler = (body: string, extra = ""): Record<string, string> =>
  baseHandler(body, extra === "" ? "" : `${extra}\n`)

/** The body of a `with` statement is read like any other statement, not only flagged. */
describe("flow-scan: with statements and iterating a class with an opaque parent", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  it("reads the statements inside a with block", async () => {
    const { input } = await h.scan(
      handler(
        "  const x: any = userData.getSnapshot().fields.user\n  with ({}) { res.json(x.email) }",
      ),
    )
    expect(facts(input).join("\n")).toMatchInlineSnapshot(
      `"E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:15"`,
    )
  })

  it("iterating an instance of a class whose parent the scan cannot read finds no iterator method", async () => {
    const { input } = await h.scan(
      handler(
        "  const x: any = userData.getSnapshot().fields.user\n  for (const v of new K()) res.json(v)\n  res.json(x.email)",
        "declare const Base: any\nclass K extends Base {}",
      ),
    )
    expect(facts(input).join("\n")).toMatchInlineSnapshot(`
      "E calls function:app/p.ts#h->function:app/p.ts#K.constructor p=- static o= h= @app/p.ts:6:19
      E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"
    `)
  })
})
