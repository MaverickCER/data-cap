// @ts-check
/**
 * Stryker config for data-cap. Extends the shared baseline
 * (`internal-package-contract/config/stryker`) with data-cap-specific `mutate`
 * exclusions.
 *
 * The mutation-score threshold is NOT set here -- the `Mutation` check owns that
 * number (`MUTATION_THRESHOLD` in internal-package-contract) and reads the JSON
 * report directly. data-cap's own goal is 100% of tested mutants killed; the 80%
 * figure is the fleet floor, not the target.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  reporters: ["json", "clear-text", "progress"],
  // Per-test coverage: each mutant runs only the tests that cover it. "all"
  // (whole suite per mutant) is not viable -- several integration tests spawn
  // real `npm pack`/install and a ts-json-schema-generator program, so a full
  // run is tens of seconds and there are 1000+ mutants.
  coverageAnalysis: "perTest",
  // Static mutants (evaluated once at module load) cannot be attributed to a
  // covering test under "perTest", so Stryker re-runs the entire suite for
  // each -- the single largest contributor to wall time. Ignoring them trades
  // that for not mutating load-time-constant expressions.
  ignoreStatic: true,
  disableTypeChecks: "{src,test}/**/*.{ts,tsx}",
  mutate: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    // Type-only modules: interfaces / type aliases / `const`-asserted string
    // unions, zero runtime behavior to mutate meaningfully. Same list as
    // vitest.config.ts's coverage.exclude, same rationale (see each file's doc
    // comment).
    "!src/core/types.ts",
    "!src/build/findings.ts",
    "!src/build/dependency-types.ts",
  ],
  incremental: true,
  incrementalFile: "reports/mutation/stryker-incremental.json",
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
  concurrency: 4,
  timeoutMS: 20_000,
  // The initial un-mutated run re-executes the whole suite once with coverage
  // hooks; under load that one pass can exceed Stryker's 5-minute default and
  // abort before any mutant runs. 10 minutes is slack without masking a hang.
  dryRunTimeoutMinutes: 10,
}
