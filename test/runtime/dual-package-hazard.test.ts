/**
 * The dual-package hazard: if a consumer's dependency tree ends up resolving
 * `@maverickcer/data-cap/runtime` through two different specifiers (one
 * import-er getting the ESM build, one require()-er getting the CJS build --
 * e.g. via a mixed ESM/CJS dependency graph, or a re-exporting intermediate
 * package), Node loads two entirely separate module instances. Since
 * `defaultCoordinator` (coordinator.ts) is a module-level singleton, each
 * instance gets its OWN coordinator -- two capabilities that should share
 * dedup/subscription work (same `execute`/`subscribe` function identity)
 * silently stop sharing it, without any error.
 *
 * This package cannot prevent that (no npm package that ships both ESM and
 * CJS can -- it's a property of how Node's two module systems resolve
 * independently), so this test exists to pin the ACTUAL, understood
 * consequence: graceful degradation (each instance stays internally
 * consistent; work just doesn't cross the boundary), not corruption or a
 * crash. This is decision/ADR "dual-package-hazard is a checked, documented
 * risk class" -- see SECURITY.md/ADOPTION.md for the consumer-facing
 * writeup once written (Phase 9).
 *
 * Requires `npm run build` to have already produced dist/runtime/index.{js,cjs}
 * -- skips gracefully otherwise, matching the tree-shaking tests' convention.
 */
import { describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Coordinator } from "../../src/runtime/coordinator.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const esmEntry = path.join(root, "dist/runtime/index.js")
const cjsEntry = path.join(root, "dist/runtime/index.cjs")
const distMissing = !existsSync(esmEntry) || !existsSync(cjsEntry)

interface RuntimeModule {
  readonly defaultCoordinator: Coordinator
}

async function loadEsm(): Promise<RuntimeModule> {
  return (await import(pathToFileURL(esmEntry).href)) as RuntimeModule
}

function loadCjs(): RuntimeModule {
  const require = createRequire(import.meta.url)
  return require(cjsEntry) as RuntimeModule
}

describe.skipIf(distMissing)("dual-package hazard -- defaultCoordinator", () => {
  it("the same resolution path always yields the same instance -- no hazard within one module graph", async () => {
    const a = await loadEsm()
    const b = await loadEsm()
    expect(a.defaultCoordinator).toBe(b.defaultCoordinator)
  })

  it("different resolution paths (ESM vs CJS) load different module instances -- the documented hazard itself", async () => {
    const esm = await loadEsm()
    const cjs = loadCjs()
    expect(esm.defaultCoordinator).not.toBe(cjs.defaultCoordinator)
  })

  it("degrades gracefully under the hazard: each instance dedupes correctly on its own, they just never share work with each other", async () => {
    const esm = await loadEsm()
    const cjs = loadCjs()

    let calls = 0
    const fn = async (_params: { id: string }, _signal: AbortSignal): Promise<number> => {
      // Captured synchronously, before the await -- reading the shared
      // `calls` counter AFTER the await would race against the other
      // invocation's own increment (both invocations' synchronous prefixes
      // run before either resumes), making the two results indistinguishable
      // regardless of whether they came from one execution or two.
      const callIndex = (calls += 1)
      await Promise.resolve()
      return callIndex
    }

    const controller = new AbortController()
    const [fromEsmFirst, fromEsmSecond, fromCjs] = await Promise.all([
      esm.defaultCoordinator.dedupe(fn, { id: "shared" }, controller.signal),
      esm.defaultCoordinator.dedupe(fn, { id: "shared" }, controller.signal),
      cjs.defaultCoordinator.dedupe(fn, { id: "shared" }, controller.signal),
    ])

    // Two calls through the SAME (ESM) instance, same params: deduped onto one underlying call.
    expect(fromEsmFirst).toBe(fromEsmSecond)
    // The CJS instance never sees the ESM instance's in-flight entry -- its own, separate call.
    expect(fromCjs).not.toBe(fromEsmFirst)
    expect(calls).toBe(2)
  })
})
