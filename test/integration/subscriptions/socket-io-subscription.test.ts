import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("subscriptions/socket-io-subscription"))(
  "integration: subscriptions/socket-io-subscription",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("subscriptions/socket-io-subscription")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("subscriptions/socket-io-subscription")
    })
  },
)
