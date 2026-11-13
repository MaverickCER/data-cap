/**
 * `data-cap/runtime/retry`: `withRetry`, opt-in retry for one operation, and `isStillDefault`, a
 * ready-made retry predicate. `data-cap/runtime` does not include it.
 *
 * @packageDocumentation
 */

/** @internal The reason value a `withRetry`/`delay` abort rejects with: the signal's own `reason`, or a synthesized `AbortError` when it has none. Exported for direct unit coverage. */
export declare function abortReason(signal: AbortSignal): unknown;

/** @internal Capped exponential backoff (1s, 2s, 4s, ... 30s max) for a 1-indexed attempt. Exported for direct unit coverage: reached in production only through `withRetry`'s loop. */
export declare function defaultBackoff(attempt: number): number;

/** @internal Resolves after `ms`, or immediately if `signal` aborts (now or during the wait). Exported for direct unit coverage. */
export declare function delay(ms: number, signal: AbortSignal): Promise<void>;

/**
 * One documented retry policy, ready-made for the common case: retry only while
 * the target field still holds its declared schema default. It never risks
 * overwriting valid data with an ambiguous retry. Not the only valid policy.
 * Uses the same canonicalization
 * comparison as array identity/coordinator dedup; a non-canonicalizable
 * value is conservatively treated as "not the default" (never retried).
 */
export declare function isStillDefault(currentValue: unknown, declaredDefault: unknown): boolean;

/** Options for `withRetry`. Every field is optional; the defaults retry every error up to 3 times with capped backoff. */
export declare interface RetryOptions {
    /** Maximum retry attempts after the initial call (not counting the first attempt itself). Defaults to 3. */
    readonly maxAttempts?: number;
    /** Delay (ms) before a given 1-indexed retry attempt. Defaults to capped exponential backoff. */
    readonly delayMs?: (attempt: number) => number;
    /** Whether `error` (from the given 1-indexed attempt) is worth retrying at all. Defaults to retrying every error: callers should narrow this for real use. */
    readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Runs `fn`, retrying on failure per `options`. Checks `signal` before every
 * attempt (including the first) and during any inter-attempt delay: an
 * aborted signal always wins over a pending retry.
 */
export declare function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, options?: RetryOptions): Promise<T>;

export { }
