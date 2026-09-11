import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("runtime-modules/runtime-retry"))(
  "integration: runtime-modules/runtime-retry",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("runtime-modules/runtime-retry")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("runtime-modules/runtime-retry")
    })
  },
)
