# runtime-cache

**Client-side pattern.** `runtime/cache` is an optional, bounded cache of
complete `DataState` snapshots -- `fields` and `info` together, atomically,
never `fields` alone and never a raw unvalidated response.

## Run it

```sh
npm install
npm start
```

## What it proves

- A cache hit never triggers a second fetch for the same key.
- The cache never grows past its configured `maxEntries` -- inserting past
  the bound evicts the least-recently-used entry.
- It's a separate concern from `coordinator.dedupe`: a cache answers
  "validated state is already available", not "a request is already in
  progress."
