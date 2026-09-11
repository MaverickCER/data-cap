import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("subscriptions/subscription-lifecycle"))(
  "integration: subscriptions/subscription-lifecycle",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("subscriptions/subscription-lifecycle")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("subscriptions/subscription-lifecycle")
    })
  },
)
