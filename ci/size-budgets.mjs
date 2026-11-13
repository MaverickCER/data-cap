// Gzip budgets for the unminified ESM build of every entry point. This file is CI tooling and is
// not published.
//
// The isomorphic entries (core, runtime, runtime/cache, runtime/retry, helpers, observe) ship to
// consumers, so their budgets are tight. `evidence` (not small) and `node` (not isomorphic) are
// budgeted near their current size, so growth needs a reviewed diff here.
// The build tooling, the ESLint plugin and the CLI run only in Node at development time. Their
// 999 KB ceiling only catches runaway growth. `compiler-isolation` keeps the bundled compiler out of
// the runtime entries; nothing else checks that their code stays out of the runtime bundles.

// Read by `internal-package-contract tool size`: one budget per entry point, in gzip bytes.
export default [
  { label: "core", file: "dist/index.js", maxGzipBytes: 2 * 1024 },
  // Raised from 4KB alongside ADR 0048's `createData`, the operations layer: getter/mutator/subscription
  // execution, dedup identity, optimistic lifecycle, runGetters and bounded per-operation state. It was a
  // deliberate, measured increase for new primary-API functionality in this entry point. `createData` stays
  // in this entry, not a separate tree-shaken sub-path, because it is the first thing most consumers reach
  // for. `runtime/cache` and `runtime/retry` are separate because most capabilities never touch them.
  // Raised from 6KB to 8KB when minification became forbidden (internal-package-contract's
  // NoMinify check). The budget was calibrated on minified output, and the same code unminified
  // gzips to about 6.9KB. A one-time recalibration to the new baseline, not unexamined growth.
  { label: "runtime", file: "dist/runtime/index.js", maxGzipBytes: 8 * 1024 },
  { label: "runtime/cache", file: "dist/runtime/cache.js", maxGzipBytes: 1 * 1024 },
  { label: "runtime/retry", file: "dist/runtime/retry.js", maxGzipBytes: 2 * 1024 },
  { label: "helpers", file: "dist/helpers.js", maxGzipBytes: 3 * 1024 },
  // The runtime-observation recorder (ADR 0072) ships into the consumer's application, so it is budgeted
  // like the other isomorphic entries. It is a few small functions with no dependencies. Raised from 1KB to 2KB
  // when the auto-walker (observeValue) and the instrumentation helpers joined the recorder. Raised to 2.5KB
  // (about 2.1KB used) when response observation (observeResponse), path-level claims and the truncation signal
  // joined. It is still dependency-free.
  { label: "observe", file: "dist/observe.js", maxGzipBytes: 2.5 * 1024 },
  // The evidence entry is isomorphic but not small. It carries the flow views and the seven standards
  // adapters (SARIF, OSCAL, CycloneDX, PROV, OTLP, DOT, Mermaid), about 26KB gzip when this budget was set.
  // Budgeted so a dependency or a duplicated adapter cannot slip in unnoticed. It never ships to a browser
  // bundle unless an application imports it there on purpose.
  { label: "evidence", file: "dist/evidence.js", maxGzipBytes: 32 * 1024 },
  // A thin Node adapter (about 0.3KB gzip): the budget guards against it growing into a second runtime.
  { label: "node", file: "dist/node.js", maxGzipBytes: 1 * 1024 },
  { label: "build", file: "dist/build.js", maxGzipBytes: 999 * 1024 },
  { label: "eslint-plugin", file: "dist/eslint-plugin/index.js", maxGzipBytes: 999 * 1024 },
  { label: "cli", file: "dist/cli/index.js", maxGzipBytes: 999 * 1024 },
]
