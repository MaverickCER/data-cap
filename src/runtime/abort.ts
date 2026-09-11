/**
 * AbortSignal composition utilities. The runtime always composes an internal
 * signal from developer-provided ones rather than replacing them outright --
 * see specs/architecture.md.
 */

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError")
}

/**
 * Combines multiple signals into one that aborts as soon as any input does.
 * Prefers the native `AbortSignal.any()` where available; falls back to a
 * manual composition for engines without it (Node < 20, still within this
 * package's `engines.node >= 18` floor).
 */
export function composeSignals(signals: readonly AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals as AbortSignal[])
  }
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener("abort", () => {
      controller.abort(signal.reason)
    })
  }
  return controller.signal
}

/**
 * Wraps `promise` so it rejects immediately if `signal` aborts. Never
 * affects `promise` itself -- does not cancel or otherwise influence any
 * underlying shared work (see coordinator.ts: a caller giving up on waiting
 * is not the same as the shared execution being cancelled for every caller).
 */
export function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // AbortController.abort(reason) accepts any value by spec, and callers
    // commonly read `signal.reason` back directly -- force-wrapping a
    // non-Error reason here would silently obscure whatever the developer
    // actually passed.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return Promise.reject(abortReason(signal))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- see above
      reject(abortReason(signal))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        // Re-propagates whatever `promise` itself rejected with, verbatim --
        // a promise may reject with any value, not only an Error.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error)
      },
    )
  })
}
