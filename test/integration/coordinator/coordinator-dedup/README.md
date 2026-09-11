# coordinator-dedup

**Client-side pattern.** `coordinator.dedupe` shares one in-flight call
across concurrent requests with the same function identity and
canonically-equal params -- several parts of an app independently
requesting the same data at once only actually triggers one real call.

## Run it

```sh
npm install
npm start
```

## What it proves

- Identical params concurrently requested through the same function
  reference dedupe onto one underlying call; different params never do.
- A function-valued (non-canonicalizable) param never dedupes, even with
  the identical reference passed twice -- dedup degrades gracefully rather
  than risking a false collision.
- A per-caller `AbortSignal` only rejects that caller's own returned
  promise -- it never cancels the shared underlying work another caller is
  still waiting on.
