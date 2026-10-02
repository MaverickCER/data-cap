# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **160 files** per operation, routing the work through `data-cap` adds **154 ms** per operation compared with a bare-minimum baseline (16× baseline), about **$0.321 – $2.23 per million operations** of compute. Overall, it grows O(n log n) with workload size (measured exponent 1.19).

> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.

| Cost | Typical (160 files) | Largest (640 files) |
| --- | --- | --- |
| Added latency per operation | 154 ms | 1.34 s |
| Added latency, relative to baseline | 16× baseline | 33× baseline |
| Added CPU time per operation | 198 ms | 2.08 s |
| Added memory per operation (heap delta) | 58.0 MiB | 569.1 MiB |
| Estimated compute cost per 1M operations | $0.321 – $2.23 | $12.40 – $23.34 |
| Single-core throughput ceiling of the overhead alone | 6 ops/s | 1 ops/s |
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
| 20 | 1.60 ms | 22.3 ms | 20.7 ms | 14× baseline | 35.3 ms | $0.043 – $0.397 |
| 40 | 2.92 ms | 39.5 ms | 36.6 ms | 14× baseline | 65.7 ms | $0.076 – $0.739 |
| 80 | 5.19 ms | 72.5 ms | 67.3 ms | 14× baseline | 109 ms | $0.140 – $1.23 |
| 160 | 10.5 ms | 165 ms | 154 ms | 16× baseline | 198 ms | $0.321 – $2.23 |
| 320 | 19.4 ms | 479 ms | 460 ms | 25× baseline | 567 ms | $0.957 – $6.38 |
| 640 | 41.3 ms | 1.38 s | 1.34 s | 33× baseline | 2.08 s | $12.40 – $23.34 |

**How the total grows:** O(n log n) (linearithmic), exponent 1.19 over 6 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.

| Function | Documented | Measured | Agreement | At 160 | At 2560 |
| --- | --- | --- | --- | --- | --- |
| `discoverCapabilityFiles` | O(n) | O(n) | ✅ matches | 4.38 ms | 64.0 ms |
| `linkCapabilityFiles` | O(n) | O(n) | ✅ matches | 44.3 ms | 415 ms |
| `buildInventory` | O(n) | O(n) | ✅ matches | 501 µs | 8.00 ms |
| `buildOwnershipModel` | O(n) | O(n) | ✅ matches | 86.7 µs | 1.57 ms |
| `buildLifecycleModel` | O(n) | O(n) | ✅ matches | 16.7 µs | 461 µs |
| `buildEvidenceModel` | O(1) | O(1) | ✅ matches | 0.613 µs | 0.634 µs |
| `defineEvidenceProjection (project)` | O(n) | O(n) | ✅ matches | 10.8 ms | 186 ms |

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

**Measured: O(n)** (exponent 0.89, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 901 µs | 944 µs | 2.54 ms | 275.0 KiB | 1,110 |
| 40 | 1.37 ms | 1.44 ms | 3.00 ms | 526.0 KiB | 729 |
| 80 | 2.33 ms | 2.40 ms | 3.95 ms | 1.0 MiB | 429 |
| 160 | 4.38 ms | 4.59 ms | 5.83 ms | 2.0 MiB | 228 |
| 320 | 8.23 ms | 8.37 ms | 9.96 ms | 4.0 MiB | 121 |
| 640 | 16.2 ms | 17.3 ms | 18.5 ms | 7.9 MiB | 62 |
| 1280 | 32.0 ms | 32.6 ms | 34.7 ms | 15.7 MiB | 31 |
| 2560 | 64.0 ms | 66.6 ms | 67.0 ms | 31.4 MiB | 16 |

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

**Measured: O(n)** (exponent 0.84, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 7.37 ms | 7.78 ms | 25.2 ms | 3.9 MiB | 136 |
| 40 | 11.6 ms | 12.1 ms | 33.0 ms | 7.6 MiB | 86 |
| 80 | 18.9 ms | 19.5 ms | 37.0 ms | 13.2 MiB | 53 |
| 160 | 44.3 ms | 49.1 ms | 79.1 ms | 28.1 MiB | 23 |
| 320 | 63.0 ms | 79.7 ms | 118 ms | 22.4 MiB | 16 |
| 640 | 116 ms | 118 ms | 193 ms | 54.8 MiB | 9 |
| 1280 | 221 ms | 254 ms | 344 ms | 90.3 MiB | 5 |
| 2560 | 415 ms | 420 ms | 732 ms | 175.5 MiB | 2 |

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

**Measured: O(n)** (exponent 0.98, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 71.5 µs | 78.6 µs | 296 µs | 238.9 KiB | 13,986 |
| 40 | 123 µs | 129 µs | 354 µs | 451.3 KiB | 8,102 |
| 80 | 249 µs | 262 µs | 714 µs | 902.0 KiB | 4,008 |
| 160 | 501 µs | 522 µs | 1.45 ms | 1.8 MiB | 1,997 |
| 320 | 973 µs | 1.03 ms | 1.99 ms | 3.5 MiB | 1,028 |
| 640 | 2.00 ms | 2.09 ms | 4.29 ms | 7.0 MiB | 501 |
| 1280 | 4.00 ms | 4.23 ms | 6.75 ms | 14.1 MiB | 250 |
| 2560 | 8.00 ms | 8.39 ms | 12.0 ms | 28.2 MiB | 125 |

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

**Measured: O(n)** (exponent 1.00, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 11.3 µs | 15.0 µs | 11.7 µs | 19.4 KiB | 88,279 |
| 40 | 22.4 µs | 24.6 µs | 98.9 µs | 28.3 KiB | 44,589 |
| 80 | 44.9 µs | 46.9 µs | 46.0 µs | 43.2 KiB | 22,271 |
| 160 | 86.7 µs | 91.5 µs | 269 µs | 75.7 KiB | 11,530 |
| 320 | 171 µs | 183 µs | 525 µs | 146.9 KiB | 5,832 |
| 640 | 341 µs | 371 µs | 1.12 ms | 276.0 KiB | 2,934 |
| 1280 | 695 µs | 763 µs | 2.16 ms | 558.7 KiB | 1,438 |
| 2560 | 1.57 ms | 1.75 ms | 5.52 ms | 1.1 MiB | 638 |

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

**Measured: O(n)** (exponent 1.02, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 3.61 µs | 5.78 µs | 3.78 µs | 19.1 KiB | 276,853 |
| 40 | 4.42 µs | 6.77 µs | 5.37 µs | 29.2 KiB | 226,065 |
| 80 | 8.90 µs | 13.3 µs | 9.43 µs | 57.6 KiB | 112,384 |
| 160 | 16.7 µs | 26.8 µs | 59.7 µs | 108.2 KiB | 59,795 |
| 320 | 35.0 µs | 38.9 µs | 139 µs | 215.7 KiB | 28,583 |
| 640 | 88.7 µs | 147 µs | 130 µs | 560.9 KiB | 11,271 |
| 1280 | 162 µs | 266 µs | 300 µs | 860.9 KiB | 6,173 |
| 2560 | 461 µs | 723 µs | 648 µs | 2.2 MiB | 2,168 |

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

**Measured: O(1)** (exponent -0.01, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 0.660 µs | 0.974 µs | 0.677 µs | 1.5 KiB | 1,516,035 |
| 40 | 0.619 µs | 0.652 µs | 0.625 µs | 1.4 KiB | 1,614,512 |
| 80 | 0.608 µs | 0.628 µs | 0.618 µs | 1.4 KiB | 1,643,836 |
| 160 | 0.613 µs | 0.626 µs | 0.622 µs | 1.4 KiB | 1,631,076 |
| 320 | 0.596 µs | 0.650 µs | 0.607 µs | 1.4 KiB | 1,678,501 |
| 640 | 0.573 µs | 0.598 µs | 0.594 µs | 1.4 KiB | 1,744,847 |
| 1280 | 0.639 µs | 0.662 µs | 0.661 µs | 1.4 KiB | 1,565,536 |
| 2560 | 0.634 µs | 0.653 µs | 0.651 µs | 1.4 KiB | 1,576,208 |

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

**Measured: O(n)** (exponent 0.99, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 1.55 ms | 1.68 ms | 3.42 ms | 950.5 KiB | 647 |
| 40 | 2.87 ms | 3.09 ms | 4.69 ms | 1.8 MiB | 349 |
| 80 | 5.51 ms | 5.92 ms | 7.41 ms | 3.6 MiB | 182 |
| 160 | 10.8 ms | 11.5 ms | 12.7 ms | 7.0 MiB | 92 |
| 320 | 22.3 ms | 22.9 ms | 24.3 ms | 14.2 MiB | 45 |
| 640 | 44.0 ms | 45.8 ms | 45.8 ms | 28.3 MiB | 23 |
| 1280 | 89.4 ms | 92.4 ms | 91.7 ms | 54.1 MiB | 11 |
| 2560 | 186 ms | 192 ms | 202 ms | 66.6 MiB | 5 |

## 3. What makes up the end-to-end overhead

Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).

**At 160 files** (total added: 154 ms)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `link-capability-files` | 1 | 44.3 ms | 29% | 27% |
| `discover-capability-files` | 1 | 4.38 ms | 2.8% | 2.7% |
| `build-inventory` | 1 | 501 µs | 0.3% | 0.3% |
| `build-ownership-model` | 1 | 86.7 µs | 0.1% | 0.1% |
| `build-lifecycle-model` | 1 | 16.7 µs | 0.0% | 0.0% |
| `build-evidence-model` | 1 | 0.613 µs | 0.0% | 0.0% |
| _unattributed_ |  | 105 ms | 68% |  |

## Failed measurements

- **end-to-end:with-package** at n1280: RangeError: Invalid string length
- **end-to-end:with-package** at n2560: RangeError: Invalid string length

## Cost model

Estimates use two bracketing price shapes: **low** = CPU-priced compute ($0.040 per vCPU-hour, billed on CPU time) and **high** = duration-and-memory-priced functions ($0.000017 per GB-second, billed on wall time, at least 128 MB reserved). Both are rounded list prices and change over time; override them in `benchmark.config.json` → `costRates` to match your platform and negotiated pricing.

## Environment and method

- Run: `2026-10-01T14:36:23.556Z` → `2026-10-01T14:37:12.521Z` (49 s), npm run benchmark
- Machine: Apple M3, 8 logical core(s) (8 physical), 24576 MB RAM, darwin/arm64, Node v24.20.0, local
- Git: `0324a82ac55d05595080af166cfec5df553a1188` on `chore/no-minify-no-dist-urls` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560 files -- One capability file in the project. 160 is a large application's worth of capabilities; 640 a large monorepo's. The ladder stops at 2,560, not 10,240, because every size writes a real project of TypeScript files and links them with the TypeScript compiler API, which takes minutes at the largest sizes.

**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

