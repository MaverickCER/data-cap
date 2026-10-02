# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **640 records** per operation, routing the work through `data-cap` adds **662 µs** per operation compared with a bare-minimum baseline (1,993× baseline), about **$0.0014 – $0.019 per million operations** of compute. Overall, it grows O(log n) with workload size (measured exponent 0.56).

> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.

| Cost | Typical (640 records) | Largest (10240 records) |
| --- | --- | --- |
| Added latency per operation | 662 µs | 7.46 ms |
| Added latency, relative to baseline | 1,993× baseline | 20,827× baseline |
| Added CPU time per operation | 1.73 ms | 10.3 ms |
| Added memory per operation (heap delta) | 222.5 KiB | 3.1 MiB |
| Estimated compute cost per 1M operations | $0.0014 – $0.019 | $0.016 – $0.116 |
| Single-core throughput ceiling of the overhead alone | 1,511 ops/s | 134 ops/s |
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
| 20 | 0.518 µs | 216 µs | 215 µs | 417× baseline | 224 µs | $0.00045 – $0.0025 |
| 40 | 0.424 µs | 230 µs | 230 µs | 542× baseline | 237 µs | $0.00048 – $0.0027 |
| 80 | 0.349 µs | 278 µs | 278 µs | 796× baseline | 950 µs | $0.00058 – $0.011 |
| 160 | 0.436 µs | 354 µs | 353 µs | 812× baseline | 1.41 ms | $0.00074 – $0.016 |
| 320 | 0.433 µs | 457 µs | 456 µs | 1,055× baseline | 1.54 ms | $0.00095 – $0.017 |
| 640 | 0.332 µs | 662 µs | 662 µs | 1,993× baseline | 1.73 ms | $0.0014 – $0.019 |
| 1280 | 0.334 µs | 1.07 ms | 1.07 ms | 3,198× baseline | 2.16 ms | $0.0022 – $0.024 |
| 2560 | 0.355 µs | 1.87 ms | 1.87 ms | 5,258× baseline | 2.79 ms | $0.0039 – $0.031 |
| 5120 | 0.361 µs | 3.50 ms | 3.50 ms | 9,678× baseline | 3.58 ms | $0.0073 – $0.040 |
| 10240 | 0.358 µs | 7.46 ms | 7.46 ms | 20,827× baseline | 10.3 ms | $0.016 – $0.116 |

**How the total grows:** O(log n) (logarithmic), exponent 0.56 over 10 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.

| Function | Documented | Measured | Agreement | At 640 | At 10240 |
| --- | --- | --- | --- | --- | --- |
| `createData (cold start)` | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildData` | O(n) | O(n) | ✅ matches | 1.65 ms | 29.0 ms |
| `commitAuthoritative (replace a whole array)` | O(n) | O(n) | ✅ matches | 585 µs | 6.65 ms |
| `commitAuthoritative (change one small field)` | O(1) | O(1) | ✅ matches | 3.06 µs | 3.18 µs |
| `reconcileArrayInfo` | O(n) | O(n) | ✅ matches | 248 µs | 4.78 ms |
| `getter dispatch (one full round trip)` | O(n) | O(log n) | 🟡 close (neighbouring class) | 680 µs | 8.15 ms |
| `canonicalize (request key)` | O(n log n) | O(n) | 🟡 close (neighbouring class) | 150 µs | 2.37 ms |
| `coordinator dedup (identical concurrent calls)` (identical) | O(n) | O(n) | ✅ matches | 7.20 ms | 84.0 ms |
| `coordinator dedup (identical concurrent calls)` (independent) | O(n) | O(n) | ✅ matches | 6.41 ms | 81.9 ms |
| `runGetters (one call, many getters)` | O(n²) | O(n²) | ✅ matches | 237 ms | 142 s |
| `createDataCache (set then get)` | O(1) | O(log n) | 🟡 close (neighbouring class) | 29.4 µs | 30.8 µs |
| `withRetry` | O(n) | O(n) | ✅ matches | 88.1 ms (at 80) | 88.1 ms (at 80) |

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

**Measured: O(n)** (exponent 0.96, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 89.4 µs | 208 µs | 365 µs | 138.6 KiB | 11,184 |
| 40 | 112 µs | 156 µs | 253 µs | 268.6 KiB | 8,923 |
| 80 | 223 µs | 318 µs | 502 µs | 528.7 KiB | 4,486 |
| 160 | 444 µs | 548 µs | 1.01 ms | 1.0 MiB | 2,253 |
| 320 | 801 µs | 989 µs | 1.44 ms | 2.0 MiB | 1,249 |
| 640 | 1.65 ms | 2.07 ms | 3.44 ms | 4.1 MiB | 608 |
| 1280 | 3.31 ms | 3.63 ms | 5.33 ms | 8.2 MiB | 302 |
| 2560 | 6.93 ms | 7.35 ms | 10.5 ms | 1.4 MiB | 144 |
| 5120 | 14.5 ms | 15.4 ms | 21.5 ms | 3.5 MiB | 69 |
| 10240 | 29.0 ms | 30.1 ms | 42.1 ms | 7.6 MiB | 34 |

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

**Measured: O(n)** (exponent 0.79, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 48.9 µs | 65.7 µs | 54.0 µs | 10.3 KiB | 20,432 |
| 40 | 71.0 µs | 88.8 µs | 74.0 µs | 16.4 KiB | 14,077 |
| 80 | 117 µs | 134 µs | 120 µs | 28.9 KiB | 8,568 |
| 160 | 207 µs | 227 µs | 211 µs | 53.9 KiB | 4,827 |
| 320 | 376 µs | 420 µs | 1.48 ms | 103.9 KiB | 2,663 |
| 640 | 585 µs | 669 µs | 1.69 ms | 203.9 KiB | 1,711 |
| 1280 | 997 µs | 1.12 ms | 2.13 ms | 403.9 KiB | 1,003 |
| 2560 | 1.81 ms | 2.03 ms | 2.97 ms | 804.0 KiB | 552 |
| 5120 | 3.37 ms | 3.50 ms | 3.74 ms | 1.6 MiB | 297 |
| 10240 | 6.65 ms | 6.82 ms | 6.66 ms | 3.1 MiB | 150 |

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

**Measured: O(1)** (exponent -0.03, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 4.21 µs | 4.82 µs | 4.30 µs | 2.3 KiB | 237,668 |
| 40 | 3.49 µs | 4.33 µs | 3.63 µs | 2.1 KiB | 286,400 |
| 80 | 3.09 µs | 4.36 µs | 3.16 µs | 2.1 KiB | 323,444 |
| 160 | 3.10 µs | 4.27 µs | 3.17 µs | 2.1 KiB | 322,826 |
| 320 | 3.06 µs | 4.33 µs | 3.11 µs | 2.1 KiB | 327,322 |
| 640 | 3.06 µs | 4.66 µs | 3.13 µs | 2.1 KiB | 326,734 |
| 1280 | 3.07 µs | 4.96 µs | 3.14 µs | 2.1 KiB | 325,347 |
| 2560 | 3.23 µs | 3.98 µs | 4.72 µs | 2.1 KiB | 309,672 |
| 5120 | 3.10 µs | 4.64 µs | 3.21 µs | 2.1 KiB | 322,700 |
| 10240 | 3.18 µs | 4.43 µs | 3.29 µs | 2.1 KiB | 314,159 |

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

**Measured: O(n)** (exponent 0.96, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 14.8 µs | 32.4 µs | 17.2 µs | 11.0 KiB | 67,573 |
| 40 | 18.2 µs | 19.8 µs | 71.6 µs | 21.2 KiB | 55,051 |
| 80 | 35.3 µs | 37.5 µs | 130 µs | 42.1 KiB | 28,312 |
| 160 | 60.6 µs | 64.2 µs | 189 µs | 83.6 KiB | 16,515 |
| 320 | 122 µs | 137 µs | 361 µs | 167.2 KiB | 8,186 |
| 640 | 248 µs | 256 µs | 667 µs | 335.6 KiB | 4,039 |
| 1280 | 481 µs | 491 µs | 1.18 ms | 674.7 KiB | 2,080 |
| 2560 | 1.04 ms | 1.06 ms | 2.64 ms | 1.4 MiB | 962 |
| 5120 | 2.23 ms | 2.30 ms | 4.24 ms | 2.7 MiB | 447 |
| 10240 | 4.78 ms | 4.90 ms | 7.75 ms | 5.4 MiB | 209 |

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

**Measured: O(log n)** (exponent 0.58, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 198 µs | 239 µs | 202 µs | 25.1 KiB | 5,062 |
| 40 | 222 µs | 261 µs | 226 µs | 31.3 KiB | 4,508 |
| 80 | 266 µs | 292 µs | 587 µs | 43.8 KiB | 3,765 |
| 160 | 354 µs | 410 µs | 1.48 ms | 68.8 KiB | 2,821 |
| 320 | 477 µs | 583 µs | 1.68 ms | 118.8 KiB | 2,096 |
| 640 | 680 µs | 907 µs | 1.95 ms | 218.8 KiB | 1,470 |
| 1280 | 1.11 ms | 1.63 ms | 2.44 ms | 418.8 KiB | 903 |
| 2560 | 2.00 ms | 2.05 ms | 3.65 ms | 819.0 KiB | 500 |
| 5120 | 3.53 ms | 3.93 ms | 4.26 ms | 1.6 MiB | 283 |
| 10240 | 8.15 ms | 8.31 ms | 13.8 ms | 3.1 MiB | 123 |

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
| 20 | 11.1 µs | 18.5 µs | 11.6 µs | 8.1 KiB | 90,140 |
| 40 | 9.77 µs | 10.5 µs | 21.7 µs | 11.1 KiB | 102,366 |
| 80 | 15.6 µs | 19.3 µs | 56.6 µs | 20.6 KiB | 63,976 |
| 160 | 29.8 µs | 33.0 µs | 96.0 µs | 39.8 KiB | 33,537 |
| 320 | 64.0 µs | 67.7 µs | 177 µs | 78.2 KiB | 15,625 |
| 640 | 150 µs | 158 µs | 379 µs | 155.6 KiB | 6,685 |
| 1280 | 263 µs | 268 µs | 647 µs | 321.6 KiB | 3,806 |
| 2560 | 552 µs | 566 µs | 1.15 ms | 646.7 KiB | 1,811 |
| 5120 | 1.20 ms | 1.23 ms | 2.38 ms | 1.3 MiB | 835 |
| 10240 | 2.37 ms | 2.41 ms | 2.82 ms | 2.6 MiB | 421 |

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
| 20 | 583 µs | 734 µs | 1.74 ms | 235.8 KiB | 1,715 |
| 40 | 735 µs | 1.02 ms | 1.98 ms | 393.5 KiB | 1,360 |
| 80 | 1.36 ms | 1.59 ms | 3.37 ms | 708.2 KiB | 735 |
| 160 | 2.15 ms | 2.52 ms | 6.59 ms | 1.3 MiB | 464 |
| 320 | 3.82 ms | 4.71 ms | 13.7 ms | 2.5 MiB | 262 |
| 640 | 7.20 ms | 8.60 ms | 25.1 ms | 5.0 MiB | 139 |
| 1280 | 13.5 ms | 17.6 ms | 47.1 ms | 9.8 MiB | 74 |
| 2560 | 29.2 ms | 31.4 ms | 92.7 ms | 8.5 MiB | 34 |
| 5120 | 47.4 ms | 52.9 ms | 121 ms | 19.7 MiB | 21 |
| 10240 | 84.0 ms | 87.5 ms | 196 ms | 28.5 MiB | 12 |

#### Variant `independent`

Every caller asks for a different page; nothing can be shared, so this is the no-dedup comparison.

**Measured: O(n)** (exponent 0.83, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 541 µs | 652 µs | 1.72 ms | 233.0 KiB | 1,847 |
| 40 | 757 µs | 981 µs | 2.13 ms | 392.1 KiB | 1,322 |
| 80 | 1.24 ms | 1.49 ms | 3.58 ms | 708.6 KiB | 808 |
| 160 | 2.15 ms | 2.68 ms | 7.19 ms | 1.3 MiB | 465 |
| 320 | 3.66 ms | 4.56 ms | 12.5 ms | 2.5 MiB | 274 |
| 640 | 6.41 ms | 8.57 ms | 22.6 ms | 4.9 MiB | 156 |
| 1280 | 13.8 ms | 16.0 ms | 48.0 ms | 9.8 MiB | 72 |
| 2560 | 26.3 ms | 31.4 ms | 84.1 ms | 8.4 MiB | 38 |
| 5120 | 44.0 ms | 49.9 ms | 111 ms | 19.7 MiB | 23 |
| 10240 | 81.9 ms | 88.8 ms | 191 ms | 28.5 MiB | 12 |

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

**Measured: O(n²)** (exponent 1.92, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 1.00 ms | 1.45 ms | 2.36 ms | 534.5 KiB | 1,000 |
| 40 | 2.14 ms | 3.31 ms | 4.70 ms | 1.4 MiB | 466 |
| 80 | 5.48 ms | 9.18 ms | 9.05 ms | 4.4 MiB | 183 |
| 160 | 20.5 ms | 24.6 ms | 30.9 ms | 14.8 MiB | 49 |
| 320 | 63.6 ms | 67.9 ms | 89.0 ms | 8.8 MiB | 16 |
| 640 | 237 ms | 242 ms | 324 ms | 6.8 MiB | 4 |
| 1280 | 960 ms | 976 ms | 1.07 s | 13.8 MiB | 1 |
| 2560 | 4.38 s | 4.40 s | 4.52 s | 27.9 MiB | 0 |
| 5120 | 29.2 s | 29.3 s | 29.4 s | 297.6 MiB | 0 |
| 10240 | 142 s | 145 s | 149 s | 66.3 MiB | 0 |

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

**Measured: O(log n)** (exponent 0.19, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 11.0 µs | 12.8 µs | 14.0 µs | 680 B | 91,025 |
| 40 | 12.1 µs | 17.5 µs | 16.0 µs | 600 B | 82,454 |
| 80 | 12.9 µs | 15.0 µs | 16.0 µs | 600 B | 77,700 |
| 160 | 18.0 µs | 21.0 µs | 22.0 µs | 600 B | 55,411 |
| 320 | 23.1 µs | 26.8 µs | 27.0 µs | 680 B | 43,243 |
| 640 | 29.4 µs | 30.2 µs | 34.0 µs | 680 B | 33,985 |
| 1280 | 28.5 µs | 43.6 µs | 34.0 µs | 680 B | 35,095 |
| 2560 | 30.2 µs | 30.4 µs | 35.0 µs | 680 B | 33,095 |
| 5120 | 29.3 µs | 30.8 µs | 35.0 µs | 680 B | 34,160 |
| 10240 | 30.8 µs | 33.5 µs | 37.0 µs | 680 B | 32,439 |

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
| 10 | 9.94 ms | 11.0 ms | 1.49 ms | 34.7 KiB | 101 |
| 20 | 21.8 ms | 22.0 ms | 1.80 ms | 68.2 KiB | 46 |
| 40 | 43.7 ms | 44.8 ms | 2.65 ms | 135.0 KiB | 23 |
| 80 | 88.1 ms | 90.5 ms | 3.71 ms | 264.4 KiB | 11 |

## 3. What makes up the end-to-end overhead

Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).

**At 640 records** (total added: 662 µs)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `getter-dispatch-cold` | 1 | 680 µs | 103% | 103% |
| `commit-authoritative-array-replace` | 1 | 585 µs | 88% | 88% |
| `reconcile-array-info` | 1 | 248 µs | 37% | 37% |
| _unattributed_ |  | 0 | 0.0% |  |

**At 10240 records** (total added: 7.46 ms)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `getter-dispatch-cold` | 1 | 8.15 ms | 109% | 109% |
| `commit-authoritative-array-replace` | 1 | 6.65 ms | 89% | 89% |
| `reconcile-array-info` | 1 | 4.78 ms | 64% | 64% |
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

- Run: `2026-10-02T13:09:05.127Z` → `2026-10-02T13:30:43.500Z` (1298 s), ci
- Machine: AMD EPYC 9V74 80-Core Processor, 4 logical core(s) (2 physical), 15990 MB RAM, linux/x64, Node v22.23.3, GitHub Actions
- Git: `a4cfb755011c545987f9bdabe077c250c91dbe6d` on `feat/gdpr-ropa-generator` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240 records -- One record in the collection a getter fetches and commits (a CRM contact, an order, a support ticket). 640 is a typical full page of a mid-sized table or a busy list endpoint.

**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

