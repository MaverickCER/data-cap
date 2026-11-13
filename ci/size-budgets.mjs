// Lightweight, dependency-free bundle size budget check (Node builtins only --
// this is dev/CI tooling, not something that ships or runs at runtime).
//
// Guards the package's core promise: the isomorphic, consumer-facing entry
// points (core, runtime, runtime/cache, runtime/retry, helpers, observe) stay
// tiny, and the two that are not tiny (evidence) or not isomorphic (node) stay
// the size they are.
// Build tooling (`dist/build.js`), the eslint plugin
// (`dist/eslint-plugin/index.js`), and the CLI (`dist/cli/index.js`) are
// Node-only and dev-time-only by design, so they aren't meaningfully
// budgeted here (999KB is effectively "don't silently balloon," not a real
// constraint) -- they just need to stay isolated from the runtime/helpers
// bundles, which the tree-shaking tests already cover.

// Read by `internal-package-contract tool size`: one budget per entry point, in gzip bytes.
export default [
  { label: "core", file: "dist/index.js", maxGzipBytes: 2 * 1024 },
  // Raised from 4KB alongside ADR 0048's `createData` (the batteries-
  // included operations layer: getter/mutator/subscription execution,
  // dedup identity, optimistic lifecycle, runGetters, bounded per-operation
  // state) -- a deliberate, measured increase for genuinely new primary-API
  // functionality in this same entry point, not unexamined growth. Kept as
  // one entry rather than a separate tree-shaken sub-path (unlike
  // `runtime/cache`/`runtime/retry`, which are optional add-ons most
  // capabilities never touch) because `createData` is meant to be the
  // first thing most consumers reach for, not an edge-case extra.
  // Raised from 6KB to 8KB when minification became forbidden (internal-package-contract's
  // NoMinify check): the budget was calibrated on minified output, and the same code unminified
  // gzips to about 6.9KB. A one-time recalibration to the new baseline, not unexamined growth.
  { label: "runtime", file: "dist/runtime/index.js", maxGzipBytes: 8 * 1024 },
  { label: "runtime/cache", file: "dist/runtime/cache.js", maxGzipBytes: 1 * 1024 },
  { label: "runtime/retry", file: "dist/runtime/retry.js", maxGzipBytes: 2 * 1024 },
  { label: "helpers", file: "dist/helpers.js", maxGzipBytes: 3 * 1024 },
  // The runtime-observation recorder (ADR 0072) ships into the consumer's application, so it is budgeted
  // like the other isomorphic entries. It is a few small functions with no dependencies. Raised from 1KB to 2KB
  // when the auto-walker (observeValue) and the instrumentation helpers joined the recorder, then to 2.5KB
  // (about 2.1KB used) when response observation (observeResponse), path-level claims and the truncation signal
  // joined; still dependency-free.
  { label: "observe", file: "dist/observe.js", maxGzipBytes: 2.5 * 1024 },
  // The evidence entry is isomorphic but not small: it carries the flow views and the seven standards
  // adapters (SARIF, OSCAL, CycloneDX, PROV, OTLP, DOT, Mermaid), about 26KB gzip when this budget was set.
  // Budgeted so a dependency or a duplicated adapter cannot slip in unnoticed; it never ships to a browser
  // bundle unless an application imports it there on purpose.
  { label: "evidence", file: "dist/evidence.js", maxGzipBytes: 32 * 1024 },
  // A thin Node adapter (about 0.3KB gzip): the budget guards against it growing into a second runtime.
  { label: "node", file: "dist/node.js", maxGzipBytes: 1 * 1024 },
  { label: "build", file: "dist/build.js", maxGzipBytes: 999 * 1024 },
  { label: "eslint-plugin", file: "dist/eslint-plugin/index.js", maxGzipBytes: 999 * 1024 },
  { label: "cli", file: "dist/cli/index.js", maxGzipBytes: 999 * 1024 },
]
