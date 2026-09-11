import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("build-tooling/tsconfig-aliases"))(
  "integration: build-tooling/tsconfig-aliases",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("build-tooling/tsconfig-aliases")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("build-tooling/tsconfig-aliases")
    })
  },
)
