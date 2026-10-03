import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { scanDependencies } from "../../src/build/scan-dependencies.js"
import { parseCapabilityFile } from "../../src/build/parse.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

// A TypeScript whose classic compiler API is gone (what `typescript@7` looks like to this package).
vi.mock("typescript", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>()
  return { default: { ...actual.default, createSourceFile: undefined, version: "7.0.2" } }
})

describe("an unsupported TypeScript", () => {
  it("makes the parser explain itself instead of failing with a raw TypeError", () => {
    expect(() => parseCapabilityFile("a.ts", "export const x = 1")).toThrow(
      /classic compiler API.*typescript 7\.0\.2/s,
    )
  })

  it("makes the dependency scanner explain itself too", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-ts7-"))
    try {
      const file = path.join(root, "consumer.ts")
      await fs.writeFile(file, "export const x = 1;", "utf8")
      await expect(
        scanDependencies(
          [file],
          [{ file, exportName: "x", getterNames: [], mutatorNames: [], subscriptionNames: [] }],
          { fs: nodeBuildFs, root, tsconfig: false },
        ),
      ).rejects.toThrow(/classic compiler API/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
