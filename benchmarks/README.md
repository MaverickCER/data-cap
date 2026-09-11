# Benchmarks

[`performance-runtime/`](performance-runtime/) and [`performance-buildtime/`](performance-buildtime/) are
project confidence tooling, not adoption samples like the flagships under [`examples/`](../examples/) --
they exist to answer "does this scale," "did that regress," and "did that architectural decision actually
pay off," for maintainers and prospective adopters evaluating data-cap at real-world scale. Each is a
self-contained npm project (its own `package.json`, depending on `data-cap` via `file:../..`)
-- run `npm install && npm run benchmark` inside either directory, or `npm run benchmark` from the repo
root, which drives both via [`run-benchmarks.mjs`](run-benchmarks.mjs).

**"Full package" benchmarks, deliberately**: both examples import data-cap by its published PACKAGE NAME
(`data-cap`, `data-cap/runtime`, `data-cap/build`, ...), resolved
through their own `node_modules` after a real `npm install` -- never a monorepo-relative `../../dist/*.js`
shortcut. This exercises the actual `exports` map/`package.json` a real consumer's `npm install` would
resolve, not an approximation of it.

[`benchmark-fixtures/`](benchmark-fixtures/) is shared support code both examples' own `scripts/` import
from -- plain `.mjs`, no `package.json` of its own, never run directly.

This file is the canonical documentation for both directories' shared methodology; each one's own README
covers what's specific to it.

## Philosophy

These benchmarks exist to answer three kinds of question: how does data-cap's own dispatch/state machinery
scale as the data it holds grows, does a change regress that scaling, and do specific architectural
decisions (ADR 0010/0044's structural sharing, the coordinator's execution dedup, `generateDataArtifacts`'s
one-shared-pass design) actually pay off. They are **not** meant to win synthetic benchmark contests, prove
an absolute performance guarantee, or gate a merge. Every benchmark here maps to a real, currently-existing
code path and a question a real user or maintainer would actually ask.

data-cap is an async-data-request tool. In production its real bottleneck is whatever's on the other end of
a getter's `execute` -- a network, a database -- never this package's own code. That has a direct
consequence for how "testing the internal infrastructure" has to work here: real I/O would make the runtime
numbers measure a network, not data-cap; a synchronous shortcut would make them measure nothing at all. See
`performance-runtime/README.md`'s "Simulated async, not real I/O" for the full rationale.

## Tiers

`baseline`/`stress`/`extreme` are a deliberately uniform scaling ladder -- three points make a curve, so a
regression that changes the _shape_ of the cost curve (not just its slope) is visible.

**Two independent axes, never conflated** -- data-cap has two structurally different things that scale,
unlike env-cap's single "how many env vars" axis:

- **Collection size** -- how many records one capability's getter fetches/holds. The axis
  `performance-runtime`'s in-process suite (`commitAuthoritative-array-replace`, `reconcileArrayInfo`,
  `getterDispatch-cold`) scales along: the realistic "does data-cap hold up as the fetched dataset grows"
  question for an async-data-request tool.
- **Capability count** -- how many separate `createData()`-declaring modules a real app/monorepo has. The
  axis `cold-start` (a fresh process importing that many capability modules) and `performance-buildtime`'s
  `discovery`/`artifacts` (a directory of that many capability files) scale along instead: the real cost
  driver for "process boot" and "how does this monorepo's build tooling scale," neither of which cares how
  big any one collection is.

| Tier       | Collection-size axis | Capability-count axis                        | Represents                                                                                   |
| ---------- | -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `baseline` | 200 items            | 10 capabilities                              | One realistic page of API results / a small app's capability set -- fast local sanity point. |
| `stress`   | 2,000 items          | 100 capabilities                             | A fully-loaded mid-size collection / a mid-size monorepo's capability count.                 |
| `extreme`  | 20,000 items         | 500 (runtime) / 400 (buildtime) capabilities | A large client-resident synced dataset / a large monorepo's full capability set.             |

Sized larger than env-cap's own tiers on both axes deliberately: a multi-field record and a single scalar
env var aren't the same unit of "size," and real payloads (a CRM contact list, an order history, a
support-ticket queue) run to thousands of multi-field records. Not every benchmark scales with a ladder --
some deliberately run once, at a fixed size, because tiering them would measure something no real app/
monorepo actually does -- see each example's own README for which, and why.

**Determinism**: fixture generation is a pure function of tier/index -- `FIXTURE_SEED:
"deterministic-index-v1"` (recorded in every result's metadata) names the strategy explicitly. Zero
`Math.random()`, zero timestamp-seeded anything, anywhere in `benchmark-fixtures/generator.mjs`. Proven, not
just asserted: `fixtureHash` (SHA-256 over every generated fixture) lets two runs against the same
`generatorVersion` be checked for an identical input without diffing the fixtures themselves.

## Fixture design

Runtime and build-time capability fixtures share the same underlying idea (a `createData()`/`documentData()`
call per capability) but deliberately diverge on content:

- **Build-time** fixtures use realistic, varied field/getter/mutator shapes -- literal TypeScript source
  text, one owner/department/residency/endpoint-URL combination per file so no two are byte-identical --
  mirroring `examples/enterprise-platform/src/capabilities/projects.capability.ts`. AST-parsing cost
  genuinely depends on source-text volume and variety, and build tooling never executes a discovered file
  (never `import()`/`eval()` -- see `src/build/parse.ts`), so this realism costs nothing at measurement
  time.
- **Runtime** (`cold-start`) fixtures give every capability a trivial identity processor and no validator,
  written as plain `.mjs` rather than `.ts` (no transpilation step between "process starts" and
  "`createData` runs"). An application-supplied processor is an extension point -- its execution cost
  belongs to the application, not to data-cap's own architecture. If runtime fixtures used the same
  realistic shape build-time's do, a `cold-start` regression could mean either "data-cap's own dispatch got
  slower" or "the fixture's processor got costlier," with no way to tell which.

**`canonicalize` is never called on a whole record or collection** in real usage -- only on getter/mutator
`params` and individual identity-key field values. `performance-runtime`'s `realisticParams()` reflects
that: a small `{filter, page, pageSize, sort}` shape, never a whole payload.

**Fresh references, always, and never inside a timed section.** `commitAuthoritative`'s no-op suppression
(ADR 0042, a real, deliberate feature) silently turns a commit of the _same array reference_ into a free
no-op after the first call -- every in-process benchmark that commits a collection repeatedly pre-generates
one fresh array per call _before_ starting the timer, via `simulatedExecuteFromPool` (see
`performance-runtime/scripts/run-benchmark.mjs`), so fixture-generation cost is never counted as data-cap's
own dispatch cost, and no-op suppression only ever fires when a real repeated commit would ALSO
short-circuit.

## What's measured, and why

### Runtime -- `cold-start`, plus the sync-core/async-dispatch suite

See [`performance-runtime/README.md`](performance-runtime/README.md) for what each benchmark measures.
`cold-start` is a fresh-child-process, capability-count-tiered benchmark (no throw-until-ready gate to split
a "validate" phase out of, unlike env-cap's own `createEnv`/`validateEnv` -- see that README). The rest is
an in-process, collection-size-tiered (or fixed-size) suite covering `buildData`, `commitAuthoritative`,
`helpers/identity.ts`, and `createData`'s getter/coordinator dispatch machinery.

### Build-time -- `discovery`, `artifacts`

See [`performance-buildtime/README.md`](performance-buildtime/README.md) for what each measures.
Runtime and build-time are measured in separate examples (mirrors ADR 0001's runtime/build-time
architectural split), never compared against each other (see "Never compare" below).

## How regressions are surfaced

[`benchmark-fixtures/budgets.mjs`](benchmark-fixtures/budgets.mjs) defines a `maxRegressionPercent` per
named benchmark. This is a **highlighting** threshold only, checked by
[`render-benchmark-summary.mjs`](render-benchmark-summary.mjs) -- never a gate, never something that fails a
CI check. A named benchmark with no budget entry is still reported, just never flagged -- these are
fixed-size sanity checks or coordination-cost comparisons, not tiered regression targets.

## Benchmark interpretation rules

Stated up front so a future contributor doesn't have to re-derive them from a raw results diff:

- `cold-start`, `commitAuthoritative-array-replace`, `reconcileArrayInfo`, `getterDispatch-cold`,
  `discovery`, and `artifacts` should all scale approximately linearly with their own axis (capability
  count or collection size) once each benchmark's fixed per-call overhead is accounted for.
- `commitAuthoritative-leaf` should stay flat across every tier -- see `performance-runtime/README.md`.
- `getterDispatch-cold` should track `commitAuthoritative-array-replace` closely at the same tier; the gap
  is coordinator dedup + ownership-walk + the extra loading commit.
- **Never read `dedupeFanIn`'s number without its `dedupeFanIn-independent` counterpart, and never read the
  gap between them as "dedup's production savings."** This suite deliberately never performs real I/O, so
  the gap it measures is ONLY data-cap's own coordination bookkeeping -- real, small, and worth catching a
  regression in, but NOT the redundant-network-call cost dedup actually saves in production.
- A `benchmarkSuiteVersion` mismatch against a history entry is warned about, never silently diffed across
  -- see `render-benchmark-summary.mjs`.

## Never compare

- Runtime numbers against build-time numbers -- different processes, different fixtures, different cost
  drivers entirely.
- The collection-size axis against the capability-count axis -- different things scaling, not two
  measurements of the same thing at different sizes.
- `dedupeFanIn`'s gap over `dedupeFanIn-independent` against any real-world "dedup saved us N requests"
  claim -- see the interpretation rule above.
- Numbers produced under different `benchmarkSuiteVersion`s or `generatorVersion`s -- even when they look
  close. `render-benchmark-summary.mjs` warns on a mismatch rather than silently diffing across one.
- Absolute millisecond numbers across machines/Node versions/CI runners -- the committed history is a
  same-runner (GitHub-hosted `ubuntu-latest`) time series for exactly this reason; every result also records
  its own `metadata.environment`.

## Non-goals

Filesystem cache effects, SSD speed, CPU frequency scaling, turbo boost, thermal throttling, real
network/database latency or variance (see "Simulated async" above), and cross-machine comparisons.

## What's not (yet) benchmarked, and why

Considered and deliberately cut, rather than merely never proposed:

- **A `standalone-vs-combined`-equivalent for build-time.** env-cap's own suite validates its ADR 0011
  shared-pass design this way. data-cap has no equivalent antipattern to benchmark against:
  `generateManifest`/`generateDocumentation`/`generateFlow` are pure functions of an already-built
  `CapabilityInventory` -- there is no code path by which calling one standalone could trigger its own
  discovery pass. See `performance-buildtime/README.md`.
- **Per-item field validation scaling.** Arrays are atomic in data-cap's own ownership/shape-checking
  (`checkValueAgainstSchema`'s array branch is `Array.isArray(value)` only -- never validated item-by-item),
  so there is no O(items × per-item-validation) code path to benchmark; the real per-item cost lives
  entirely in `deepFreezeNewNodes` and `reconcileArrayInfo`, both already covered.
- **A non-uniform "enterprise" realism tier** (env-cap's own fourth tier, mixing archetypes of differing
  size). May be revisited if a future architectural change introduces a third scaling axis worth isolating.
- **Package COMPILE time** (`npm run build`'s own `tsup`/`tsc` cost) as a benchmark. A real, separate
  maintainer-facing metric, but orthogonal to what this directory measures (data-cap's own runtime/
  build-tooling architecture) -- conflating the two would misrepresent both.
- **Memory as a tiered benchmark family.** No unbounded structure exists in the hot commit path
  (`operationsWorking`'s per-operation history is LRU-capped at `maxOperationHistory`, default 50);
  `cold-start` records one before/after snapshot per tier as a free byproduct instead.
- **Subscription throughput.** `coordinator.acquireSubscription`'s fan-out/ref-counting is exercised by the
  test suite's correctness tests; a throughput benchmark would need a simulated transport with its own
  event-rate assumptions, risking the same "measuring the simulation, not data-cap" trap the async getter
  benchmarks were specifically designed to avoid.

## Versioning

Four independent version numbers, each answering a different question:

- `benchmarkSchemaVersion` -- did the per-run `results.json` shape change?
- `benchmarkSuiteVersion` -- did the methodology (which benchmarks exist, what they measure) change?
  Embedded in every result `id` (`s<suiteVersion>`).
- `generatorVersion` -- did fixture-generation semantics change? A `fixtureHash` change is always traceable
  to an explicit bump here.
- `historySchemaVersion` -- did `benchmarks/history/*.json`'s own aggregate shape change?

## `benchmarks/history/`

`benchmarks/history/runtime.json` and `.../buildtime.json` are append-only arrays of compact entries
(`medianMs` per completed named-benchmark×tier, plus commit/version/timestamp/runner metadata) -- not the
full per-run detail already in each commit's own `results.json` (min/max/p95/stdDev/memory/inputs). Written
to by CI only (`benchmark-main`'s job, on every push to `main`), in the same bot PR that refreshes
`results.json`/`RESULTS.md` -- never by a local `npm run benchmark`.

## Reproduction

```bash
npm install
npm run build
npm run benchmark
```

From the repo root, this drives both examples via `run-benchmarks.mjs`. Each can also be run
independently -- see its own README.
