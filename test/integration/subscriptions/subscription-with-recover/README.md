# subscription-with-recover

**Client-side pattern.** After a subscription reconnects, an optional
`recover` getter re-syncs by fetching the current value once through the
ordinary getter pipeline. If a live event arrives around the same time,
both simply commit through the ordinary atomic path in whatever order they
resolve.

## Run it

```sh
npm install
npm start
```

## What it proves

- There is no invented ordering guarantee between a `recover` getter and a
  live subscription event -- whichever commits last is what's visible
  afterward, regardless of which kind of operation it is.
- Because every commit always folds onto whatever is _currently_
  authoritative, no update is silently lost even without an ordering
  guarantee.
