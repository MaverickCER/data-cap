/**
 * Optional, opt-in retry. Never required by core, never applied
 * automatically to a processor/validation failure -- only the caller's
 * `shouldRetry` predicate decides what's worth retrying, since retry.ts
 * itself has no knowledge of data-cap's operation-failure taxonomy (that
 * distinction belongs to whatever wires this into the real execution
 * pipeline, in a later phase). Never retries after the signal aborts, never
 * exceeds `maxAttempts`, and never assumes a mutation is idempotent -- the
 * developer opts a specific operation into retry, this module never decides
 * that on its own.
 *
 * Ships as its own `./runtime/retry` entry point (see tsup.config.ts) for
 * the same structural tree-shaking guarantee `./runtime/cache` has.
 */

import { canonicalize } from "../core/canonicalize.js"

export interface RetryOptions {
  /** Maximum retry attempts after the initial call (not counting the first attempt itself). Defaults to 3. */
  readonly maxAttempts?: number
  /** Delay (ms) before a given 1-indexed retry attempt. Defaults to capped exponential backoff. */
  readonly delayMs?: (attempt: number) => number
  /** Whether `error` (from the given 1-indexed attempt) is worth retrying at all. Defaults to retrying every error -- callers should narrow this for real use. */
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean
}

/** @internal Capped exponential backoff (1s, 2s, 4s, ... 30s max) for a 1-indexed attempt. Exported for direct unit coverage -- reached in production only through `withRetry`'s loop. */
export function defaultBackoff(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 30_000)
}

/** @internal The reason value a `withRetry`/`delay` abort rejects with -- the signal's own `reason`, or a synthesized `AbortError` when it has none. Exported for direct unit coverage. */
export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError")
}

/** @internal Resolves after `ms`, or immediately if `signal` aborts (now or during the wait). Exported for direct unit coverage. */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * Runs `fn`, retrying on failure per `options`. Checks `signal` before every
 * attempt (including the first) and during any inter-attempt delay -- an
 * aborted signal always wins over a pending retry.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const delayMs = options.delayMs ?? defaultBackoff
  const shouldRetry = options.shouldRetry ?? ((_error: unknown, _attempt: number): boolean => true)

  if (signal.aborted) {
    throw abortReason(signal)
  }

  // A hard, generous iteration ceiling -- deliberately bounded by a fixed
  // array's length, not a manually incremented/decremented counter compared
  // against a limit: an `UpdateOperator` mutation flipping `iterations++` to
  // `iterations--` would walk such a counter away from its bound instead of
  // toward it, looping until Stryker's own timeout rather than producing an
  // observably wrong result a normal test could catch. Iterator protocol has
  // no exposed counter for that class of mutation to target (same rationale
  // as env-cap's `compatibility.ts`/`exclusive-group.ts` pairwise loops).
  // Also deliberately NOT derived from `maxAttempts` -- a pathological
  // caller-supplied `maxAttempts` of `Infinity`/`NaN` must not turn this
  // into an unbounded loop too. Not a policy limit (a caller's
  // `maxAttempts`/`shouldRetry`/signal abort already enforce that; correct
  // code with any sane, finite `maxAttempts` always exits via
  // `attempt > maxAttempts` by iteration `maxAttempts + 1`, far short of
  // this) but a fast-failing backstop against a broken loop-exit condition
  // -- or a broken `maxAttempts` itself -- spinning forever instead of
  // failing fast. See mutation-testing notes in retry.test.ts.
  const iterationCeiling = 100
  let attempt = 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the loop variable itself is irrelevant; only the fixed array length bounds the loop
  for (const _iteration of Array.from({ length: iterationCeiling + 1 })) {
    try {
      return await fn(signal)
    } catch (error) {
      attempt += 1
      // `AbortSignal.aborted` is declared `readonly` in the DOM lib types, so
      // TS assumes it stays `false` once checked before the loop -- but the
      // signal is externally mutable: an AbortController elsewhere can call
      // `.abort()` at any point during the `await fn(signal)` above. This
      // check is genuinely re-evaluated at runtime, not statically redundant.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see comment above; externally mutable
      if (signal.aborted || attempt > maxAttempts || !shouldRetry(error, attempt)) {
        throw error
      }
      await delay(delayMs(attempt), signal)
      // delay() can resolve EARLY, before its full duration, specifically
      // because the signal aborted during the wait (see delay()'s own abort
      // listener) -- that early return must not be mistaken for "the delay
      // simply finished," or a retry would fire after cancellation.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- externally mutable, see above
      if (signal.aborted) {
        throw abortReason(signal)
      }
    }
  }
  // Unreachable by any correct exit path: `attempt > maxAttempts` above
  // always throws well before the loop could ever exhaust `iterationCeiling`
  // iterations. Reaching here means the exit condition itself is broken --
  // fail fast and say so, rather than hang.
  throw new Error(
    `withRetry: exceeded ${String(iterationCeiling)} loop iterations without ever honoring maxAttempts=${String(maxAttempts)} -- the retry loop's own exit condition is broken, or maxAttempts itself is not a sane finite number.`,
  )
}

/**
 * One documented retry policy, exposed ready-made for the common case: retry
 * only when the target field currently holds nothing but its declared
 * schema default -- never risks overwriting already-valid data with an
 * ambiguous retry. Not the only valid policy. Uses the same canonicalization
 * comparison as array identity/coordinator dedup; a non-canonicalizable
 * value is conservatively treated as "not the default" (never retried).
 */
export function isStillDefault(currentValue: unknown, declaredDefault: unknown): boolean {
  if (Object.is(currentValue, declaredDefault)) return true
  const currentKey = canonicalize(currentValue)
  const defaultKey = canonicalize(declaredDefault)
  // A non-canonicalizable value (`canonicalize` -> `undefined`) is conservatively
  // "not the default": if `currentKey` is undefined the whole thing is false; if
  // only `defaultKey` is undefined, a real `currentKey` can never `===` it.
  return currentKey !== undefined && currentKey === defaultKey
}
