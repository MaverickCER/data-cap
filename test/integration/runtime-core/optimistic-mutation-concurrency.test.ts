import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("runtime-core/optimistic-mutation-concurrency"))(
  "integration: runtime-core/optimistic-mutation-concurrency",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("runtime-core/optimistic-mutation-concurrency")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("runtime-core/optimistic-mutation-concurrency")
    })
  },
)
