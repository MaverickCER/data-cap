import { describe, expect, it, vi } from "vitest"
import { generateDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import { createInMemoryBuildFs } from "../support/build-filesystem.js"

// A TypeScript 7 `typescript` with the bundled TypeScript 6 stripped from the install: the loader
// hands back a module with no classic API, which is the only way the scanner can fail to start.
vi.mock("../../src/build/typescript.js", () => ({ ts: { version: "7.0.2" } }))

describe("a build with no usable compiler", () => {
  it("fails with the readable compiler error before it writes anything", async () => {
    const fs = createInMemoryBuildFs({
      "/repo/user.ts": 'export const userCapability = createData({ fields: { id: "" } });',
    })
    const before = fs.paths()

    await expect(
      generateDataArtifacts({
        fs,
        root: "/repo",
        location: "/repo/data.manifest.ts",
        docs: "/repo/DATA.md",
      }),
    ).rejects.toThrow(
      /typescript 7\.0\.2 does not expose it and the bundled @typescript\/typescript6/,
    )

    expect(fs.paths()).toEqual(before)
  })
})
