# socket-io-subscription

**Client-side pattern.** data-cap ships no `./socket-io` adapter (see ADR
"no first-party integration/adapter packages ship") -- this is the wiring
an application writes itself. A real local Socket.IO server + client pair
(no external network dependency) stands in for a production WebSocket
deployment.

## Run it

```sh
npm install
npm start
```

## What it proves

- A real Socket.IO client's `connect`/`price-update`/`disconnect` events
  drive `coordinator.acquireSubscription`'s handlers exactly like any other
  transport -- data-cap has no special-cased knowledge of Socket.IO.
- A status transition alone (`connecting`/`connected`) never touches
  `fields`, only `info.<field>.subscription`.
- A real inbound event, delivered over a real (if local) socket, commits
  through the ordinary atomic path.
