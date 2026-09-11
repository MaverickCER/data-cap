/**
 * Verifies helpers/index.ts's four exported namespaces
 * (processors/identity/canonicalize/shape) tree-shake independently of one
 * another once bundled by a SECOND, downstream bundler -- the actual bug
 * class this guards against: tsup/esbuild lowering `export * as x from
 * "./mod.js"` into a namespace-construction call a downstream bundler can't
 * prove side-effect-free (see helpers/index.ts's own module doc comment for
 * why it's built from plain object literals instead). Bundles the BUILT
 * dist/helpers.js (never src/ -- this bug class only manifests post-build),
 * skipping gracefully if dist/ hasn't been built yet.
 *
 * `identity` is the one namespace that legitimately depends on
 * `canonicalize` internally (computeItemIdentity calls canonicalize() to
 * encode each key component) -- so an identity-only bundle is expected to
 * still include canonicalize's code; only processors/shape are asserted
 * absent there.
 *
 * Deliberately keeps identifiers unminified (`minifyIdentifiers: false`) so
 * each namespace's own top-level function names remain literal, reliable
 * presence/absence markers in the output -- unlike env-cap's equivalent test
 * (which matches literal error-message strings, since its processors/
 * validators throw distinctive text on failure), most of data-cap's helpers
 * return `undefined` on unparseable input rather than throwing, so there's
 * no equivalently-distinctive message text to match against instead.
 */
import { afterAll, describe, expect, it } from "vitest"
import * as esbuild from "esbuild"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const distEntry = path.join(root, "dist/helpers.js")
const distMissing = !existsSync(distEntry)

const tmpDir = mkdtempSync(path.join(os.tmpdir(), "data-cap-tree-shaking-"))

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function bundle(entryCode: string): { code: string; gzip: number } {
  const entryPath = path.join(tmpDir, `entry-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(entryPath, entryCode, "utf8")
  const result = esbuild.buildSync({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
  })
  const output = result.outputFiles[0]
  if (output === undefined) {
    throw new Error("esbuild produced no output file")
  }
  return { code: output.text, gzip: gzipSync(output.text).length }
}

const MARKERS = {
  processors: ["toBoolean", "toInteger", "parseJSON", "toBigInt"],
  identity: ["computeItemIdentity", "reconcileArrayInfo"],
  canonicalize: ["canonicalizeInner"],
  shape: ["isPlainObject", "isRegExp"],
} as const

const entryFor = (spec: string, usage: string): string =>
  `import { ${spec} } from ${JSON.stringify(distEntry)};\n${usage}`

describe.skipIf(distMissing)("helpers tree-shaking", () => {
  it("importing only `processors` excludes identity/canonicalize/shape code", () => {
    const { code } = bundle(entryFor("processors", 'console.log(processors.toBoolean("yes"))'))
    for (const marker of MARKERS.processors) expect(code).toContain(marker)
    for (const marker of MARKERS.identity) expect(code).not.toContain(marker)
    for (const marker of MARKERS.canonicalize) expect(code).not.toContain(marker)
    for (const marker of MARKERS.shape) expect(code).not.toContain(marker)
  })

  it("importing only `shape` excludes processors/identity/canonicalize code", () => {
    const { code } = bundle(entryFor("shape", "console.log(shape.isPlainObject({}))"))
    for (const marker of MARKERS.shape) expect(code).toContain(marker)
    for (const marker of MARKERS.processors) expect(code).not.toContain(marker)
    for (const marker of MARKERS.identity) expect(code).not.toContain(marker)
    for (const marker of MARKERS.canonicalize) expect(code).not.toContain(marker)
  })

  it("importing only `canonicalize` excludes processors/identity/shape code", () => {
    const { code } = bundle(entryFor("canonicalize", "console.log(canonicalize(1))"))
    for (const marker of MARKERS.canonicalize) expect(code).toContain(marker)
    for (const marker of MARKERS.processors) expect(code).not.toContain(marker)
    for (const marker of MARKERS.identity) expect(code).not.toContain(marker)
    for (const marker of MARKERS.shape) expect(code).not.toContain(marker)
  })

  it("importing only `identity` excludes processors/shape code (canonicalize is legitimately included -- identity depends on it)", () => {
    const { code } = bundle(
      entryFor("identity", "console.log(identity.computeItemIdentity({}, [], [], []))"),
    )
    for (const marker of MARKERS.identity) expect(code).toContain(marker)
    for (const marker of MARKERS.canonicalize) expect(code).toContain(marker)
    for (const marker of MARKERS.processors) expect(code).not.toContain(marker)
    for (const marker of MARKERS.shape) expect(code).not.toContain(marker)
  })

  it("importing every namespace produces a meaningfully larger gzip payload than importing one alone", () => {
    const single = bundle(entryFor("processors", 'console.log(processors.toBoolean("yes"))'))
    const combined = bundle(
      entryFor(
        "processors, identity, canonicalize, shape",
        "console.log(processors, identity, canonicalize, shape)",
      ),
    )
    expect(combined.gzip).toBeGreaterThan(single.gzip + 50)
  })
})
