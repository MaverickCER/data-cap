import { describe, expect, it, vi } from "vitest"
import { loadTsconfigPaths } from "../../../src/build/resolution/resolve-tsconfig-paths.js"
import { createInMemoryBuildFs } from "../../support/build-filesystem.js"

// No usable compiler (the bundled TypeScript 6 stripped from an install): the loader hands back a
// module with no classic API.
vi.mock("../../../src/build/typescript.js", () => ({ ts: { version: "7.0.2" } }))

describe("loadTsconfigPaths with no usable compiler", () => {
  it("explains itself before reading a tsconfig.json, instead of failing with a raw TypeError", async () => {
    const fs = createInMemoryBuildFs({ "/repo/tsconfig.json": '{ "compilerOptions": {} }' })
    await expect(loadTsconfigPaths("/repo", undefined, fs)).rejects.toThrow(
      /classic compiler API.*typescript 7\.0\.2/s,
    )
  })

  it("leaves tsconfig: false alone, since it never touches the compiler", async () => {
    const fs = createInMemoryBuildFs({ "/repo/tsconfig.json": "{}" })
    await expect(loadTsconfigPaths("/repo", false, fs)).resolves.toEqual({
      resolution: undefined,
      warning: undefined,
    })
  })
})
