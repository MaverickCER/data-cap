import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { PACKAGE_VERSION } from "../../src/build/package-version.js"

// Since ADR 0058, `PACKAGE_VERSION` is the build-time constant
// `__PACKAGE_VERSION__` -- `tsup`/vitest substitute it from `package.json` at
// bundle/test time, so `./build` never reads its own manifest from disk.
describe("PACKAGE_VERSION", () => {
  const declaredVersion: string = (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string
    }
  ).version

  it("is the package's own declared version, substituted at build time", () => {
    expect(PACKAGE_VERSION).toBe(declaredVersion)
  })

  it("is a non-empty semver-shaped string", () => {
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
