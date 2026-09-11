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
