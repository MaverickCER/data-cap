import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("coordinator/coordinator-isolation"))(
  "integration: coordinator/coordinator-isolation",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("coordinator/coordinator-isolation")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("coordinator/coordinator-isolation")
    })
  },
)
