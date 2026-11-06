import { describe, expect, it, vi } from "vitest"
import { scanFlow } from "../../src/build/flow-scan.js"
import { createInMemoryBuildFs } from "../support/build-filesystem.js"
import { capability, inventoryOf } from "./mut-flow-scan-harness.js"

// A TypeScript 7 `typescript` with the bundled TypeScript 6 stripped from the install: the loader hands back a module
// with no classic API, which is the only way the scanner can fail to start.
vi.mock("../../src/build/typescript.js", () => ({ ts: { version: "7.0.2" } }))

describe("flow-scan with no usable compiler", () => {
  it("fails with the readable compiler error instead of a missing-function error", async () => {
    const fs = createInMemoryBuildFs({
      "/repo/features/user/user.ts": "export const userData = createData({ fields: {} });",
    })
    await expect(
      scanFlow({
        inventory: inventoryOf(capability()),
        files: ["/repo/features/user/user.ts"],
        fs,
        root: "/repo",
        tsconfig: false,
      }),
    ).rejects.toThrow(
      /typescript 7\.0\.2 does not expose it and the bundled @typescript\/typescript6/,
    )
  })
})
