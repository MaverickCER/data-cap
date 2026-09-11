import { describe, expect, it } from "vitest"
import { compareGoldenOutput, isInstalled, runStart } from "../support.js"

describe.skipIf(!isInstalled("build-tooling/tsconfig-aliases-consumer"))(
  "integration: build-tooling/tsconfig-aliases-consumer",
  () => {
    it("runs its real assertions against the installed package and matches its golden output", () => {
      const output = runStart("build-tooling/tsconfig-aliases-consumer")
      expect(output).toContain("all assertions passed")
      compareGoldenOutput("build-tooling/tsconfig-aliases-consumer")
    })
  },
)
