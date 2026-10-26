import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { IMPORT_CAP, makeHarness, USER } from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

const MAX_STEPS = 3_000_000
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

  const afterNode = (burned: number) =>
    h
      .scan({
        "app/a.ts": `export function burn() {${";".repeat(burned)}}\n`,
        "app/b.ts": `${IMPORT_CAP}export function after(res: any) { res.json(${USER}.id) }\n`,
      })
      .then((r) => ({
        status: r.input.nodes.find(
          (n) => n.kind === "function" && n.scope === "app/b.ts" && n.name === "after",
        )?.status,
        sideEffects: r.input.edges.filter((e) => e.kind === "side-effect").length,
        unknowns: r.input.unknowns.map((u) => u.reason),
      }))

  it("spending exactly the budget does not exhaust it", async () => {
    expect(await afterNode(MAX_STEPS - MODULE_STEPS)).toEqual({
      status: "static",
      sideEffects: 0,
      unknowns: [],
    })
  }, 90_000)

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
  }, 90_000)

  it("a call into an exhausted analysis records an unknown with the data it received", async () => {
    const r = await h.scan({
      "app/a.ts": `export function burn() {${";".repeat(MAX_STEPS)}}\n`,
      "app/z.ts": `${IMPORT_CAP}export function inner(v: any) { return v }\nexport function outer() { return inner(${USER}.id) }\n`,
    })
    const unanalyzed = r.input.unknowns.filter((u) => u.reason === "unanalyzed-function")
    expect(unanalyzed.length).toBe(0)
    expect(r.input.nodes.filter((n) => n.status === "unknown").map((n) => n.name)).toEqual([
      "inner",
      "outer",
    ])
  }, 90_000)
})
