import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import eslintConfigPrettier from "eslint-config-prettier/flat"

/**
 * Scoped to this package's own source (src/, test/) plus root-level
 * build/CI/benchmark scripts, matching tsconfig.json's own include list.
 * examples/ is a self-contained set of npm projects with their own tooling
 * (several with fixture files whose ESLint "violations" are the point, not
 * real issues) and is intentionally not linted here, same rationale
 * env-cap uses. Each `test/integration/<category>/<name>/` fixture is the
 * same kind of self-contained npm project (relocated out of `examples/`,
 * see examples/README.md) and gets the same treatment -- only the flat
 * `<category>/<name>.test.ts` wrapper one level up is linted here.
 * `benchmarks/performance-runtime/` and `benchmarks/performance-buildtime/`
 * are the same kind of self-contained npm project too (each its own
 * `package.json` depending on `@maverickcer/data-cap` via `file:../..`,
 * installed by its own `npm install`, never the root `npm ci`) -- only
 * `benchmarks/benchmark-fixtures/` and the top-level orchestration scripts
 * directly under `benchmarks/` are linted here, same rationale env-cap
 * uses for its own `benchmark/performance-runtime`/`performance-buildtime`.
 */
export default tseslint.config(
  {
    // test/cross-runtime/**: Bun's own native test runner (bun:test) and
    // Deno's global `Deno` namespace execute these -- neither is part of
    // this project's Node-targeted tsconfig, and each runtime does its own
    // type-checking (or deliberately skips it -- see deno.test.ts) when
    // actually running the file.
    ignores: [
      "dist",
      "coverage",
      "node_modules",
      "**/node_modules",
      "test/cross-runtime",
      "examples",
      "benchmarks/performance-runtime",
      "benchmarks/performance-buildtime",
      // Explicit, not a `*/*/*` glob: ESLint's flat-config nested-config
      // auto-discovery (each package in a tree may carry its own
      // eslint.config.js) still descends into and loads a fixture's own
      // eslint.config.js during traversal if the ignore pattern only
      // matches *contents* of the fixture directory rather than the
      // directory path itself -- and loading it fails, since these
      // fixtures' own node_modules aren't installed by the root `npm ci`.
      // A literal directory path (same as the bare "examples" entry above)
      // prunes traversal before that discovery step ever runs.
      "test/integration/runtime-core/basic-standalone",
      "test/integration/runtime-core/server-database-integration",
      "test/integration/runtime-core/optimistic-mutation-concurrency",
      "test/integration/runtime-core/array-identity-reconciliation",
      "test/integration/subscriptions/subscription-lifecycle",
      "test/integration/subscriptions/subscription-with-recover",
      "test/integration/subscriptions/multi-capability-shared-transport",
      "test/integration/subscriptions/socket-io-subscription",
      "test/integration/coordinator/coordinator-dedup",
      "test/integration/coordinator/coordinator-isolation",
      "test/integration/runtime-modules/runtime-cache",
      "test/integration/runtime-modules/runtime-retry",
      "test/integration/adoption-patterns/tanstack-query-integration",
      "test/integration/build-tooling/tsconfig-aliases",
      "test/integration/build-tooling/tsconfig-aliases-consumer",
      "test/integration/build-tooling/eslint-plugin-usage",
    ],
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Encodes ADR "build tooling is static-analysis-only" as something CI
      // enforces, not just documents -- once src/build/ exists it must never
      // gain a dynamic-execution code path for discovered schema files. On
      // from day one so the rule can't be silently dropped when that phase
      // lands.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      // TypeScript's own compiler already catches genuinely undefined
      // identifiers, more accurately than this base rule.
      "no-undef": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // ADR 0058: every library surface (`.`, `./helpers`, `./runtime`,
    // `./build`, `./evidence`) must not acquire a filesystem capability
    // implicitly -- `./build` accepts a `BuildFileSystem` from its caller
    // instead. Only `src/cli/**` (the executable capability boundary that
    // constructs the `node:fs/promises` adapter) may import `node:fs`. The
    // published `@maverickcer/data-cap/eslint-plugin` ships `no-node-fs` for
    // a consumer to enforce the same discipline; this `no-restricted-imports`
    // block is data-cap's own, needing no plugin build.
    // `scripts/verify-no-ambient-fs.mjs` is the release-blocking backstop
    // that checks the actual tarball.
    files: ["src/**/*.ts"],
    ignores: ["src/cli/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["fs", "node:fs", "fs/promises", "node:fs/promises"].map((name) => ({
            name,
            message:
              "ADR 0058: a library surface must not import node:fs. Accept a BuildFileSystem capability from the caller (see src/build/types.ts). Only src/cli/** may import node:fs.",
          })),
        },
      ],
    },
  },
  {
    // Every coercion here exists specifically to turn a raw `unknown` value
    // into a target type -- `String(value)` is the deliberate, correct way
    // to do that (well-defined for every JS value, unlike a bare template
    // literal). The rule can't know these `unknown`s are never a
    // plain-object-without-toString in practice; it's flagging the exact
    // pattern this file exists to implement (mirrors env-cap's identical
    // override for its own helpers/processors.ts).
    files: ["src/helpers/processors.ts"],
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "benchmarks/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      parserOptions: { sourceType: "module" },
      globals: globals.node,
    },
  },
  {
    // Root-level config files aren't part of tsconfig.json's `include`, so
    // these get syntax-only TS linting -- no `projectService`, hence no
    // type-aware rules -- rather than failing to resolve a TS project.
    files: ["*.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  // Last on purpose -- turns off every core/stylistic rule that would
  // otherwise fight Prettier's own formatting decisions.
  eslintConfigPrettier,
)
