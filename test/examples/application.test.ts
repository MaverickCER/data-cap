import { describe, expect, it } from "vitest"
import { checkDocsFresh, isInstalled, runStart } from "./support.js"

describe.skipIf(!isInstalled("application"))("example: application", () => {
  it("runs its real assertions against the installed package", () => {
    const output = runStart("application")
    expect(output).toContain("all assertions passed")
  })

  it("has committed documentation that matches a fresh generation", () => {
    checkDocsFresh("application")
  })
})
