// Build-time benchmark orchestrator -- `npm run benchmark` from this
// directory, or via ../../run-benchmarks.mjs (benchmarks/run-benchmarks.mjs)
// from the repo root. Writes results.json (immutable, measurement-only) and
// RESULTS.md.
//
// Only measures. Never reads a previous results.json, never computes a
// diff, never decides what's a regression -- that's
// ../../render-benchmark-summary.mjs's job, run separately by CI.
//
// Imports data-cap's build tooling via its PACKAGE NAME
// (`data-cap/build`), resolved through this directory's own
// `node_modules` (a `file:../..` dependency, installed by `npm install`
// here) -- the "full package" benchmark, exercising the real published
// `./build` entry point a real consumer's `npm install` would resolve, not
// a monorepo-relative `../../dist/build.js` shortcut. Requires
// `npm run build --prefix ../..` first -- `generateDataArtifacts`'s parsing
// needs a real built `dist/` to run against, the same as any real consumer.

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { discoverCapabilityFiles, generateDataArtifacts } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"

import { generateBuildtimeFixtures } from "../../benchmark-fixtures/generator.mjs"
import { hashFixtureTree } from "../../benchmark-fixtures/fixture-hash.mjs"
import { buildMetadata } from "../../benchmark-fixtures/metadata.mjs"
import { adaptiveSample, computeDurationStats } from "../../benchmark-fixtures/measure.mjs"
import {
  benchmarkId,
  buildManifest,
  BUILDTIME_BENCHMARKS,
  BUILDTIME_FILE_TIERS,
  TIER_NAMES,
} from "../../benchmark-fixtures/scenarios.mjs"
import { renderResultsMarkdown } from "../../benchmark-fixtures/render-results-markdown.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const exampleRoot = path.resolve(here, "..")
const repoRoot = path.resolve(exampleRoot, "..", "..")
const fixturesRoot = path.join(exampleRoot, "fixtures", "generated")

const SAMPLE_OPTS = {
  baseline: { warmupIterations: 2, targetDurationMs: 1500, minIterations: 5, maxIterations: 20 },
  stress: { warmupIterations: 1, targetDurationMs: 2000, minIterations: 5, maxIterations: 10 },
  extreme: { warmupIterations: 1, targetDurationMs: 3000, minIterations: 3, maxIterations: 6 },
}

function completed(id, fields) {
  return { id, status: "completed", ...fields }
}

async function prepareTierFixtures(tierName) {
  const { files } = BUILDTIME_FILE_TIERS[tierName]
  const discoveryRoot = path.join(fixturesRoot, tierName, "capabilities")
  const artifactsOutputDir = path.join(fixturesRoot, tierName, "artifacts-output")

  const genStart = performance.now()
  const generated = await generateBuildtimeFixtures({ tierName, count: files, outputDir: discoveryRoot })
  const fixtureGenerationMs = performance.now() - genStart
  const fixtureHash = await hashFixtureTree(discoveryRoot)

  await fs.rm(artifactsOutputDir, { recursive: true, force: true })
  await fs.mkdir(artifactsOutputDir, { recursive: true })

  return { discoveryRoot, artifactsOutputDir, generated, fixtureGenerationMs, fixtureHash }
}

async function runDiscoveryTier(tierName, definitionVersion) {
  const { discoveryRoot, generated, fixtureGenerationMs, fixtureHash } = await prepareTierFixtures(tierName)

  const { samples, configuration } = await adaptiveSample(async () => {
    const t0 = performance.now()
    const files = await discoverCapabilityFiles({ root: discoveryRoot, fs: nodeBuildFileSystem })
    const elapsed = performance.now() - t0
    return { elapsed, fileCount: files.length }
  }, SAMPLE_OPTS[tierName])

  return {
    entry: completed(benchmarkId("buildtime", "discovery", tierName, definitionVersion), {
      inputs: { capabilities: generated.capabilities },
      fixtureHash,
      fixtureGenerationMs: Math.round(fixtureGenerationMs),
      durationMs: computeDurationStats(
        samples.map((s) => s.elapsed),
        configuration.warmupIterations,
      ),
    }),
    configuration,
  }
}

async function runArtifactsTier(tierName, definitionVersion) {
  const { discoveryRoot, artifactsOutputDir, generated, fixtureGenerationMs, fixtureHash } =
    await prepareTierFixtures(tierName)

  const { samples, configuration } = await adaptiveSample(async () => {
    const t0 = performance.now()
    await generateDataArtifacts({
      root: discoveryRoot,
      fs: nodeBuildFileSystem,
      tsconfig: false,
      location: path.join(artifactsOutputDir, "data.manifest.ts"),
      docs: path.join(artifactsOutputDir, "DATA.md"),
      ownership: path.join(artifactsOutputDir, "OWNERSHIP.md"),
      flow: path.join(artifactsOutputDir, "flow"),
      evidence: path.join(artifactsOutputDir, "data.evidence.json"),
    })
    return performance.now() - t0
  }, SAMPLE_OPTS[tierName])

  return {
    entry: completed(benchmarkId("buildtime", "artifacts", tierName, definitionVersion), {
      inputs: { capabilities: generated.capabilities },
      fixtureHash,
      fixtureGenerationMs: Math.round(fixtureGenerationMs),
      durationMs: computeDurationStats(samples, configuration.warmupIterations),
    }),
    configuration,
  }
}

async function main() {
  const startedAt = new Date()
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"))

  const results = { discovery: { tiers: {} }, artifacts: { tiers: {} } }
  let sharedConfiguration

  const discoveryDef = BUILDTIME_BENCHMARKS.discovery
  for (const tier of discoveryDef.tiers) {
    console.log(`[performance-buildtime] discovery.${tier} ...`)
    const { entry, configuration } = await runDiscoveryTier(tier, discoveryDef.definitionVersion)
    results.discovery.tiers[tier] = entry
    sharedConfiguration = configuration
    console.log(
      `[performance-buildtime] discovery.${tier}: median ${entry.durationMs.medianMs.toFixed(2)}ms, n=${entry.durationMs.iterations}`,
    )
  }

  const artifactsDef = BUILDTIME_BENCHMARKS.artifacts
  for (const tier of artifactsDef.tiers) {
    console.log(`[performance-buildtime] artifacts.${tier} ...`)
    const { entry, configuration } = await runArtifactsTier(tier, artifactsDef.definitionVersion)
    results.artifacts.tiers[tier] = entry
    sharedConfiguration = configuration
    console.log(
      `[performance-buildtime] artifacts.${tier}: median ${entry.durationMs.medianMs.toFixed(2)}ms, n=${entry.durationMs.iterations}`,
    )
  }

  const finishedAt = new Date()
  const metadata = buildMetadata({
    repoRoot,
    startedAt,
    finishedAt,
    configuration: sharedConfiguration,
    dataCapVersion: packageJson.version,
  })
  const benchmarkManifest = buildManifest("buildtime", BUILDTIME_BENCHMARKS)

  const output = { metadata, benchmarkManifest, results }
  await fs.writeFile(path.join(exampleRoot, "results.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8")
  await fs.writeFile(
    path.join(exampleRoot, "RESULTS.md"),
    renderResultsMarkdown(output, "Build-time performance results"),
    "utf8",
  )

  console.log(`\n[performance-buildtime] wrote results.json and RESULTS.md`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
