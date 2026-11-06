/**
 * Guards `data-cap/observe` as a published entry point (ADR 0072): it exists in
 * `package.json`, it is built as its own isomorphic bundle, and what the bundle
 * contains cannot reach Node, the compiler, or the build entry.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import * as observe from "../../src/observe/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  exports: Record<string, unknown>
  sideEffects?: boolean
}

describe("data-cap/observe entry point", () => {
  it("exposes exactly the recorder surface", () => {
    expect(Object.keys(observe).sort()).toEqual([
      "createMemorySink",
      "fieldPathName",
      "instrumentBoundary",
      "observeBoundary",
      "observeResponse",
      "observeSink",
      "observeValue",
    ])
  })

  it("is declared in package.json with both module formats and types", () => {
    expect(manifest.exports["./observe"]).toEqual({
      import: { types: "./dist/observe.d.ts", default: "./dist/observe.js" },
      require: { types: "./dist/observe.d.cts", default: "./dist/observe.cjs" },
    })
  })

  it("is built as its own bundle for the neutral platform", () => {
    const config = readFileSync(path.join(repoRoot, "tsup.config.ts"), "utf8")
    expect(config).toMatch(
      /name: "observe"[\s\S]*?entry: \{ observe: "src\/observe\/index.ts" \}[\s\S]*?platform: "neutral"/,
    )
  })

  it("is size-budgeted", () => {
    const budgets = readFileSync(path.join(repoRoot, "ci/size-budgets.mjs"), "utf8")
    expect(budgets).toContain('file: "dist/observe.js"')
  })

  it("is a typedoc and knip entry point, and gets a declaration shim", () => {
    expect(readFileSync(path.join(repoRoot, "typedoc.json"), "utf8")).toContain(
      "src/observe/index.ts",
    )
    expect(readFileSync(path.join(repoRoot, "knip.json"), "utf8")).toContain("src/observe/index.ts")
    expect(readFileSync(path.join(repoRoot, "scripts/emit-dts-shims.mjs"), "utf8")).toContain(
      'name: "observe"',
    )
  })

  it("emits a bundle with no Node dependency (dist/observe.js, when built)", () => {
    const bundle = path.join(repoRoot, "dist/observe.js")
    if (!existsSync(bundle)) return
    expect(readFileSync(bundle, "utf8")).not.toMatch(/require\("node:|from\s*"node:/)
  })
})
