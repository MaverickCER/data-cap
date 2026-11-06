import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { IMPORT_CAP, makeHarness, USER } from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

describe("flow-scan: what a function stores on a global", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  it.each(["window", "globalThis", "global", "self"])(
    "a read of %s in an earlier file sees what a later file stores there",
    async (name) => {
      const r = await h.scan({
        "app/a.ts": `export function reader(res: any) { res.json((${name} as any).leak) }\n`,
        "app/b.ts": `${IMPORT_CAP}export function writer() { (${name} as any).leak = ${USER}.passwordHash }\n`,
      })
      const sends = r.input.edges.filter((e) => e.kind === "side-effect")
      expect(sends.map((e) => e.path)).toEqual([["passwordHash"]])
    },
  )
})
