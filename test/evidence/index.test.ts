/**
 * Guards `data-cap/evidence`'s two defining properties: what it
 * exports, and that it is genuinely isomorphic. The second matters more than
 * it looks -- the whole reason this entry point exists separately from
 * `./build` is that a dashboard backend, an edge function, or a browser can
 * run a projection over a JSON-deserialized `EvidenceModel` without dragging
 * in `node:fs` or the TypeScript compiler API. A single accidental value
 * import from `../build/` would silently destroy that, and nothing else in
 * the suite would notice.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import * as evidence from "../../src/evidence/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const evidenceDir = path.join(repoRoot, "src/evidence")

describe("evidence public barrel exports", () => {
  it("exposes defineEvidenceProjection as its one runtime export", () => {
    expect(evidence.defineEvidenceProjection).toBeTypeOf("function")
    expect(Object.keys(evidence)).toEqual(["defineEvidenceProjection"])
  })
})

describe("evidence entry point isomorphism", () => {
  const sources = readdirSync(evidenceDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(path.join(evidenceDir, name), "utf8") }))

  it("has source files to check (guards against this test silently passing on an empty glob)", () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  it("never imports a node: builtin or the typescript compiler API", () => {
    for (const { name, text } of sources) {
      expect(text, `${name} must stay isomorphic`).not.toMatch(/from\s+"node:/)
      expect(text, `${name} must stay isomorphic`).not.toMatch(/from\s+"typescript"/)
    }
  })

  it("imports from ../build/ with `import type` only, so nothing there is a runtime dependency", () => {
    for (const { name, text } of sources) {
      for (const line of text.split("\n")) {
        if (!line.includes('from "../build/')) continue
        expect(line, `${name}: ${line.trim()}`).toMatch(/^\s*(export|import)\s+type\s/)
      }
    }
  })

  it("emits a bundle with no Node dependency (dist/evidence.js, when built)", () => {
    const bundle = path.join(repoRoot, "dist/evidence.js")
    if (!existsSync(bundle)) return // dist/ not built in this run -- covered by CI's own build step
    expect(readFileSync(bundle, "utf8")).not.toMatch(/require\("node:|from\s*"node:/)
  })
})
