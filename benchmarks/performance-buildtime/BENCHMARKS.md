# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **160 files** per operation, routing the work through `data-cap` adds **450 ms** per operation compared with a bare-minimum baseline (17× baseline), about **$0.937 – $10.23 per million operations** of compute. Overall, it grows O(n) with workload size (measured exponent 1.04).

> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.

| Cost | Typical (160 files) | Largest (640 files) |
| --- | --- | --- |
| Added latency per operation | 450 ms | 2.80 s |
| Added latency, relative to baseline | 17× baseline | 23× baseline |
| Added CPU time per operation | 910 ms | 4.88 s |
| Added memory per operation (heap delta) | 71.1 MiB | 557.0 MiB |
| Estimated compute cost per 1M operations | $0.937 – $10.23 | $25.41 – $54.82 |
| Single-core throughput ceiling of the overhead alone | 2 ops/s | 0 ops/s |
| Shipped code parsed at every cold start (gzip) | 40.2 KiB | 40.2 KiB |

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
| 20 | 5.10 ms | 79.0 ms | 73.9 ms | 15× baseline | 170 ms | $0.154 – $1.91 |
| 40 | 8.07 ms | 131 ms | 123 ms | 16× baseline | 277 ms | $0.256 – $3.11 |
| 80 | 15.9 ms | 237 ms | 221 ms | 15× baseline | 440 ms | $0.460 – $4.94 |
| 160 | 28.7 ms | 479 ms | 450 ms | 17× baseline | 910 ms | $0.937 – $10.23 |
| 320 | 60.4 ms | 1.09 s | 1.03 s | 18× baseline | 1.82 s | $2.30 – $20.42 |
| 640 | 127 ms | 2.93 s | 2.80 s | 23× baseline | 4.88 s | $25.41 – $54.82 |

**How the total grows:** O(n) (linear), exponent 1.04 over 6 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.

| Function | Documented | Measured | Agreement | At 160 | At 2560 |
| --- | --- | --- | --- | --- | --- |
| `discoverCapabilityFiles` | O(n) | O(n) | ✅ matches | 11.4 ms | 147 ms |
| `linkCapabilityFiles` | O(n) | O(n) | ✅ matches | 119 ms | 1.34 s |
| `buildInventory` | O(n) | O(n) | ✅ matches | 2.03 ms | 30.7 ms |
| `buildOwnershipModel` | O(n) | O(n) | ✅ matches | 251 µs | 4.10 ms |
| `buildLifecycleModel` | O(n) | O(n) | ✅ matches | 50.5 µs | 781 µs |
| `buildEvidenceModel` | O(1) | O(1) | ✅ matches | 1.63 µs | 1.97 µs |
| `defineEvidenceProjection (project)` | O(n) | O(n) | ✅ matches | 22.4 ms | 464 ms |

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
| 20 | 2.26 ms | 2.35 ms | 4.61 ms | 283.5 KiB | 443 |
| 40 | 3.14 ms | 3.48 ms | 6.62 ms | 538.5 KiB | 319 |
| 80 | 5.54 ms | 6.96 ms | 8.23 ms | 1.0 MiB | 180 |
| 160 | 11.4 ms | 11.9 ms | 16.0 ms | 2.1 MiB | 87 |
| 320 | 20.4 ms | 21.6 ms | 28.5 ms | 4.1 MiB | 49 |
| 640 | 41.2 ms | 42.7 ms | 52.8 ms | 8.2 MiB | 24 |
| 1280 | 76.2 ms | 83.8 ms | 91.6 ms | 3.9 MiB | 13 |
| 2560 | 147 ms | 164 ms | 171 ms | 8.1 MiB | 7 |

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
| 20 | 26.4 ms | 29.2 ms | 70.9 ms | 3.7 MiB | 38 |
| 40 | 42.3 ms | 49.2 ms | 108 ms | 7.0 MiB | 24 |
| 80 | 66.1 ms | 83.2 ms | 164 ms | 5.8 MiB | 15 |
| 160 | 119 ms | 133 ms | 279 ms | 13.7 MiB | 8 |
| 320 | 235 ms | 244 ms | 530 ms | 22.7 MiB | 4 |
| 640 | 414 ms | 426 ms | 869 ms | 46.1 MiB | 2 |
| 1280 | 725 ms | 737 ms | 1.30 s | 86.9 MiB | 1 |
| 2560 | 1.34 s | 1.36 s | 2.34 s | 168.6 MiB | 1 |

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

**Measured: O(n)** (exponent 0.91, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 327 µs | 421 µs | 1.15 ms | 231.8 KiB | 3,058 |
| 40 | 607 µs | 698 µs | 1.99 ms | 447.8 KiB | 1,646 |
| 80 | 1.24 ms | 1.37 ms | 4.32 ms | 895.1 KiB | 805 |
| 160 | 2.03 ms | 2.45 ms | 6.44 ms | 1.7 MiB | 492 |
| 320 | 3.79 ms | 5.05 ms | 10.9 ms | 3.5 MiB | 264 |
| 640 | 7.06 ms | 11.2 ms | 18.4 ms | 6.9 MiB | 142 |
| 1280 | 13.0 ms | 17.7 ms | 33.8 ms | 14.4 MiB | 77 |
| 2560 | 30.7 ms | 32.2 ms | 65.8 ms | 15.1 MiB | 33 |

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
| 20 | 34.5 µs | 39.7 µs | 35.8 µs | 19.6 KiB | 28,989 |
| 40 | 64.1 µs | 68.3 µs | 114 µs | 28.5 KiB | 15,591 |
| 80 | 124 µs | 147 µs | 355 µs | 43.5 KiB | 8,073 |
| 160 | 251 µs | 265 µs | 858 µs | 75.8 KiB | 3,978 |
| 320 | 536 µs | 582 µs | 1.88 ms | 146.9 KiB | 1,864 |
| 640 | 1.15 ms | 1.28 ms | 3.80 ms | 276.4 KiB | 872 |
| 1280 | 2.17 ms | 2.48 ms | 7.58 ms | 561.1 KiB | 460 |
| 2560 | 4.10 ms | 4.65 ms | 12.2 ms | 1.1 MiB | 244 |

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

**Measured: O(n)** (exponent 0.90, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 20.2 µs | 24.5 µs | 21.1 µs | 19.5 KiB | 49,557 |
| 40 | 22.3 µs | 35.4 µs | 23.4 µs | 29.3 KiB | 44,766 |
| 80 | 24.0 µs | 41.9 µs | 80.4 µs | 57.7 KiB | 41,745 |
| 160 | 50.5 µs | 52.6 µs | 52.9 µs | 134.5 KiB | 19,801 |
| 320 | 182 µs | 367 µs | 499 µs | 268.4 KiB | 5,481 |
| 640 | 361 µs | 745 µs | 887 µs | 536.0 KiB | 2,773 |
| 1280 | 741 µs | 1.37 ms | 2.68 ms | 969.2 KiB | 1,349 |
| 2560 | 781 µs | 4.57 ms | 2.98 ms | 2.1 MiB | 1,281 |

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

**Measured: O(1)** (exponent -0.09, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 4.08 µs | 5.59 µs | 4.41 µs | 1.8 KiB | 245,257 |
| 40 | 1.86 µs | 4.02 µs | 1.94 µs | 1.4 KiB | 538,445 |
| 80 | 1.56 µs | 3.71 µs | 1.66 µs | 1.4 KiB | 640,393 |
| 160 | 1.63 µs | 3.82 µs | 1.71 µs | 1.4 KiB | 612,102 |
| 320 | 1.69 µs | 3.32 µs | 1.82 µs | 1.4 KiB | 591,966 |
| 640 | 1.62 µs | 2.60 µs | 1.71 µs | 1.4 KiB | 617,111 |
| 1280 | 1.76 µs | 2.32 µs | 1.90 µs | 1.4 KiB | 569,503 |
| 2560 | 1.97 µs | 3.06 µs | 2.11 µs | 1.5 KiB | 507,935 |

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

**Measured: O(n)** (exponent 1.02, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 3.38 ms | 3.73 ms | 6.42 ms | 1.0 MiB | 296 |
| 40 | 6.11 ms | 8.92 ms | 9.95 ms | 2.0 MiB | 164 |
| 80 | 11.5 ms | 12.8 ms | 14.7 ms | 4.0 MiB | 87 |
| 160 | 22.4 ms | 23.8 ms | 27.6 ms | 7.7 MiB | 45 |
| 320 | 47.0 ms | 48.2 ms | 53.3 ms | 15.6 MiB | 21 |
| 640 | 103 ms | 105 ms | 125 ms | 10.7 MiB | 10 |
| 1280 | 219 ms | 223 ms | 299 ms | 38.6 MiB | 5 |
| 2560 | 464 ms | 472 ms | 649 ms | 81.9 MiB | 2 |

## 3. What makes up the end-to-end overhead

Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).

**At 160 files** (total added: 450 ms)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `link-capability-files` | 1 | 119 ms | 26% | 25% |
| `discover-capability-files` | 1 | 11.4 ms | 2.5% | 2.4% |
| `build-inventory` | 1 | 2.03 ms | 0.5% | 0.4% |
| `build-ownership-model` | 1 | 251 µs | 0.1% | 0.1% |
| `build-lifecycle-model` | 1 | 50.5 µs | 0.0% | 0.0% |
| `build-evidence-model` | 1 | 1.63 µs | 0.0% | 0.0% |
| _unattributed_ |  | 317 ms | 70% |  |

## Failed measurements

- **end-to-end:with-package** at n1280: RangeError: Invalid string length
- **end-to-end:with-package** at n2560: RangeError: Invalid string length

## Cost model

Estimates use two bracketing price shapes: **low** = CPU-priced compute ($0.040 per vCPU-hour, billed on CPU time) and **high** = duration-and-memory-priced functions ($0.000017 per GB-second, billed on wall time, at least 128 MB reserved). Both are rounded list prices and change over time; override them in `benchmark.config.json` → `costRates` to match your platform and negotiated pricing.

## Environment and method

- Run: `2026-10-02T13:30:44.208Z` → `2026-10-02T13:32:32.440Z` (108 s), ci
- Machine: AMD EPYC 9V74 80-Core Processor, 4 logical core(s) (2 physical), 15990 MB RAM, linux/x64, Node v22.23.3, GitHub Actions
- Git: `a4cfb755011c545987f9bdabe077c250c91dbe6d` on `feat/gdpr-ropa-generator` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560 files -- One capability file in the project. 160 is a large application's worth of capabilities; 640 a large monorepo's. The ladder stops at 2,560, not 10,240, because every size writes a real project of TypeScript files and links them with the TypeScript compiler API, which takes minutes at the largest sizes.

**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

