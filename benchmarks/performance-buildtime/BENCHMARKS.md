# data-cap: performance and cost report

What does adopting this package add to latency, CPU, memory and compute spend, and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](../READING-BENCHMARKS.md) first.

## What adopting this package costs

For a typical workload of **160 files** per operation, routing the work through `data-cap` adds **494 ms** per operation compared with a bare-minimum baseline (**14× the baseline**). Overall, it grows O(n log n) with workload size (measured exponent 1.12). At list prices that is on the order of **~$1 – $10 per million operations** of compute.

> The relative figure and the growth class are the steadier ones. Both come from the same run, so they depend far less on the machine than a time does. Runtime behaviour and contention on the runner still move them. The growth class is an empirical fit to the sizes tested, not a proof of asymptotic complexity. Dollar figures are **order-of-magnitude** estimates from published list prices on shared hardware (see _Cost model_ below). They show scale, not a budget.

| Cost | Typical (160 files) | Largest (640 files) |
| --- | --- | --- |
| Added latency per operation | 494 ms | 3.06 s |
| Added latency, relative to baseline | 14× baseline | 20× baseline |
| Added CPU time per operation | 881 ms | 5.11 s |
| Added memory per operation (heap delta) | 71.0 MiB | 556.6 MiB |
| Compute cost per 1M operations (order of magnitude) | ~$1 – $10 | ~$10 – $100 |
| Single-core throughput ceiling of the overhead alone | 2 ops/s | 0 ops/s |
| Shipped code parsed at every cold start (gzip) | 40.2 KiB | 40.2 KiB |

## 1. End-to-end: the package's total impact

Shows what a pipeline run or a developer pays to regenerate every data-cap artifact for a project: manifest, documentation, ownership report, flow diagrams and evidence. It compares that with the bare minimum of reading every capability file. The baseline is the unavoidable floor (the files must at least be read), so the difference is data-cap's parsing, linking and rendering. This is CI and development time, paid on every build, not request-time cost.

- **Baseline (no package):** Walk the project directory and read every capability file as text, with no data-cap.
- **With the package:** `generateDataArtifacts` discovers, parses and links every capability once and writes all of its artifacts.

Both sides use empty or minimal functions on purpose. The difference is then the package's own cost, not the cost of the work an application would plug into it. Real applications add their own work on top; this is the floor the package imposes.

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

The baseline is an empty or minimal function, so it costs almost nothing. The _relative_ overhead can then look enormous (shown as a multiple of the baseline). Read the absolute columns (time, CPU and dollars added): they are what a bill and a latency budget are made of.

| files | Baseline | With package | Added | Added vs baseline | Added CPU | Est. $ / 1M ops |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 6.66 ms | 82.3 ms | 75.7 ms | 12× baseline | 177 ms | $0.158 – $1.99 |
| 40 | 10.6 ms | 144 ms | 133 ms | 14× baseline | 297 ms | $0.278 – $3.34 |
| 80 | 19.2 ms | 264 ms | 245 ms | 14× baseline | 489 ms | $0.511 – $5.50 |
| 160 | 39.4 ms | 534 ms | 494 ms | 14× baseline | 881 ms | $1.03 – $9.91 |
| 320 | 79.7 ms | 1.22 s | 1.14 s | 15× baseline | 1.93 s | $2.55 – $21.72 |
| 640 | 162 ms | 3.23 s | 3.06 s | 20× baseline | 5.11 s | $27.76 – $57.40 |

**How the total grows:** O(n log n) (linearithmic), exponent 1.12 over 6 sizes.

## 2. Function by function

Every function the package exposes is measured on its own across the full size ladder. Its measured growth rate is then compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report. Either the documentation or the code is wrong.

| Function | Varies | Documented | Measured | Agreement | At 160 | At 2560 |
| --- | --- | --- | --- | --- | --- | --- |
| `discoverCapabilityFiles` | file | O(n) | O(n) | ✅ matches | 13.6 ms | 202 ms |
| `linkCapabilityFiles` | file | O(n) | O(n) | ✅ matches | 145 ms | 1.43 s |
| `buildInventory` | file | O(n) | O(n) | ✅ matches | 1.49 ms | 20.6 ms |
| `buildOwnershipModel` | file | O(n) | O(n) | ✅ matches | 251 µs | 3.75 ms |
| `buildLifecycleModel` | file | O(n) | O(n) | ✅ matches | 79.1 µs | 1.49 ms |
| `buildEvidenceModel` | file | O(1) | O(1) | ✅ matches | 1.85 µs | 1.91 µs |
| `generateDataArtifacts` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `computeDataArtifacts` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `checkArtifacts` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `computeSourceFingerprint` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `getEvidenceModel` (cache-hit) | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `getEvidenceModel` (cache-miss) | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `parseCapabilityFile` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `generateManifest` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `generateDocumentation` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `generateFlow` | file | O(n²) | n/a | ❔ not enough data | n/a | n/a |
| `scanFlow` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `computeDataArtifacts` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildCycloneDxBom` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `renderFlowCycloneDx` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `traceFlow` | file | O(n log n) | n/a | ❔ not enough data | n/a | n/a |
| `filterFlow` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `diffFlow` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `renderFlowText` | file | O(n²) | n/a | ❔ not enough data | n/a | n/a |
| `renderFlowDot` | file | O(n log n) | n/a | ❔ not enough data | n/a | n/a |
| `renderFlowMermaid` | file | O(n log n) | n/a | ❔ not enough data | n/a | n/a |
| `evaluateEvidenceRules` | file | O(n²) | n/a | ❔ not enough data | n/a | n/a |
| `observedFlow` | file | O(n log n) | n/a | ❔ not enough data | n/a | n/a |
| `buildObservationModel` | file | O(n log n) | n/a | ❔ not enough data | n/a | n/a |
| `observationsToOtlp` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `observationsFromOtlp` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `diffManifestSnapshots` (first-run) | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `diffManifestSnapshots` (unchanged) | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectAuditEvidence` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectClassificationEvidence` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectComplianceEvidence` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectPrivacyEvidence` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectRetentionEvidence` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `computeExpiringEntries` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildOwnershipMatrix` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildManifestSnapshot` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `checkDuplicateEndpoints` | file | O(n²) | n/a | ❔ not enough data | n/a | n/a |
| `checkExclusiveGroups` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `checkOwnershipAndSensitivity` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `checkStructuralDuplication` | file | O(n²) | n/a | ❔ not enough data | n/a | n/a |
| `findManifestExportCollisions` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectFields` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectGetters` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectMutators` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectOperationInventory` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `projectSubscriptions` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `renderManifest` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildOpenApiSchemaArtifact` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `renderDocumentation` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `renderOwnershipGraphDot` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildFlowGraph` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `deriveUsageFindings` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `renderUsageReport` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `buildSarifLog` | file | O(n) | n/a | ❔ not enough data | n/a | n/a |
| `defineEvidenceProjection (project)` | file | O(n) | O(n) | ✅ matches | 23.2 ms | 448 ms |

### `discoverCapabilityFiles`

**Why we benchmark it.** Every build-time command starts by finding the project's capability files. So every generator and every CI run pays this cost first.

**What poor performance would mean.** Every pipeline step that touches data-cap starts later. A super-linear regression would slow monorepos with thousands of files before any real work begins.

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

**Measured: O(n)** (exponent 0.98, 8 sizes): ✅ matches.

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

**What poor performance would mean.** Build time grows with the size of the project. A super-linear regression would make the largest monorepos the slowest to build, which is exactly where developers feel it most.

**Expected growth: O(n).** Each file is parsed once and its declarations linked by name through maps. Cost is proportional to the amount of source text.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| type information | fixed at "tsconfig: false" | No TypeScript program is built for type resolution. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run; every artifact is rendered from this one shared pass.

**Measured: O(n)** (exponent 0.82, 8 sizes): ✅ matches.

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

**What poor performance would mean.** Every artifact run pays the slowdown after the heavy parsing has already finished. It grows with the number of capabilities.

**Expected growth: O(n).** It visits each linked capability once and records one inventory entry per capability, so cost is proportional to their number.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run.

**Measured: O(n)** (exponent 0.95, 8 sizes): ✅ matches.

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

**Expected growth: O(n).** It visits each capability once and appends it to its owner's group in a map. Cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| owner distribution | fixed at "a handful of owners across all capabilities" | Thousands of distinct owners add map entries proportionally. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run.

**Measured: O(n)** (exponent 0.96, 8 sizes): ✅ matches.

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

**Measured: O(n)** (exponent 1.08, 8 sizes): ✅ matches.

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

**What poor performance would mean.** It should cost next to nothing at any size. If it started copying the models it assembles, evidence rebuilt on every run would get slower with project size. The saving of building the models once and sharing them would be lost.

**Expected growth: O(1).** It returns a small record that holds references to the already-built capability, lifecycle and ownership models plus a provenance stamp. Reading the source confirms that nothing is copied or walked. So the work does not depend on how many capabilities the models contain.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Once per artifact run.

**Measured: O(1)** (exponent 0.01, 8 sizes): ✅ matches.

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

### `generateDataArtifacts`

**Why we benchmark it.** The combined entry point most pipelines call. It shares one discovery and parse across the manifest, documentation, ownership report, flow diagrams and evidence.

**What poor performance would mean.** The shared pass is the whole saving over running the generators one by one. If it stopped being shared, every pipeline would pay several times the parsing.

**Expected growth: O(n).** It discovers, parses and links once and renders each artifact from that single pass. Cost is proportional to the amount of source.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** This is the end-to-end operation itself.

### `computeDataArtifacts`

**Why we benchmark it.** It computes every artifact in memory without writing any, for tools that want the content and not the files.

**What poor performance would mean.** A slower read-only run in proportion to the amount of source.

**Expected growth: O(n).** It runs the same single discovery, parse and link as generation and renders each artifact once. Cost is proportional to the amount of source.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** A read-only run, not part of generating the artifacts.

### `checkArtifacts`

**Why we benchmark it.** The CI gate that fails when a committed artifact is stale. It recomputes every artifact in memory and compares it with the file on disk.

**What poor performance would mean.** A slower gate on every pull request, which is the most frequent place build-time cost is paid.

**Expected growth: O(n).** It runs one shared discovery, parse and link, renders each artifact once and compares each with its file. Cost is proportional to the amount of source.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** A CI gate, not part of generating the artifacts.

### `computeSourceFingerprint`

**Why we benchmark it.** It decides whether a cached evidence model is still current. It runs before every cached read, so it must cost far less than the recompute it avoids.

**What poor performance would mean.** A cache that costs nearly as much as the recompute it saves, which makes every cached read pointless.

**Expected growth: O(n).** It walks the capability files and hashes each one's text once, with no parsing or linking. Cost is proportional to the bytes of source.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Run before a cached read, not while generating.

### `getEvidenceModel`

**Why we benchmark it.** The cached way to read the evidence model. It trusts a committed artifact only while the source fingerprint matches, and recomputes otherwise.

**What poor performance would mean.** The cache would be worse than not having it. That happens when a miss costs more than a plain recompute, or a hit costs nearly as much as one.

**Expected growth: O(n).** A hit fingerprints the source and reads one file. A miss does that and then rebuilds the model, so both grow with the amount of source.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| cache state | variant | A committed artifact whose fingerprint matches, or none. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** A cached read, not part of generating the artifacts.

#### Variant `cache-hit`

The committed artifact is current: read from disk, no recompute.

#### Variant `cache-miss`

No artifact exists: the model is rebuilt.

### `parseCapabilityFile`

**Why we benchmark it.** Every generator parses each capability file with the TypeScript parser, which is the largest single cost of a build-time run.

**What poor performance would mean.** Every build-time command slows in proportion to the source it parses. A super-linear parse would punish the largest files first.

**Expected growth: O(n).** The text is parsed once by the TypeScript parser and the declarations read from one syntax tree. Cost is proportional to the length of the source.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many copies of the fixture capability the one source file declares. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Run once per capability file inside every generator; measured here on one file.

### `generateManifest`

**Why we benchmark it.** It renders the manifest the application imports at runtime. It diffs it against the previous snapshot in every build that ships the application.

**What poor performance would mean.** Slower builds in proportion to the number of capabilities.

**Expected growth: O(n).** One manifest entry is rendered and one snapshot entry diffed for each capability. Cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Run inside every artifact generation; measured on its own.

### `generateDocumentation`

**Why we benchmark it.** It renders the Markdown reference from an inventory and a change report, wherever documentation is regenerated.

**What poor performance would mean.** Documentation builds slow down in proportion to the number of capabilities and the prose each carries.

**Expected growth: O(n).** One section is rendered for each capability, once, so cost is proportional to the amount of documentation.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Run inside every artifact generation; measured on its own.

### `generateFlow`

**Why we benchmark it.** It renders the flow diagrams of how data moves between capabilities, in every pipeline that publishes them.

**What poor performance would mean.** A slower diagram step that grows with the square of the number of capabilities, so the largest projects pay most. Drawing each capability from a grouped list of its own flows would make it linear.

**Expected growth: O(n²).** Each capability's diagram is drawn from the list of every flow filtered for that capability. So the work grows with the number of capabilities times the number of flows. The flows grow with the capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Run inside every artifact generation; measured on its own.

### `scanFlow`

**Why we benchmark it.** It is the pass that reads every source module and follows each capability field through the functions that touch it. Every pipeline that computes flow evidence runs it. It is the one step whose cost grows with the amount of application code, not with the number of capabilities.

**What poor performance would mean.** A slower evidence build in proportion to the application's size, on every pull request that runs the flow gate. A regression to quadratic would make a 10,000-function service take minutes before any policy is evaluated.

**Expected growth: O(n).** Each module is parsed and indexed once. Every function body is evaluated once per distinct shape of argument, because results are memoised by signature. Chains cross files only within a bounded group, so the work is proportional to the number of functions.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| analysis budget | fixed at "the scanner's own limits (call depth 40, 3,000,000 steps)" | These fixtures stay far inside both limits; what happens beyond them is proven by test/build/flow-scale.test.ts, which asserts an explicit unknown, not measured here. |

**In the end-to-end run:** Run only when flow evidence is requested, which the end-to-end operation does not do; measured on its own.

### `computeDataArtifacts`

**Why we benchmark it.** It is the whole flow evidence build a pipeline pays for when it turns on `flowEvidence`. That covers scan, model, declared policy, claims and least-data analysis. It is the number a team adopting the flow gate budgets for.

**What poor performance would mean.** A flow gate that is too slow to run on every pull request, so it gets skipped. The post-scan analyses trace each field across the whole graph. If they regressed to a scan of every edge per node, a project twice as large would cost four times as much.

**Expected growth: O(n).** The policy, claims and least-data passes each trace a field's flow through an index of edges by node. Every edge is visited a bounded number of times, so the work grows with the number of modules.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Every sample runs the whole flow evidence pipeline (scan, model, policy, claims and least-data analysis) over a real project. That analysis grows faster than linearly, so at 1,280 modules one sample takes minutes.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| filesystem | fixed at "local SSD through the Node adapter" | A network or virtual filesystem adds latency per file; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| post-scan analyses | fixed at "policy with two rules, claims, least-data" | All three run whenever flow evidence is on; none can be requested alone. |

**In the end-to-end run:** Run only when flow evidence is requested, which the end-to-end operation does not do; measured on its own.

### `buildCycloneDxBom`

**Why we benchmark it.** It turns the evidence's flow, policy, claims and observations into a CycloneDX 1.6 document for the supply-chain tools that read it. It runs once per published evidence build.

**What poor performance would mean.** A slower export step in proportion to the size of the flow graph. A regression to quadratic would make exporting a large project's data flows slower than computing them.

**Expected growth: O(n).** Each edge that crosses a boundary is folded into one flow record by a map lookup. Each record is written once on each of its two services. Annotations are written once per unknown, non-satisfied policy result and unverified claim. So the work is proportional to the nodes plus the edges.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| policy and claims | fixed at "the fixture's two rules and the claims the pipeline derives" | Each non-satisfied policy result and each claim that is not simply verified adds one annotation. |
| document name | fixed at "the default" | `options.name` is only copied into the document's metadata. |

**Deliberately not covered**

- **runtime observations**: The fixture records none; each observation adds one flow record and is matched against the field and boundary nodes only.

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `renderFlowCycloneDx`

**Why we benchmark it.** It writes the CycloneDX document as the text a pipeline publishes, once per evidence build that exports it.

**What poor performance would mean.** A slower export step in proportion to the size of the flow graph.

**Expected growth: O(n).** It builds the document once and serializes it once; both are single passes over the nodes, edges and annotations.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| policy and claims | fixed at "the fixture's two rules and the claims the pipeline derives" | Each non-satisfied policy result and each claim that is not simply verified adds one annotation. |
| document name | fixed at "the default" | `options.name` is only copied into the document's metadata. |

**Deliberately not covered**

- **runtime observations**: The fixture records none.

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `traceFlow`

**Why we benchmark it.** Every flow question is a trace. The policy, claims and least-data passes trace each governed field, and the diagram and text views trace what they draw. A reviewer or a script asks where one field goes. Its cost is paid once per field per question.

**What poor performance would mean.** Every flow check and view slows with the size of the application. A trace that rescanned the edge list per node would make each question quadratic in the code base.

**Expected growth: O(n log n).** A breadth-first walk expands each reached node once through an index of edges by node. Then it sorts the reached nodes and edges by id. The work is the walk (linear in what the field reaches) plus the sort.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| flow index | fixed at "already built" | The adjacency index of a flow model is built on its first query (one pass over its nodes, edges and unknowns). It is cached on that model object, so after the warm-up every sample reuses it. A first query on a freshly loaded model also pays that pass. |
| direction | fixed at "downstream from the one field" | What every policy, claim and least-data check asks. Upstream repeats the downstream walk once per field node, and the fixture has one. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `filterFlow`

**Why we benchmark it.** It narrows a flow model to the nodes a reviewer or a view asks for: one file, one kind, one classification. It runs once per such question.

**What poor performance would mean.** A slower review tool in proportion to the size of the application's flow.

**Expected growth: O(n).** Each node is tested against the filter once. Each edge and unknown is kept or dropped by a set lookup of its ends. So the work is proportional to the nodes plus the edges.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| filter | fixed at "function, field and boundary nodes" | Keeps every function and drops parameters and return values; each further criterion adds one comparison per node. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `diffFlow`

**Why we benchmark it.** It tells what changed in the data flow between two revisions. A pull-request review of flow evidence asks that once per change.

**What poor performance would mean.** A slower review step in proportion to the size of the application's flow.

**Expected growth: O(n).** Both models' nodes, edges and unknowns are indexed by id once. Every node present in both is compared through one JSON serialization of each side. Each list is checked against the other's index once.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| revisions compared | fixed at "the same model on both sides" | Every node is found in both and compared, which is the most comparison work; a real change adds one entry per difference. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `renderFlowText`

**Why we benchmark it.** It writes the flow as Markdown, the text equivalent of the diagrams that a review or an accessibility reader uses. It runs once per published evidence build.

**What poor performance would mean.** The text view grows with the square of the application's functions. On a large service it is the slowest flow export. Indexing the edges and nodes by function once would make it linear.

**Expected growth: O(n²).** The graph view it renders builds one entry per function node. Each entry filters the whole edge list (twice), the whole unknown list and the whole node list (twice). So the work is the number of functions times the size of the flow.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `renderFlowDot`

**Why we benchmark it.** It draws the flow as Graphviz text for the published diagram, once per evidence build that exports it.

**What poor performance would mean.** A slower diagram step in proportion to the size of the application's flow.

**Expected growth: O(n log n).** It selects the drawable nodes and edges in one pass and sorts them by id. It writes one line per node, edge and unknown, so the sort dominates as the flow grows.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `renderFlowMermaid`

**Why we benchmark it.** It draws the flow as a Mermaid chart that renders inline in documentation and pull requests. It runs once per evidence build that exports it.

**What poor performance would mean.** A slower diagram step in proportion to the size of the application's flow.

**Expected growth: O(n log n).** It selects the drawable nodes and edges in one pass and sorts them by id. It writes one line per node, edge and unknown, so the sort dominates as the flow grows.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `evaluateEvidenceRules`

**Why we benchmark it.** It is the CI gate over flow evidence. Every pull request that runs `data-cap --rules` evaluates it once, and three of its rules re-run whole-flow analyses.

**What poor performance would mean.** A slower gate on every pull request. Its redundant-transformation rule grows with the square of the functions that carry one field, so a large service pays for that rule most.

**Expected growth: O(n²).** With every rule set, the redundant-transformation rule groups the edges carrying each field path. For each function in a group, it filters that whole group. So its work is the functions times the edges of one field's flow. The two least-data rules each trace the field once and then once per key. The other rules scan the policy results or the claims once.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| rules set | fixed at "all twelve" | Every check runs; a gate that sets fewer rules skips their work. |

**Deliberately not covered**

- **runtime observations**: The fixture records none, so the observation rules find none and no claim is verified.

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `observedFlow`

**Why we benchmark it.** It joins what a test run witnessed to the static flow. That step shows which static routes were actually exercised, once per review of observed evidence.

**What poor performance would mean.** A slower review of runtime evidence. The slowdown follows the size of the application's flow, multiplied by how many distinct things were observed.

**Expected growth: O(n log n).** For each observation it traces the observed field to the observed boundary (`traceFlowBetween`). A trace is a breadth-first walk through the edge index, a reverse walk over the edges it reached, and a sort of the result. With the observations held fixed, each trace grows with the flow it reaches.

**Measured on a shorter ladder (20, 40, 80, 160, 320, 640).** Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| application modules | swept | The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here. |
| source shape | fixed at "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field" | Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered. |
| tracked capabilities | fixed at "one capability with a single five-field record" | A project with many capabilities tracks more data through every function; not covered. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |
| flow index | fixed at "already built" | The adjacency index of a flow model is built on its first query (one pass over its nodes, edges and unknowns). It is cached on that model object, so after the warm-up every sample reuses it. A first query on a freshly loaded model also pays that pass. |
| observations | fixed at "four, in one execution: three keys at the response and one in the log" | Each distinct observation adds one trace per candidate field and boundary. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `buildObservationModel`

**Why we benchmark it.** It turns the events a test run recorded into the observation model the evidence carries. It runs once per evidence build that ingests `--observations`.

**What poor performance would mean.** A slower evidence build in proportion to how much runtime evidence a team collects, which grows with the test suite.

**Expected growth: O(n log n).** Each event is validated and grouped into its observation by a map lookup once. Then the observations and the scopes are sorted, so the sort dominates as the events grow.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| observation events | swept | The tier axis here is runtime observation events, this many, each recorded in its own execution (scope). |
| event shape | fixed at "a boundary, a field path and a time, each from its own execution" | Every event is its own observation, the most grouping and sorting work; repeated events only raise a count. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `observationsToOtlp`

**Why we benchmark it.** It exports the observation model as OpenTelemetry spans for the tracing back ends teams already run. It runs once per evidence build that exports it.

**What poor performance would mean.** A slower export in proportion to how much runtime evidence a team collects.

**Expected growth: O(n).** One span is built for each observation, with two hashed identifiers and two timestamps each. The work is proportional to the observations.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| observation events | swept | The tier axis here is runtime observation events, this many, each recorded in its own execution (scope). |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `observationsFromOtlp`

**Why we benchmark it.** It reads observation spans back from an OpenTelemetry export, the way runtime evidence collected in a deployed environment reaches the build.

**What poor performance would mean.** A slower ingest in proportion to the spans a deployment exported.

**Expected growth: O(n).** Each span's attributes are indexed into a map once and turned into its events. The work is proportional to the spans.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| observation events | swept | The tier axis here is runtime observation events, this many, each recorded in its own execution (scope). |
| spans | fixed at "the export of `observations-to-otlp`, one timed span per observation" | A foreign export with many unrelated spans adds one attribute scan per span. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `diffManifestSnapshots`

**Why we benchmark it.** It tells what changed since the previous manifest, once per artifact run.

**What poor performance would mean.** A slower artifact run in proportion to the number of capabilities.

**Expected growth: O(n).** Both snapshots are indexed once and each capability compared once, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| previous snapshot | variant | None (a first run: everything is added) or an identical one (nothing changed). |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Run inside every artifact generation; measured on its own.

#### Variant `first-run`

There is no previous snapshot: every capability reads as added.

#### Variant `unchanged`

The previous snapshot is identical: nothing changed.

### `projectAuditEvidence`

**Why we benchmark it.** It projects the evidence model into the view an audit reads.

**What poor performance would mean.** A slower audit export in proportion to the evidence model.

**Expected growth: O(n).** The model is read once and one row built for each capability, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectClassificationEvidence`

**Why we benchmark it.** It projects the evidence model into the view a data-classification review reads.

**What poor performance would mean.** A slower review export in proportion to the evidence model.

**Expected growth: O(n).** The model is read once and one row built for each classified field, so cost is proportional to the number of fields.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectComplianceEvidence`

**Why we benchmark it.** It projects the evidence model into the view a compliance review reads.

**What poor performance would mean.** A slower review export in proportion to the evidence model.

**Expected growth: O(n).** The model is read once and one row built for each capability, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectPrivacyEvidence`

**Why we benchmark it.** It projects the evidence model into the view a privacy review reads.

**What poor performance would mean.** A slower review export in proportion to the evidence model.

**Expected growth: O(n).** The model is read once and one row built for each personal-data field, so cost is proportional to the number of fields.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectRetentionEvidence`

**Why we benchmark it.** It projects the evidence model into the view a retention review reads.

**What poor performance would mean.** A slower review export in proportion to the evidence model.

**Expected growth: O(n).** The model is read once and one row built for each field with a retention rule. Cost is proportional to the number of fields.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `computeExpiringEntries`

**Why we benchmark it.** It lists the capabilities that expire within a window, once for every reminder and every report that shows expiries.

**What poor performance would mean.** A slower expiry reminder in proportion to the number of capabilities.

**Expected growth: O(n).** Each capability's expiry date is compared with the window once, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `buildOwnershipMatrix`

**Why we benchmark it.** It builds the matrix of who owns what that the ownership report prints.

**What poor performance would mean.** A slower ownership report in proportion to the number of capabilities.

**Expected growth: O(n).** Each capability is placed in the matrix once, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `buildManifestSnapshot`

**Why we benchmark it.** It snapshots the inventory so the next run can tell what changed, once per artifact run.

**What poor performance would mean.** A slower artifact run in proportion to the number of capabilities.

**Expected growth: O(n).** One snapshot entry is built for each capability, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `checkDuplicateEndpoints`

**Why we benchmark it.** It reports operations that call the same endpoint, once per artifact run.

**What poor performance would mean.** A slower artifact run that grows with the square of the number of capabilities, so the largest projects pay most. A grouped comparison would make it linear.

**Expected growth: O(n²).** It enumerates every pair of active capabilities and rebuilds each one's endpoint list for each pair it is in. Cost grows with the square of the number of capabilities, even when nothing is duplicated.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `checkExclusiveGroups`

**Why we benchmark it.** It reports capabilities whose exclusive-group declarations conflict, once per artifact run.

**What poor performance would mean.** A slower artifact run in proportion to the number of capabilities.

**Expected growth: O(n).** Each capability's group is recorded in a map once, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `checkOwnershipAndSensitivity`

**Why we benchmark it.** It reports capabilities that handle sensitive data without an owner, once per artifact run.

**What poor performance would mean.** A slower artifact run in proportion to the number of capabilities.

**Expected growth: O(n).** Each capability's owner and sensitivity are read once, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `checkStructuralDuplication`

**Why we benchmark it.** It reports capabilities whose structure repeats another's, once per artifact run.

**What poor performance would mean.** A slower artifact run. When many capabilities are structurally alike, the output grows with the square of their number. Nobody can read a report that size.

**Expected growth: O(n²).** It compares every pair of active capabilities, and the fixtures make every capability structurally alike. So one finding is reported for each pair. Both the work and the output grow with the square of the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `findManifestExportCollisions`

**Why we benchmark it.** It finds capabilities whose exported names would collide in the generated manifest, once per manifest.

**What poor performance would mean.** A slower manifest build in proportion to the number of capabilities.

**Expected growth: O(n).** Each capability's export name is recorded in a map once, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectFields`

**Why we benchmark it.** It lists every field of every capability, the view the field tables and the privacy projections read.

**What poor performance would mean.** A slower report in proportion to the number of capabilities and the fields each has.

**Expected growth: O(n).** Every field of every capability is listed once, so cost is proportional to the number of fields.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectGetters`

**Why we benchmark it.** It lists every getter of every capability, the view the operation tables read.

**What poor performance would mean.** A slower report in proportion to the number of capabilities and the getters each has.

**Expected growth: O(n).** Every getter of every capability is listed once, so cost is proportional to the number of getters.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectMutators`

**Why we benchmark it.** It lists every mutator of every capability, the view the operation tables read.

**What poor performance would mean.** A slower report in proportion to the number of capabilities and the mutators each has.

**Expected growth: O(n).** Every mutator of every capability is listed once, so cost is proportional to the number of mutators.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectOperationInventory`

**Why we benchmark it.** It lists every operation (getter, mutator and subscription) of every capability, the view audits read.

**What poor performance would mean.** A slower audit in proportion to the number of operations.

**Expected growth: O(n).** Every operation of every capability is listed once, so cost is proportional to the number of operations.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `projectSubscriptions`

**Why we benchmark it.** It lists every subscription of every capability, the view the operation tables read.

**What poor performance would mean.** A slower report in proportion to the number of capabilities.

**Expected growth: O(n).** Every subscription of every capability is listed once, so cost is proportional to the number of subscriptions.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `renderManifest`

**Why we benchmark it.** It renders the TypeScript manifest the application imports, in every build that ships the application.

**What poor performance would mean.** Slower builds in proportion to the number of capabilities.

**Expected growth: O(n).** One manifest entry is rendered for each capability, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `buildOpenApiSchemaArtifact`

**Why we benchmark it.** It renders the OpenAPI schema for the capabilities, in every pipeline that publishes one.

**What poor performance would mean.** A slower publish step in proportion to the number of capabilities and their fields.

**Expected growth: O(n).** One schema is built for each capability and field, once, so cost is proportional to the amount of schema.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `renderDocumentation`

**Why we benchmark it.** It renders the Markdown reference of every capability, the largest text data-cap writes.

**What poor performance would mean.** Documentation builds slow in proportion to the number of capabilities and the prose each carries.

**Expected growth: O(n).** One section is rendered for each capability, once, so cost is proportional to the amount of documentation.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `renderOwnershipGraphDot`

**Why we benchmark it.** It renders the ownership graph as Graphviz text, in every pipeline that publishes the ownership diagram.

**What poor performance would mean.** A slower diagram step in proportion to the number of owners and capabilities.

**Expected growth: O(n).** One node is written for each owner and capability, once, so cost is proportional to the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `buildFlowGraph`

**Why we benchmark it.** It builds the graph of how data flows between capabilities and their consumers, once per artifact run.

**What poor performance would mean.** A slower artifact run in proportion to the number of capabilities and the consumers wired to them.

**Expected growth: O(n).** Each capability's fields are visited once and each edge applied once, so cost is proportional to the fields plus the edges.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `deriveUsageFindings`

**Why we benchmark it.** It derives the unused and over-used findings from how consumers use each capability, once per usage report.

**What poor performance would mean.** A slower usage report in proportion to the number of capabilities and the edges.

**Expected growth: O(n).** Each capability's edges are counted once, so cost is proportional to the capabilities plus the edges.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `renderUsageReport`

**Why we benchmark it.** It renders the report of who uses which capability, in every pipeline that publishes it.

**What poor performance would mean.** A slower report in proportion to the number of capabilities and the edges.

**Expected growth: O(n).** One section is rendered for each capability and each edge, once, so cost is proportional to the capabilities plus the edges.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| capability content | fixed at "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls" | Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `buildSarifLog`

**Why we benchmark it.** It converts the finding model into SARIF for code-scanning dashboards, in every pipeline that uploads findings.

**What poor performance would mean.** A slower upload step in proportion to the number of findings.

**Expected growth: O(n).** One SARIF result is built for each finding, so cost is proportional to the number of findings.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis here is findings, one for each of this many capabilities with a problem. |
| finding mix | fixed at "one error, one warning and one info in turn" | Severity only picks the SARIF level. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**In the end-to-end run:** Not part of the end-to-end operation, which calls the generator; measured on its own.

### `defineEvidenceProjection (project)`

**Why we benchmark it.** Turns the evidence model into a consumer-specific view (a report, an export); it runs in every pipeline that publishes one.

**What poor performance would mean.** Custom reports slow in proportion to the model. A copy-heavy implementation would make the projection cost more than building the evidence itself.

**Expected growth: O(n).** The projection copies the model once (`structuredClone`) and reads it through a tracking membrane. Both are proportional to the model's size, which grows with the number of capabilities.

**Variables that could change its cost**

| Variable | How it is handled | What it is |
| --- | --- | --- |
| capability files | swept | The tier axis: how many files in the project declare a data capability. |
| projection shape | fixed at "four derived fields" | A projection reading fewer fields still pays the clone; one computing more adds proportional work. |
| runtime | fixed at "Node (V8)" | Measured on Node only. |

**Measured: O(n)** (exponent 1.08, 8 sizes): ✅ matches.

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

## 3. What makes up one end-to-end operation

Each function's measured cost is multiplied by how many times one end-to-end operation calls it. A function measured on its own includes everything it calls. So where one attributed function calls another, the nested time is subtracted from the caller (its _exclusive_ time). Every moment of the operation then belongs to at most one row. Shares are measured against the whole operation with the package, a figure measured directly. They are not measured against the _added_ time, which is the small difference of two noisy medians. They are estimates (each function was measured separately); the remainder is shown as _unattributed_.

**At 160 files** (whole operation: 534 ms)

| Function | Calls / operation | Time if called that often | Exclusive time | Share of operation |
| --- | --- | --- | --- | --- |
| `link-capability-files` | 1 | 145 ms | 145 ms | 27% |
| `discover-capability-files` | 1 | 13.6 ms | 13.6 ms | 2.5% |
| `build-inventory` | 1 | 1.49 ms | 1.49 ms | 0.3% |
| `build-ownership-model` | 1 | 251 µs | 251 µs | 0.0% |
| `build-lifecycle-model` | 1 | 79.1 µs | 79.1 µs | 0.0% |
| `build-evidence-model` | 1 | 1.85 µs | 1.85 µs | 0.0% |
| _unattributed_ |  |  | 374 ms | 70% |

## Failed measurements

- **end-to-end:with-package** at n1280: RangeError: Invalid string length
- **end-to-end:with-package** at n2560: RangeError: Invalid string length

## Cost model

Estimates use two bracketing price shapes. **Low** is CPU-priced compute ($0.040 per vCPU-hour, billed on CPU time). **High** is duration-and-memory-priced functions ($0.000017 per GB-second, billed on wall time, at least 128 MB reserved). Both are rounded list prices and change over time; override them in `benchmark.config.json` → `costRates` to match your platform and negotiated pricing.

## Environment and method

- Run: `2026-10-02T14:24:44.331Z` → `2026-10-02T14:26:37.336Z` (113 s), ci
- Machine: AMD EPYC 7763 64-Core Processor, 4 logical core(s) (2 physical), 15990 MB RAM, linux/x64, Node v22.23.3, GitHub Actions
- Git: `c7233e83f8e7c7e16e01866bb364781cfa73bd35` on `fix/code-scanning-and-caches` (uncommitted changes)
- Sizes: 20, 40, 80, 160, 320, 640, 1280, 2560 files: One capability file in the project. 160 is a large application's worth of capabilities; 640 a large monorepo's. The ladder stops at 2,560, not 10,240. Every size writes a real project of TypeScript files and links them with the TypeScript compiler API, which takes minutes at the largest sizes.

**Do not compare these numbers with another machine's, another day's, or another package's.** They show how _this_ package's cost changes between runs on comparable hardware, and how it scales with size. See [READING-BENCHMARKS.md](../READING-BENCHMARKS.md).

