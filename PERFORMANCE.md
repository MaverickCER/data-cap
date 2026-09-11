# Performance

This document describes what `data-cap` actually measures, what it
doesn't, and why — not a marketing claim about speed.

## Philosophy

Two independent guarantees, checked separately: **bundle size** (a hard,
CI-enforced budget per entry point) and **runtime behavior**
(highlighting-only micro-benchmarks, never a merge gate). The first is a
real commitment; the second is informational, since micro-benchmark
numbers vary meaningfully by machine/Node version and don't reliably
predict a specific application's real workload.

## Bundle size budgets

Enforced in `scripts/check-size.mjs`, run as a required step in CI's
`verify` job (`npm run size`). Current budgets (gzip, minified via tsup's
`minifyWhitespace` — identifiers are never mangled, so stack traces stay
readable):

| Entry point       | Budget    | Current (approx.)        |
| ----------------- | --------- | ------------------------ |
| `.` (core)        | 2 KB      | ~1 KB                    |
| `./runtime`       | 6 KB      | ~5.5 KB                  |
| `./runtime/cache` | 1 KB      | ~0.4 KB                  |
| `./runtime/retry` | 2 KB      | ~1.2 KB                  |
| `./helpers`       | 3 KB      | ~1.8 KB                  |
| `./build`         | unbounded | Node-only, dev-time-only |
| `./eslint-plugin` | unbounded | Node-only, dev-time-only |

`./runtime`'s budget was raised from 4 KB alongside
[ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)'s
`createData` — a deliberate, measured increase for genuinely new primary-API
functionality (getter/mutator/subscription execution, dedup identity,
optimistic lifecycle, `runGetters`, bounded per-operation state) landing in
this same entry point, not unexamined growth. It stays one entry rather
than a separate tree-shaken sub-path (unlike `./runtime/cache`/
`./runtime/retry`, optional add-ons most capabilities never touch) because
`createData` is meant to be the first thing most consumers reach for, not
an edge-case extra — an application that only ever uses `createDataStore`/
`coordinator` directly still pays for `createData`'s code as a result; that
tradeoff is the point of this decision, not an oversight.

`build` and `eslint-plugin` carry no budget deliberately — both are
Node-only, dev/CI-only tooling that never ships to a browser bundle; their
size is isolated from the runtime/helpers bundles by the tree-shaking test
suite instead (`test/*/tree-shaking.test.ts`), not by a byte ceiling.

Run `npm run size` locally for exact, current numbers — the table above is
a snapshot, not a live-updating source of truth. Budgets are ratcheted
down (never up) as real measurements allow; see `scripts/check-size.mjs`'s
own `BUDGETS` array for the authoritative current values.

## What's measured, and why

- **Structural sharing.** `patchInto`/`commitState` reuse unchanged
  branches by reference — a commit touching one leaf field never
  reallocates unrelated branches
  ([ADR 0010](specs/decisions/0010-datainfo-array-reconciliation-identity-diffed.md)).
- **Amortized freeze cost.** `deepFreezeNewNodes` only freezes newly-
  created nodes on a given commit's changed path — an already-frozen
  branch (reused by reference) is skipped, so freeze cost is proportional
  to what changed, not to total state size
  ([ADR 0044](specs/decisions/0044-snapshots-deep-frozen-amortized.md)).
- **No-op suppression.** A commit producing no actual difference returns
  the previous object reference unchanged and never notifies subscribers
  ([ADR 0042](specs/decisions/0042-no-op-suppression.md)).

## Micro-benchmarks

Two self-contained npm projects under `benchmarks/` — [`performance-runtime/`](benchmarks/performance-runtime/)
and [`performance-buildtime/`](benchmarks/performance-buildtime/) — each depending on
`@maverickcer/data-cap` via `file:../..` and importing it by **package name**, never a monorepo-relative
`dist/*.js` path. This is a "full package" benchmark: it exercises the actual `exports` map/`package.json`
a real consumer's `npm install` would resolve.

`performance-runtime` times a fresh-process `cold-start` (capability-count scaling) plus an in-process suite
covering `buildData`, `commitAuthoritative`, array-identity reconciliation, and `createData`'s getter/
coordinator dispatch machinery (collection-size scaling). Every getter's `execute` is simulated — never real
network/database I/O, and never a synchronous shortcut that skips real dispatch logic either.
`performance-buildtime` times `discoverCapabilityFiles()` and the full `generateDataArtifacts()` pipeline
(discover → link → inventory → manifest/docs/ownership/flow/evidence) as capability-file count scales. See
[`benchmarks/README.md`](benchmarks/README.md) for the full methodology (tiers, fixture design, why
simulated async, what's measured and why, and which numbers should never be read in isolation).

```sh
npm run build
npm run benchmark
```

`.github/workflows/benchmarks.yml` runs this on every pull request and posts the results as a PR comment
(marker-tagged, updated in place rather than duplicated on each push), diffed against the currently-committed
`results.json` for each example — **highlighting-only, never a merge gate**. A run that regresses past its
benchmark's own threshold in [`benchmarks/benchmark-fixtures/budgets.mjs`](benchmarks/benchmark-fixtures/budgets.mjs)
(15% for most; wider for the near-zero-cost `commitAuthoritative-leaf` check) is flagged with a ⚠️ in the
rendered table, but no step in that workflow ever fails the job because of a performance number.

On every push to `main`, the same workflow's `benchmark-main` job re-runs both examples and, if either
`results.json` changed, opens a PR refreshing both `results.json`/`RESULTS.md` and appending one entry to
each of `benchmarks/history/runtime.json` and `benchmarks/history/buildtime.json` — see
[`benchmarks/append-benchmark-history.mjs`](benchmarks/append-benchmark-history.mjs) and
[`benchmarks/render-benchmark-summary.mjs`](benchmarks/render-benchmark-summary.mjs). Each history entry is
intentionally compact (median per benchmark×tier, plus commit/version/runner metadata) — the full per-run
detail (min/max/p95/stdDev/memory/inputs) stays in that commit's own `results.json`, never duplicated here.

## Non-goals

- **No production-workload benchmark suite.** The micro-benchmarks above measure this package's own
  primitives in isolation — including its concurrent-call dispatch/dedup machinery, at realistic payload
  sizes — but never real network/database latency (see [`benchmarks/README.md`](benchmarks/README.md)'s
  "Simulated async, not real I/O"), and never a full application's own mixed workload.
- **No cross-machine/cross-CI-runner normalization.** Absolute millisecond numbers are only meaningfully
  comparable against another run on the same machine/Node version, not across different CI runners or
  contributors' own machines — the committed history is a same-runner (GitHub-hosted `ubuntu-latest`) time
  series for exactly this reason, not a cross-environment comparison.

## Reproduction

```sh
git clone https://github.com/maverickcer/data-cap.git
cd data-cap
npm ci
npm run build
npm run size       # bundle size budgets
npm run benchmark  # micro-benchmarks (installs each example's own node_modules first, if missing)
```
