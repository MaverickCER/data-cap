/**
 * runtime/cache.ts and runtime/retry.ts are separate tsup entries (ADR:
 * "optional runtime features ship as separate tsup entries/exports
 * subpaths, not just named exports") -- structural tree-shaking that
 * doesn't depend on a consumer's bundler being sophisticated enough to
 * shake unused named exports. Since they're genuinely separate build
 * outputs with no import between them, the guarantee is by construction;
 * this test just pins that neither dist file's content leaks into the
 * other as a regression guard, rather than re-proving it via a second
 * downstream bundler round-trip (unlike helpers/tree-shaking.test.ts,
 * where the four namespaces share one file and the guarantee genuinely
 * depends on how a downstream bundler processes it).
 */
import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const cacheEntry = path.join(root, "dist/runtime/cache.js")
const retryEntry = path.join(root, "dist/runtime/retry.js")
const distMissing = !existsSync(cacheEntry) || !existsSync(retryEntry)

describe.skipIf(distMissing)("runtime/cache and runtime/retry tree-shake structurally", () => {
  it("dist/runtime/cache.js never includes retry.ts's code", () => {
    const code = readFileSync(cacheEntry, "utf8")
    expect(code).not.toContain("withRetry")
    expect(code).not.toContain("isStillDefault")
  })

  it("dist/runtime/retry.js never includes cache.ts's code", () => {
    const code = readFileSync(retryEntry, "utf8")
    expect(code).not.toContain("createDataCache")
  })
})
