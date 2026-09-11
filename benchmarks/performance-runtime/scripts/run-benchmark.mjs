// Runtime benchmark orchestrator -- `npm run benchmark` from this
// directory, or via ../../run-benchmarks.mjs (benchmarks/run-benchmarks.mjs)
// from the repo root. Writes results.json (immutable, measurement-only) and
// RESULTS.md.
//
// Only measures. Never reads a previous results.json, never computes a
// diff, never decides what's a regression -- that's
// ../../render-benchmark-summary.mjs's job, run separately by CI.
//
// Imports data-cap via its PACKAGE NAME, resolved through this directory's
// own `node_modules/@maverickcer/data-cap` (a `file:../..` dependency,
// installed by `npm install` here) -- never a relative `../../dist/*.js`
// path. This is the "full package" benchmark: it exercises the actual
// published entry points/exports map a real consumer's `npm install` would
// resolve, not a monorepo-relative shortcut around them.

import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildData } from "@maverickcer/data-cap"
import { createDataStore, createData, createCoordinator } from "@maverickcer/data-cap/runtime"
import { canonicalize, identity } from "@maverickcer/data-cap/helpers"

import {
  generateRecords,
  capabilitySchemaFields,
  realisticParams,
  generateRuntimeCapabilityFixtures,
} from "../../benchmark-fixtures/generator.mjs"
import { hashFixtureTree } from "../../benchmark-fixtures/fixture-hash.mjs"
import { buildMetadata } from "../../benchmark-fixtures/metadata.mjs"
import { adaptiveSample, computeDurationStats } from "../../benchmark-fixtures/measure.mjs"
import {
  benchmarkId,
  buildManifest,
  RUNTIME_BENCHMARKS,
  RUNTIME_ITEM_TIERS,
  RUNTIME_CAPABILITY_TIERS,
  TIER_NAMES,
} from "../../benchmark-fixtures/scenarios.mjs"
import { renderResultsMarkdown } from "../../benchmark-fixtures/render-results-markdown.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const exampleRoot = path.resolve(here, "..")
const repoRoot = path.resolve(exampleRoot, "..", "..")
const fixturesRoot = path.join(exampleRoot, "fixtures", "generated")
const coldStartChildScript = path.join(here, "cold-start-child.mjs")

function timeItSync(fn) {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

/**
 * Stands in for a getter's real `execute` (a fetch, a DB query, ...)
 * without ever touching the network or filesystem, and without skipping
 * real dispatch logic either -- see ../README.md's "Simulated async, not
 * real I/O". Each call hands out the NEXT entry from a pre-generated
 * `payloads` pool -- never the same reference twice (commitAuthoritative's
 * no-op suppression would silently turn a repeated-reference commit into a
 * free no-op after the first call), and never generated inside the timed
 * section.
 */
function simulatedExecuteFromPool(payloads) {
  let index = 0
  const execute = async () => {
    if (index >= payloads.length) {
      throw new Error(
        "simulatedExecuteFromPool: exhausted its pre-generated payload pool -- generate at least as many payloads as execute will be called",
      )
    }
    const payload = payloads[index]
    index += 1
    return payload
  }
  return { execute, callCount: () => index }
}

function completed(id, fields) {
  return { id, status: "completed", ...fields }
}

/* -------------------------------------------------------------------------- */
/* cold-start (capability-count axis, child-process, real package import)     */
/* -------------------------------------------------------------------------- */

const COLD_START_OPTS = { warmupIterations: 0, targetDurationMs: 2000, minIterations: 5, maxIterations: 15 }

function runColdStartChildOnce(indexPath) {
  const t0 = performance.now()
  const stdout = execFileSync(
    process.execPath,
    ["--expose-gc", coldStartChildScript, indexPath],
    { encoding: "utf8", cwd: exampleRoot },
  )
  const totalMs = performance.now() - t0
  const child = JSON.parse(stdout)
  return { totalMs, ...child }
}

async function runColdStartTier(tierName, definitionVersion) {
  const outputDir = path.join(fixturesRoot, "cold-start", tierName)
  const { capabilities } = RUNTIME_CAPABILITY_TIERS[tierName]
  const genStart = performance.now()
  const generated = await generateRuntimeCapabilityFixtures({ tierName, count: capabilities, outputDir })
  const fixtureGenerationMs = performance.now() - genStart
  const fixtureHash = await hashFixtureTree(outputDir)

  const { samples, configuration } = await adaptiveSample(
    () => runColdStartChildOnce(generated.indexPath),
    COLD_START_OPTS,
  )
  const last = samples[samples.length - 1]

  return {
    entry: completed(benchmarkId("runtime", "cold-start", tierName, definitionVersion), {
      inputs: { capabilities: generated.capabilities },
      fixtureHash,
      fixtureGenerationMs: Math.round(fixtureGenerationMs),
      totalMs: computeDurationStats(samples.map((s) => s.totalMs), configuration.warmupIterations),
      moduleEvalMs: computeDurationStats(
        samples.map((s) => s.moduleEvalMs),
        configuration.warmupIterations,
      ),
      memoryBeforeBytes: last.memoryBeforeBytes,
      memoryAfterBytes: last.memoryAfterBytes,
    }),
    configuration,
  }
}

/* -------------------------------------------------------------------------- */
/* Sync core state layer -- buildData / commitAuthoritative / identity        */
/* -------------------------------------------------------------------------- */

const ITEM_SAMPLE_OPTS = {
  baseline: { warmupIterations: 3, targetDurationMs: 1200, minIterations: 10, maxIterations: 60 },
  stress: { warmupIterations: 2, targetDurationMs: 1200, minIterations: 8, maxIterations: 25 },
  extreme: { warmupIterations: 1, targetDurationMs: 1500, minIterations: 5, maxIterations: 12 },
}
const FIXED_SAMPLE_OPTS = {
  warmupIterations: 3,
  targetDurationMs: 1200,
  minIterations: 10,
  maxIterations: 100,
}

function poolBudget(opts) {
  return opts.warmupIterations + opts.maxIterations
}

async function benchBuildData(definitionVersion) {
  const { samples, configuration } = await adaptiveSample(
    () => timeItSync(() => buildData({ fields: capabilitySchemaFields(0) })),
    FIXED_SAMPLE_OPTS,
  )
  return {
    entry: completed(benchmarkId("runtime", "buildData", "fixed", definitionVersion), {
      durationMs: computeDurationStats(samples, configuration.warmupIterations),
    }),
    configuration,
  }
}

async function benchCommitArrayReplace(tierName, definitionVersion) {
  const { itemCount } = RUNTIME_ITEM_TIERS[tierName]
  const opts = ITEM_SAMPLE_OPTS[tierName]
  const store = createDataStore(buildData({ fields: capabilitySchemaFields(0) }))
  const patches = Array.from({ length: poolBudget(opts) }, () => generateRecords(itemCount))
  let i = 0
  const { samples, configuration } = await adaptiveSample(
    () =>
      timeItSync(() => {
        store.commitAuthoritative({ items: patches[i] }, { items: { status: "success" } })
        i += 1
      }),
    opts,
  )
  return {
    entry: completed(
      benchmarkId("runtime", "commitAuthoritative-array-replace", tierName, definitionVersion),
      { inputs: { itemCount }, durationMs: computeDurationStats(samples, configuration.warmupIterations) },
    ),
    configuration,
  }
}

async function benchCommitLeaf(tierName, definitionVersion) {
  const { itemCount } = RUNTIME_ITEM_TIERS[tierName]
  const opts = ITEM_SAMPLE_OPTS[tierName]
  const store = createDataStore(buildData({ fields: capabilitySchemaFields(itemCount) }))
  let i = 0
  const { samples, configuration } = await adaptiveSample(
    () =>
      timeItSync(() => {
        store.commitAuthoritative({ meta: { lastSyncedBy: `user-${String(i)}` } }, undefined)
        i += 1
      }),
    opts,
  )
  return {
    entry: completed(
      benchmarkId("runtime", "commitAuthoritative-leaf", tierName, definitionVersion),
      { inputs: { itemCount }, durationMs: computeDurationStats(samples, configuration.warmupIterations) },
    ),
    configuration,
  }
}

async function benchReconcileArrayInfo(tierName, definitionVersion) {
  const { itemCount } = RUNTIME_ITEM_TIERS[tierName]
  const opts = ITEM_SAMPLE_OPTS[tierName]
  const records = generateRecords(itemCount)
  const { samples, configuration } = await adaptiveSample(
    () =>
      timeItSync(() => {
        identity.reconcileArrayInfo(undefined, records, ["id"], "all", () => ({ fetchedAt: 0 }))
      }),
    opts,
  )
  return {
    entry: completed(benchmarkId("runtime", "reconcileArrayInfo", tierName, definitionVersion), {
      inputs: { itemCount },
      durationMs: computeDurationStats(samples, configuration.warmupIterations),
    }),
    configuration,
  }
}

async function benchCanonicalize(definitionVersion) {
  let i = 0
  const { samples, configuration } = await adaptiveSample(
    () =>
      timeItSync(() => {
        canonicalize(realisticParams(i))
        i += 1
      }),
    FIXED_SAMPLE_OPTS,
  )
  return {
    entry: completed(benchmarkId("runtime", "canonicalize", "fixed", definitionVersion), {
      durationMs: computeDurationStats(samples, configuration.warmupIterations),
    }),
    configuration,
  }
}

/* -------------------------------------------------------------------------- */
/* Async dispatch layer -- createData's getter/coordinator machinery          */
/* -------------------------------------------------------------------------- */

async function benchGetterDispatchCold(tierName, definitionVersion) {
  const { itemCount } = RUNTIME_ITEM_TIERS[tierName]
  const opts = ITEM_SAMPLE_OPTS[tierName]
  const payloads = Array.from({ length: poolBudget(opts) }, () => ({ items: generateRecords(itemCount) }))
  const { execute } = simulatedExecuteFromPool(payloads)
  const coordinator = createCoordinator()
  const capability = createData(
    {
      fields: capabilitySchemaFields(0),
      getters: { listItems: { params: { page: 0 }, execute, writes: { items: true } } },
    },
    { coordinator },
  )
  let i = 0
  const { samples, configuration } = await adaptiveSample(async () => {
    const t0 = performance.now()
    await capability.listItems({ page: i })
    i += 1
    return performance.now() - t0
  }, opts)
  return {
    entry: completed(benchmarkId("runtime", "getterDispatch-cold", tierName, definitionVersion), {
      inputs: { itemCount },
      durationMs: computeDurationStats(samples, configuration.warmupIterations),
    }),
    configuration,
  }
}

const DEDUPE_FAN_IN_CONCURRENCY = 25
// Both fan-in benchmarks share this item count deliberately -- their whole
// point is a fair, apples-to-apples comparison of ONE variable (dedup vs.
// no dedup) at matched payload size; payload-size scaling is already
// covered by commitAuthoritative-array-replace/getterDispatch-cold.
const DEDUPE_FAN_IN_ITEM_COUNT = RUNTIME_ITEM_TIERS.baseline.itemCount

async function benchDedupeFanIn(definitionVersion) {
  const itemCount = DEDUPE_FAN_IN_ITEM_COUNT
  const opts = FIXED_SAMPLE_OPTS
  const payloads = Array.from({ length: poolBudget(opts) + 1 }, () => ({
    items: generateRecords(itemCount),
  }))
  const { execute, callCount } = simulatedExecuteFromPool(payloads)
  const coordinator = createCoordinator()
  const capability = createData(
    {
      fields: capabilitySchemaFields(0),
      getters: { listItems: { params: { page: 0 }, execute, writes: { items: true } } },
    },
    { coordinator },
  )
  const fanIn = () =>
    Promise.all(
      Array.from({ length: DEDUPE_FAN_IN_CONCURRENCY }, () => capability.listItems({ page: 0 })),
    )

  const before = callCount()
  await fanIn()
  if (callCount() - before !== 1) {
    throw new Error(
      `dedupeFanIn: expected exactly 1 underlying execute for ${String(DEDUPE_FAN_IN_CONCURRENCY)} concurrent identical calls, got ${String(callCount() - before)} -- coordinator.dedupe may have regressed`,
    )
  }

  const { samples, configuration } = await adaptiveSample(async () => {
    const t0 = performance.now()
    await fanIn()
    return performance.now() - t0
  }, opts)

  return {
    entry: completed(benchmarkId("runtime", "dedupeFanIn", "fixed", definitionVersion), {
      inputs: { itemCount, concurrency: DEDUPE_FAN_IN_CONCURRENCY },
      durationMs: computeDurationStats(samples, configuration.warmupIterations),
    }),
    configuration,
  }
}

async function benchDedupeFanInIndependent(definitionVersion) {
  const itemCount = DEDUPE_FAN_IN_ITEM_COUNT
  const opts = FIXED_SAMPLE_OPTS
  const payloads = Array.from(
    { length: poolBudget(opts) * DEDUPE_FAN_IN_CONCURRENCY },
    () => ({ items: generateRecords(itemCount) }),
  )
  const { execute } = simulatedExecuteFromPool(payloads)
  const coordinator = createCoordinator()
  const capability = createData(
    {
      fields: capabilitySchemaFields(0),
      getters: { listItems: { params: { page: 0 }, execute, writes: { items: true } } },
    },
    { coordinator },
  )
  let nextPage = 0
  const { samples, configuration } = await adaptiveSample(async () => {
    const t0 = performance.now()
    await Promise.all(
      Array.from({ length: DEDUPE_FAN_IN_CONCURRENCY }, () => {
        nextPage += 1
        return capability.listItems({ page: nextPage })
      }),
    )
    return performance.now() - t0
  }, opts)

  return {
    entry: completed(benchmarkId("runtime", "dedupeFanIn-independent", "fixed", definitionVersion), {
      inputs: { itemCount, concurrency: DEDUPE_FAN_IN_CONCURRENCY },
      durationMs: computeDurationStats(samples, configuration.warmupIterations),
    }),
    configuration,
  }
}

const RUN_GETTERS_FAN_OUT_COUNT = 6

async function benchRunGettersFanOut(definitionVersion) {
  const { itemCount } = RUNTIME_ITEM_TIERS.baseline
  const opts = FIXED_SAMPLE_OPTS
  const getters = {}
  const schemaFields = {}
  for (let g = 0; g < RUN_GETTERS_FAN_OUT_COUNT; g++) {
    const fieldName = `section${String(g)}`
    schemaFields[fieldName] = []
    const payloads = Array.from({ length: poolBudget(opts) }, () => ({
      [fieldName]: generateRecords(itemCount),
    }))
    const { execute } = simulatedExecuteFromPool(payloads)
    getters[`get${String(g)}`] = { params: {}, execute, writes: { [fieldName]: true } }
  }
  const coordinator = createCoordinator()
  const capability = createData({ fields: schemaFields, getters }, { coordinator })
  const calls = Object.fromEntries(Object.keys(getters).map((name) => [name, {}]))

  const { samples, configuration } = await adaptiveSample(async () => {
    const t0 = performance.now()
    await capability.runGetters(calls)
    return performance.now() - t0
  }, opts)

  return {
    entry: completed(benchmarkId("runtime", "runGettersFanOut", "fixed", definitionVersion), {
      inputs: { itemCount, getterCount: RUN_GETTERS_FAN_OUT_COUNT },
      durationMs: computeDurationStats(samples, configuration.warmupIterations),
    }),
    configuration,
  }
}

/* -------------------------------------------------------------------------- */
/* Run everything                                                             */
/* -------------------------------------------------------------------------- */

async function main() {
  const startedAt = new Date()
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"))

  const results = {}
  let sharedConfiguration

  const coldStartDef = RUNTIME_BENCHMARKS["cold-start"]
  results["cold-start"] = { tiers: {} }
  for (const tier of coldStartDef.tiers) {
    console.log(`[performance-runtime] cold-start.${tier} ...`)
    const { entry, configuration } = await runColdStartTier(tier, coldStartDef.definitionVersion)
    results["cold-start"].tiers[tier] = entry
    sharedConfiguration = configuration
    console.log(
      `[performance-runtime] cold-start.${tier}: median ${entry.totalMs.medianMs.toFixed(2)}ms total (moduleEval ${entry.moduleEvalMs.medianMs.toFixed(2)}ms), n=${entry.totalMs.iterations}`,
    )
  }

  results.buildData = { tiers: { fixed: (await benchBuildData(1)).entry } }
  console.log(
    `[performance-runtime] buildData: median ${results.buildData.tiers.fixed.durationMs.medianMs.toFixed(4)}ms`,
  )

  results["commitAuthoritative-array-replace"] = { tiers: {} }
  results["commitAuthoritative-leaf"] = { tiers: {} }
  results.reconcileArrayInfo = { tiers: {} }
  results["getterDispatch-cold"] = { tiers: {} }
  for (const tier of TIER_NAMES) {
    const arrayReplace = await benchCommitArrayReplace(tier, 1)
    results["commitAuthoritative-array-replace"].tiers[tier] = arrayReplace.entry
    const leaf = await benchCommitLeaf(tier, 1)
    results["commitAuthoritative-leaf"].tiers[tier] = leaf.entry
    const reconcile = await benchReconcileArrayInfo(tier, 1)
    results.reconcileArrayInfo.tiers[tier] = reconcile.entry
    const getterDispatch = await benchGetterDispatchCold(tier, 1)
    results["getterDispatch-cold"].tiers[tier] = getterDispatch.entry
    console.log(
      `[performance-runtime] ${tier}: array-replace ${arrayReplace.entry.durationMs.medianMs.toFixed(4)}ms, leaf ${leaf.entry.durationMs.medianMs.toFixed(4)}ms, reconcile ${reconcile.entry.durationMs.medianMs.toFixed(4)}ms, getterDispatch ${getterDispatch.entry.durationMs.medianMs.toFixed(4)}ms`,
    )
  }

  results.canonicalize = { tiers: { fixed: (await benchCanonicalize(1)).entry } }
  results.dedupeFanIn = { tiers: { fixed: (await benchDedupeFanIn(1)).entry } }
  results["dedupeFanIn-independent"] = { tiers: { fixed: (await benchDedupeFanInIndependent(1)).entry } }
  results.runGettersFanOut = { tiers: { fixed: (await benchRunGettersFanOut(1)).entry } }
  console.log(
    `[performance-runtime] dedupeFanIn ${results.dedupeFanIn.tiers.fixed.durationMs.medianMs.toFixed(4)}ms vs. dedupeFanIn-independent ${results["dedupeFanIn-independent"].tiers.fixed.durationMs.medianMs.toFixed(4)}ms`,
  )

  const finishedAt = new Date()
  const metadata = buildMetadata({
    repoRoot,
    startedAt,
    finishedAt,
    configuration: sharedConfiguration,
    dataCapVersion: packageJson.version,
  })
  const benchmarkManifest = buildManifest("runtime", RUNTIME_BENCHMARKS)

  const output = { metadata, benchmarkManifest, results }
  await fs.writeFile(path.join(exampleRoot, "results.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8")
  await fs.writeFile(
    path.join(exampleRoot, "RESULTS.md"),
    renderResultsMarkdown(output, "Runtime performance results"),
    "utf8",
  )

  console.log(`\n[performance-runtime] wrote results.json and RESULTS.md`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
