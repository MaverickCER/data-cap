#!/usr/bin/env node
// Extracts a compact entry from a fresh results.json and appends it to
// benchmarks/history/<name>.json. Called only by the benchmark-main CI job
// (.github/workflows/benchmarks.yml), in the same step that stages
// results.json/RESULTS.md for the bot PR -- never by a local `npm run
// benchmark`, never by the PR job. See benchmarks/README.md.
//
// Usage: node benchmarks/append-benchmark-history.mjs <results.json> <history.json>

import fs from "node:fs/promises"
import path from "node:path"

function primaryMedianMs(entry) {
  if (entry.totalMs?.medianMs !== undefined) return entry.totalMs.medianMs
  if (
    entry.durationMs &&
    typeof entry.durationMs === "object" &&
    entry.durationMs.medianMs !== undefined
  )
    return entry.durationMs.medianMs
  return undefined
}

async function main() {
  const [, , resultsPath, historyPath] = process.argv
  if (!resultsPath || !historyPath) {
    console.error(
      "Usage: node benchmarks/append-benchmark-history.mjs <results.json> <history.json>",
    )
    process.exitCode = 1
    return
  }

  const results = JSON.parse(await fs.readFile(resultsPath, "utf8"))

  let history
  try {
    history = JSON.parse(await fs.readFile(historyPath, "utf8"))
  } catch {
    history = { historySchemaVersion: 1, entries: [] }
  }

  // Intentionally compact: medianMs per completed (name, tier), not the
  // full per-run detail (min/max/stdDev/memory/inputs) already reachable
  // via `gitCommit` in that commit's own results.json. Duplicating all of
  // it here would make this file grow unboundedly for no benefit.
  const measurements = {}
  for (const [name, benchmark] of Object.entries(results.results ?? {})) {
    for (const [tier, entry] of Object.entries(benchmark.tiers ?? {})) {
      if (entry.status !== "completed") continue
      const medianMs = primaryMedianMs(entry)
      if (medianMs === undefined) continue
      measurements[name] = measurements[name] ?? {}
      measurements[name][tier] = { medianMs }
    }
  }

  history.entries.push({
    timestamp: results.metadata.timing.finishedAtUtc,
    gitCommit: results.metadata.git.gitCommit,
    dataCapVersion: results.metadata.versions.dataCapVersion,
    benchmarkSuiteVersion: results.metadata.versions.benchmarkSuiteVersion,
    runner: results.metadata.environment.runner,
    measurements,
  })

  await fs.mkdir(path.dirname(historyPath), { recursive: true })
  await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8")
  console.log(
    `[append-benchmark-history] appended entry to ${historyPath} (${String(history.entries.length)} total)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
