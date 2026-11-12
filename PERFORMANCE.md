# Performance

You need to know what `data-cap` adds to a bundle or a build. Here are the budgets CI fails over, what the benchmarks measure, and which benchmark result fails a run.

## Two kinds of check

- **Bundle size** is a hard budget per entry point. The `verify` and `contract` jobs fail when an entry is over it.
- **Runtime and build-time speed** are measured, and raw times are shown but never gated between runs. A run fails only on growth class or on overhead relative to its own baseline. The benchmark job does not block a merge.

## Bundle size budgets

`ci/size-budgets.mjs` holds the budgets; `npm run size` checks them. They are gzip sizes of the unminified ESM build. The published code is never minified, so stack traces read like the source. The CommonJS builds carry no budget.

| Entry point       | Budget (gzip) | Notes                                                                                      |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `.` (core)        | 2 KB          |                                                                                            |
| `./runtime`       | 8 KB          | Includes `createData`                                                                      |
| `./runtime/cache` | 1 KB          | Separate entry; `test/runtime/tree-shaking.test.ts` checks `./runtime` does not contain it |
| `./runtime/retry` | 2 KB          | Separate entry; `test/runtime/tree-shaking.test.ts` checks `./runtime` does not contain it |
| `./helpers`       | 3 KB          |                                                                                            |
| `./observe`       | 2.5 KB        |                                                                                            |
| `./evidence`      | 32 KB         | Carries the flow views and the standards adapters                                          |
| `./node`          | 1 KB          | Node only                                                                                  |
| `./build`         | 999 KB        | Node only, development and CI; a ceiling, not a target                                     |
| `./eslint-plugin` | 999 KB        | Node only, inside ESLint; a ceiling, not a target                                          |
| CLI (`bin`)       | 999 KB        | Node only; a ceiling, not a target                                                         |

Run `npm run size` for the current sizes. A budget is raised in review, with the reason written next to it in `ci/size-budgets.mjs`.

`./runtime` holds `createData` instead of a separate entry, because most consumers start with it. An application that uses only `createDataStore` and the coordinator still pays for `createData`'s code. That is a deliberate trade ([ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)).

The build entry, the ESLint plugin and the CLI are not meant for a browser. `compiler-isolation` fails if a runtime entry can reach the bundled compiler; nothing else checks that build, plugin or CLI code stays out of the runtime bundles.

## What the runtime is built to avoid

These hold by reference, and the tests in `test/core/patch.test.ts` check the references, not the timing:

- **Structural sharing.** A commit reuses unchanged branches by reference; changing one leaf never reallocates its siblings ([ADR 0010](specs/decisions/0010-datainfo-array-reconciliation-identity-diffed.md)).
- **Freezing only what changed.** Only new nodes on the changed path are frozen; a reused branch is already frozen ([ADR 0044](specs/decisions/0044-snapshots-deep-frozen-amortized.md)).
- **No-op suppression.** A commit that changes nothing returns the previous snapshot and notifies nobody ([ADR 0042](specs/decisions/0042-no-op-suppression.md)).

## Micro-benchmarks

Two npm projects under `benchmarks/` each depend on `data-cap` through `file:../..` and import it by package name. They exercise the real `exports` map a consumer resolves:

- [`performance-runtime/`](benchmarks/performance-runtime/) times a cold start, `buildData`, `commitAuthoritative`, array-identity reconciliation and `createData`'s dispatch. Every `execute` is simulated; no real network or database is involved.
- [`performance-buildtime/`](benchmarks/performance-buildtime/) times `discoverCapabilityFiles()` and the whole `generateDataArtifacts()` pipeline as the file count grows.

[`benchmarks/README.md`](benchmarks/README.md) explains the fixtures and which numbers should never be read alone.

### What fails a run

The `benchmark-pr` job runs both suites on each pull request that touches benchmarked code. It posts the results as one comment, updated in place, and never commits to the branch. It uses the shared engine from [`internal-package-contract`](https://github.com/MaverickCER/internal-package-contract). A run fails when:

1. a function's measured growth class is two or more classes away from its documented big-O;
2. its growth class is worse than at the last release, unless `.repo-contract/exceptions/benchmark-complexity.json` records a person's acceptance; or
3. the package's overhead relative to its own baseline grows past internal-package-contract's default allowance (70% for sub-millisecond work, 50% otherwise), which [`benchmarks/budgets.mjs`](https://github.com/MaverickCER/data-cap/blob/main/benchmarks/budgets.mjs) can override (it overrides nothing today).

A growth class one step off passes. A failed `benchmark-pr` skips `lint`, `verify` and `contract`, and GitHub counts a skipped required check as passing, so check it by hand. The release still needs a successful `contract` run. [READING-BENCHMARKS.md](benchmarks/READING-BENCHMARKS.md) describes the gates in full.

After a merge, a job measures the merge commit and records the results and a history entry through its own small pull request. Each entry names the commit, pull request and version. It keeps each size's standard deviation, p95 and iteration count, and the processor the run used. The history page at `docs/benchmarks/index.html` is rendered on each deploy and never committed.

## Non-goals

- **No production-workload benchmark.** The suites measure the package's own primitives with simulated I/O, never a full application's mixed workload ([`benchmarks/README.md`](benchmarks/README.md)).
- **No comparison across machines.** Absolute times compare only within one machine and one Node version. The committed history uses one runner label; the processor differs between entries and is recorded with each.

## Reproduction

```sh
git clone https://github.com/maverickcer/data-cap.git
cd data-cap
npm ci
npm run build
npm run size                                     # bundle size budgets
(cd benchmarks/performance-runtime && npm install)
(cd benchmarks/performance-buildtime && npm install)
npm run benchmark                                # skips a suite whose node_modules is missing
```
