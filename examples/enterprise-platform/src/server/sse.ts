/**
 * The SSE hub -- native `text/event-stream`, no library. `data-cap` has no
 * transport of its own (ADR "no first-party integration/adapter packages
 * ship"); this is exactly the kind of real-time transport a `createData`
 * subscription wires against, same role `test/integration/subscriptions/
 * socket-io-subscription/` demonstrates for Socket.IO.
 *
 * "In a secure manner" means two concrete things, both enforced by
 * `http-handler.ts` before this module is ever reached, not here:
 * (1) a stream is only ever opened for a request carrying a currently-valid
 * session (`getSession`) -- an unauthenticated client can never subscribe;
 * (2) every event this hub publishes is already scoped to one `projectId`'s
 * own subscriber set, so one project's live invoice updates never reach a
 * client subscribed to a different project. This module itself has no
 * session concept at all -- it only ever fans out to whoever the caller
 * already decided was allowed to listen.
 */
import type { ServerResponse } from "node:http"

/**
 * Carries the full current invoice list on every event, not just the one
 * invoice that changed -- the same "the live feed pushes the full snapshot"
 * choice `examples/team-service/` and the earlier legal-matters build of
 * this example both made, for the same reason: a subscription's `processor`
 * (unlike `optimistic`) never receives current field state, so merging a
 * single changed item into an existing array isn't possible from inside
 * `processor` alone.
 */
export interface InvoiceEvent {
  readonly invoices: readonly {
    readonly id: string
    readonly amountCents: number
    readonly status: "draft" | "sent" | "paid" | "disputed"
  }[]
}

const subscribers = new Map<string, Set<ServerResponse>>()

/** Registers `res` as an open SSE connection for `projectId` -- caller is responsible for having already authenticated the request. */
export function subscribeToInvoiceEvents(projectId: string, res: ServerResponse): () => void {
  const existing = subscribers.get(projectId) ?? new Set<ServerResponse>()
  existing.add(res)
  subscribers.set(projectId, existing)
  return () => {
    existing.delete(res)
    if (existing.size === 0) subscribers.delete(projectId)
  }
}

/** Publishes `event` to every currently-open connection for `projectId` -- never to any other project's subscribers. */
export function publishInvoiceEvent(projectId: string, event: InvoiceEvent): void {
  const connections = subscribers.get(projectId)
  if (connections === undefined) return
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const res of connections) {
    res.write(payload)
  }
}

/** Current subscriber count for `projectId` -- used only by the headless test to prove ref-counted-style fan-out without a race on `setTimeout`. */
export function subscriberCountFor(projectId: string): number {
  return subscribers.get(projectId)?.size ?? 0
}
