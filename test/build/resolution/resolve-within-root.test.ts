import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  resolveWithinRoot,
  isWithinDirectory,
} from "../../../src/build/resolution/resolve-within-root.js"

describe("isWithinDirectory", () => {
  it("returns true for the same directory", () => {
    expect(isWithinDirectory("/root", "/root")).toBe(true)
  })

  it("returns true for a nested path", () => {
    expect(isWithinDirectory("/root", "/root/a/b.ts")).toBe(true)
  })

  it("returns false for a sibling directory sharing a string prefix (not a naive startsWith bug)", () => {
    expect(isWithinDirectory("/root", "/root-evil/b.ts")).toBe(false)
  })

  it("returns false for a parent directory", () => {
    expect(isWithinDirectory("/root/sub", "/root/other.ts")).toBe(false)
  })

  it("returns false when targetPath IS baseDir's immediate parent -- relative is exactly '..', not '../something'", () => {
    expect(isWithinDirectory("/root/sub", "/root")).toBe(false)
  })
})

describe("resolveWithinRoot", () => {
  const root = "/project"

  it("accepts a normal in-root relative path", () => {
    const result = resolveWithinRoot(
      root,
      "src/generated/data.manifest.ts",
      "location",
      "generateManifest",
    )
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.resolved).toBe(path.resolve(root, "src/generated/data.manifest.ts"))
  })

  it("rejects a ../ traversal escape, with the full escape message verbatim", () => {
    const result = resolveWithinRoot(
      "/project/root",
      "../../etc/passwd",
      "location",
      "generateManifest",
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.warning.file).toBe("../../etc/passwd")
      expect(result.warning.message).toBe(
        '"location" ("../../etc/passwd") resolves to "/etc/passwd", which is outside "root" ("/project/root"). ' +
          "generateManifest() refuses to write outside root -- use a path nested under root instead.",
      )
    }
  })

  it("rejects an absolute path outside root", () => {
    expect(resolveWithinRoot(root, "/etc/passwd", "location", "generateManifest").ok).toBe(false)
  })

  it("accepts an absolute path that happens to already be inside root", () => {
    expect(
      resolveWithinRoot(root, path.join(root, "src/x.ts"), "location", "generateManifest").ok,
    ).toBe(true)
  })

  it("accepts location '.' (resolves to root itself)", () => {
    const result = resolveWithinRoot(root, ".", "location", "generateManifest")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.resolved).toBe(root)
  })

  describe("symlink behavior (fixture-backed, real filesystem)", () => {
    let tmpRoot: string

    beforeEach(async () => {
      tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-resolve-within-root-test-"))
    })

    afterEach(async () => {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    })

    it("does NOT resolve a symlink's real target -- purely lexical by design (realpath-aware containment for a path that already exists and crosses a real trust boundary is resolve-package-schema.ts's job, not this one's)", async () => {
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "data-cap-resolve-within-root-outside-"),
      )
      try {
        // A symlink lexically inside tmpRoot whose real target lives outside it.
        const linkPath = path.join(tmpRoot, "escape-link.ts")
        await fs.symlink(path.join(outsideDir, "real.ts"), linkPath, "file")

        const result = resolveWithinRoot(tmpRoot, "escape-link.ts", "location", "generateManifest")

        // Lexically, "escape-link.ts" resolves to a path inside tmpRoot --
        // resolveWithinRoot must report ok:true (proving, not "fixing", the
        // intentional scope limit), even though the symlink's real target
        // is outside tmpRoot.
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.resolved).toBe(linkPath)
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true })
      }
    })
  })
})
