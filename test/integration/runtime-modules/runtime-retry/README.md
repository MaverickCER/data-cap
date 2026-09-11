# runtime-retry

**Client-side pattern.** `runtime/retry` is optional, opt-in retry -- never
applied automatically to any failure. `isStillDefault` is one documented,
ready-made retry policy: only retry a getter when the target field still
holds nothing but its declared schema default.

## Run it

```sh
npm install
npm start
```

## What it proves

- `withRetry` retries transient failures up to `maxAttempts`, and succeeds
  once the wrapped function does.
- A `shouldRetry` predicate returning `false` stops retrying immediately,
  even on the very first failure.
- Aborting during an inter-attempt delay prevents the next attempt from
  ever firing -- an aborted signal always wins over a pending retry.
- `isStillDefault` never mistakes real data for "still the default", and
  conservatively treats a non-canonicalizable value as "not the default"
  (never retried) rather than risk a false positive.
