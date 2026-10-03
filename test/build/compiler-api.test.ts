import { describe, expect, it } from "vitest"
import ts from "typescript"
import { assertCompilerApi } from "../../src/build/compiler-api.js"

describe("assertCompilerApi", () => {
  it("accepts the installed typescript", () => {
    expect(() => {
      assertCompilerApi(ts)
    }).not.toThrow()
  })

  it("names the installed version and the supported range when createSourceFile is missing", () => {
    expect(() => {
      assertCompilerApi({ version: "7.0.2" })
    }).toThrow(
      /typescript 7\.0\.2 does not expose it.*typescript@6.*VERSIONING\.md, 'Supported toolchain'/s,
    )
  })

  it("still explains itself when the version is unknown", () => {
    expect(() => {
      assertCompilerApi({})
    }).toThrow(/installed typescript does not expose it/)
  })
})
