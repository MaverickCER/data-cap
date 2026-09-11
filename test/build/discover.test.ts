import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { discoverCapabilityFiles } from "../../src/build/discover.js"
import { createInMemoryBuildFs, nodeBuildFs } from "../support/build-filesystem.js"

describe("discoverCapabilityFiles", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-discover-test-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function touch(relativePath: string): Promise<void> {
    const filePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, "", "utf8")
  }

  it("finds .ts and .tsx files, alphabetically sorted, as absolute paths", async () => {
    await touch("b.ts")
    await touch("a.tsx")
    await touch("nested/c.ts")

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root })
    expect(files).toEqual([
      path.join(root, "a.tsx"),
      path.join(root, "b.ts"),
      path.join(root, "nested/c.ts"),
    ])
  })

  it("sorts a large batch of siblings alphabetically, not directory-listing order", async () => {
    const names = ["z", "y", "m", "q", "b", "k", "a", "w", "e", "d"]
    for (const name of names) await touch(`${name}.ts`)

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root })
    expect(files).toEqual([...names].sort().map((name) => path.join(root, `${name}.ts`)))
  })

  it("sorts the final result even when the underlying directory listing itself is NOT alphabetical -- proven by forcing a reversed readdir order", async () => {
    await touch("a.ts")
    await touch("b.ts")
    await touch("c.ts")
    const real = fs.readdir.bind(fs)
    const spy = vi
      .spyOn(fs, "readdir")
      // @ts-expect-error -- overriding readdir's overloaded signature for one deterministic call shape.
      .mockImplementation(async (dir: string, options: unknown) => {
        const entries = await real(dir, options as { withFileTypes: true })
        return [...entries].reverse()
      })
    try {
      const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root })
      expect(files).toEqual([
        path.join(root, "a.ts"),
        path.join(root, "b.ts"),
        path.join(root, "c.ts"),
      ])
    } finally {
      spy.mockRestore()
    }
  })

  it("ignores non-.ts/.tsx files", async () => {
    await touch("readme.md")
    await touch("data.json")
    await touch("real.ts")

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root })
    expect(files).toEqual([path.join(root, "real.ts")])
  })

  it("prunes node_modules and .git during the walk, not after", async () => {
    await touch("node_modules/some-pkg/index.ts")
    await touch(".git/hooks/pre-commit.ts")
    await touch("src/real.ts")

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root })
    expect(files).toEqual([path.join(root, "src/real.ts")])
  })

  it("prunes directories matching a caller-supplied exclude glob", async () => {
    await touch("dist/compiled.ts")
    await touch("src/real.ts")

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root, exclude: ["**/dist/**"] })
    expect(files).toEqual([path.join(root, "src/real.ts")])
  })

  it("prunes a directory named by a directory-only exclude glob (trailing slash), which no file path would match", async () => {
    await touch("dist/compiled.ts") // "dist/compiled.ts" does NOT match "**/dist/"
    await touch("src/real.ts")

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root, exclude: ["**/dist/"] })
    expect(files).toEqual([path.join(root, "src/real.ts")])
  })

  it("excludes an individual file matching an exclude glob without pruning its directory", async () => {
    await touch("src/real.ts")
    await touch("src/real.test.ts")

    const files = await discoverCapabilityFiles({
      fs: nodeBuildFs,
      root,
      exclude: ["**/*.test.ts"],
    })
    expect(files).toEqual([path.join(root, "src/real.ts")])
  })

  it("only includes files matching a caller-supplied include glob", async () => {
    await touch("a.ts")
    await touch("b.tsx")
    await touch("nested/c.ts")

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root, include: ["nested/**"] })
    expect(files).toEqual([path.join(root, "nested/c.ts")])
  })

  it("applies exclude on top of a caller-supplied include", async () => {
    await touch("a.ts")
    await touch("a.test.ts")

    const files = await discoverCapabilityFiles({
      fs: nodeBuildFs,
      root,
      include: ["**/*.ts"],
      exclude: ["**/*.test.ts"],
    })
    expect(files).toEqual([path.join(root, "a.ts")])
  })

  it("never traverses into a symlinked directory (symlink-cycle-immune by construction)", async () => {
    await touch("real/target.ts")
    await fs.symlink(path.join(root, "real"), path.join(root, "link"), "dir")

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root })
    expect(files).toEqual([path.join(root, "real/target.ts")])
  })

  it("never includes a FILE symlink even when its name matches the include pattern -- it is neither a directory nor a (raw, lstat-typed) file", async () => {
    await touch("real.ts")
    await fs.symlink(path.join(root, "real.ts"), path.join(root, "sneaky.ts"), "file")

    const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root })
    expect(files).toEqual([path.join(root, "real.ts")])
  })

  it("never throws for an unreadable/inaccessible subdirectory -- skips it silently", async () => {
    await touch("readable/ok.ts")
    const restrictedDir = path.join(root, "restricted")
    await fs.mkdir(restrictedDir)
    await fs.chmod(restrictedDir, 0o000)

    try {
      const files = await discoverCapabilityFiles({ fs: nodeBuildFs, root })
      expect(files).toEqual([path.join(root, "readable/ok.ts")])
    } finally {
      await fs.chmod(restrictedDir, 0o755) // restore so afterEach's rm can clean it up
    }
  })

  it("returns an empty array for an empty root", async () => {
    expect(await discoverCapabilityFiles({ fs: nodeBuildFs, root })).toEqual([])
  })
})

// ADR 0058: `src/build/**` depends on the `BuildFileSystem` *contract*, not on
// `node:fs`. Running the exact same discovery against a `Map`-backed fake --
// no real disk anywhere -- is the proof: if `discover.ts` reached for
// `node:fs` itself, these would not pass.
describe("discoverCapabilityFiles against an in-memory BuildFileSystem", () => {
  const memRoot = path.normalize("/project")

  it("walks the seeded tree and applies include/exclude, pruning node_modules", async () => {
    const inMemoryFs = createInMemoryBuildFs({
      [`${memRoot}/features/payments/data.schema.ts`]: "// contract\n",
      [`${memRoot}/packages/database/data.schema.ts`]: "// contract\n",
      [`${memRoot}/features/payments/notes.md`]: "// not a .ts file\n",
      [`${memRoot}/node_modules/dep/data.schema.ts`]: "// must be pruned\n",
      [`${memRoot}/legacy/data.schema.ts`]: "// excluded by pattern\n",
    })

    const files = await discoverCapabilityFiles({
      fs: inMemoryFs,
      root: memRoot,
      include: ["**/*.ts"],
      exclude: ["legacy/**"],
    })

    expect(files).toEqual([
      path.normalize(`${memRoot}/features/payments/data.schema.ts`),
      path.normalize(`${memRoot}/packages/database/data.schema.ts`),
    ])
  })

  it("returns an empty array when the fake holds no matching file", async () => {
    const inMemoryFs = createInMemoryBuildFs({ [`${memRoot}/src/index.md`]: "" })
    const files = await discoverCapabilityFiles({
      fs: inMemoryFs,
      root: memRoot,
      include: ["**/*.ts"],
      exclude: [],
    })
    expect(files).toEqual([])
  })
})
