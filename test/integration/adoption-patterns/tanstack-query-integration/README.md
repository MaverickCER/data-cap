# tanstack-query-integration

**Client-side pattern.** data-cap ships no `./tanstack` adapter (see ADR "no
first-party integration/adapter packages ship") -- this is the wiring an
application writes itself. TanStack Query owns fetching, in-flight
dedup, and time-based caching; its settled results flow into a data-cap
`DataStore`, so application code reads the same `DataState`/`info` shape
every other example uses.

## Run it

```sh
npm install
npm start
```

## What it proves

- TanStack Query's own in-flight request dedup (two concurrent identical
  queries share one underlying fetch) works the same way whether or not
  data-cap is involved -- data-cap doesn't need to know or care.
- With the default `staleTime` (0), a later call refetches; with an
  explicit `staleTime`, it doesn't -- ordinary TanStack Query behavior,
  unaffected by being wired into a data-cap store.
- The fetched result still flows through the same loading/success commit
  shape every other example uses, regardless of what actually fetched it.
