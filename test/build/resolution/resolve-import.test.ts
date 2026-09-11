import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  resolveImportSpecifier,
  type ImportResolutionContext,
} from "../../../src/build/resolution/resolve-import.js"
import { createAliasResolutionCache } from "../../../src/build/resolution/resolve-tsconfig-paths.js"
import type { TsconfigPathsResolution } from "../../../src/build/resolution/resolve-tsconfig-paths.js"
import { nodeBuildFs } from "../../support/build-filesystem.js"

describe("resolveImportSpecifier -- relative resolution", () => {
  let root: string
  const context = (): ImportResolutionContext => ({
    fs: nodeBuildFs,
    root,
    packages: [],
    cache: new Map(),
    tsconfigPaths: undefined,
    aliasCache: createAliasResolutionCache(),
  })

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-resolve-import-"))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function write(rel: string): Promise<string> {
    const p = path.join(root, rel)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, "export const x = 1\n")
    return p
  }

  it("returns undefined for a bare (non-relative) specifier -- even when a same-named file sits next to the importer", async () => {
    await write("feature/neighbor.ts")
    expect(
      await resolveImportSpecifier(path.join(root, "feature/index.ts"), "neighbor", context()),
    ).toBe(undefined)
  })

  it("resolves a `./x.js` specifier to the sibling `x.ts` source file", async () => {
    const target = await write("feature/schema.ts")
    expect(
      await resolveImportSpecifier(path.join(root, "feature/index.ts"), "./schema.js", context()),
    ).toBe(target)
  })

  it("resolves a `.tsx` sibling", async () => {
    const target = await write("feature/widget.tsx")
    expect(
      await resolveImportSpecifier(path.join(root, "feature/index.ts"), "./widget.js", context()),
    ).toBe(target)
  })

  it("resolves a directory specifier to its `index.ts`", async () => {
    const target = await write("feature/sub/index.ts")
    expect(await resolveImportSpecifier(path.join(root, "feature/a.ts"), "./sub", context())).toBe(
      target,
    )
  })

  it("resolves a directory specifier to its `index.tsx` when there is no `index.ts`", async () => {
    const target = await write("feature/sub/index.tsx")
    expect(await resolveImportSpecifier(path.join(root, "feature/a.ts"), "./sub", context())).toBe(
      target,
    )
  })

  it("resolves a `../` parent specifier", async () => {
    const target = await write("shared/types.ts")
    expect(
      await resolveImportSpecifier(
        path.join(root, "feature/a.ts"),
        "../shared/types.js",
        context(),
      ),
    ).toBe(target)
  })

  it("returns undefined when a relative specifier resolves to no file on disk", async () => {
    expect(
      await resolveImportSpecifier(path.join(root, "a.ts"), "./does-not-exist.js", context()),
    ).toBe(undefined)
  })

  it("returns undefined when the target path exists but is a directory, not a file", async () => {
    await fs.mkdir(path.join(root, "just-a-dir"), { recursive: true })
    expect(
      await resolveImportSpecifier(path.join(root, "a.ts"), "./just-a-dir.ts", context()),
    ).toBe(undefined)
  })

  it("falls through past a non-matching alias config to package resolution", async () => {
    // tsconfigPaths is present but the specifier is NOT an alias -- it's an
    // allow-listed package, so resolution must not stop at the alias step.
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "host" }))
    await write("node_modules/@vendor/pkg/package.json")
    await fs.writeFile(
      path.join(root, "node_modules/@vendor/pkg/package.json"),
      JSON.stringify({
        name: "@vendor/pkg",
        exports: { "./package.json": "./package.json" },
        dataCap: { schema: "./schema.ts" },
      }),
    )
    await write("node_modules/@vendor/pkg/schema.ts")
    const tsconfigPaths: TsconfigPathsResolution = {
      compilerOptions: { baseUrl: root, paths: { "@app/*": ["src/*"] } },
      configFile: path.join(root, "tsconfig.json"),
    }
    const resolved = await resolveImportSpecifier(path.join(root, "src/index.ts"), "@vendor/pkg", {
      ...context(),
      packages: ["@vendor/pkg"],
      tsconfigPaths,
    })
    expect(
      resolved?.endsWith(`node_modules${path.sep}@vendor${path.sep}pkg${path.sep}schema.ts`),
    ).toBe(true)
  })

  it("falls through to tsconfig path-alias resolution for a bare specifier the aliases match", async () => {
    const target = await write("src/schema.ts")
    const tsconfigPaths: TsconfigPathsResolution = {
      compilerOptions: { baseUrl: root, paths: { "@app/*": ["src/*"] } },
      configFile: path.join(root, "tsconfig.json"),
    }
    expect(
      await resolveImportSpecifier(path.join(root, "src/index.ts"), "@app/schema.js", {
        ...context(),
        tsconfigPaths,
      }),
    ).toBe(target)
  })

  it("only strips a trailing recognised extension, never one embedded in the name", async () => {
    // `./x.js.bak` -> keeps `x.js.bak`, looks for `x.js.bak.ts` (not `x.bak.ts`)
    const target = await write("x.js.bak.ts")
    expect(await resolveImportSpecifier(path.join(root, "a.ts"), "./x.js.bak", context())).toBe(
      target,
    )
  })
})
