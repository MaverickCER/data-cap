import { describe, expect, it } from "vitest"
import { checkDocsFresh, isInstalled, runStart } from "./support.js"

describe.skipIf(!isInstalled("enterprise-platform"))("example: enterprise-platform", () => {
  it(
    "runs its real assertions against the installed package",
    () => {
      const output = runStart("enterprise-platform")
      expect(output).toContain("all assertions passed")
    },
    60000,
  )

  it(
    "has committed documentation and reports that match a fresh generation",
    () => {
      checkDocsFresh("enterprise-platform")
    },
    60000,
  )
})
