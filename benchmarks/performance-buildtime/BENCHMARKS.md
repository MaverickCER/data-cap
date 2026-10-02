# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **160 files** per operation, routing the work through `data-cap` adds **442 ms** per operation compared with a bare-minimum baseline (16× baseline), about **$0.920 – $9.86 per million operations** of compute. Overall, it grows O(n) with workload size (measured exponent 1.04).

> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.

| Cost | Typical (160 files) | Largest (640 files) |
| --- | --- | --- |
| Added latency per operation | 442 ms | 2.76 s |
| Added latency, relative to baseline | 16× baseline | 25× baseline |
| Added CPU time per operation | 877 ms | 4.71 s |
| Added memory per operation (heap delta) | 71.1 MiB | 556.4 MiB |
| Estimated compute cost per 1M operations | $0.920 – $9.86 | $24.98 – $53.01 |
| Single-core throughput ceiling of the overhead alone | 2 ops/s | 0 ops/s |
| Shipped code parsed at every cold start (gzip) | 40.1 KiB | 40.1 KiB |

## 1. End-to-end: the package's total impact

Shows what a pipeline run or a developer pays to regenerate every data-cap artifact (manifest, documentation, ownership report, flow diagrams and evidence) for a project, compared with the bare minimum of just reading every capability file. The baseline is the unavoidable floor -- the files must at least be read -- so the difference is data-cap's parsing, linking and rendering. This is CI and development time, paid on every build, not request-time cost.

- **Baseline (no package):** Walk the project directory and read every capability file as text -- no data-cap.
- **With the package:** `generateDataArtifacts` discovers, parses and links every capability once and writes all of its artifacts.

Both sides use empty or minimal functions on purpose, so the difference is the package's own cost -- not the cost of the work an application would plug into it. Real applications add their own work on top; this is the floor the package imposes.

**Variables that could change this result**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| artifacts requested | fixed at "manifest, docs, ownership, flow and evidence" | Requesting fewer artifacts costs less. |
| type information | fixed at "tsconfig: false" | Linking without a project's tsconfig; resolving a full TypeScript program adds substantial cost and is not covered. |
| cache state | fixed at "no incremental cache" | Every run parses from scratch; the tooling keeps no build cache. |

The baseline is an empty or minimal function, so it costs almost nothing and the _relative_ overhead can look enormous (shown as a multiple of the baseline). Read the absolute columns -- time, CPU and dollars added -- they are what a bill and a latency budget are made of.

| files | Baseline | With package | Added | Added vs baseline | Added CPU | Est. $ / 1M ops |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 5.10 ms | 77.3 ms | 72.2 ms | 15× baseline | 169 ms | $0.150 – $1.90 |
| 40 | 9.13 ms | 129 ms | 120 ms | 14× baseline | 269 ms | $0.250 – $3.02 |
| 80 | 14.0 ms | 225 ms | 211 ms | 16× baseline | 418 ms | $0.439 – $4.70 |
| 160 | 30.5 ms | 472 ms | 442 ms | 16× baseline | 877 ms | $0.920 – $9.86 |
| 320 | 57.2 ms | 1.07 s | 1.01 s | 19× baseline | 1.75 s | $2.26 – $19.69 |
| 640 | 115 ms | 2.87 s | 2.76 s | 25× baseline | 4.71 s | $24.98 – $53.01 |

**How the total grows:** O(n) (linear), exponent 1.04 over 6 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.

| Function | Documented | Measured | Agreement | At 160 | At 2560 |
| --- | --- | --- | --- | --- | --- |
| `discoverCapabilityFiles` | O(n) | O(n) | ✅ matches | 9.97 ms | 140 ms |
| `linkCapabilityFiles` | O(n) | O(n) | ✅ matches | 141 ms | 1.29 s |
| `buildInventory` | O(n) | O(n) | ✅ matches | 2.14 ms | 27.4 ms |
| `buildOwnershipModel` | O(n) | O(n) | ✅ matches | 238 µs | 3.45 ms |
| `buildLifecycleModel` | O(n) | O(n) | ✅ matches | 72.9 µs | 1.68 ms |
| `buildEvidenceModel` | O(1) | O(1) | ✅ matches | 1.82 µs | 1.90 µs |
| `defineEvidenceProjection (project)` | O(n) | O(n) | ✅ matches | 21.8 ms | 425 ms |

### `discoverCapabilityFiles`

**Why we benchmark it.** Every build-time command starts by finding the project's capability files, so its cost is paid first by every generator and every CI run.

**What poor performance would mean.** Every pipeline step that touches data-cap starts later, and a super-linear regression would slow monorepos with thousands of files before any real work begins.

**Expected growth: O(n).** It walks the directory tree once and tests each path, so cost is proportional to the number of files visited.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| directory depth | fixed at "flat" | Deeper trees add a directory read per level. |
| unrelated files | fixed at "none" | Real repositories hold many other files that must also be walked; a pure capability tree is the best case. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once at the start of every artifact generation.

**Measured: O(n)** (exponent 0.93, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 1.48 ms | 2.23 ms | 4.34 ms | 286.6 KiB | 676 |
| 40 | 3.14 ms | 7.43 ms | 5.75 ms | 544.7 KiB | 318 |
| 80 | 5.77 ms | 6.86 ms | 8.23 ms | 1.0 MiB | 173 |
| 160 | 9.97 ms | 12.0 ms | 15.6 ms | 2.1 MiB | 100 |
| 320 | 20.4 ms | 21.2 ms | 29.2 ms | 4.1 MiB | 49 |
| 640 | 40.7 ms | 42.5 ms | 52.5 ms | 8.2 MiB | 25 |
| 1280 | 74.1 ms | 79.0 ms | 83.0 ms | 4.0 MiB | 14 |
| 2560 | 140 ms | 161 ms | 157 ms | 8.1 MiB | 7 |

### `linkCapabilityFiles`

**Why we benchmark it.** Parses every capability file with the TypeScript compiler API and links the declarations (schemas, getters, mutators, documentation) into one model. It is by far the heaviest build-time step, so it dominates every artifact run.

**What poor performance would mean.** Build time grows with the size of the project, and a super-linear regression would make the largest monorepos the slowest to build -- exactly where developers feel it most.

**Expected growth: O(n).** Each file is parsed once and its declarations linked by name through maps, so cost is proportional to the amount of source text.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| type information | fixed at "tsconfig: false" | No TypeScript program is built for type resolution. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run; every artifact is rendered from this one shared pass.

**Measured: O(n)** (exponent 0.82, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 24.7 ms | 30.2 ms | 67.5 ms | 3.7 MiB | 40 |
| 40 | 39.7 ms | 43.4 ms | 92.2 ms | 6.8 MiB | 25 |
| 80 | 68.8 ms | 80.7 ms | 177 ms | 13.0 MiB | 15 |
| 160 | 141 ms | 163 ms | 324 ms | 13.8 MiB | 7 |
| 320 | 242 ms | 261 ms | 541 ms | 22.6 MiB | 4 |
| 640 | 405 ms | 408 ms | 839 ms | 45.9 MiB | 2 |
| 1280 | 689 ms | 698 ms | 1.23 s | 86.4 MiB | 1 |
| 2560 | 1.29 s | 1.31 s | 2.15 s | 167.8 MiB | 1 |

### `buildInventory`

**Why we benchmark it.** Condenses the linked model into the capability inventory every artifact reads from.

**What poor performance would mean.** Every artifact run pays the slowdown after the heavy parsing has already finished, and it grows with the number of capabilities.

**Expected growth: O(n).** It visits each linked capability once and records one inventory entry per capability, so cost is proportional to their number.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run.

**Measured: O(n)** (exponent 0.90, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 292 µs | 374 µs | 939 µs | 230.3 KiB | 3,423 |
| 40 | 577 µs | 647 µs | 2.07 ms | 439.4 KiB | 1,733 |
| 80 | 1.18 ms | 1.32 ms | 3.97 ms | 878.2 KiB | 850 |
| 160 | 2.14 ms | 2.38 ms | 6.86 ms | 1.7 MiB | 467 |
| 320 | 3.55 ms | 4.61 ms | 9.57 ms | 3.4 MiB | 282 |
| 640 | 6.23 ms | 10.1 ms | 15.7 ms | 6.8 MiB | 161 |
| 1280 | 12.0 ms | 15.9 ms | 33.2 ms | 13.5 MiB | 83 |
| 2560 | 27.4 ms | 29.7 ms | 59.3 ms | 14.4 MiB | 37 |

### `buildOwnershipModel`

**Why we benchmark it.** Groups capabilities by their declared owner for the ownership report and audits.

**What poor performance would mean.** Ownership reviews slow down with the size of the project, which discourages running them on every change.

**Expected growth: O(n).** It visits each capability once and appends it to its owner's group in a map, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| owner distribution | fixed at "a handful of owners across all capabilities" | Thousands of distinct owners add map entries proportionally. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run.

**Measured: O(n)** (exponent 0.97, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 31.9 µs | 33.9 µs | 34.1 µs | 19.6 KiB | 31,385 |
| 40 | 62.1 µs | 66.3 µs | 150 µs | 28.5 KiB | 16,114 |
| 80 | 120 µs | 128 µs | 282 µs | 43.6 KiB | 8,305 |
| 160 | 238 µs | 258 µs | 782 µs | 75.8 KiB | 4,193 |
| 320 | 497 µs | 537 µs | 1.74 ms | 146.9 KiB | 2,013 |
| 640 | 994 µs | 1.09 ms | 2.59 ms | 276.4 KiB | 1,006 |
| 1280 | 1.76 ms | 2.15 ms | 6.09 ms | 562.0 KiB | 568 |
| 2560 | 3.45 ms | 3.80 ms | 10.6 ms | 1.1 MiB | 290 |

### `buildLifecycleModel`

**Why we benchmark it.** Finds capabilities that are expiring or past review, for lifecycle reports and compliance checks.

**What poor performance would mean.** Compliance reports slow down with the size of the project.

**Expected growth: O(n).** It checks each capability's dates against the review window once, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| review window | fixed at "30 days" | The window changes how many capabilities are flagged, not how many are checked. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run.

**Measured: O(n)** (exponent 0.91, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 17.3 µs | 19.4 µs | 17.7 µs | 19.5 KiB | 57,859 |
| 40 | 23.2 µs | 33.6 µs | 76.8 µs | 36.4 KiB | 43,130 |
| 80 | 37.4 µs | 68.9 µs | 100 µs | 67.6 KiB | 26,717 |
| 160 | 72.9 µs | 133 µs | 242 µs | 134.5 KiB | 13,719 |
| 320 | 86.9 µs | 259 µs | 321 µs | 268.2 KiB | 11,504 |
| 640 | 395 µs | 422 µs | 825 µs | 571.1 KiB | 2,529 |
| 1280 | 362 µs | 813 µs | 1.49 ms | 913.7 KiB | 2,760 |
| 2560 | 1.68 ms | 1.76 ms | 4.64 ms | 2.2 MiB | 594 |

### `buildEvidenceModel`

**Why we benchmark it.** Assembles the capability, lifecycle and ownership models into the single evidence model that audits and custom projections read.

**What poor performance would mean.** It should cost next to nothing at any size. If it started copying the models it assembles, compliance tooling that rebuilds evidence on every run would get slower with project size, and the saving of building the models once and sharing them would be lost.

**Expected growth: O(1).** It returns a small record that holds references to the already-built capability, lifecycle and ownership models plus a provenance stamp (read from the source: nothing is copied or walked), so the work does not depend on how many capabilities the models contain.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run.

**Measured: O(1)** (exponent 0.03, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 1.61 µs | 3.71 µs | 1.77 µs | 1.4 KiB | 621,816 |
| 40 | 1.46 µs | 3.65 µs | 1.53 µs | 1.4 KiB | 685,350 |
| 80 | 1.49 µs | 3.68 µs | 1.56 µs | 1.4 KiB | 672,963 |
| 160 | 1.82 µs | 3.72 µs | 2.03 µs | 1.4 KiB | 548,469 |
| 320 | 1.49 µs | 2.13 µs | 1.55 µs | 1.4 KiB | 669,448 |
| 640 | 1.49 µs | 2.03 µs | 1.55 µs | 1.4 KiB | 669,269 |
| 1280 | 1.64 µs | 2.56 µs | 1.89 µs | 1.4 KiB | 608,901 |
| 2560 | 1.90 µs | 2.51 µs | 2.02 µs | 1.5 KiB | 525,464 |

### `defineEvidenceProjection (project)`

**Why we benchmark it.** Turns the evidence model into a consumer-specific view (a report, an export); it runs in every pipeline that publishes one.

**What poor performance would mean.** Custom reports slow in proportion to the model, and a copy-heavy implementation would make the projection cost more than building the evidence itself.

**Expected growth: O(n).** The projection copies the model once (`structuredClone`) and reads it through a tracking membrane, both proportional to the model's size, which grows with the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| projection shape | fixed at "four derived fields" | A projection reading fewer fields still pays the clone; one computing more adds proportional work. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**Measured: O(n)** (exponent 1.01, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 3.29 ms | 3.42 ms | 6.10 ms | 1.0 MiB | 304 |
| 40 | 5.92 ms | 7.24 ms | 8.75 ms | 2.0 MiB | 169 |
| 80 | 11.2 ms | 12.4 ms | 14.5 ms | 3.9 MiB | 89 |
| 160 | 21.8 ms | 23.4 ms | 26.6 ms | 7.6 MiB | 46 |
| 320 | 43.5 ms | 44.5 ms | 49.1 ms | 15.0 MiB | 23 |
| 640 | 96.0 ms | 100 ms | 118 ms | 10.0 MiB | 10 |
| 1280 | 209 ms | 211 ms | 284 ms | 37.9 MiB | 5 |
| 2560 | 425 ms | 428 ms | 574 ms | 81.3 MiB | 2 |

## 3. What makes up the end-to-end overhead

Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).

**At 160 files** (total added: 442 ms)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `link-capability-files` | 1 | 141 ms | 32% | 30% |
| `discover-capability-files` | 1 | 9.97 ms | 2.3% | 2.1% |
| `build-inventory` | 1 | 2.14 ms | 0.5% | 0.5% |
| `build-ownership-model` | 1 | 238 µs | 0.1% | 0.1% |
| `build-lifecycle-model` | 1 | 72.9 µs | 0.0% | 0.0% |
| `build-evidence-model` | 1 | 1.82 µs | 0.0% | 0.0% |
| _unattributed_ |  | 288 ms | 65% |  |

## Failed measurements

- **end-to-end:with-package** at n1280: RangeError: Invalid string length
- **end-to-end:with-package** at n2560: RangeError: Invalid string length

## Cost model

Estimates use two bracketing price shapes: **low** = CPU-priced compute ($0.040 per vCPU-hour, billed on CPU time) and **high** = duration-and-memory-priced functions ($0.000017 per GB-second, billed on wall time, at least 128 MB reserved). Both are rounded list prices and change over time; override them in `benchmark.config.json` → `costRates` to match your platform and negotiated pricing.

## Environment and method

- Run: `2026-10-02T01:05:03.387Z` → `2026-10-02T01:06:49.369Z` (106 s), ci
- Machine: AMD EPYC 9V74 80-Core Processor, 4 logical core(s) (2 physical), 15990 MB RAM, linux/x64, Node v22.23.3, GitHub Actions
- Git: `29b74756425d93fc965acb3462d57908c2ab8649` on `chore/no-minify-no-dist-urls` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560 files -- One capability file in the project. 160 is a large application's worth of capabilities; 640 a large monorepo's. The ladder stops at 2,560, not 10,240, because every size writes a real project of TypeScript files and links them with the TypeScript compiler API, which takes minutes at the largest sizes.

**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

