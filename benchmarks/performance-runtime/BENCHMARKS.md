# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **640 records** per operation, routing the work through `data-cap` adds **666 µs** per operation compared with a bare-minimum baseline (1,889× baseline), about **$0.0014 – $0.019 per million operations** of compute. Overall, it grows O(log n) with workload size (measured exponent 0.56).

> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.

| Cost | Typical (640 records) | Largest (10240 records) |
| --- | --- | --- |
| Added latency per operation | 666 µs | 7.38 ms |
| Added latency, relative to baseline | 1,889× baseline | 20,395× baseline |
| Added CPU time per operation | 1.72 ms | 11.0 ms |
| Added memory per operation (heap delta) | 222.5 KiB | 3.1 MiB |
| Estimated compute cost per 1M operations | $0.0014 – $0.019 | $0.015 – $0.124 |
| Single-core throughput ceiling of the overhead alone | 1,502 ops/s | 135 ops/s |
| Shipped code parsed at every cold start (gzip) | 10.4 KiB | 10.4 KiB |

## 1. End-to-end: the package's total impact

Shows what an application pays per data fetch just for putting data-cap between its data source and its UI, compared with handling the same payload by hand. Both sides get the same pre-fetched records from a simulated instant source and both end with the records available to a reader; the only difference is data-cap's dispatch, deduplication, ownership checking, immutability and state bookkeeping. This is the floor: a real getter adds its own network or database time on top, which dwarfs this overhead in production but cannot be avoided by anything the application does.

- **Baseline (no package):** An async function returns n pre-generated records and the caller stores them in a plain object -- no data-cap.
- **With the package:** The same n records arrive through a data-cap getter (`createData`) and the caller reads the resulting snapshot: coordinator dedup registry, simulated async execute, ownership-checked commit, structural sharing and deep freeze of the new nodes.

Both sides use empty or minimal functions on purpose, so the difference is the package's own cost -- not the cost of the work an application would plug into it. Real applications add their own work on top; this is the floor the package imposes.

**Variables that could change this result**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| records per fetch | swept | The tier axis: how many records one getter call fetches and commits. |
| record shape | fixed at "7-field task record (strings, dates, a tag array)" | Records come from the deterministic generator in benchmark-fixtures/generator.mjs; wider or deeper records would raise the per-record cost. |
| runtime | fixed at "Node (V8)" | Measured on Node only. Bun, Deno, browsers and edge runtimes are not covered. |
| data source latency | fixed at "0 ms (simulated, instant)" | A real network or database call is far slower than anything measured here; it is excluded on purpose so the report shows data-cap's cost, not the network's. |
| concurrent identical calls | fixed at 1 | One caller. Concurrency is measured separately in the dedupe-fan-in functions below. |

The baseline is an empty or minimal function, so it costs almost nothing and the _relative_ overhead can look enormous (shown as a multiple of the baseline). Read the absolute columns -- time, CPU and dollars added -- they are what a bill and a latency budget are made of.

| records | Baseline | With package | Added | Added vs baseline | Added CPU | Est. $ / 1M ops |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 0.677 µs | 216 µs | 215 µs | 318× baseline | 222 µs | $0.00045 – $0.0025 |
| 40 | 0.434 µs | 236 µs | 236 µs | 545× baseline | 242 µs | $0.00049 – $0.0027 |
| 80 | 0.361 µs | 287 µs | 287 µs | 796× baseline | 955 µs | $0.0006 – $0.011 |
| 160 | 0.441 µs | 363 µs | 363 µs | 824× baseline | 1.39 ms | $0.00076 – $0.016 |
| 320 | 0.446 µs | 465 µs | 465 µs | 1,044× baseline | 1.52 ms | $0.00097 – $0.017 |
| 640 | 0.353 µs | 666 µs | 666 µs | 1,889× baseline | 1.72 ms | $0.0014 – $0.019 |
| 1280 | 0.357 µs | 1.08 ms | 1.08 ms | 3,017× baseline | 2.14 ms | $0.0022 – $0.024 |
| 2560 | 0.362 µs | 1.88 ms | 1.88 ms | 5,186× baseline | 2.91 ms | $0.0039 – $0.033 |
| 5120 | 0.359 µs | 3.42 ms | 3.42 ms | 9,522× baseline | 3.73 ms | $0.0071 – $0.042 |
| 10240 | 0.362 µs | 7.38 ms | 7.38 ms | 20,395× baseline | 11.0 ms | $0.015 – $0.124 |

**How the total grows:** O(log n) (logarithmic), exponent 0.56 over 10 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.

| Function | Documented | Measured | Agreement | At 640 | At 10240 |
| --- | --- | --- | --- | --- | --- |
| `createData (cold start)` | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildData` | O(n) | O(n) | ✅ matches | 1.69 ms | 27.7 ms |
| `commitAuthoritative (replace a whole array)` | O(n) | O(n) | ✅ matches | 580 µs | 6.51 ms |
| `commitAuthoritative (change one small field)` | O(1) | O(1) | ✅ matches | 3.07 µs | 3.08 µs |
| `reconcileArrayInfo` | O(n) | O(n) | ✅ matches | 267 µs | 4.85 ms |
| `getter dispatch (one full round trip)` | O(n) | O(log n) | 🟡 close (neighbouring class) | 702 µs | 8.05 ms |
| `canonicalize (request key)` | O(n log n) | O(n) | 🟡 close (neighbouring class) | 151 µs | 2.34 ms |
| `coordinator dedup (identical concurrent calls)` (identical) | O(n) | O(n) | ✅ matches | 8.02 ms | 83.1 ms |
| `coordinator dedup (identical concurrent calls)` (independent) | O(n) | O(n) | ✅ matches | 7.52 ms | 83.6 ms |
| `runGetters (one call, many getters)` | O(n²) | O(n²) | ✅ matches | 243 ms | 128 s |
| `createDataCache (set then get)` | O(1) | O(log n) | 🟡 close (neighbouring class) | 23.2 µs | 26.5 µs |
| `withRetry` | O(n) | O(n) | ✅ matches | 90.6 ms (at 80) | 90.6 ms (at 80) |

### `createData (cold start)`

**Why we benchmark it.** Every process that imports capability modules pays this before serving its first request: a deploy, a serverless cold start, a CLI invocation or a test run. It is the cost of adopting data-cap at the moment it hurts most, and it recurs on every scale-up.

**What poor performance would mean.** Slower deploys, longer first-request latency on every new instance, and (on serverless platforms) a cold-start penalty billed on every scale-from-zero event. A quadratic regression would make large applications visibly slow to boot.

**Expected growth: O(n).** Each capability module evaluates one `createData` call, which builds its schema, registers its operations and allocates its store independently of every other capability, so total boot time is the process start-up floor plus a constant amount of work per capability.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capabilities imported | swept | The tier axis: how many `createData`-declaring modules the process imports. |
| process start-up floor | fixed at "one fresh Node process per sample" | Every sample spawns a new process, so Node's own start-up time is included and sets the flat floor of the curve. |
| processor/validator cost | fixed at "identity processors, no validators" | Application-supplied processors belong to the application; the fixtures use trivial ones so a regression here is data-cap's. |
| runtime | fixed at "Node (V8)" | Measured on Node only. Bun, Deno, browsers and edge runtimes are not covered. |

**Deliberately not covered**

- **warm module cache** -- A cold process is the point of this benchmark; a warm cache cannot exist in a fresh process.
- **bundled vs unbundled loading** -- Measured unbundled through Node's native ESM loader; bundlers change module-evaluation cost and are application-specific.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n20/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 40 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n40/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 80 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n80/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 160 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n160/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 320 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n320/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 640 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n640/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 1280 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n1280/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 2560 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n2560/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 5120 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n5120/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |
| 10240 | ❌ Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n10240/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3
 |  |  |  |  |

### `buildData`

**Why we benchmark it.** Builds the initial immutable state from a schema; every capability and every store creation calls it, so it sits inside cold start and inside every test that creates a store.

**What poor performance would mean.** Slower boot and slower tests; for an application that creates stores per request or per component, the cost lands on the hot path.

**Expected growth: O(n).** It walks the schema's initial field values once to freeze and index them, so its cost follows the number of initial records.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| initial records | swept | How many records the schema's collection field starts with. |
| record shape | fixed at "7-field task record (strings, dates, a tag array)" | Records come from the deterministic generator in benchmark-fixtures/generator.mjs; wider or deeper records would raise the per-record cost. |
| field count | fixed at 7 | A typical table-view capability declares around seven fields; more fields add proportionally. |

**Deliberately not covered**

- **schemas with validators** -- Validators are application code; their cost belongs to the application.

**Measured: O(n)** (exponent 0.93, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 98.1 µs | 221 µs | 375 µs | 138.6 KiB | 10,191 |
| 40 | 133 µs | 204 µs | 351 µs | 268.6 KiB | 7,500 |
| 80 | 231 µs | 332 µs | 500 µs | 528.7 KiB | 4,320 |
| 160 | 467 µs | 631 µs | 1.00 ms | 1.0 MiB | 2,142 |
| 320 | 836 µs | 1.39 ms | 1.62 ms | 2.0 MiB | 1,196 |
| 640 | 1.69 ms | 2.04 ms | 3.29 ms | 4.1 MiB | 593 |
| 1280 | 3.17 ms | 3.54 ms | 4.97 ms | 8.2 MiB | 316 |
| 2560 | 6.73 ms | 7.14 ms | 9.82 ms | 1.4 MiB | 149 |
| 5120 | 14.2 ms | 17.2 ms | 20.9 ms | 3.5 MiB | 70 |
| 10240 | 27.7 ms | 28.5 ms | 39.8 ms | 7.6 MiB | 36 |

### `commitAuthoritative (replace a whole array)`

**Why we benchmark it.** Every successful getter ends here: the fetched collection is committed into state. It runs once per fetch for every capability in the application, so it is the dominant steady-state cost of reading data.

**What poor performance would mean.** Every fetch gets slower in proportion to its size; at thousands of records a regression turns a page load into a visible stall and raises server CPU per request. A quadratic bug would make large lists unusable.

**Expected growth: O(n).** Committing a new array replaces the field and deep-freezes every newly arrived record exactly once (`deepFreezeNewNodes`), so the work is proportional to the number of new records.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| records per fetch | swept | The tier axis: how many records one getter call fetches and commits. |
| record shape | fixed at "7-field task record (strings, dates, a tag array)" | Records come from the deterministic generator in benchmark-fixtures/generator.mjs; wider or deeper records would raise the per-record cost. |
| existing state size | fixed at "empty collection" | The store starts with an empty collection, so no reconciliation against old records is included; that is measured in reconcile-array-info. |
| reference reuse | fixed at "always new references" | Each sample commits freshly built records; committing the same reference again is a free no-op by design and is not what this measures. |

**Deliberately not covered**

- **commits that fail ownership checks** -- A rejected commit stops early and is not a steady-state cost.

**In the end-to-end run:** One commit per fetch.

**Measured: O(n)** (exponent 0.78, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 48.8 µs | 71.7 µs | 54.0 µs | 10.3 KiB | 20,487 |
| 40 | 73.1 µs | 96.8 µs | 77.0 µs | 16.4 KiB | 13,683 |
| 80 | 124 µs | 145 µs | 128 µs | 28.9 KiB | 8,042 |
| 160 | 217 µs | 248 µs | 220 µs | 53.9 KiB | 4,609 |
| 320 | 380 µs | 437 µs | 1.46 ms | 103.9 KiB | 2,635 |
| 640 | 580 µs | 799 µs | 1.67 ms | 203.9 KiB | 1,724 |
| 1280 | 986 µs | 1.59 ms | 2.10 ms | 403.9 KiB | 1,014 |
| 2560 | 1.79 ms | 3.18 ms | 2.93 ms | 804.0 KiB | 559 |
| 5120 | 3.29 ms | 3.40 ms | 3.65 ms | 1.6 MiB | 304 |
| 10240 | 6.51 ms | 6.62 ms | 6.52 ms | 3.1 MiB | 154 |

### `commitAuthoritative (change one small field)`

**Why we benchmark it.** Most state changes are tiny (a filter, a selection, a timestamp) but happen while a large collection sits in the same store. This proves the central design promise, structural sharing: a small change must not pay for the large data next to it.

**What poor performance would mean.** If the cost grew with the collection, every keystroke or click would re-copy thousands of records, and the application would get slower as its data grew -- the exact failure structural sharing exists to prevent.

**Expected growth: O(1).** A leaf commit rebuilds only the path from the root to the changed field and reuses every other branch by reference, so the work does not depend on how many records the store holds.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| records held in the store | swept | The tier axis: how large the unrelated collection in the same store is. |
| record shape | fixed at "7-field task record (strings, dates, a tag array)" | Records come from the deterministic generator in benchmark-fixtures/generator.mjs; wider or deeper records would raise the per-record cost. |
| size of the change | fixed at "one string field" | A single small leaf; larger patches cost proportionally more and are covered by the array-replace benchmark. |

**Deliberately not covered**

- **deeply nested change paths** -- Path length adds a small constant per level; the store's fields are shallow by design.

**Measured: O(1)** (exponent -0.04, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 4.41 µs | 5.16 µs | 4.50 µs | 2.3 KiB | 226,636 |
| 40 | 3.30 µs | 4.40 µs | 3.38 µs | 2.1 KiB | 303,470 |
| 80 | 3.21 µs | 3.62 µs | 7.20 µs | 2.1 KiB | 311,582 |
| 160 | 3.20 µs | 3.48 µs | 3.26 µs | 2.1 KiB | 312,467 |
| 320 | 3.16 µs | 3.53 µs | 3.21 µs | 2.1 KiB | 316,438 |
| 640 | 3.07 µs | 3.34 µs | 3.11 µs | 2.1 KiB | 325,535 |
| 1280 | 3.06 µs | 3.37 µs | 3.10 µs | 2.1 KiB | 326,608 |
| 2560 | 3.09 µs | 3.34 µs | 3.11 µs | 2.1 KiB | 323,918 |
| 5120 | 3.07 µs | 3.33 µs | 3.10 µs | 2.1 KiB | 326,092 |
| 10240 | 3.08 µs | 3.35 µs | 3.11 µs | 2.1 KiB | 325,126 |

### `reconcileArrayInfo`

**Why we benchmark it.** Builds the identity-keyed bookkeeping that lets lists update in place instead of being replaced; it runs on every collection commit that carries an identity key.

**What poor performance would mean.** Collection commits slow down in proportion to their size, adding directly to every list fetch; a quadratic regression would appear first on large tables.

**Expected growth: O(n).** It visits each incoming record once to compute its identity key and look it up in a hash map of known records, so the work is proportional to the number of records.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| records per fetch | swept | The tier axis: how many records one getter call fetches and commits. |
| record shape | fixed at "7-field task record (strings, dates, a tag array)" | Records come from the deterministic generator in benchmark-fixtures/generator.mjs; wider or deeper records would raise the per-record cost. |
| key composition | fixed at "single `id` field" | Composite keys add a small constant per record. |
| previous state | fixed at "none (first load)" | Reconciling against a large previous collection would add map lookups; the first-load case is the worst case for allocation. |

**In the end-to-end run:** Once per collection commit.

**Measured: O(n)** (exponent 0.93, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 17.0 µs | 36.4 µs | 26.9 µs | 11.0 KiB | 58,767 |
| 40 | 23.0 µs | 25.7 µs | 91.1 µs | 21.2 KiB | 43,547 |
| 80 | 39.0 µs | 40.9 µs | 130 µs | 42.1 KiB | 25,639 |
| 160 | 72.9 µs | 77.9 µs | 233 µs | 83.9 KiB | 13,718 |
| 320 | 135 µs | 143 µs | 365 µs | 167.2 KiB | 7,401 |
| 640 | 267 µs | 276 µs | 664 µs | 335.6 KiB | 3,745 |
| 1280 | 524 µs | 543 µs | 1.19 ms | 674.7 KiB | 1,907 |
| 2560 | 1.14 ms | 1.34 ms | 2.73 ms | 1.4 MiB | 874 |
| 5120 | 2.34 ms | 2.42 ms | 4.26 ms | 2.7 MiB | 427 |
| 10240 | 4.85 ms | 5.20 ms | 7.81 ms | 5.4 MiB | 206 |

### `getter dispatch (one full round trip)`

**Why we benchmark it.** This is what an application actually calls: one getter through `createData` -- dedup registry, async execute, ownership-checked commit and the loading-then-success state transitions. It is the best single number for 'what does one fetch cost through data-cap'.

**What poor performance would mean.** Every read in the application is slower and burns more CPU, and the cost scales with traffic and with payload size.

**Expected growth: O(n).** Dispatch bookkeeping is constant per call, and the commit that follows touches every new record once, so the total is a small constant plus a term proportional to the records returned.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| records per fetch | swept | The tier axis: how many records one getter call fetches and commits. |
| record shape | fixed at "7-field task record (strings, dates, a tag array)" | Records come from the deterministic generator in benchmark-fixtures/generator.mjs; wider or deeper records would raise the per-record cost. |
| cache state | fixed at "cold (fresh capability each sample)" | Each sample uses a brand-new capability, so no previous result or in-flight request is reused. |
| data source latency | fixed at "0 ms (simulated)" | Excluded on purpose; see the end-to-end section. |

**In the end-to-end run:** This is the end-to-end operation itself.

**Measured: O(log n)** (exponent 0.59, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 196 µs | 230 µs | 201 µs | 25.1 KiB | 5,100 |
| 40 | 222 µs | 257 µs | 229 µs | 31.3 KiB | 4,503 |
| 80 | 267 µs | 298 µs | 597 µs | 43.8 KiB | 3,747 |
| 160 | 359 µs | 439 µs | 1.48 ms | 68.8 KiB | 2,785 |
| 320 | 487 µs | 577 µs | 1.64 ms | 118.8 KiB | 2,052 |
| 640 | 702 µs | 973 µs | 1.91 ms | 218.8 KiB | 1,424 |
| 1280 | 1.14 ms | 1.79 ms | 2.40 ms | 418.8 KiB | 875 |
| 2560 | 2.04 ms | 2.64 ms | 3.61 ms | 819.0 KiB | 490 |
| 5120 | 3.67 ms | 3.70 ms | 4.25 ms | 1.6 MiB | 272 |
| 10240 | 8.05 ms | 8.16 ms | 13.6 ms | 3.1 MiB | 124 |

### `canonicalize (request key)`

**Why we benchmark it.** Turns a request's parameters into the string the coordinator uses to recognise identical in-flight requests. It runs on every getter and mutator call, so it sits on the hot path of everything the application does.

**What poor performance would mean.** Every call pays a surcharge proportional to how complex its parameters are; large filter objects would make deduplication more expensive than the requests it saves.

**Expected growth: O(n log n).** It walks every key of the parameters object (linear) and sorts the keys of each object so equal objects produce equal strings (n log n), so the sort dominates as objects grow.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| keys in the parameters object | swept | The tier axis: how many keys the parameter object has. |
| value types | fixed at "short strings and numbers" | Dates, URLs, nested objects and arrays add proportional work per node and are not swept. |
| typical real parameters | fixed at "3-6 keys in real use" | Real calls pass 3-6 keys; the ladder deliberately goes far beyond that to expose the growth rate. |

**Deliberately not covered**

- **deeply nested parameters** -- Nesting is bounded by a hard depth limit and is not representative of real request parameters.

**Measured: O(n)** (exponent 0.94, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 11.2 µs | 15.9 µs | 11.6 µs | 8.1 KiB | 89,092 |
| 40 | 9.16 µs | 10.7 µs | 33.9 µs | 11.1 KiB | 109,119 |
| 80 | 15.4 µs | 16.7 µs | 50.6 µs | 20.6 KiB | 64,841 |
| 160 | 31.3 µs | 33.2 µs | 92.1 µs | 39.8 KiB | 31,908 |
| 320 | 71.3 µs | 74.3 µs | 193 µs | 78.2 KiB | 14,017 |
| 640 | 151 µs | 160 µs | 374 µs | 155.6 KiB | 6,633 |
| 1280 | 266 µs | 274 µs | 630 µs | 321.6 KiB | 3,758 |
| 2560 | 554 µs | 569 µs | 1.11 ms | 646.7 KiB | 1,805 |
| 5120 | 1.18 ms | 1.23 ms | 2.29 ms | 1.3 MiB | 847 |
| 10240 | 2.34 ms | 2.42 ms | 2.99 ms | 2.6 MiB | 426 |

### `coordinator dedup (identical concurrent calls)`

**Why we benchmark it.** When many components ask for the same data at once, the coordinator should run the request once and share the result. This benchmark proves the saving is real and shows what the sharing itself costs.

**What poor performance would mean.** Without effective deduplication every concurrent caller hits the data source, multiplying load and cost on the backend; if the sharing itself were slow, dedup would cost more than it saves.

**Expected growth: O(n).** Each of the n callers registers on the shared in-flight request and receives the one result, so the work is proportional to the number of callers while the underlying fetch runs only once.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| concurrent identical callers | swept | The tier axis: how many callers ask for the same data at the same moment. |
| payload size | fixed at "200 records" | Held constant so only the caller count varies; payload scaling is measured in getter-dispatch-cold. |
| request identity | variant | Identical requests (shared) versus independent requests (not shared), measured as the two variants below. |

#### Variant `identical`

Every caller asks for the same page; the coordinator runs one fetch and shares it.

**Measured: O(n)** (exponent 0.83, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 589 µs | 756 µs | 1.74 ms | 235.8 KiB | 1,699 |
| 40 | 768 µs | 1.12 ms | 2.09 ms | 395.6 KiB | 1,302 |
| 80 | 1.30 ms | 1.69 ms | 3.34 ms | 710.2 KiB | 768 |
| 160 | 2.44 ms | 2.82 ms | 6.67 ms | 1.3 MiB | 411 |
| 320 | 4.31 ms | 5.18 ms | 14.5 ms | 2.5 MiB | 232 |
| 640 | 8.02 ms | 9.07 ms | 26.7 ms | 4.9 MiB | 125 |
| 1280 | 15.0 ms | 18.7 ms | 49.9 ms | 9.8 MiB | 67 |
| 2560 | 30.4 ms | 31.4 ms | 90.3 ms | 8.5 MiB | 33 |
| 5120 | 47.3 ms | 53.5 ms | 130 ms | 19.7 MiB | 21 |
| 10240 | 83.1 ms | 88.0 ms | 189 ms | 28.6 MiB | 12 |

#### Variant `independent`

Every caller asks for a different page; nothing can be shared, so this is the no-dedup comparison.

**Measured: O(n)** (exponent 0.83, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 551 µs | 602 µs | 1.70 ms | 233.0 KiB | 1,816 |
| 40 | 757 µs | 1.04 ms | 1.99 ms | 391.9 KiB | 1,320 |
| 80 | 1.40 ms | 1.74 ms | 3.51 ms | 710.2 KiB | 715 |
| 160 | 2.24 ms | 2.77 ms | 6.71 ms | 1.3 MiB | 446 |
| 320 | 4.11 ms | 5.11 ms | 12.8 ms | 2.5 MiB | 243 |
| 640 | 7.52 ms | 8.94 ms | 26.0 ms | 4.9 MiB | 133 |
| 1280 | 16.4 ms | 19.0 ms | 56.1 ms | 9.7 MiB | 61 |
| 2560 | 29.3 ms | 33.4 ms | 88.0 ms | 8.3 MiB | 34 |
| 5120 | 43.7 ms | 52.3 ms | 112 ms | 19.6 MiB | 23 |
| 10240 | 83.6 ms | 84.8 ms | 196 ms | 28.6 MiB | 12 |

### `runGetters (one call, many getters)`

**Why we benchmark it.** Screens usually need several datasets at once; `runGetters` starts them together. Its overhead is paid on every screen load.

**What poor performance would mean.** Screen-load latency grows with the number of datasets a screen needs, and a super-linear regression would punish exactly the most data-rich screens.

**Expected growth: O(n²).** Dispatching and aggregating are linear in the getters, but each getter commits to its own field and every commit rebuilds the root fields object, whose size is the number of fields (confirmed separately: one commit costs roughly 0.1 ms at 500 fields and 1.3 ms at 8,000). Here every getter owns one field, so n getters make n commits of O(n) each. A real capability has a handful of fields, where this is effectively linear; the quadratic term only appears when fields and getters grow together, which is why it is measured this way.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| getters per call | swept | The tier axis: how many getters one `runGetters` call starts. |
| fields per capability | swept | Swept together with getters on purpose (one field per getter): the cost of each commit depends on the field count, so the two cannot be separated in this benchmark. |
| payload per getter | fixed at "20 records" | Small and constant so the getter count, not payload size, drives the result. |
| getter independence | fixed at "all independent, all succeed" | A failing getter takes the error path, which is cheaper and not representative. |

**Measured: O(n²)** (exponent 1.90, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 1.10 ms | 1.68 ms | 2.66 ms | 534.5 KiB | 908 |
| 40 | 2.22 ms | 3.86 ms | 5.59 ms | 1.4 MiB | 451 |
| 80 | 5.88 ms | 10.0 ms | 11.5 ms | 4.4 MiB | 170 |
| 160 | 19.4 ms | 23.2 ms | 29.2 ms | 14.8 MiB | 52 |
| 320 | 62.3 ms | 66.2 ms | 95.4 ms | 8.8 MiB | 16 |
| 640 | 243 ms | 244 ms | 328 ms | 6.9 MiB | 4 |
| 1280 | 959 ms | 971 ms | 1.07 s | 13.6 MiB | 1 |
| 2560 | 4.87 s | 4.91 s | 5.02 s | 27.9 MiB | 0 |
| 5120 | 26.9 s | 27.1 s | 27.1 s | 298.6 MiB | 0 |
| 10240 | 128 s | 129 s | 135 s | 86.9 MiB | 0 |

### `createDataCache (set then get)`

**Why we benchmark it.** The optional snapshot cache lets a screen restore instantly. It must never become a hidden per-item cost: it should hold snapshots by reference.

**What poor performance would mean.** If the cache copied snapshots, every cache write would cost as much as re-fetching, and memory would multiply with the number of cached screens.

**Expected growth: O(1).** Entries are stored by reference in a bounded map with least-recently-used eviction, so set, get and eviction are constant-time regardless of how many records a snapshot contains.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| records inside the cached snapshot | swept | The tier axis: the size of the snapshot being cached. |
| cache fullness | fixed at "full (50 entries), every set evicts" | The worst case: each set evicts the oldest entry. |
| hit versus miss | fixed at "hit" | The get immediately follows the set, so it is always a hit; a miss is cheaper. |

**Measured: O(log n)** (exponent 0.21, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 9.67 µs | 12.5 µs | 13.0 µs | 680 B | 103,434 |
| 40 | 9.11 µs | 10.4 µs | 12.0 µs | 600 B | 109,806 |
| 80 | 10.3 µs | 13.8 µs | 13.0 µs | 600 B | 96,805 |
| 160 | 11.3 µs | 14.5 µs | 14.0 µs | 600 B | 88,331 |
| 320 | 17.4 µs | 18.2 µs | 21.0 µs | 680 B | 57,597 |
| 640 | 23.2 µs | 24.7 µs | 28.0 µs | 680 B | 43,115 |
| 1280 | 24.0 µs | 26.1 µs | 29.0 µs | 680 B | 41,623 |
| 2560 | 27.1 µs | 28.4 µs | 32.0 µs | 680 B | 36,913 |
| 5120 | 26.9 µs | 27.9 µs | 32.0 µs | 680 B | 37,202 |
| 10240 | 26.5 µs | 28.9 µs | 32.0 µs | 680 B | 37,750 |

### `withRetry`

**Why we benchmark it.** Opt-in retry wrapper used around flaky data sources. Its loop, timers and abort handling run only on failure, exactly when the system is already struggling, so its overhead must be small and predictable.

**What poor performance would mean.** Retry storms amplify an outage: if each retry is expensive, a struggling dependency makes the retrying service slower and more resource-hungry still.

**Expected growth: O(n).** Each failed attempt goes once around the loop (error handling, backoff computation, a timer and microtask hand-off), so total cost is proportional to the number of attempts.

**Measured on a shorter ladder (10, 20, 40, 80).** withRetry refuses more than 100 attempts (a built-in loop guard that fails fast on a broken exit condition), so the ladder stops at 80; real retry policies use 3-10 attempts, so this still covers well beyond real use.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| attempts before success | swept | The tier axis: how many calls fail before one succeeds. |
| backoff delay | fixed at "0 ms" | Real backoff waits seconds and would measure the timer, not the loop; the real control flow still runs. |
| abort signal | fixed at "never aborted" | The abort path exits early and is cheaper. |

**Deliberately not covered**

- **real backoff delays** -- Waiting is not CPU or memory cost; it is latency the caller chose.

**Measured: O(n)** (exponent 1.05, 4 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 10 | 10.1 ms | 11.2 ms | 1.57 ms | 35.9 KiB | 99 |
| 20 | 22.3 ms | 23.3 ms | 2.40 ms | 68.2 KiB | 45 |
| 40 | 43.3 ms | 47.7 ms | 3.51 ms | 134.2 KiB | 23 |
| 80 | 90.6 ms | 91.8 ms | 4.83 ms | 264.4 KiB | 11 |

## 3. What makes up the end-to-end overhead

Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).

**At 640 records** (total added: 666 µs)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `getter-dispatch-cold` | 1 | 702 µs | 106% | 105% |
| `commit-authoritative-array-replace` | 1 | 580 µs | 87% | 87% |
| `reconcile-array-info` | 1 | 267 µs | 40% | 40% |
| _unattributed_ |  | 0 | 0.0% |  |

**At 10240 records** (total added: 7.38 ms)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `getter-dispatch-cold` | 1 | 8.05 ms | 109% | 109% |
| `commit-authoritative-array-replace` | 1 | 6.51 ms | 88% | 88% |
| `reconcile-array-info` | 1 | 4.85 ms | 66% | 66% |
| _unattributed_ |  | 0 | 0.0% |  |

## Failed measurements

- **fn:cold-start** at n20: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n20/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n40: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n40/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n80: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n80/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n160: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n160/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n320: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n320/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n640: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n640/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n1280: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n1280/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n2560: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n2560/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n5120: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n5120/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3

- **fn:cold-start** at n10240: Error: Command failed: /opt/hostedtoolcache/node/22.23.3/x64/bin/node --expose-gc /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/fixtures/generated/cold-start/n10240/index.mjs
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs' imported from /home/runner/work/data-cap/data-cap/benchmarks/performance-runtime/scripts/cold-start-child.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/runner/work/data-cap/data-cap/benchmarks/benchmark-fixtures/measure.mjs'
}

Node.js v22.23.3


## Cost model

Estimates use two bracketing price shapes: **low** = CPU-priced compute ($0.040 per vCPU-hour, billed on CPU time) and **high** = duration-and-memory-priced functions ($0.000017 per GB-second, billed on wall time, at least 128 MB reserved). Both are rounded list prices and change over time; override them in `benchmark.config.json` → `costRates` to match your platform and negotiated pricing.

## Environment and method

- Run: `2026-10-02T14:04:53.795Z` → `2026-10-02T14:24:43.608Z` (1190 s), ci
- Machine: AMD EPYC 7763 64-Core Processor, 4 logical core(s) (2 physical), 15990 MB RAM, linux/x64, Node v22.23.3, GitHub Actions
- Git: `c7233e83f8e7c7e16e01866bb364781cfa73bd35` on `fix/code-scanning-and-caches` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240 records -- One record in the collection a getter fetches and commits (a CRM contact, an order, a support ticket). 640 is a typical full page of a mid-sized table or a busy list endpoint.

**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

