import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultScanLimits } from "../../src/build/flow-scan.js"
import { IMPORT_CAP, makeHarness, USER } from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

/** A budget small enough to spend in a moment; the real one is pinned by `defaultScanLimits`. */
const MAX_STEPS = 400
/** The capability file's `export const userData = createData(...)` costs three steps (statement, declaration, call). */
const MODULE_STEPS = 3

describe("flow-scan: the analysis budget", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const small = { maxSteps: MAX_STEPS }
  const afterNode = (burned: number) =>
    h
      .scan(
        {
          "app/a.ts": `export function burn() {${";".repeat(burned)}}\n`,
          "app/b.ts": `${IMPORT_CAP}export function after(res: any) { res.json(${USER}.id) }\n`,
        },
        {},
        undefined,
        small,
      )
      .then((r) => ({
        status: r.input.nodes.find(
          (n) => n.kind === "function" && n.scope === "app/b.ts" && n.name === "after",
        )?.status,
        sideEffects: r.input.edges.filter((e) => e.kind === "side-effect").length,
        unknowns: r.input.unknowns.map((u) => u.reason),
      }))

  it("works within the budget it is given, which by default is three million steps", () => {
    expect(defaultScanLimits()).toEqual({ maxCallDepth: 40, maxSteps: 3_000_000, maxExportHops: 9 })
  })

  it("spending exactly the budget does not exhaust it", async () => {
    expect(await afterNode(MAX_STEPS - MODULE_STEPS)).toEqual({
      status: "static",
      sideEffects: 0,
      unknowns: [],
    })
  })

  it("spending one step more exhausts it, and later functions are unanalyzed", async () => {
    expect(await afterNode(MAX_STEPS - MODULE_STEPS - 1)).toEqual({
      status: "static",
      sideEffects: 0,
      unknowns: [],
    })
    expect(await afterNode(MAX_STEPS - MODULE_STEPS + 1)).toEqual({
      status: "unknown",
      sideEffects: 0,
      unknowns: [],
    })
  })

  it("a call into an exhausted analysis records an unknown with the data it received", async () => {
    const r = await h.scan(
      {
        "app/a.ts": `export function burn() {${";".repeat(MAX_STEPS)}}\n`,
        "app/z.ts": `${IMPORT_CAP}export function inner(v: any) { return v }\nexport function outer() { return inner(${USER}.id) }\n`,
      },
      {},
      undefined,
      small,
    )
    const unanalyzed = r.input.unknowns.filter((u) => u.reason === "unanalyzed-function")
    expect(unanalyzed.length).toBe(0)
    expect(r.input.nodes.filter((n) => n.status === "unknown").map((n) => n.name)).toEqual([
      "inner",
      "outer",
    ])
  })
})
