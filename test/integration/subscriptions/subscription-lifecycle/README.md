# subscription-lifecycle

**Client-side pattern.** `coordinator.acquireSubscription` ref-counts a
shared transport by `subscribe` function identity: the first acquirer opens
it, later acquirers with the same identity reuse it, and it tears down only
once every acquirer has released.

## Run it

```sh
npm install
npm start
```

## What it proves

- A second acquirer using the same `subscribe` reference never opens a
  second connection.
- A late joiner immediately learns the transport's current status instead
  of waiting for the next transition.
- One consumer unsubscribing while another remains never disconnects the
  transport -- only the last release does.
