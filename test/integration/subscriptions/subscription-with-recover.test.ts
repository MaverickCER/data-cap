import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("subscriptions/subscription-with-recover"))(
  "integration: subscriptions/subscription-with-recover",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("subscriptions/subscription-with-recover")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("subscriptions/subscription-with-recover")
    })
  },
)
