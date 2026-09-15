import { readFileSync } from "node:fs"
import { defineConfig } from "vitest/config"

// Mirrors tsup.config.ts's `define`: tests run against `src/` directly, not
// the bundle, so `__PACKAGE_VERSION__` (a build-time constant, see ADR 0058)
// must be substituted here too.
const packageVersion: string = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string
  }
).version

export default defineConfig({
  define: { __PACKAGE_VERSION__: JSON.stringify(packageVersion) },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Bun/Deno's own native test runners execute these (see the
    // `cross-runtime` CI job) -- they import `bun:test`/reference the global
    // `Deno` namespace, neither of which exists under Node/vitest.
    exclude: ["test/cross-runtime/**", "**/node_modules/**"],
    watch: false,
    // Several integration/example tests spawn real subprocesses (npm pack +
    // install, a spawned CLI, a full ts-json-schema-generator program). Those
    // clear vitest's 5000ms default easily in isolation but blow past it under
    // full-suite parallel resource contention -- raised globally rather than
    // patched file-by-file, since which one trips depends on what else is
    // running. Matches env-cap's own vitest.config.ts.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Pure type-only files (interfaces/type aliases, no runtime code) --
      // zero coverable statements. Excluding them is the accurate
      // reflection, not a loophole -- see each module's own doc comment.
      // `src/build/types.ts` is the `BuildFileSystem` capability contract
      // (ADR 0058) -- pure type declarations, zero coverable statements.
      exclude: [
        "src/core/types.ts",
        "src/build/findings.ts",
        "src/build/dependency-types.ts",
        "src/build/types.ts",
      ],
      // "json" (not just "json-summary") is load-bearing: it's what actually
      // writes coverage/coverage-final.json, the per-file raw coverage data
      // internal-package-contract's Crap check hands to `crap4ts --coverage`.
      // Without it, Crap can't tell "genuinely no coverage produced" apart
      // from "Tests failed" and warns with a misleading message either way.
      // Same fix as env-cap's identical gap.
      reporter: ["text", "html", "lcov", "json", "json-summary"],
      // Starting floor, matching env-cap's own ratchet-up-only policy (see
      // CONTRIBUTING.md) -- raised as real coverage improves, never lowered
      // to accommodate a drop.
      thresholds: {
        branches: 90,
        functions: 100,
        lines: 95,
        statements: 95,
      },
    },
  },
})
