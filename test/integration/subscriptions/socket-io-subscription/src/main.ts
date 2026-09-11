/**
 * Client-side pattern: data-cap ships no `./socket-io` adapter -- this is
 * the wiring an application writes itself. A real local Socket.IO server +
 * client pair (no external network dependency) stands in for a production
 * WebSocket deployment; `coordinator.acquireSubscription` is exactly what
 * makes this shareable across multiple consumers the same way any other
 * transport would be (see subscription-lifecycle/).
 */
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { Server as SocketIOServer } from "socket.io"
import { io as ioClient } from "socket.io-client"
import { buildData } from "@maverickcer/data-cap"
import { createDataStore, defaultCoordinator } from "@maverickcer/data-cap/runtime"
import type { SubscriptionHandlers } from "@maverickcer/data-cap/runtime"

interface PriceEvent {
  readonly price: number
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// -- A real local Socket.IO server, listening on an OS-assigned port -- --
let serverSideDisconnectCount = 0
const httpServer = createServer()
const ioServer = new SocketIOServer(httpServer, { transports: ["websocket"] })
ioServer.on("connection", (socket) => {
  setTimeout(() => socket.emit("price-update", { price: 100 } satisfies PriceEvent), 5)
  socket.on("disconnect", () => {
    serverSideDisconnectCount += 1
  })
})
await new Promise<void>((resolve) => httpServer.listen(0, resolve))
const port = (httpServer.address() as AddressInfo).port

function subscribeToPrices(handlers: SubscriptionHandlers<PriceEvent>): () => void {
  const socket = ioClient(`http://localhost:${String(port)}`, { transports: ["websocket"] })
  handlers.onStatusChange("connecting")
  socket.on("connect", () => handlers.onStatusChange("connected"))
  socket.on("price-update", (event: PriceEvent) => handlers.onEvent(event))
  socket.on("disconnect", () => handlers.onStatusChange("disconnected"))
  return () => socket.disconnect()
}

const capability = buildData({ fields: { price: 0 } })
const store = createDataStore(capability)

const release = defaultCoordinator.acquireSubscription(subscribeToPrices, {
  onEvent: (event) => {
    store.commitAuthoritative(
      { price: event.price },
      { price: { status: "success", source: "priceFeed" } },
    )
  },
  onStatusChange: (status) => {
    store.commitAuthoritative(undefined, { price: { subscription: { status } } })
  },
})

await waitUntil(() => store.getSnapshot().info.price?.subscription?.status === "connected", 2000)
assert.equal(
  store.getSnapshot().fields.price,
  0,
  "connecting doesn't touch fields, only info.subscription",
)

await waitUntil(() => store.getSnapshot().fields.price === 100, 2000)
assert.equal(
  store.getSnapshot().fields.price,
  100,
  "a real event, over a real local socket, committed the fetched value",
)
assert.equal(store.getSnapshot().info.price?.source, "priceFeed")

// The last (and only) acquirer's own release() removes it from the
// coordinator's consumer set BEFORE the transport's teardown runs -- so
// the releasing consumer never observes its OWN "disconnected" status via
// onStatusChange (there's no one left in the fan-out to broadcast it to).
// Confirmed instead from the server side: the real socket really closed.
release()
await waitUntil(() => serverSideDisconnectCount === 1, 2000)

await new Promise<void>((resolve) => {
  ioServer.close(() => {
    httpServer.close(() => resolve())
  })
})

const summary = {
  finalPrice: store.getSnapshot().fields.price,
  finalSource: store.getSnapshot().info.price?.source,
  serverSideDisconnectCount,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("socket-io-subscription: all assertions passed.")
