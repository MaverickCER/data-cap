# multi-capability-shared-transport

**Client-side pattern.** Subscription transport sharing, field-state, and
processor execution are three independent concerns -- only the first is
ever shared. Two different capabilities acquiring the same `subscribe`
function identity share one connection, but each still runs its own
processor against its own `DataStore`.

## Run it

```sh
npm install
npm start
```

## What it proves

- Two capabilities sharing one `subscribe` identity open exactly one
  transport connection between them.
- The same inbound event reaches both capabilities' own `onEvent` handlers,
  and each processes it completely independently -- capability A converts
  the raw event one way, capability B another -- with no shared state
  between them.
