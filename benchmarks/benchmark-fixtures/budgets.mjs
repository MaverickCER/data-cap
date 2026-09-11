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
}
