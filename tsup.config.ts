import { readFileSync } from "node:fs"
import { defineConfig, type Options } from "tsup"

// Nothing here may minify: no `minify*` option, no esbuildOptions that sets one. Minified code is a
// Socket.dev supply-chain alert and internal-package-contract's NoMinify check fails the contract
// on it. The built output ships exactly as esbuild prints it, comments included.

// Read once, here, at build time -- NOT shipped in dist/. Substituted into
// `src/build/package-version.ts` and (transitively) `src/cli/json.ts` via
// `define` below, so neither reads `package.json` from disk at runtime. See
// ADR 0058.
const packageVersion: string = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string
  }
).version
const versionDefine = { __PACKAGE_VERSION__: JSON.stringify(packageVersion) }

const bundles: Options[] = [
  {
    name: "core",
    entry: { index: "src/core/index.ts" },
    format: ["esm", "cjs"],
    // Core has zero external runtime dependencies and never touches Node-only
    // APIs -- "neutral" keeps it honest: a bundler targeting core for a
    // browser/edge/worker build gets exactly this platform-agnostic output.
    platform: "neutral",
    // Matches tsconfig.json's target -- Object.hasOwn (ES2022) is load-bearing
    // for the ownership algorithm and has shipped natively since Node 18.
    target: "es2022",
    dts: false,
    sourcemap: true,
    // NOT `clean: true` here -- tsup's multi-entry-array execution order/
    // concurrency isn't a documented guarantee, and cleaning from inside one
    // of several entries risks a race against another entry's own writes.
    // `dist/` is cleaned once, deterministically, by `npm run clean` as an
    // explicit prior step in the `build` script instead.
    treeshake: true,
  },
  {
    name: "runtime",
    entry: { "runtime/index": "src/runtime/index.ts" },
    format: ["esm", "cjs"],
    platform: "neutral",
    target: "es2022",
    dts: false,
    sourcemap: true,
    treeshake: true,
  },
  {
    // Separate tsup entries (not just named exports) for cache/retry --
    // structural tree-shaking that doesn't depend on a consumer's bundler
    // being sophisticated enough to shake unused named exports (see ADR 29).
    name: "runtime-cache",
    entry: { "runtime/cache": "src/runtime/cache.ts" },
    format: ["esm", "cjs"],
    platform: "neutral",
    target: "es2022",
    dts: false,
    sourcemap: true,
    treeshake: true,
  },
  {
    name: "runtime-retry",
    entry: { "runtime/retry": "src/runtime/retry.ts" },
    format: ["esm", "cjs"],
    platform: "neutral",
    target: "es2022",
    dts: false,
    sourcemap: true,
    treeshake: true,
  },
  {
    name: "helpers",
    entry: { helpers: "src/helpers/index.ts" },
    format: ["esm", "cjs"],
    // helpers/processors.ts's `toBigInt`/`toURL`/`toRegExp` are the only
    // Node-adjacent-looking calls here, and all are real cross-platform
    // globals (BigInt/URL/RegExp) -- this entry is exactly as isomorphic as
    // core, so it gets the same "neutral" platform treatment.
    platform: "neutral",
    target: "es2022",
    dts: false,
    sourcemap: true,
    treeshake: true,
  },
  {
    name: "build",
    entry: { build: "src/build/index.ts" },
    format: ["esm", "cjs"],
    // Node-only, dev/CI-only -- uses node:path and the `typescript` compiler
    // API, unlike every other entry above. It does NOT import `node:fs`: since
    // ADR 0058 the caller supplies a `BuildFileSystem` capability.
    platform: "node",
    target: "node22",
    dts: false,
    sourcemap: true,
    treeshake: true,
    // `src/build/typescript.ts` resolves the compiler with `createRequire(import.meta.url)`; the
    // CJS output has no `import.meta`, so tsup's shim supplies the equivalent file URL there.
    shims: true,
    define: versionDefine,
  },
  {
    name: "node",
    // The `data-cap/node` entry -- the Node-backed
    // `BuildFileSystem` adapter (`src/cli/filesystem.ts`, re-exported through
    // `src/node/index.ts`). An executable-context entry like `bin` /
    // `./eslint-plugin`: it legitimately bundles `node:fs/promises`, and
    // `scripts/verify-no-ambient-fs.mjs` exempts its resolved target. See ADR 0058.
    entry: { node: "src/node/index.ts" },
    format: ["esm", "cjs"],
    platform: "node",
    target: "node22",
    dts: false,
    sourcemap: true,
    treeshake: true,
  },
  {
    name: "evidence",
    entry: { evidence: "src/evidence/index.ts" },
    format: ["esm", "cjs"],
    // Isomorphic by construction: `src/evidence/` imports `EvidenceModel`
    // with `import type` only (fully erased), so nothing from the Node-only
    // `build` entry -- not `node:fs`, not the TypeScript compiler API --
    // reaches this bundle. "neutral" is what keeps that honest.
    platform: "neutral",
    target: "es2022",
    dts: false,
    sourcemap: true,
    treeshake: true,
  },
  {
    name: "eslint-plugin",
    entry: { "eslint-plugin/index": "src/eslint-plugin/index.ts" },
    format: ["esm", "cjs"],
    // An ESLint rule runs inside ESLint's own Node process, never a browser.
    platform: "node",
    target: "node22",
    dts: false,
    sourcemap: true,
    treeshake: true,
    // `@typescript-eslint/utils` is an optional peer, NOT bundled (ADR 0068): a bundled copy is
    // invisible to a consumer's `npm audit`/Dependabot/Socket and frozen at build time. Anyone
    // linting TypeScript with ESLint already has it through `typescript-eslint`.
    external: ["eslint", "typescript", "@typescript-eslint/utils"],
  },
  {
    name: "cli",
    entry: { "cli/index": "src/cli/index.ts" },
    // ESM only -- package.json's "type": "module" plus a shebang banner
    // makes this directly executable via npm's `bin` symlink; no CJS
    // consumer needs to `require()` a CLI entry point.
    format: ["esm"],
    platform: "node",
    target: "node22",
    dts: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
    define: versionDefine,
  },
]

// Maps keep pointing at `src/` lines but no longer embed the full source text of every file: that
// text was about 60% of the unpacked package, and the sources are in the repository.
export default defineConfig(
  bundles.map((bundle) => ({
    ...bundle,
    esbuildOptions(options, context) {
      options.sourcesContent = false
      bundle.esbuildOptions?.(options, context)
    },
  })),
)
