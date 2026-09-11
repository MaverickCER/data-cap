// Assembles results.json's `metadata` field in a fixed key order
// (environment -> package -> configuration -> timing -> generation ->
// versions -> git -> generatedBy) so diffs between runs stay stable.

import { collectEnvironmentInfo, collectGitInfo, collectProvenance } from "./hardware-info.mjs"
import { collectPackageSize } from "./package-size.mjs"
import { FIXTURE_SEED, GENERATOR_VERSION } from "./generator.mjs"
import { BENCHMARK_SUITE_VERSION } from "./scenarios.mjs"

export const BENCHMARK_SCHEMA_VERSION = 1
export const BENCHMARK_TOOL_VERSION = "1.0.0"

export function buildMetadata({ repoRoot, startedAt, finishedAt, configuration, dataCapVersion }) {
  return {
    environment: collectEnvironmentInfo(),
    package: collectPackageSize(repoRoot),
    configuration,
    timing: {
      startedAtUtc: startedAt.toISOString(),
      finishedAtUtc: finishedAt.toISOString(),
      totalSuiteDurationMs: finishedAt.getTime() - startedAt.getTime(),
    },
    generation: { fixtureSeed: FIXTURE_SEED, generatorVersion: GENERATOR_VERSION },
    versions: {
      benchmarkSchemaVersion: BENCHMARK_SCHEMA_VERSION,
      benchmarkSuiteVersion: BENCHMARK_SUITE_VERSION,
      benchmarkToolVersion: BENCHMARK_TOOL_VERSION,
      dataCapVersion,
    },
    git: collectGitInfo(repoRoot),
    generatedBy: collectProvenance().generatedBy,
  }
}
