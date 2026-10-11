// @ts-check
/**
 * Stryker config for data-cap. Extends the shared baseline
 * (`internal-package-contract/config/stryker`), which sets the test runner, reporters, per-test
 * coverage, static-mutant handling and the single worker, with what is data-cap's own.
 *
 * The mutation-score threshold is NOT set here -- the `Mutation` check owns the policy
 * (zero tolerance: every non-ignored mutant must be killed, or carry an exception record in
 * `.repo-contract/exceptions/mutation.json`) and reads the JSON report directly.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
import baseline from "internal-package-contract/config/stryker"

export default {
  ...baseline,
  // Limited to `src/`: matching `test/` too would prepend `// @ts-nocheck` to every fixture source
  // file and shift the line numbers the goldens pin.
  disableTypeChecks: "src/**/*.ts",
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
  timeoutMS: 20_000,
  // The initial un-mutated run re-executes the whole suite once with coverage hooks; under load
  // that one pass can exceed Stryker's 5-minute default and abort before any mutant runs.
  dryRunTimeoutMinutes: 10,
}
