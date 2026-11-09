import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CAP_FILE,
  capability,
  dump,
  handler,
  inventoryOf,
  makeHarness,
  USER,
} from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

describe("flow-scan: a capability the inventory spells with a leading ./", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  it("is the same capability as the one imported, so a call on an operation it does not declare adds nothing and its fields are followed", async () => {
    const result = await h.scan(
      handler(`  userData.refresh(${USER}.email)\n  res.json(${USER}.email)`),
      {},
      inventoryOf(capability({ file: `./${CAP_FILE}` })),
    )
    expect(dump(result.input).filter((line) => line.startsWith("E "))).toEqual([
      "E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:20",
      "E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:20",
      "E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3",
      "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @",
      "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @",
      "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @",
      "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @",
    ])
    expect(result.input.nodes.some((node) => node.scope.startsWith("./"))).toBe(false)
  })
})
