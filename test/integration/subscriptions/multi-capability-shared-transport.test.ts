import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("subscriptions/multi-capability-shared-transport"))(
  "integration: subscriptions/multi-capability-shared-transport",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("subscriptions/multi-capability-shared-transport")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("subscriptions/multi-capability-shared-transport")
    })
  },
)
