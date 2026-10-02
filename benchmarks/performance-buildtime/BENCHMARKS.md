# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **160 files** per operation, routing the work through `data-cap` adds **494 ms** per operation compared with a bare-minimum baseline (14× baseline), about **$1.03 – $9.91 per million operations** of compute. Overall, it grows O(n) with workload size (measured exponent 1.05).

> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.

| Cost | Typical (160 files) | Largest (640 files) |
| --- | --- | --- |
| Added latency per operation | 494 ms | 3.06 s |
| Added latency, relative to baseline | 14× baseline | 20× baseline |
| Added CPU time per operation | 881 ms | 5.11 s |
| Added memory per operation (heap delta) | 71.0 MiB | 556.6 MiB |
| Estimated compute cost per 1M operations | $1.03 – $9.91 | $27.76 – $57.40 |
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
| 20 | 6.66 ms | 82.3 ms | 75.7 ms | 12× baseline | 177 ms | $0.158 – $1.99 |
| 40 | 10.6 ms | 144 ms | 133 ms | 14× baseline | 297 ms | $0.278 – $3.34 |
| 80 | 19.2 ms | 264 ms | 245 ms | 14× baseline | 489 ms | $0.511 – $5.50 |
| 160 | 39.4 ms | 534 ms | 494 ms | 14× baseline | 881 ms | $1.03 – $9.91 |
| 320 | 79.7 ms | 1.22 s | 1.14 s | 15× baseline | 1.93 s | $2.55 – $21.72 |
| 640 | 162 ms | 3.23 s | 3.06 s | 20× baseline | 5.11 s | $27.76 – $57.40 |

**How the total grows:** O(n) (linear), exponent 1.05 over 6 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.

| Function | Documented | Measured | Agreement | At 160 | At 2560 |
| --- | --- | --- | --- | --- | --- |
| `discoverCapabilityFiles` | O(n) | O(n) | ✅ matches | 13.6 ms | 202 ms |
| `linkCapabilityFiles` | O(n) | O(n) | ✅ matches | 145 ms | 1.43 s |
| `buildInventory` | O(n) | O(n) | ✅ matches | 1.49 ms | 20.6 ms |
| `buildOwnershipModel` | O(n) | O(n) | ✅ matches | 251 µs | 3.75 ms |
| `buildLifecycleModel` | O(n) | O(n) | ✅ matches | 79.1 µs | 1.49 ms |
| `buildEvidenceModel` | O(1) | O(1) | ✅ matches | 1.85 µs | 1.91 µs |
| `defineEvidenceProjection (project)` | O(n) | O(n) | ✅ matches | 23.2 ms | 448 ms |

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

**Measured: O(n)** (exponent 0.92, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 2.41 ms | 2.49 ms | 4.49 ms | 283.3 KiB | 415 |
| 40 | 4.07 ms | 5.74 ms | 6.50 ms | 542.8 KiB | 245 |
| 80 | 7.04 ms | 10.8 ms | 9.10 ms | 1.0 MiB | 142 |
| 160 | 13.6 ms | 16.4 ms | 16.2 ms | 2.1 MiB | 74 |
| 320 | 25.9 ms | 31.8 ms | 36.0 ms | 4.1 MiB | 39 |
| 640 | 52.1 ms | 58.6 ms | 60.2 ms | 8.2 MiB | 19 |
| 1280 | 101 ms | 117 ms | 106 ms | 3.9 MiB | 10 |
| 2560 | 202 ms | 233 ms | 209 ms | 8.1 MiB | 5 |

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
| 20 | 28.2 ms | 33.8 ms | 75.0 ms | 3.7 MiB | 35 |
| 40 | 43.0 ms | 48.5 ms | 111 ms | 7.0 MiB | 23 |
| 80 | 76.2 ms | 82.5 ms | 182 ms | 13.0 MiB | 13 |
| 160 | 145 ms | 161 ms | 347 ms | 13.8 MiB | 7 |
| 320 | 252 ms | 259 ms | 556 ms | 22.8 MiB | 4 |
| 640 | 438 ms | 443 ms | 900 ms | 46.1 MiB | 2 |
| 1280 | 772 ms | 773 ms | 1.33 s | 86.7 MiB | 1 |
| 2560 | 1.43 s | 1.44 s | 2.37 s | 168.8 MiB | 1 |

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

**Measured: O(n)** (exponent 0.86, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 277 µs | 417 µs | 1.07 ms | 237.4 KiB | 3,611 |
| 40 | 480 µs | 569 µs | 1.84 ms | 465.0 KiB | 2,085 |
| 80 | 966 µs | 1.04 ms | 3.73 ms | 929.4 KiB | 1,036 |
| 160 | 1.49 ms | 1.82 ms | 4.33 ms | 1.8 MiB | 672 |
| 320 | 2.55 ms | 2.89 ms | 5.55 ms | 3.6 MiB | 392 |
| 640 | 4.75 ms | 5.06 ms | 8.41 ms | 7.3 MiB | 210 |
| 1280 | 9.34 ms | 9.60 ms | 13.8 ms | 14.5 MiB | 107 |
| 2560 | 20.6 ms | 23.7 ms | 30.8 ms | 15.4 MiB | 49 |

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

**Measured: O(n)** (exponent 0.96, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 36.5 µs | 42.1 µs | 82.1 µs | 19.6 KiB | 27,403 |
| 40 | 69.9 µs | 79.1 µs | 152 µs | 28.5 KiB | 14,309 |
| 80 | 134 µs | 156 µs | 445 µs | 43.5 KiB | 7,441 |
| 160 | 251 µs | 285 µs | 885 µs | 76.0 KiB | 3,978 |
| 320 | 534 µs | 592 µs | 1.95 ms | 147.3 KiB | 1,872 |
| 640 | 1.12 ms | 1.22 ms | 3.87 ms | 277.3 KiB | 896 |
| 1280 | 1.84 ms | 2.42 ms | 6.42 ms | 561.1 KiB | 543 |
| 2560 | 3.75 ms | 4.38 ms | 11.0 ms | 1.1 MiB | 266 |

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
| 20 | 13.6 µs | 22.6 µs | 15.3 µs | 17.4 KiB | 73,683 |
| 40 | 22.8 µs | 41.2 µs | 92.1 µs | 34.1 KiB | 43,919 |
| 80 | 44.2 µs | 81.1 µs | 114 µs | 64.0 KiB | 22,603 |
| 160 | 79.1 µs | 162 µs | 257 µs | 134.5 KiB | 12,635 |
| 320 | 86.2 µs | 301 µs | 355 µs | 268.2 KiB | 11,598 |
| 640 | 266 µs | 630 µs | 999 µs | 535.9 KiB | 3,762 |
| 1280 | 429 µs | 1.31 ms | 918 µs | 1.0 MiB | 2,331 |
| 2560 | 1.49 ms | 2.88 ms | 5.38 ms | 2.1 MiB | 673 |

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

**Measured: O(1)** (exponent -0.02, 8 sizes) -- ✅ matches.

| files | Median | p95 | CPU (median) | Heap Δ | Ops/s |
| --- | --- | --- | --- | --- | --- |
| 20 | 2.36 µs | 4.67 µs | 3.93 µs | 1.4 KiB | 423,494 |
| 40 | 1.59 µs | 4.05 µs | 1.65 µs | 1.4 KiB | 630,070 |
| 80 | 1.58 µs | 3.98 µs | 1.64 µs | 1.4 KiB | 634,668 |
| 160 | 1.85 µs | 4.05 µs | 2.14 µs | 1.4 KiB | 541,100 |
| 320 | 1.62 µs | 2.52 µs | 1.76 µs | 1.4 KiB | 619,080 |
| 640 | 1.63 µs | 2.67 µs | 1.69 µs | 1.4 KiB | 614,971 |
| 1280 | 1.67 µs | 1.97 µs | 1.82 µs | 1.4 KiB | 598,932 |
| 2560 | 1.91 µs | 2.35 µs | 2.01 µs | 1.4 KiB | 523,650 |

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
| 20 | 3.47 ms | 3.62 ms | 6.21 ms | 1.0 MiB | 288 |
| 40 | 6.27 ms | 7.61 ms | 9.00 ms | 2.0 MiB | 159 |
| 80 | 11.9 ms | 13.2 ms | 14.7 ms | 4.0 MiB | 84 |
| 160 | 23.2 ms | 24.7 ms | 28.2 ms | 7.7 MiB | 43 |
| 320 | 46.1 ms | 47.3 ms | 51.5 ms | 15.1 MiB | 22 |
| 640 | 99.5 ms | 101 ms | 121 ms | 10.1 MiB | 10 |
| 1280 | 222 ms | 222 ms | 301 ms | 37.5 MiB | 5 |
| 2560 | 448 ms | 454 ms | 604 ms | 82.9 MiB | 2 |

## 3. What makes up the end-to-end overhead

Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).

**At 160 files** (total added: 494 ms)

| Function | Calls / operation | Estimated time | Share of added time | Share of operation |
| --- | --- | --- | --- | --- |
| `link-capability-files` | 1 | 145 ms | 29% | 27% |
| `discover-capability-files` | 1 | 13.6 ms | 2.7% | 2.5% |
| `build-inventory` | 1 | 1.49 ms | 0.3% | 0.3% |
| `build-ownership-model` | 1 | 251 µs | 0.1% | 0.0% |
| `build-lifecycle-model` | 1 | 79.1 µs | 0.0% | 0.0% |
| `build-evidence-model` | 1 | 1.85 µs | 0.0% | 0.0% |
| _unattributed_ |  | 334 ms | 68% |  |

## Failed measurements

- **end-to-end:with-package** at n1280: RangeError: Invalid string length
- **end-to-end:with-package** at n2560: RangeError: Invalid string length

## Cost model

Estimates use two bracketing price shapes: **low** = CPU-priced compute ($0.040 per vCPU-hour, billed on CPU time) and **high** = duration-and-memory-priced functions ($0.000017 per GB-second, billed on wall time, at least 128 MB reserved). Both are rounded list prices and change over time; override them in `benchmark.config.json` → `costRates` to match your platform and negotiated pricing.

## Environment and method

- Run: `2026-10-02T14:24:44.331Z` → `2026-10-02T14:26:37.336Z` (113 s), ci
- Machine: AMD EPYC 7763 64-Core Processor, 4 logical core(s) (2 physical), 15990 MB RAM, linux/x64, Node v22.23.3, GitHub Actions
- Git: `c7233e83f8e7c7e16e01866bb364781cfa73bd35` on `fix/code-scanning-and-caches` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560 files -- One capability file in the project. 160 is a large application's worth of capabilities; 640 a large monorepo's. The ladder stops at 2,560, not 10,240, because every size writes a real project of TypeScript files and links them with the TypeScript compiler API, which takes minutes at the largest sizes.

**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

