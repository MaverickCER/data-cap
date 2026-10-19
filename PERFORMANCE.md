# Performance

This document describes what `data-cap` actually measures, what it
doesn't, and why — not a marketing claim about speed.

## Philosophy

Two independent guarantees, checked separately: **bundle size** (a hard,
CI-enforced budget per entry point) and **runtime behavior**
(micro-benchmarks whose raw times are shown, never judged). The first is a
byte-level commitment; the second gates only on properties of one run --
a function's growth class against its documented big-O and against the
last release, and the package's overhead relative to its own baseline --
since raw micro-benchmark numbers vary meaningfully by machine/Node version
and don't reliably predict a specific application's real workload.

## Bundle size budgets

Enforced in `ci/size-budgets.mjs`, run as a required step in CI's
`verify` job (`npm run size`). Current budgets (gzip of the unminified
build — the published code is never minified, so stack traces and
reviews read the source as written):

| Entry point       | Budget | Current (approx.)        |
| ----------------- | ------ | ------------------------ |
| `.` (core)        | 2 KB   | ~1.1 KB                  |
| `./runtime`       | 8 KB   | ~6.6 KB                  |
| `./runtime/cache` | 1 KB   | ~0.5 KB                  |
| `./runtime/retry` | 2 KB   | ~1.6 KB                  |
| `./helpers`       | 3 KB   | ~2.5 KB                  |
| `./build`         | 999 KB | Node-only, dev-time-only |
| `./eslint-plugin` | 999 KB | Node-only, dev-time-only |

`./runtime`'s budget was raised to 8 KB when minification was dropped, and
before that from 4 KB alongside
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

`build` and `eslint-plugin` carry only a 999 KB ceiling, deliberately —
both are Node-only, dev/CI-only tooling that never ships to a browser
bundle; their size is isolated from the runtime/helpers bundles by the
tree-shaking test suite instead (`test/*/tree-shaking.test.ts`), not by a
tight byte budget.

Run `npm run size` locally for exact, current numbers — the table above is
a snapshot, not a live-updating source of truth. A budget is raised only
for a recorded reason (new primary functionality, or the unminified build);
`ci/size-budgets.mjs` holds the authoritative current values.

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
`data-cap` via `file:../..` and importing it by **package name**, never a monorepo-relative
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

`.github/workflows/ci.yml (benchmark-pr job)` runs this on every pull request that touches benchmarked code and
posts the results as a PR comment (marker-tagged, updated in place rather than duplicated on each push); it never
commits to the PR's branch. No gate compares a raw time with another run's, because two runs are on different
machines: a run fails when a function's measured growth class differs from its documented big-O, when it has
gotten worse since the last release (unless `.repo-contract/exceptions/benchmark-complexity.json` records a
person's acceptance), or when the package's overhead relative to its own baseline grows past the allowance in
[`benchmarks/budgets.mjs`](https://github.com/MaverickCER/data-cap/blob/main/benchmarks/budgets.mjs) (the shared
defaults; `GATES` overrides none of them). [READING-BENCHMARKS.md](benchmarks/READING-BENCHMARKS.md) describes the
gates in full. A local run writes to `.benchmark-local/` (ignored) and gates the change without publishing a
figure from a laptop; after a merge, a job measures the merge commit and records the results file and a history
entry through its own small pull request. This is
[`internal-package-contract`](https://github.com/MaverickCER/internal-package-contract)'s shared benchmark
engine, called via its reusable `benchmark-pr.yml` workflow -- data-cap keeps only its suites
(`benchmarks/performance-*/suite.mjs`); everything downstream of a fresh `results.json` is shared,
consumer-agnostic code. Each history entry names the commit, pull request and version, and keeps how noisy
that run was (standard deviation, p95 and iteration count for every size) and the processor it ran on, so a
reader can judge whether a change is larger than the run's own spread. A static history page (small-multiples charts, one per benchmark
group, annotated with its currently-inferred algorithmic complexity class) is rendered fresh at
`docs/benchmarks/index.html` on every deploy — never committed, same treatment `docs/api/` already gets.

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
