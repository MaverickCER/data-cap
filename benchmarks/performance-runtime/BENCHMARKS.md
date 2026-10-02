# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **640 records** per operation, routing the work through `data-cap` adds **262 µs** per operation compared with a bare-minimum baseline (2,740× baseline), about **$0.00055 – $0.012 per million operations** of compute. Overall, it grows O(n) with workload size (measured exponent 0.70).

> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.

| Cost | Typical (640 records) | Largest (10240 records) |
| --- | --- | --- |
| Added latency per operation | 262 µs | 3.39 ms |
| Added latency, relative to baseline | 2,740× baseline | 34,346× baseline |
| Added CPU time per operation | 1.04 ms | 4.98 ms |
| Added memory per operation (heap delta) | 223.4 KiB | 3.1 MiB |
| Estimated compute cost per 1M operations | $0.00055 – $0.012 | $0.0071 – $0.056 |
| Single-core throughput ceiling of the overhead alone | 3,821 ops/s | 295 ops/s |
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
| 20 | 0.114 µs | 51.9 µs | 51.8 µs | 454× baseline | 56.9 µs | $0.00011 – $0.00064 |
| 40 | 0.118 µs | 50.9 µs | 50.8 µs | 433× baseline | 53.9 µs | $0.00011 – $0.00061 |
| 80 | 0.0973 µs | 65.5 µs | 65.4 µs | 673× baseline | 69.8 µs | $0.00014 – $0.00078 |
| 160 | 0.101 µs | 94.5 µs | 94.4 µs | 936× baseline | 97.9 µs | $0.0002 – $0.0011 |
| 320 | 0.101 µs | 151 µs | 151 µs | 1,503× baseline | 437 µs | $0.00031 – $0.0049 |
| 640 | 0.0955 µs | 262 µs | 262 µs | 2,740× baseline | 1.04 ms | $0.00055 – $0.012 |
| 1280 | 0.0962 µs | 462 µs | 462 µs | 4,807× baseline | 1.22 ms | $0.00096 – $0.014 |
| 2560 | 0.0953 µs | 873 µs | 873 µs | 9,164× baseline | 1.77 ms | $0.0018 – $0.020 |
| 5120 | 0.0999 µs | 1.71 ms | 1.71 ms | 17,109× baseline | 2.83 ms | $0.0036 – $0.032 |
| 10240 | 0.0987 µs | 3.39 ms | 3.39 ms | 34,346× baseline | 4.98 ms | $0.0071 – $0.056 |

**How the total grows:** O(n) (linear), exponent 0.70 over 10 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.

| Function | Documented | Measured | Agreement | At 640 | At 10240 |
| --- | --- | --- | --- | --- | --- |
| `createData (cold start)` | O(n) | O(log n) | 🟡 close (neighbouring class) | 110 ms | 1.19 s |
| `buildData` | O(n) | O(n) | ✅ matches | 862 µs | 15.5 ms |
| `commitAuthoritative (replace a whole array)` | O(n) | O(n) | ✅ matches | 222 µs | 3.32 ms |
| `commitAuthoritative (change one small field)` | O(1) | O(1) | ✅ matches | 0.888 µs | 0.901 µs |
| `reconcileArrayInfo` | O(n) | O(n) | ✅ matches | 105 µs | 2.28 ms |
| `getter dispatch (one full round trip)` | O(n) | O(n) | ✅ matches | 279 µs | 3.44 ms |
| `canonicalize (request key)` | O(n log n) | O(n) | 🟡 close (neighbouring class) | 81.6 µs | 1.44 ms |
| `coordinator dedup (identical concurrent calls)` (identical) | O(n) | O(n) | ✅ matches | 2.25 ms | 29.8 ms |
| `coordinator dedup (identical concurrent calls)` (independent) | O(n) | O(n) | ✅ matches | 2.24 ms | 31.5 ms |
| `runGetters (one call, many getters)` | O(n²) | O(n²) | ✅ matches | 121 ms | 52.5 s |
| `createDataCache (set then get)` | O(1) | O(log n) | 🟡 close (neighbouring class) | 7.21 µs | 11.2 µs |
| `withRetry` | O(n) | O(n) | ✅ matches | 99.1 ms (at 80) | 99.1 ms (at 80) |

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

**Measured: O(log n)** (exponent 0.57, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 35.3 ms | 38.0 ms | 1.28 ms | 70.2 KiB | 28 |
| 40 | 39.1 ms | 40.6 ms | 1.27 ms | 65.4 KiB | 26 |
| 80 | 43.2 ms | 78.8 ms | 1.24 ms | 62.0 KiB | 23 |
| 160 | 53.9 ms | 55.9 ms | 1.28 ms | 62.0 KiB | 19 |
| 320 | 74.2 ms | 116 ms | 1.32 ms | 62.0 KiB | 13 |
| 640 | 110 ms | 143 ms | 1.30 ms | 62.0 KiB | 9 |
| 1280 | 180 ms | 276 ms | 1.34 ms | 62.0 KiB | 6 |
| 2560 | 335 ms | 379 ms | 1.44 ms | 61.8 KiB | 3 |
| 5120 | 632 ms | 633 ms | 1.45 ms | 61.7 KiB | 2 |
| 10240 | 1.19 s | 1.22 s | 1.34 ms | 61.7 KiB | 1 |

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

**Measured: O(n)** (exponent 1.01, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 30.9 µs | 44.5 µs | 118 µs | 25.8 KiB | 32,330 |
| 40 | 54.4 µs | 61.2 µs | 95.5 µs | 54.8 KiB | 18,377 |
| 80 | 104 µs | 108 µs | 182 µs | 123.2 KiB | 9,642 |
| 160 | 194 µs | 212 µs | 320 µs | 1.0 MiB | 5,149 |
| 320 | 390 µs | 444 µs | 628 µs | 2.0 MiB | 2,561 |
| 640 | 862 µs | 1.01 ms | 1.27 ms | 4.1 MiB | 1,161 |
| 1280 | 1.72 ms | 1.86 ms | 2.59 ms | 8.2 MiB | 581 |
| 2560 | 3.74 ms | 3.96 ms | 4.79 ms | 16.3 MiB | 267 |
| 5120 | 7.49 ms | 7.75 ms | 9.25 ms | 32.6 MiB | 133 |
| 10240 | 15.5 ms | 15.8 ms | 20.7 ms | 4.3 MiB | 65 |

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

**Measured: O(n)** (exponent 0.91, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 12.7 µs | 21.5 µs | 15.0 µs | 11.0 KiB | 78,431 |
| 40 | 18.4 µs | 27.0 µs | 21.0 µs | 17.3 KiB | 54,422 |
| 80 | 34.1 µs | 50.8 µs | 37.0 µs | 29.8 KiB | 29,304 |
| 160 | 60.1 µs | 63.6 µs | 63.0 µs | 54.8 KiB | 16,632 |
| 320 | 114 µs | 134 µs | 118 µs | 104.8 KiB | 8,801 |
| 640 | 222 µs | 251 µs | 1.03 ms | 204.8 KiB | 4,494 |
| 1280 | 447 µs | 468 µs | 1.47 ms | 414.8 KiB | 2,238 |
| 2560 | 846 µs | 925 µs | 1.79 ms | 804.8 KiB | 1,182 |
| 5120 | 1.68 ms | 2.30 ms | 2.79 ms | 1.6 MiB | 594 |
| 10240 | 3.32 ms | 3.62 ms | 4.71 ms | 3.1 MiB | 301 |

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

**Measured: O(1)** (exponent -0.01, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 1.01 µs | 1.44 µs | 1.07 µs | 3.1 KiB | 987,575 |
| 40 | 1.01 µs | 1.17 µs | 4.00 µs | 2.3 KiB | 992,807 |
| 80 | 0.870 µs | 0.999 µs | 3.63 µs | 2.1 KiB | 1,149,749 |
| 160 | 0.879 µs | 1.07 µs | 0.929 µs | 2.1 KiB | 1,137,687 |
| 320 | 0.872 µs | 0.987 µs | 3.18 µs | 2.1 KiB | 1,147,436 |
| 640 | 0.888 µs | 0.925 µs | 3.55 µs | 2.1 KiB | 1,125,910 |
| 1280 | 0.889 µs | 0.993 µs | 4.15 µs | 2.1 KiB | 1,124,583 |
| 2560 | 0.915 µs | 1.46 µs | 0.973 µs | 2.1 KiB | 1,093,299 |
| 5120 | 0.888 µs | 1.04 µs | 1.13 µs | 2.1 KiB | 1,126,198 |
| 10240 | 0.901 µs | 1.00 µs | 0.954 µs | 2.1 KiB | 1,110,048 |

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

**Measured: O(n)** (exponent 1.03, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 4.08 µs | 7.92 µs | 4.33 µs | 14.4 KiB | 244,898 |
| 40 | 6.19 µs | 7.67 µs | 18.9 µs | 20.9 KiB | 161,458 |
| 80 | 12.4 µs | 14.1 µs | 29.9 µs | 41.7 KiB | 80,778 |
| 160 | 25.3 µs | 27.4 µs | 52.4 µs | 83.2 KiB | 39,552 |
| 320 | 52.0 µs | 56.1 µs | 100 µs | 166.3 KiB | 19,220 |
| 640 | 105 µs | 117 µs | 201 µs | 335.2 KiB | 9,510 |
| 1280 | 214 µs | 240 µs | 404 µs | 677.3 KiB | 4,665 |
| 2560 | 455 µs | 503 µs | 1.01 ms | 1.4 MiB | 2,196 |
| 5120 | 1.05 ms | 1.22 ms | 2.33 ms | 2.7 MiB | 950 |
| 10240 | 2.28 ms | 2.65 ms | 4.27 ms | 5.4 MiB | 439 |

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

**Measured: O(n)** (exponent 0.73, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 45.6 µs | 89.4 µs | 49.0 µs | 24.9 KiB | 21,938 |
| 40 | 49.9 µs | 83.8 µs | 53.0 µs | 31.2 KiB | 20,033 |
| 80 | 62.6 µs | 118 µs | 73.0 µs | 43.5 KiB | 15,979 |
| 160 | 93.4 µs | 115 µs | 99.0 µs | 68.5 KiB | 10,705 |
| 320 | 153 µs | 183 µs | 162 µs | 118.5 KiB | 6,543 |
| 640 | 279 µs | 347 µs | 1.24 ms | 218.5 KiB | 3,585 |
| 1280 | 493 µs | 637 µs | 1.60 ms | 418.6 KiB | 2,029 |
| 2560 | 944 µs | 1.22 ms | 2.37 ms | 818.7 KiB | 1,060 |
| 5120 | 1.77 ms | 1.93 ms | 3.73 ms | 1.6 MiB | 566 |
| 10240 | 3.44 ms | 3.65 ms | 6.37 ms | 3.1 MiB | 291 |

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

**Measured: O(n)** (exponent 1.04, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 1.98 µs | 3.47 µs | 2.07 µs | 8.0 KiB | 505,265 |
| 40 | 3.56 µs | 3.92 µs | 12.4 µs | 11.0 KiB | 280,963 |
| 80 | 7.79 µs | 8.84 µs | 18.3 µs | 20.6 KiB | 128,387 |
| 160 | 16.1 µs | 18.1 µs | 35.2 µs | 39.7 KiB | 61,996 |
| 320 | 36.2 µs | 42.6 µs | 75.6 µs | 77.9 KiB | 27,604 |
| 640 | 81.6 µs | 103 µs | 178 µs | 154.8 KiB | 12,257 |
| 1280 | 114 µs | 199 µs | 271 µs | 319.0 KiB | 8,747 |
| 2560 | 236 µs | 317 µs | 559 µs | 641.6 KiB | 4,237 |
| 5120 | 642 µs | 827 µs | 1.11 ms | 1.3 MiB | 1,557 |
| 10240 | 1.44 ms | 1.83 ms | 2.38 ms | 2.6 MiB | 695 |

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
| 20 | 196 µs | 389 µs | 354 µs | 245.1 KiB | 5,094 |
| 40 | 274 µs | 373 µs | 1.02 ms | 416.0 KiB | 3,647 |
| 80 | 388 µs | 527 µs | 1.29 ms | 717.8 KiB | 2,575 |
| 160 | 669 µs | 840 µs | 2.20 ms | 1.3 MiB | 1,496 |
| 320 | 1.18 ms | 1.46 ms | 3.14 ms | 2.5 MiB | 845 |
| 640 | 2.25 ms | 2.52 ms | 5.11 ms | 4.8 MiB | 445 |
| 1280 | 4.33 ms | 4.66 ms | 7.39 ms | 9.6 MiB | 231 |
| 2560 | 8.29 ms | 8.74 ms | 11.5 ms | 19.1 MiB | 121 |
| 5120 | 15.8 ms | 16.8 ms | 19.9 ms | 38.0 MiB | 63 |
| 10240 | 29.8 ms | 31.0 ms | 44.3 ms | 20.2 MiB | 34 |

#### Variant `independent`

Every caller asks for a different page; nothing can be shared, so this is the no-dedup comparison.

**Measured: O(n)** (exponent 0.85, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 187 µs | 241 µs | 214 µs | 226.2 KiB | 5,334 |
| 40 | 245 µs | 286 µs | 306 µs | 377.3 KiB | 4,079 |
| 80 | 372 µs | 553 µs | 1.35 ms | 680.8 KiB | 2,689 |
| 160 | 621 µs | 860 µs | 1.81 ms | 1.3 MiB | 1,610 |
| 320 | 1.17 ms | 1.64 ms | 3.13 ms | 2.5 MiB | 856 |
| 640 | 2.24 ms | 2.58 ms | 5.09 ms | 4.8 MiB | 446 |
| 1280 | 4.34 ms | 4.79 ms | 9.43 ms | 9.6 MiB | 230 |
| 2560 | 8.28 ms | 8.93 ms | 12.6 ms | 19.0 MiB | 121 |
| 5120 | 16.7 ms | 17.5 ms | 23.6 ms | 38.0 MiB | 60 |
| 10240 | 31.5 ms | 32.8 ms | 45.9 ms | 20.2 MiB | 32 |

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

**Measured: O(n²)** (exponent 1.89, 10 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 426 µs | 466 µs | 1.47 ms | 522.7 KiB | 2,348 |
| 40 | 1.03 ms | 1.19 ms | 2.95 ms | 1.4 MiB | 973 |
| 80 | 2.93 ms | 4.75 ms | 5.00 ms | 4.3 MiB | 341 |
| 160 | 9.11 ms | 47.4 ms | 14.8 ms | 14.7 MiB | 110 |
| 320 | 31.2 ms | 32.7 ms | 37.2 ms | 53.9 MiB | 32 |
| 640 | 121 ms | 122 ms | 131 ms | 19.0 MiB | 8 |
| 1280 | 492 ms | 514 ms | 509 ms | 67.8 MiB | 2 |
| 2560 | 2.06 s | 2.07 s | 2.09 s | 26.9 MiB | 0 |
| 5120 | 9.64 s | 9.71 s | 9.69 s | 97.8 MiB | 0 |
| 10240 | 52.5 s | 53.4 s | 52.5 s | 437.0 MiB | 0 |

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

**Measured: O(log n)** (exponent 0.35, 10 sizes) -- 🟡 close (neighbouring class).

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 1.71 µs | 4.12 µs | 3.00 µs | 680 B | 585,138 |
| 40 | 1.75 µs | 2.83 µs | 3.00 µs | 680 B | 571,429 |
| 80 | 2.08 µs | 2.54 µs | 3.00 µs | 680 B | 480,077 |
| 160 | 2.67 µs | 3.42 µs | 4.00 µs | 680 B | 374,953 |
| 320 | 4.38 µs | 5.46 µs | 7.00 µs | 680 B | 228,571 |
| 640 | 7.21 µs | 8.25 µs | 10.0 µs | 600 B | 138,715 |
| 1280 | 9.25 µs | 11.4 µs | 13.0 µs | 600 B | 108,108 |
| 2560 | 7.42 µs | 8.04 µs | 10.0 µs | 600 B | 134,825 |
| 5120 | 10.6 µs | 10.9 µs | 14.0 µs | 600 B | 94,491 |
| 10240 | 11.2 µs | 15.0 µs | 15.0 µs | 600 B | 89,222 |

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

**Measured: O(n)** (exponent 1.02, 4 sizes) -- ✅ matches.

| records | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 10 | 11.8 ms | 12.0 ms | 1.48 ms | 34.9 KiB | 85 |
| 20 | 24.7 ms | 25.2 ms | 1.83 ms | 66.6 KiB | 40 |
| 40 | 49.4 ms | 50.6 ms | 2.79 ms | 126.7 KiB | 20 |
| 80 | 99.1 ms | 100 ms | 5.02 ms | 259.1 KiB | 10 |

## 3. What makes up the end-to-end overhead

Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).

**At 640 records** (total added: 262 µs)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `getter-dispatch-cold` | 1 | 279 µs | 107% | 107% |
| `commit-authoritative-array-replace` | 1 | 222 µs | 85% | 85% |
| `reconcile-array-info` | 1 | 105 µs | 40% | 40% |
| _unattributed_ |  | 0 | 0.0% |  |

**At 10240 records** (total added: 3.39 ms)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `getter-dispatch-cold` | 1 | 3.44 ms | 102% | 102% |
| `commit-authoritative-array-replace` | 1 | 3.32 ms | 98% | 98% |
| `reconcile-array-info` | 1 | 2.28 ms | 67% | 67% |
| _unattributed_ |  | 0 | 0.0% |  |

## Cost model

Estimates use two bracketing price shapes: **low** = CPU-priced compute ($0.040 per vCPU-hour, billed on CPU time) and **high** = duration-and-memory-priced functions ($0.000017 per GB-second, billed on wall time, at least 128 MB reserved). Both are rounded list prices and change over time; override them in `benchmark.config.json` → `costRates` to match your platform and negotiated pricing.

## Environment and method

- Run: `2026-10-01T13:39:56.385Z` → `2026-10-01T13:48:19.648Z` (503 s), npm run benchmark
- Machine: Apple M3, 8 logical core(s) (8 physical), 24576 MB RAM, darwin/arm64, Node v24.20.0, local
- Git: `0324a82ac55d05595080af166cfec5df553a1188` on `chore/no-minify-no-dist-urls` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240 records -- One record in the collection a getter fetches and commits (a CRM contact, an order, a support ticket). 640 is a typical full page of a mid-sized table or a busy list endpoint.

**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

