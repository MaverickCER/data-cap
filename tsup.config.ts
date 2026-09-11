import { readFileSync } from "node:fs"
import { defineConfig } from "tsup"

// See env-cap's tsup.config.ts for the full rationale (this package follows
// the same convention): `minifyWhitespace` only -- strips comments/whitespace
// but leaves every identifier intact, so dist/*.js stack traces still read
// like the source. `dts: false` because declarations (with working
// declaration maps) are emitted separately by `tsc -p tsconfig.build.json`
// and shimmed into place by scripts/emit-dts-shims.mjs -- tsup's own dts
// pipeline can't produce declaration maps.
const esbuildOptions = (options: { minifyWhitespace?: boolean }): void => {
  options.minifyWhitespace = true
}

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

export default defineConfig([
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
    esbuildOptions,
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
    esbuildOptions,
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
    esbuildOptions,
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
    esbuildOptions,
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
    esbuildOptions,
  },
  {
    name: "build",
    entry: { build: "src/build/index.ts" },
    format: ["esm", "cjs"],
    // Node-only, dev/CI-only -- uses node:path and the `typescript` compiler
    // API, unlike every other entry above. It does NOT import `node:fs`: since
    // ADR 0058 the caller supplies a `BuildFileSystem` capability.
    platform: "node",
    target: "node18",
    dts: false,
    sourcemap: true,
    treeshake: true,
    define: versionDefine,
    esbuildOptions,
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
    target: "node18",
    dts: false,
    sourcemap: true,
    treeshake: true,
    esbuildOptions,
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
    esbuildOptions,
  },
  {
    name: "eslint-plugin",
    entry: { "eslint-plugin/index": "src/eslint-plugin/index.ts" },
    format: ["esm", "cjs"],
    // An ESLint rule runs inside ESLint's own Node process, never a browser.
    platform: "node",
    target: "node18",
    dts: false,
    sourcemap: true,
    treeshake: true,
    esbuildOptions,
    // `@typescript-eslint/utils` internally does a dynamic `require("eslint")`
    // for its FlatESLint/ESLint wrapper types, which esbuild's ESM output
    // can't satisfy for a bundled dependency -- external keeps both as real
    // runtime imports instead (both are already peerDependencies).
    external: ["eslint", "typescript"],
  },
  {
    name: "cli",
    entry: { "cli/index": "src/cli/index.ts" },
    // ESM only -- package.json's "type": "module" plus a shebang banner
    // makes this directly executable via npm's `bin` symlink; no CJS
    // consumer needs to `require()` a CLI entry point.
    format: ["esm"],
    platform: "node",
    target: "node18",
    dts: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
    define: versionDefine,
    esbuildOptions,
  },
])
