import { describe, expect, it } from "vitest"
import { checkDocsFresh, isInstalled, runStart } from "./support.js"

describe.skipIf(!isInstalled("team-service"))("example: team-service", () => {
  it("runs its real assertions against the installed package", () => {
    const output = runStart("team-service")
    expect(output).toContain("all assertions passed")
  })

  it("has committed documentation that matches a fresh generation", () => {
    checkDocsFresh("team-service")
  })
})
