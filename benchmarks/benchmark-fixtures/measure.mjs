// Shared timing/memory measurement helpers. No dependency on data-cap
// itself -- these operate on plain numbers and callback functions, reused
// identically by performance-runtime and performance-buildtime.

export function snapshotMemory() {
  const m = process.memoryUsage()
  return {
    rssBytes: m.rss,
    heapUsedBytes: m.heapUsed,
    heapTotalBytes: m.heapTotal,
    externalBytes: m.external,
    arrayBuffersBytes: m.arrayBuffers ?? 0,
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

/** Turns a flat array of per-iteration durations into the shared DurationStats shape. */
export function computeDurationStats(valuesMs, warmupIterations) {
  const sorted = [...valuesMs].sort((a, b) => a - b)
  const n = sorted.length
  const mean = n > 0 ? sorted.reduce((a, b) => a + b, 0) / n : 0
  const variance = n > 0 ? sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0
  return {
    minMs: sorted[0] ?? 0,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[n - 1] ?? 0,
    stdDevMs: Math.sqrt(variance),
    iterations: n,
    warmupIterations,
  }
}

/** Times one call to `fn`, returning elapsed milliseconds. */
export async function timeIt(fn) {
  const t0 = performance.now()
  await fn()
  return performance.now() - t0
}

/**
 * Runs `iterationFn` repeatedly -- `warmupIterations` discarded runs first,
 * then samples until `targetDurationMs` of wall-clock elapses or
 * `maxIterations` is hit, never stopping before `minIterations`. Calls
 * `global.gc()` (requires `--expose-gc`) before each counted sample when
 * available. Returns the raw per-iteration results (caller decides how to
 * reduce them -- a single duration number for in-process benchmarks, or a
 * richer per-iteration object for something like cold-start that reports
 * multiple fields per sample).
 */
export async function adaptiveSample(iterationFn, opts = {}) {
  const warmupIterations = opts.warmupIterations ?? 5
  const targetDurationMs = opts.targetDurationMs ?? 2000
  const minIterations = opts.minIterations ?? 5
  const maxIterations = opts.maxIterations ?? 100
  const gc = typeof global.gc === "function" ? global.gc : undefined

  for (let i = 0; i < warmupIterations; i++) {
    await iterationFn()
  }

  const samples = []
  const start = performance.now()
  while (
    samples.length < maxIterations &&
    (samples.length < minIterations || performance.now() - start < targetDurationMs)
  ) {
    gc?.()
    samples.push(await iterationFn())
  }

  return {
    samples,
    configuration: {
      targetDurationMs,
      minIterations,
      maxIterations,
      warmupIterations,
      gcEnabled: Boolean(gc),
    },
  }
}

/** Convenience wrapper for the common "time this async fn repeatedly" case. */
export async function measureDuration(fn, opts = {}) {
  const { samples, configuration } = await adaptiveSample(() => timeIt(fn), opts)
  return { stats: computeDurationStats(samples, configuration.warmupIterations), configuration }
}
