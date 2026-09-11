import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("build-tooling/eslint-plugin-usage"))(
  "integration: build-tooling/eslint-plugin-usage",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("build-tooling/eslint-plugin-usage")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("build-tooling/eslint-plugin-usage")
    })
  },
)
