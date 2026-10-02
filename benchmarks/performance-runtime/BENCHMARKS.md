# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **640 records** per operation, routing the work through `data-cap` adds **666 µs** per operation compared with a bare-minimum baseline (1,960× baseline), about **$0.0014 – $0.019 per million operations** of compute. Overall, it grows O(log n) with workload size (measured exponent 0.56).

> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.

| Cost | Typical (640 records) | Largest (10240 records) |
| --- | --- | --- |
| Added latency per operation | 666 µs | 7.15 ms |
| Added latency, relative to baseline | 1,960× baseline | 21,056× baseline |
| Added CPU time per operation | 1.72 ms | 9.96 ms |
| Added memory per operation (heap delta) | 222.5 KiB | 3.1 MiB |
| Estimated compute cost per 1M operations | $0.0014 – $0.019 | $0.015 – $0.112 |
| Single-core throughput ceiling of the overhead alone | 1,500 ops/s | 140 ops/s |
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
| 20 | 0.629 µs | 211 µs | 210 µs | 335× baseline | 217 µs | $0.00044 – $0.0024 |
| 40 | 0.417 µs | 229 µs | 229 µs | 549× baseline | 237 µs | $0.00048 – $0.0027 |
| 80 | 0.337 µs | 274 µs | 274 µs | 814× baseline | 921 µs | $0.00057 – $0.010 |
| 160 | 0.420 µs | 355 µs | 355 µs | 845× baseline | 1.37 ms | $0.00074 – $0.015 |
| 320 | 0.415 µs | 452 µs | 451 µs | 1,088× baseline | 1.52 ms | $0.00094 – $0.017 |
| 640 | 0.340 µs | 667 µs | 666 µs | 1,960× baseline | 1.72 ms | $0.0014 – $0.019 |
| 1280 | 0.345 µs | 1.03 ms | 1.03 ms | 2,981× baseline | 1.99 ms | $0.0021 – $0.022 |
| 2560 | 0.341 µs | 1.78 ms | 1.78 ms | 5,223× baseline | 2.13 ms | $0.0037 – $0.024 |
| 5120 | 0.351 µs | 3.40 ms | 3.40 ms | 9,668× baseline | 3.64 ms | $0.0071 – $0.041 |
| 10240 | 0.340 µs | 7.16 ms | 7.15 ms | 21,056× baseline | 9.96 ms | $0.015 – $0.112 |

**How the total grows:** O(log n) (logarithmic), exponent 0.56 over 10 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.

| Function | Documented | Measured | Agreement | At 640 | At 10240 |
| --- | --- | --- | --- | --- | --- |
| `createData (cold start)` | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildData` | O(n) | O(n) | ✅ matches | 1.57 ms | 27.6 ms |
| `commitAuthoritative (replace a whole array)` | O(n) | O(n) | ✅ matches | 562 µs | 6.35 ms |
| `commitAuthoritative (change one small field)` | O(1) | O(1) | ✅ matches | 2.89 µs | 2.92 µs |
| `reconcileArrayInfo` | O(n) | O(n) | ✅ matches | 248 µs | 4.54 ms |
| `getter dispatch (one full round trip)` | O(n) | O(log n) | 🟡 close (neighbouring class) | 674 µs | 7.56 ms |
| `canonicalize (request key)` | O(n log n) | O(n) | 🟡 close (neighbouring class) | 149 µs | 2.44 ms |
| `coordinator dedup (identical concurrent calls)` (identical) | O(n) | O(n) | ✅ matches | 6.81 ms | 82.5 ms |
| `coordinator dedup (identical concurrent calls)` (independent) | O(n) | O(n) | ✅ matches | 7.05 ms | 79.5 ms |
| `runGetters (one call, many getters)` | O(n²) | O(n²) | ✅ matches | 232 ms | 135 s |
| `createDataCache (set then get)` | O(1) | O(log n) | 🟡 close (neighbouring class) | 25.1 µs | 29.4 µs |
| `withRetry` | O(n) | O(n) | ✅ matches | 87.2 ms (at 80) | 87.2 ms (at 80) |

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

**Measured: O(n)** (exponent 0.95, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 88.2 µs | 178 µs | 362 µs | 138.6 KiB | 11,343 |
| 40 | 120 µs | 164 µs | 307 µs | 268.6 KiB | 8,358 |
| 80 | 218 µs | 305 µs | 508 µs | 528.7 KiB | 4,581 |
| 160 | 407 µs | 531 µs | 787 µs | 1.0 MiB | 2,456 |
| 320 | 774 µs | 943 µs | 1.43 ms | 2.0 MiB | 1,293 |
| 640 | 1.57 ms | 1.92 ms | 3.26 ms | 4.1 MiB | 638 |
| 1280 | 3.02 ms | 3.39 ms | 4.89 ms | 8.2 MiB | 331 |
| 2560 | 6.37 ms | 6.80 ms | 9.33 ms | 1.4 MiB | 157 |
| 5120 | 13.3 ms | 13.8 ms | 19.6 ms | 3.5 MiB | 75 |
| 10240 | 27.6 ms | 28.2 ms | 39.4 ms | 7.6 MiB | 36 |

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
| 20 | 47.8 µs | 54.1 µs | 53.0 µs | 10.3 KiB | 20,910 |
| 40 | 70.6 µs | 74.5 µs | 74.0 µs | 16.4 KiB | 14,163 |
| 80 | 115 µs | 133 µs | 118 µs | 28.9 KiB | 8,695 |
| 160 | 204 µs | 228 µs | 208 µs | 53.9 KiB | 4,900 |
| 320 | 365 µs | 406 µs | 1.47 ms | 103.9 KiB | 2,740 |
| 640 | 562 µs | 739 µs | 1.68 ms | 203.9 KiB | 1,778 |
| 1280 | 957 µs | 1.44 ms | 2.07 ms | 403.9 KiB | 1,044 |
| 2560 | 1.76 ms | 2.39 ms | 2.91 ms | 804.0 KiB | 569 |
| 5120 | 3.22 ms | 3.43 ms | 3.51 ms | 1.6 MiB | 311 |
| 10240 | 6.35 ms | 6.38 ms | 6.56 ms | 3.1 MiB | 157 |

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

**Measured: O(1)** (exponent -0.06, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 4.18 µs | 4.77 µs | 4.29 µs | 2.3 KiB | 239,186 |
| 40 | 4.80 µs | 5.57 µs | 5.10 µs | 2.2 KiB | 208,325 |
| 80 | 3.04 µs | 4.05 µs | 3.10 µs | 2.1 KiB | 328,628 |
| 160 | 2.99 µs | 3.30 µs | 3.04 µs | 2.1 KiB | 334,244 |
| 320 | 2.98 µs | 3.18 µs | 3.02 µs | 2.1 KiB | 335,678 |
| 640 | 2.89 µs | 3.11 µs | 2.93 µs | 2.1 KiB | 345,497 |
| 1280 | 2.90 µs | 3.10 µs | 2.93 µs | 2.1 KiB | 345,341 |
| 2560 | 2.89 µs | 3.12 µs | 2.94 µs | 2.1 KiB | 345,993 |
| 5120 | 2.91 µs | 3.10 µs | 2.94 µs | 2.1 KiB | 344,113 |
| 10240 | 2.92 µs | 3.14 µs | 2.96 µs | 2.1 KiB | 342,911 |

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

**Measured: O(n)** (exponent 0.95, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 13.2 µs | 33.1 µs | 13.6 µs | 11.0 KiB | 75,878 |
| 40 | 21.5 µs | 23.3 µs | 21.9 µs | 21.4 KiB | 46,535 |
| 80 | 33.6 µs | 35.8 µs | 119 µs | 42.0 KiB | 29,804 |
| 160 | 62.6 µs | 65.7 µs | 205 µs | 83.7 KiB | 15,983 |
| 320 | 116 µs | 120 µs | 313 µs | 166.8 KiB | 8,611 |
| 640 | 248 µs | 255 µs | 661 µs | 335.6 KiB | 4,025 |
| 1280 | 482 µs | 492 µs | 1.16 ms | 674.7 KiB | 2,077 |
| 2560 | 1.04 ms | 1.06 ms | 2.61 ms | 1.4 MiB | 959 |
| 5120 | 2.19 ms | 2.22 ms | 4.21 ms | 2.7 MiB | 458 |
| 10240 | 4.54 ms | 4.60 ms | 7.45 ms | 5.4 MiB | 220 |

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
| 20 | 193 µs | 219 µs | 196 µs | 25.1 KiB | 5,185 |
| 40 | 218 µs | 241 µs | 223 µs | 31.3 KiB | 4,596 |
| 80 | 261 µs | 316 µs | 265 µs | 43.8 KiB | 3,828 |
| 160 | 349 µs | 393 µs | 1.46 ms | 68.8 KiB | 2,862 |
| 320 | 453 µs | 550 µs | 1.63 ms | 118.8 KiB | 2,208 |
| 640 | 674 µs | 917 µs | 1.93 ms | 218.8 KiB | 1,484 |
| 1280 | 1.08 ms | 1.63 ms | 2.38 ms | 418.8 KiB | 929 |
| 2560 | 1.92 ms | 1.99 ms | 3.51 ms | 819.0 KiB | 520 |
| 5120 | 3.39 ms | 3.47 ms | 4.06 ms | 1.6 MiB | 295 |
| 10240 | 7.56 ms | 7.70 ms | 13.1 ms | 3.1 MiB | 132 |

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

**Measured: O(n)** (exponent 0.96, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 10.5 µs | 15.9 µs | 10.9 µs | 8.1 KiB | 95,054 |
| 40 | 8.70 µs | 10.1 µs | 35.6 µs | 11.1 KiB | 114,949 |
| 80 | 15.3 µs | 16.6 µs | 53.9 µs | 20.6 KiB | 65,381 |
| 160 | 29.3 µs | 31.6 µs | 91.2 µs | 39.8 KiB | 34,132 |
| 320 | 63.6 µs | 66.2 µs | 175 µs | 78.2 KiB | 15,718 |
| 640 | 149 µs | 167 µs | 378 µs | 155.6 KiB | 6,698 |
| 1280 | 275 µs | 282 µs | 668 µs | 321.6 KiB | 3,631 |
| 2560 | 571 µs | 582 µs | 1.16 ms | 646.7 KiB | 1,753 |
| 5120 | 1.21 ms | 1.23 ms | 2.39 ms | 1.3 MiB | 823 |
| 10240 | 2.44 ms | 2.48 ms | 3.18 ms | 2.6 MiB | 410 |

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
| 20 | 584 µs | 748 µs | 1.73 ms | 235.8 KiB | 1,712 |
| 40 | 750 µs | 1.03 ms | 2.14 ms | 394.3 KiB | 1,333 |
| 80 | 1.29 ms | 1.57 ms | 3.37 ms | 709.0 KiB | 776 |
| 160 | 2.21 ms | 2.49 ms | 6.64 ms | 1.3 MiB | 452 |
| 320 | 3.94 ms | 4.61 ms | 13.2 ms | 2.5 MiB | 254 |
| 640 | 6.81 ms | 8.30 ms | 21.5 ms | 4.9 MiB | 147 |
| 1280 | 13.5 ms | 16.7 ms | 46.6 ms | 9.8 MiB | 74 |
| 2560 | 29.1 ms | 31.6 ms | 85.2 ms | 8.4 MiB | 34 |
| 5120 | 46.3 ms | 48.7 ms | 121 ms | 19.7 MiB | 22 |
| 10240 | 82.5 ms | 85.2 ms | 193 ms | 28.7 MiB | 12 |

#### Variant `independent`

Every caller asks for a different page; nothing can be shared, so this is the no-dedup comparison.

**Measured: O(n)** (exponent 0.83, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 524 µs | 663 µs | 1.69 ms | 233.0 KiB | 1,910 |
| 40 | 724 µs | 948 µs | 1.99 ms | 392.1 KiB | 1,381 |
| 80 | 1.28 ms | 1.63 ms | 3.11 ms | 709.0 KiB | 779 |
| 160 | 2.21 ms | 2.48 ms | 6.69 ms | 1.3 MiB | 452 |
| 320 | 3.59 ms | 4.41 ms | 12.4 ms | 2.5 MiB | 279 |
| 640 | 7.05 ms | 8.14 ms | 24.0 ms | 5.0 MiB | 142 |
| 1280 | 11.9 ms | 16.2 ms | 40.8 ms | 9.8 MiB | 84 |
| 2560 | 26.8 ms | 30.6 ms | 83.9 ms | 8.3 MiB | 37 |
| 5120 | 47.6 ms | 50.9 ms | 128 ms | 19.8 MiB | 21 |
| 10240 | 79.5 ms | 83.4 ms | 187 ms | 28.6 MiB | 13 |

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
| 20 | 971 µs | 1.45 ms | 2.25 ms | 534.5 KiB | 1,030 |
| 40 | 2.09 ms | 3.19 ms | 4.54 ms | 1.4 MiB | 478 |
| 80 | 5.54 ms | 8.39 ms | 9.66 ms | 4.4 MiB | 180 |
| 160 | 17.0 ms | 22.9 ms | 27.9 ms | 14.8 MiB | 59 |
| 320 | 62.5 ms | 66.3 ms | 83.0 ms | 8.8 MiB | 16 |
| 640 | 232 ms | 235 ms | 301 ms | 6.7 MiB | 4 |
| 1280 | 952 ms | 972 ms | 1.06 s | 13.8 MiB | 1 |
| 2560 | 4.24 s | 4.24 s | 4.37 s | 27.8 MiB | 0 |
| 5120 | 28.5 s | 28.7 s | 28.7 s | 297.5 MiB | 0 |
| 10240 | 135 s | 138 s | 142 s | 73.4 MiB | 0 |

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

**Measured: O(log n)** (exponent 0.22, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 10.0 µs | 11.8 µs | 13.0 µs | 680 B | 99,950 |
| 40 | 9.74 µs | 11.1 µs | 13.0 µs | 600 B | 102,722 |
| 80 | 9.95 µs | 12.1 µs | 13.0 µs | 600 B | 100,553 |
| 160 | 12.0 µs | 15.8 µs | 15.0 µs | 600 B | 83,070 |
| 320 | 17.7 µs | 18.5 µs | 22.0 µs | 680 B | 56,379 |
| 640 | 25.1 µs | 25.9 µs | 30.0 µs | 680 B | 39,780 |
| 1280 | 26.2 µs | 27.1 µs | 31.0 µs | 680 B | 38,241 |
| 2560 | 28.2 µs | 29.6 µs | 33.0 µs | 680 B | 35,433 |
| 5120 | 28.0 µs | 28.3 µs | 33.0 µs | 680 B | 35,685 |
| 10240 | 29.4 µs | 30.3 µs | 34.0 µs | 680 B | 34,032 |

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
| 10 | 9.92 ms | 11.1 ms | 1.46 ms | 35.9 KiB | 101 |
| 20 | 20.8 ms | 23.0 ms | 1.76 ms | 68.2 KiB | 48 |
| 40 | 43.5 ms | 44.8 ms | 2.72 ms | 134.1 KiB | 23 |
| 80 | 87.2 ms | 88.0 ms | 3.60 ms | 264.4 KiB | 11 |

## 3. What makes up the end-to-end overhead

Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).

**At 640 records** (total added: 666 µs)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `getter-dispatch-cold` | 1 | 674 µs | 101% | 101% |
| `commit-authoritative-array-replace` | 1 | 562 µs | 84% | 84% |
| `reconcile-array-info` | 1 | 248 µs | 37% | 37% |
| _unattributed_ |  | 0 | 0.0% |  |

**At 10240 records** (total added: 7.15 ms)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `getter-dispatch-cold` | 1 | 7.56 ms | 106% | 106% |
| `commit-authoritative-array-replace` | 1 | 6.35 ms | 89% | 89% |
| `reconcile-array-info` | 1 | 4.54 ms | 64% | 64% |
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

- Run: `2026-10-02T00:44:16.878Z` → `2026-10-02T01:05:02.659Z` (1246 s), ci
- Machine: AMD EPYC 9V74 80-Core Processor, 4 logical core(s) (2 physical), 15990 MB RAM, linux/x64, Node v22.23.3, GitHub Actions
- Git: `29b74756425d93fc965acb3462d57908c2ab8649` on `chore/no-minify-no-dist-urls` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240 records -- One record in the collection a getter fetches and commits (a CRM contact, an order, a support ticket). 640 is a typical full page of a mid-sized table or a busy list endpoint.

**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

