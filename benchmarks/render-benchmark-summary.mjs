#!/usr/bin/env node
// Diffs a "previous" and "current" results.json for each of the runtime and
// build-time examples, renders a Markdown summary. Highlights entries that
// exceed their budgets.mjs threshold; never gates, never fails.
//
// Usage:
//   node benchmarks/render-benchmark-summary.mjs <prev-runtime.json> <cur-runtime.json> <prev-buildtime.json> <cur-buildtime.json>
//
// Any missing/unreadable "previous" file (e.g. first-ever run) is treated as
// "no prior data" -- the summary still renders, just without a diff for that
// example. This script always exits 0: it renders findings for a human (or
// a PR comment) to read, it never decides pass/fail.

import { readFileSync } from "node:fs"
import { BUDGETS } from "./benchmark-fixtures/budgets.mjs"

const MARKER = "<!-- data-cap-benchmark-summary -->"

function tryReadJson(filePath) {
  if (!filePath) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

/** Finds the first `medianMs`-bearing field on an entry, for a simple regression-percent story. Not every benchmark shape has one -- those are reported without a percent. */
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

function collectEntries(results) {
  const entries = []
  if (!results?.results) return entries
  for (const [name, benchmark] of Object.entries(results.results)) {
    for (const [tier, entry] of Object.entries(benchmark.tiers ?? {})) {
      entries.push({ name, tier, entry })
    }
  }
  return entries
}

function renderExample(label, previous, current) {
  const lines = [`## ${label}`, ""]

  if (!current) {
    lines.push("_No current results found._", "")
    return lines.join("\n")
  }

  // `previous` is `{}` (truthy, but no real metadata), never `null`, on a
  // first-ever run -- CI's `git show ... || echo '{}'` fallback (see
  // .github/workflows/benchmarks.yml). Guarded on `previous.metadata` being
  // present, not just `previous` being truthy, so a first run reports
  // "no prior data" (via the empty previousByKey map below) instead of a
  // confusing "previous run used sundefined" mismatch warning.
  if (
    previous?.metadata &&
    previous.metadata.versions?.benchmarkSuiteVersion !==
      current.metadata?.versions?.benchmarkSuiteVersion
  ) {
    lines.push(
      `> ⚠️ **Suite version mismatch**: previous run used \`s${previous.metadata?.versions?.benchmarkSuiteVersion}\`, ` +
        `current run used \`s${current.metadata?.versions?.benchmarkSuiteVersion}\`. Numbers below are not directly comparable -- see benchmarks/README.md's "never compare" rule.`,
      "",
    )
  }

  const currentEntries = collectEntries(current)
  const previousByKey = new Map(
    collectEntries(previous ?? {}).map((e) => [`${e.name}.${e.tier}`, e.entry]),
  )

  const notCompleted = currentEntries.filter((e) => e.entry.status !== "completed")
  if (notCompleted.length > 0) {
    lines.push("**Failed / skipped:**", "")
    for (const { name, tier, entry } of notCompleted) {
      lines.push(
        `- \`${name}.${tier}\`: ${entry.status}${entry.reason ? ` (${entry.reason})` : ""}${entry.error ? ` (${entry.error.name}: ${entry.error.message})` : ""}`,
      )
    }
    lines.push("")
  }

  lines.push("| Benchmark | Tier | Median | Change | Budget |", "|---|---|---|---|---|")
  const highlights = []
  for (const { name, tier, entry } of currentEntries) {
    if (entry.status !== "completed") continue
    const medianMs = primaryMedianMs(entry)
    const previousEntry = previousByKey.get(`${name}.${tier}`)
    const previousMedianMs =
      previousEntry && previousEntry.status === "completed"
        ? primaryMedianMs(previousEntry)
        : undefined

    let changeCell = "—"
    let changePercent
    if (medianMs !== undefined && previousMedianMs !== undefined && previousMedianMs > 0) {
      changePercent = ((medianMs - previousMedianMs) / previousMedianMs) * 100
      changeCell = `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}%`
    }

    const budget = BUDGETS[name]
    const budgetCell = budget ? `${budget.maxRegressionPercent}%` : "(unbudgeted)"
    if (budget && changePercent !== undefined && changePercent > budget.maxRegressionPercent) {
      highlights.push({ name, tier, changePercent, budget: budget.maxRegressionPercent })
    }

    lines.push(
      `| \`${name}\` | ${tier} | ${medianMs !== undefined ? medianMs.toFixed(2) + "ms" : "—"} | ${changeCell} | ${budgetCell} |`,
    )
  }
  lines.push("")

  if (highlights.length > 0) {
    lines.push("**Exceeds budget:**", "")
    for (const h of highlights) {
      lines.push(
        `- ⚠️ \`${h.name}.${h.tier}\` +${h.changePercent.toFixed(1)}% (budget: ${h.budget}%) — human review suggested.`,
      )
    }
    lines.push("")
  }

  return lines.join("\n")
}

function main() {
  const [, , prevRuntimePath, curRuntimePath, prevBuildtimePath, curBuildtimePath] = process.argv

  const prevRuntime = tryReadJson(prevRuntimePath)
  const curRuntime = tryReadJson(curRuntimePath)
  const prevBuildtime = tryReadJson(prevBuildtimePath)
  const curBuildtime = tryReadJson(curBuildtimePath)

  const output = [
    MARKER,
    "",
    "# Benchmark summary",
    "",
    "Highlight-only -- nothing here gates a merge. See [benchmarks/README.md](../benchmarks/README.md) for methodology.",
    "",
    renderExample("Runtime (`benchmarks/performance-runtime`)", prevRuntime, curRuntime),
    renderExample("Build-time (`benchmarks/performance-buildtime`)", prevBuildtime, curBuildtime),
  ]

  process.stdout.write(output.join("\n") + "\n")
}

main()
