// Highlighting thresholds only -- never a gate. A named benchmark with no
// entry here is still reported, just never flagged -- see
// ../README.md's "How regressions are surfaced".

export const BUDGETS = {
  "cold-start": { maxRegressionPercent: 10 },
  "commitAuthoritative-array-replace": { maxRegressionPercent: 15 },
  "getterDispatch-cold": { maxRegressionPercent: 15 },
  reconcileArrayInfo: { maxRegressionPercent: 15 },
  // Expected near-constant regardless of tier (the structural-sharing
  // invariant this benchmark exists to prove) -- its absolute cost is tiny,
  // so ordinary run-to-run noise produces much larger relative swings than
  // the other, heavier benchmarks. A wider threshold avoids flagging noise
  // as a regression while still catching a real structural-sharing break
  // (which would show up as a large, sustained jump, not noise).
  "commitAuthoritative-leaf": { maxRegressionPercent: 40 },
  discovery: { maxRegressionPercent: 15 },
  artifacts: { maxRegressionPercent: 15 },
  // `createDataCache`'s set/get -- same near-zero-absolute-cost profile as
  // commitAuthoritative-leaf above (single-digit-microsecond Map operations),
  // with the same wide threshold for the same reason: ordinary noise
  // produces much larger relative swings here than a heavier benchmark would
  // see. Measured locally across several runs (~0.004-0.008ms median, up to
  // ~18% run-to-run swing) before picking this value.
  dataCacheSetGet: { maxRegressionPercent: 40 },
  // `withRetry` -- real per-retry cost (setTimeout(0) + Promise/microtask
  // scheduling), not noise-dominated like the two above: repeated local runs
  // measured under ~4% run-to-run swing at every tier once baseline was
  // changed to use at least one real retry (see RUNTIME_RETRY_TIERS's own
  // comment for why `attempts: 1`, a zero-retry immediate-success call, was
  // dropped as the baseline tier -- it never touches the timer/microtask
  // path at all and was measured ~4x noisier as a result).
  withRetry: { maxRegressionPercent: 25 },
  // `defineEvidenceProjection`'s `.project()` -- dominated by
  // `structuredClone()` plus a recursive read-tracking Proxy membrane over
  // the whole Evidence Model. Measured locally across 5 runs: medians of
  // ~1.2-1.6ms (baseline), ~8.6-11.9ms (stress), ~40.6-56.7ms (extreme) --
  // up to ~40% run-to-run swing at every tier, comparable to
  // commitAuthoritative-leaf's own noise profile, hence the same wide
  // threshold rather than a guessed tighter one.
  evidenceProjection: { maxRegressionPercent: 40 },
}
