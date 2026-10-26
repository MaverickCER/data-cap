import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { computeSourceFingerprint } from "../../src/build/evidence-fingerprint.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

describe("computeSourceFingerprint: the extra options key is framed, not appended", () => {
  let roots: string[]
  beforeEach(() => {
    roots = []
  })
  afterEach(async () => {
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  async function tree(files: Record<string, string>): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-mut-fp-"))
    roots.push(root)
    for (const [relative, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true })
      await fs.writeFile(path.join(root, relative), content, "utf8")
    }
    return root
  }

  it("an options key can never imitate a source file's path-and-content record", async () => {
    const withFile = await tree({ "src/a.ts": "content" })
    const withExtra = await tree({})
    const fileFingerprint = await computeSourceFingerprint({ fs: nodeBuildFs, root: withFile })
    const imitation = await computeSourceFingerprint({
      fs: nodeBuildFs,
      root: withExtra,
      extra: "src/a.ts\u0000content\u0000",
    })
    expect(imitation).not.toBe(fileFingerprint)
  })

  it("an empty extra key still differs from no key", async () => {
    const root = await tree({ "src/a.ts": "x" })
    expect(await computeSourceFingerprint({ fs: nodeBuildFs, root, extra: "" })).not.toBe(
      await computeSourceFingerprint({ fs: nodeBuildFs, root }),
    )
  })
})
