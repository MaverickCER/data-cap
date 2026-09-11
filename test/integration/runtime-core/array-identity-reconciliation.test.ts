import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("runtime-core/array-identity-reconciliation"))(
  "integration: runtime-core/array-identity-reconciliation",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("runtime-core/array-identity-reconciliation")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("runtime-core/array-identity-reconciliation")
    })
  },
)
