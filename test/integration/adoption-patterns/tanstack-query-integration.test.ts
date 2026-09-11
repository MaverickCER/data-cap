import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("adoption-patterns/tanstack-query-integration"))(
  "integration: adoption-patterns/tanstack-query-integration",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("adoption-patterns/tanstack-query-integration")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("adoption-patterns/tanstack-query-integration")
    })
  },
)
