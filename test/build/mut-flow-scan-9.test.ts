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

describe("flow-scan: a capability the inventory names differently from the import", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  it("yields nothing for a call on a capability that has no registered node, instead of failing", async () => {
    const result = await h.scan(
      handler(`  userData.refresh(${USER}.email)\n  res.json(${USER}.email)`),
      {},
      inventoryOf(capability({ file: `./${CAP_FILE}` })),
    )
    expect(dump(result.input).filter((line) => line.startsWith("E "))).toEqual([])
  })
})
