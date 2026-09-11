# 0036: Retry is an opt-in policy with explicit non-duplication/non-overwrite/non-permanent-retry constraints

## Status

Accepted. Implemented in `src/runtime/retry.ts` (`withRetry`,
`isStillDefault`). Demonstrated directly in `test/integration/runtime-modules/runtime-retry/`.

## Context

Automatic retry is dangerous to apply blindly: retrying a genuinely
permanent failure (a 404, a validation error) forever wastes resources and
never succeeds; retrying in a way that duplicates a subscription or dedup
entry corrupts the coordinator's own bookkeeping; retrying after a caller
has already aborted ignores an explicit cancellation; and retrying when
real data has already arrived risks overwriting it with a stale, in-flight
retry's eventually-arriving (and now-outdated) result.

## Decision

`withRetry(fn, signal, options)` is opt-in — never applied automatically
to any operation by this package — and is built around explicit
constraints: it checks `signal.aborted` before every attempt (including
the first) and again after any inter-attempt delay (since the delay itself
can resolve early specifically because of an abort, which must not be
mistaken for "the delay simply finished"); it never exceeds
`options.maxAttempts`; its `shouldRetry` predicate decides what's worth
retrying at all (defaulting to "retry everything," but callers are
expected to narrow this for real use, since `withRetry` itself has no
knowledge of data-cap's own operation-failure taxonomy). `isStillDefault`
is offered as one documented, ready-made policy: retry a getter only when
the target field currently holds nothing but its declared schema default
— never risking an overwrite of already-real data with an ambiguous retry.

## Consequences

- No operation retries without an application explicitly choosing to wrap
  it in `withRetry` — a plain failure just fails, exactly as it would
  without this module involved at all.
- An aborted caller's retry loop stops promptly, even mid-delay, rather
  than firing one more attempt after the caller has already given up.
- `isStillDefault`'s conservative treatment of non-canonicalizable values
  (never "still the default," so never retried on that basis) means a
  false-positive retry-over-real-data can't happen through that policy's
  own edge cases.

## Alternatives considered

- **Automatic retry applied to every getter/mutator by default.** Rejected
  — a permanent failure (bad input, a 4xx-class error) would retry
  fruitlessly, and this package has no way to distinguish that case from
  a genuinely transient one without an application-supplied predicate.
- **A fixed, non-configurable retry count/backoff.** Rejected — different
  operations have genuinely different acceptable retry budgets and
  backoff shapes; `maxAttempts`/`delayMs`/`shouldRetry` are all
  configurable specifically so one policy doesn't have to fit every case.
