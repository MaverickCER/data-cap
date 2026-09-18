import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { nodeBuildFs } from "../support/build-filesystem.js"

const packageVersionState = { current: "1.0.0" }
vi.mock("../../src/build/package-version.js", () => ({
  get PACKAGE_VERSION() {
    return packageVersionState.current
  },
}))

describe("computeSourceFingerprint depends on PACKAGE_VERSION", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-evidence-fingerprint-"))
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.writeFile(path.join(root, "src", "data.ts"), "export const fields = {}\n", "utf8")
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
    packageVersionState.current = "1.0.0"
  })

  it("changes when PACKAGE_VERSION changes, for the exact same source tree", async () => {
    const { computeSourceFingerprint } = await import("../../src/build/evidence-fingerprint.js")

    packageVersionState.current = "1.0.0"
    const first = await computeSourceFingerprint({ fs: nodeBuildFs, root })

    packageVersionState.current = "2.0.0"
    const second = await computeSourceFingerprint({ fs: nodeBuildFs, root })

    expect(second).not.toBe(first)
  })
})
