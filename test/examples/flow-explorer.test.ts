import { describe, expect, it } from "vitest"
import { checkDocsFresh, isInstalled, runScript, runStart } from "./support.js"

describe.skipIf(!isInstalled("flow-explorer"))("example: flow-explorer", () => {
  it("runs its real assertions against the installed package", () => {
    const output = runStart("flow-explorer")
    expect(output).toContain("all assertions passed")
  })

  it("has committed outputs (the evidence, every standards export, and the explorer page) that match a fresh generation", () => {
    checkDocsFresh("flow-explorer")
  })

  it("passes its own end-to-end tests: the explorer's behaviour and accessibility, and every export against its standard's own tools", () => {
    const output = runScript("flow-explorer", "test")
    expect(output).toMatch(/ℹ fail 0/)
    expect(output).toMatch(/ℹ pass [1-9]\d*/)
  })
})
