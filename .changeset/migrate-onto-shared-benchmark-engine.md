---
"data-cap": minor
---

Migrates the benchmark pipeline (history append, PR-comment summary, history page) onto `internal-package-contract`'s new shared benchmark engine (`scripts/benchmark/*.mjs`, called via its reusable `benchmark-pr.yml` workflow), replacing this repo's own now-deleted `benchmarks/append-benchmark-history.mjs` / `benchmarks/render-benchmark-summary.mjs` copies.

This repo's directory convention (`benchmarks/`, `benchmarks/history/`) is unchanged -- nothing moved or renamed. What did change:

- `.github/workflows/ci.yml`'s `benchmark-pr` job is now a thin caller of `internal-package-contract`'s reusable `benchmark-pr.yml` (pinned to its merged commit), with the exact same trigger condition, anti-recursion-loop guard, and per-PR concurrency serialization as before -- only the step bodies moved into the shared workflow.
- Three new npm scripts (`benchmark:history`, `benchmark:summary`, `benchmark:page`) forward to `internal-package-contract`'s copies, matching its README's documented consumer wiring.
- Committed benchmark history (`benchmarks/history/{runtime,buildtime}.json`) moves to schema v2: each tier measurement now also carries its full `inputs` object and a derived `unitsPerSecond` figure, alongside the existing `medianMs`. Older v1 entries stay valid as-is; nothing is migrated or rewritten.
- The `deploy` job now renders a static benchmark-history page (`docs/benchmarks/index.html` -- small-multiples charts per benchmark group, each annotated with its currently-inferred algorithmic complexity class) fresh on every deploy, the same treatment `docs/api/` already gets. Never committed.

No change to what's measured, this package's public API, or the PR-comment's own methodology/budgets -- `benchmarks/run-benchmarks.mjs`, each example's own `scripts/run-benchmark.mjs`, and `benchmark-fixtures/budgets.mjs` are untouched.
