# Runtime performance benchmark

Measures `createData()`'s cost as capability count scales (`cold-start`), plus the sync-core/async-dispatch
suite's cost as fetched collection size scales. See [`../README.md`](../README.md) for full methodology, tier
definitions, and the "never compare" rules. This README covers only what's specific to this example.

## Run it

```bash
npm install
npm run benchmark
```

A real `npm install` here (not a monorepo-relative import) -- `data-cap` is a `file:../..`
dependency, so every benchmark below runs against the package as an actual consumer's `npm install` would
resolve it (real `exports` map, real `package.json`, real `dist/`), never a `../../dist/*.js` shortcut.

Writes `results.json` (immutable measurement record) and `RESULTS.md` (its human-readable rendering). Both
are committed -- CI refreshes them on `main` via a bot PR, never by pushing directly. `fixtures/` is
generated on demand and gitignored.

## What's measured

### `cold-start` (capability-count axis, tiered `baseline`/`stress`/`extreme`)

A fresh child process imports a tier's generated capability barrel (triggering `createData()` for each
capability, as a side effect of module evaluation -- see
[`scripts/cold-start-child.mjs`](scripts/cold-start-child.mjs)). Each sample is a brand-new process (zero
warmup by construction -- a cold process can't be "warmed"). The parent measures total wall-clock time per
spawn; the child self-reports how much of that was its own module-evaluation cost.

Unlike env-cap's `createEnv()`/`validateEnv()` split, data-cap's `buildData()`/`createData()` have no
throw-until-ready gate (a deliberate architectural divergence -- see `specs/architecture.md`), so there is
no separate "validate" phase to report: one measured phase, `moduleEvalMs`, not two.

**Fixtures here use trivial identity processors and no validators**, deliberately different from
`../performance-buildtime`'s realistic ones -- see `../README.md`'s "Runtime fixture design" section for
why: an application-supplied processor's execution cost belongs to the application that supplies it, not to
data-cap's own architecture, and mixing it in would make a regression here ambiguous between "data-cap got
slower" and "the fixture's processor got slower."

### The item-count-tiered suite (`commitAuthoritative-array-replace`, `commitAuthoritative-leaf`, `reconcileArrayInfo`, `getterDispatch-cold`)

In-process, tiered by fetched **collection size** (200/2,000/20,000 items), not capability count -- a
structurally different axis from `cold-start` (see `../README.md`'s "Two independent axes"). Every getter's
`execute` is simulated (never real network/database I/O, never a synchronous shortcut that skips real
dispatch logic either -- see `../README.md`'s "Simulated async, not real I/O").

- **`commitAuthoritative-array-replace`** -- committing a freshly-fetched array wholesale. Should scale with
  tier: `deepFreezeNewNodes` walks every newly-arrived item.
  `commitAuthoritative-leaf` -- a small leaf-field commit against a store that ALSO holds the tier's full
  collection. Expected **flat** across every tier -- proves structural sharing (ADR 0010/0044); if it stops
  being flat, that's a regression, not noise.
- **`reconcileArrayInfo`** -- `helpers/identity.ts` reconciling identity-keyed `info` for the tier's full
  collection. Genuinely O(items).
- **`getterDispatch-cold`** -- one full getter round trip through `createData`: coordinator dedup registry,
  simulated async `execute`, ownership-checked commit (loading, then success). Should track
  `commitAuthoritative-array-replace` closely at the same tier.

### `dataCacheSetGet` (collection-size axis, tiered `baseline`/`stress`/`extreme`)

`data-cap/runtime/cache`'s `createDataCache` -- an optional, LRU-eviction cache of complete `DataState`
snapshots (see `../../src/runtime/cache.ts`'s own doc comment), previously zero benchmark coverage despite
being a whole separate, independently-tree-shaken entry point. Tiered along the SAME `itemCount` axis as
`commitAuthoritative-leaf`, and expected to behave the same way: flat. `set()`/`get()` only ever touch `Map`
entries keyed by an opaque string -- the cached `DataState` is stored BY REFERENCE, never deep-copied -- so a
regression here (the curve stops being flat) would mean the cache started copying instead of referencing.
The cache is pre-filled to capacity (50 entries, under keys the timed loop never reuses) OUTSIDE the timed
section, so every timed iteration's `set()` is guaranteed to be the 51st live entry -- evicting the cache's
current oldest key on every single call, real LRU churn from the first timed sample onward, regardless of how
many iterations a given tier's own sampling budget ends up running. Each timed iteration then sets one fresh,
pre-built snapshot under a new key and reads it back.

### `withRetry` (a third axis -- retry-attempt count, tiered `baseline`/`stress`/`extreme`)

`data-cap/runtime/retry`'s `withRetry` -- previously zero benchmark coverage for another whole separate entry
point. Tiered along `RUNTIME_RETRY_TIERS`'s own `attempts` axis (how many total calls the wrapped `fn` takes
to succeed: `2`/`8`/`30`), neither collection size nor capability count -- retry's own cost driver is how many
times the loop goes around, not how big any one payload is. `delayMs: () => 0` overrides the real
(multi-second) default backoff so this measures the loop/try-catch/`AbortSignal`-check/`delay()` control flow
itself, not real wall-clock waiting -- the same "simulate the async boundary, never skip real dispatch logic"
principle `simulatedExecuteFromPool` applies to getter execution above. `baseline` starts at `2` attempts (one
real retry), not `1` (zero retries, immediate success): a zero-retry call never reaches `delay()`'s own
timer/microtask path at all, and was measured ~4x noisier run-to-run as a result -- see
`benchmark-fixtures/scenarios.mjs`'s own comment on `RUNTIME_RETRY_TIERS`.

### Fixed-size sanity checks (`buildData`, `canonicalize`, `dedupeFanIn`, `dedupeFanIn-independent`, `runGettersFanOut`)

- **`buildData`** -- schema-breadth cold-init cost, `items` starting empty (a real app's collection arrives
  later via a getter, matching `examples/enterprise-platform`'s own `projects: [] as Project[]` pattern).
  Not tiered by item count -- tiering it that way would benchmark something no real app does at startup.
- **`canonicalize`** -- a realistic small `params`-shaped object, matching what `canonicalize` is actually
  called on in real usage (getter/mutator params, never a whole payload).
- **`dedupeFanIn`** / **`dedupeFanIn-independent`** -- K=25 concurrent callers to the same getter, identical
  params vs. unique params, at matched item count. `dedupeFanIn` asserts (throws if violated) that identical-
  params concurrency collapses to exactly one underlying `execute`. Read together, never alone: this suite
  never performs real I/O, so the gap between them is ONLY data-cap's own coordination bookkeeping -- real
  and worth catching a regression in, but not the redundant-network-call savings dedup provides in
  production.
- **`runGettersFanOut`** -- `runGetters` firing 6 distinct getters concurrently, each owning an independent
  field slice.

Considered and cut from this example: a `validation-failures`-style benchmark (data-cap's ownership walk
does the same O(fields-in-processor-output) work regardless of whether the processor's output is valid --
indistinguishable in cost shape from the benchmarks above) and a warm-repeated-call benchmark
(`getSnapshot()`/repeated identical commits are O(1) by construction -- ADR 0042's no-op suppression --
not a scaling question). See `../README.md`.

Also considered and cut, from the full public-API-surface coverage pass that added `dataCacheSetGet`/
`withRetry` above: `documentData` (`data-cap` core) -- a deliberate, Stryker-disabled true no-op at runtime
(see `src/core/document.ts`'s own doc comment); there is no cost to measure, and a benchmark asserting "this
takes ~0ms" would just be a slower, noisier restatement of that doc comment. `helpers/processors` -- plain
O(1) scalar coercions (`toString`/`toNumber`/`toBoolean`/...) with no input-size axis to tier against, the
same category of trivial single-value operation this repo's philosophy already excludes (see `../README.md`'s
"Non-goals"). `helpers/shape`'s structural guards are exercised indirectly, at real scale, by every
`commitAuthoritative-*` benchmark above (they back the ownership/ shape-check pass every commit goes
through) -- a standalone benchmark would just re-measure a subset of `commitAuthoritative-array-replace`'s
own cost curve.
