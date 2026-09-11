// Tier and named-benchmark definitions shared by both performance-runtime
// and performance-buildtime. Plain JS, not TypeScript: nothing here needs
// type checking, and keeping it dependency-free avoids any transpilation
// cost leaking into what either example measures. See ../README.md for why
// these particular tiers and benchmarks exist.

export const BENCHMARK_SUITE_VERSION = 1

export const TIER_NAMES = ["baseline", "stress", "extreme"]

/**
 * data-cap has TWO structurally different things that scale, never
 * conflated (see ../README.md's "Two independent axes"):
 *
 * - COLLECTION size -- how many records one capability's getter fetches/
 *   holds. The primary axis for the in-process runtime benchmarks below
 *   (commitAuthoritative-array-replace, reconcileArrayInfo,
 *   getterDispatch-cold): the realistic "does data-cap hold up as the
 *   fetched dataset grows" question for an async-data-request tool.
 * - CAPABILITY count -- how many separate `createData()`-declaring modules
 *   a real app imports at startup. The axis `cold-start` (a fresh child
 *   process importing that many capability modules) and the build-time
 *   `discovery`/`artifacts` benchmarks (a fresh directory of that many
 *   capability files) both scale along instead -- the real cost driver for
 *   "process boot" and "how does this monorepo's build tooling scale,"
 *   neither of which cares how big any one collection is.
 *
 * Sized larger than env-cap's own tiers on both axes deliberately: a
 * multi-field record and a single scalar env var aren't the same unit of
 * "size," and real payloads (a CRM contact list, an order history, a
 * support-ticket queue) run to thousands of multi-field records.
 */
export const RUNTIME_ITEM_TIERS = {
  baseline: { itemCount: 200 },
  stress: { itemCount: 2_000 },
  extreme: { itemCount: 20_000 },
}

export const RUNTIME_CAPABILITY_TIERS = {
  baseline: { capabilities: 10 },
  stress: { capabilities: 100 },
  extreme: { capabilities: 500 },
}

export const BUILDTIME_FILE_TIERS = {
  baseline: { files: 10 },
  stress: { files: 100 },
  extreme: { files: 400 },
}

/**
 * `id` embeds both the suite version (methodology, at generation time) and
 * this specific (category, name, tier)'s own definition version -- an id
 * pasted into an issue or dashboard stays unambiguous even out of context.
 */
export function benchmarkId(category, name, tier, definitionVersion) {
  return `${category}-${name}-${tier}-s${BENCHMARK_SUITE_VERSION}-v${definitionVersion}`
}

// Runtime: cold-start (capability-count axis) plus the in-process
// sync-core/async-dispatch suite (item-count axis, or fixed where tiering
// wouldn't measure anything real -- see each benchmark's own rationale in
// ../performance-runtime/README.md).
export const RUNTIME_BENCHMARKS = {
  "cold-start": { tiers: TIER_NAMES, definitionVersion: 1 },
  buildData: { tiers: ["fixed"], definitionVersion: 1 },
  "commitAuthoritative-array-replace": { tiers: TIER_NAMES, definitionVersion: 1 },
  "commitAuthoritative-leaf": { tiers: TIER_NAMES, definitionVersion: 1 },
  reconcileArrayInfo: { tiers: TIER_NAMES, definitionVersion: 1 },
  "getterDispatch-cold": { tiers: TIER_NAMES, definitionVersion: 1 },
  canonicalize: { tiers: ["fixed"], definitionVersion: 1 },
  dedupeFanIn: { tiers: ["fixed"], definitionVersion: 1 },
  "dedupeFanIn-independent": { tiers: ["fixed"], definitionVersion: 1 },
  runGettersFanOut: { tiers: ["fixed"], definitionVersion: 1 },
}

// Build-time: discovery alone, and the full generateDataArtifacts pipeline
// (discover -> link -> inventory -> manifest/docs/ownership/flow/evidence).
export const BUILDTIME_BENCHMARKS = {
  discovery: { tiers: TIER_NAMES, definitionVersion: 1 },
  artifacts: { tiers: TIER_NAMES, definitionVersion: 1 },
}

/** Every (category, name, tier) the suite declares, independent of whether a given run produced a result for it. */
export function buildManifest(category, benchmarks) {
  const manifest = []
  for (const [name, def] of Object.entries(benchmarks)) {
    for (const tier of def.tiers) {
      manifest.push({
        id: benchmarkId(category, name, tier, def.definitionVersion),
        category,
        name,
        tier,
        suiteVersion: BENCHMARK_SUITE_VERSION,
        definitionVersion: def.definitionVersion,
      })
    }
  }
  return manifest
}
