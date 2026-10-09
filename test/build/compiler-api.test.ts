import { describe, expect, it } from "vitest"
import ts from "typescript"
import { assertCompilerApi } from "../../src/build/compiler-api.js"

describe("assertCompilerApi", () => {
  it("accepts the installed typescript", () => {
    expect(() => {
      assertCompilerApi(ts)
    }).not.toThrow()
  })

  it("names the installed version, the bundled fallback and the alias recipe when createSourceFile is missing", () => {
    expect(() => {
      assertCompilerApi({ version: "7.0.2" })
    }).toThrow(
      /typescript 7\.0\.2 does not expose it and the bundled @typescript\/typescript6 could not be loaded\. Reinstall data-cap with its dependencies, or provide a TypeScript 6 compiler: npm install --save-dev typescript@npm:@typescript\/typescript6.*@typescript\/native@npm:typescript@\^7.*VERSIONING\.md, 'Supported toolchain'/s,
    )
  })

  it("still explains itself when the version is unknown", () => {
    expect(() => {
      assertCompilerApi({})
    }).toThrow(/installed typescript does not expose it/)
  })
})
