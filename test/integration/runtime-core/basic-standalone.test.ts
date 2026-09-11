import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("runtime-core/basic-standalone"))(
  "integration: runtime-core/basic-standalone",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("runtime-core/basic-standalone")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("runtime-core/basic-standalone")
    })
  },
)
