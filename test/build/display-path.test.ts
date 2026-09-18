import { describe, expect, it } from "vitest"
import { displayPath } from "../../src/build/display-path.js"

describe("displayPath", () => {
  it("renders a path under root relative to root, POSIX-separated", () => {
    expect(displayPath("/project", "/project/src/user.ts")).toBe("src/user.ts")
  })

  it("renders root itself as a bare relative segment, not an empty string turned absolute", () => {
    expect(displayPath("/project/src", "/project/src/user.ts")).toBe("user.ts")
  })

  it("falls back to the absolute path, unchanged, for a path outside root", () => {
    expect(displayPath("/project", "/elsewhere/user.ts")).toBe("/elsewhere/user.ts")
  })

  it("never manufactures a '../' escape for a path outside root", () => {
    const result = displayPath("/project/nested", "/project/user.ts")
    expect(result).toBe("/project/user.ts")
    expect(result.startsWith("..")).toBe(false)
  })

  it("falls back to the absolute path for a root/path pair on different drives-equivalent roots", () => {
    expect(displayPath("/a", "/b/user.ts")).toBe("/b/user.ts")
  })

  it("passes an already-relative path through unchanged, POSIX-separated, without touching root", () => {
    expect(displayPath("/project", "src/user.ts")).toBe("src/user.ts")
  })
})
