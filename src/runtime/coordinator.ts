/**
 * Coordinates shared underlying work across capability instances -- NOT the
 * state store (that's store.ts). Two responsibilities:
 *
 * 1. Execution dedup: concurrent calls to the same function identity with
 *    canonically-equal params share one in-flight promise.
 * 2. Subscription sharing: concurrent `acquireSubscription` calls against
 *    the same `subscribe` function identity share one transport connection,
 *    ref-counted, torn down when the last consumer releases.
 *
 * Sharing boundary is FUNCTION IDENTITY, never structural/behavioral
 * equality -- two capabilities passing the same `execute`/`subscribe`
 * reference share; two capabilities passing different references (even
 * behaviorally identical ones) never do. This is not "arrow functions opt
 * out" -- the rule is identity, regardless of syntax.
 *
 * `defaultCoordinator` is a module-level singleton, used implicitly
 * throughout one loaded module instance. `createCoordinator()` gives
 * applications an explicit, opt-in isolated coordination domain (multi-
 * tenant server processes, test isolation) -- isolation is always requested
 * explicitly through this factory, never inferred from function identity/
 * syntax, which remains solely the intra-coordinator sharing boundary.
 *
 * Internal -- not re-exported from the public `.` barrel.
 */

import { canonicalize } from "../core/canonicalize.js"
import { rejectOnAbort } from "./abort.js"
import type { SubscriptionInfo } from "../core/types.js"

interface ExecutionEntry {
  readonly promise: Promise<unknown>
}

/** Handlers a coordinator-managed subscription drives -- see `SubscriptionEventHandlers`, the same shape without a bound `params`. */
export interface SubscriptionHandlers<TEvent> {
  /** Call with each incoming event. */
  readonly onEvent: (event: TEvent) => void
  /** Call whenever the subscription's connection status changes, optionally with the triggering error. */
  readonly onStatusChange: (
    status: SubscriptionInfo["status"],
    detail?: { readonly error?: unknown },
  ) => void
}

/** Opens a shared subscription's transport; the returned function tears it down. */
export type SubscribeFn<TEvent> = (handlers: SubscriptionHandlers<TEvent>) => () => void

interface SharedSubscriptionEntry {
  refCount: number
  status: SubscriptionInfo["status"]
  readonly consumers: Set<SubscriptionHandlers<unknown>>
  readonly unsubscribeFromTransport: () => void
}

/** An isolated coordination domain for dedup and shared subscriptions -- see `createCoordinator`/`defaultCoordinator`. */
export interface Coordinator {
  /**
   * Deduplicates concurrent calls to `fn` (by its own identity) with
   * canonically-equal `params`. Non-canonicalizable params (or a
   * non-canonicalizable-adjacent failure) simply never dedupe -- `fn` runs
   * fresh every time, never throwing and never silently colliding two
   * unrelated calls onto one shared promise.
   *
   * Each caller's own `signal` only affects THEIR OWN wait -- aborting it
   * rejects this call's returned promise without affecting the shared
   * underlying execution or any other caller sharing it.
   */
  dedupe<TParams, TResult>(
    fn: (params: TParams, signal: AbortSignal) => Promise<TResult>,
    params: TParams,
    signal: AbortSignal,
  ): Promise<TResult>

  /**
   * Acquires a shared subscription for `subscribeFn`. The first acquirer
   * establishes the transport; later acquirers with the same function
   * identity reuse it and immediately learn its current status. Returns a
   * release function -- the transport tears down only once every acquirer
   * has released.
   */
  acquireSubscription<TEvent>(
    subscribeFn: SubscribeFn<TEvent>,
    handlers: SubscriptionHandlers<TEvent>,
  ): () => void
}

/** Creates a fresh, isolated `Coordinator` -- an independent dedup/shared-subscription domain, e.g. per-tenant on a server (ADR 0027). */
export function createCoordinator(): Coordinator {
  const executionRegistry = new WeakMap<object, Map<string, ExecutionEntry>>()
  const subscriptionRegistry = new WeakMap<object, SharedSubscriptionEntry>()

  function dedupe<TParams, TResult>(
    fn: (params: TParams, signal: AbortSignal) => Promise<TResult>,
    params: TParams,
    signal: AbortSignal,
  ): Promise<TResult> {
    const key = canonicalize(params)
    if (key === undefined) {
      // Non-canonicalizable params: dedup is purely an optimization, so
      // availability degrades gracefully rather than risking a false
      // collision between two unrelated calls.
      return rejectOnAbort(fn(params, signal), signal)
    }

    let entries = executionRegistry.get(fn)
    const existing = entries?.get(key)
    if (existing !== undefined) {
      return rejectOnAbort(existing.promise as Promise<TResult>, signal)
    }

    // The shared execution runs to completion independent of any single
    // caller's own signal -- other callers may still need the result even
    // if this particular caller gives up on waiting.
    const controller = new AbortController()
    const promise = fn(params, controller.signal)

    if (entries === undefined) {
      entries = new Map()
      executionRegistry.set(fn, entries)
    }
    entries.set(key, { promise })

    const settledEntries = entries
    promise
      .finally(() => {
        // Completed, failed, or cancelled -- always removed, never left to
        // accumulate stale entries a long-lived `fn` would otherwise keep
        // growing regardless of GC (a pending promise is referenced by every
        // awaiter anyway and would never be collected while genuinely in
        // flight).
        settledEntries.delete(key)
      })
      .catch(() => {
        // The .finally() cleanup itself never throws; this only exists so an
        // unhandled-rejection warning is never attributed to this internal
        // bookkeeping promise -- the real rejection is still delivered to
        // every caller via their own returned (rejectOnAbort-wrapped) promise.
      })

    return rejectOnAbort(promise, signal)
  }

  function acquireSubscription<TEvent>(
    subscribeFn: SubscribeFn<TEvent>,
    handlers: SubscriptionHandlers<TEvent>,
  ): () => void {
    let entry = subscriptionRegistry.get(subscribeFn)

    if (entry === undefined) {
      const consumers = new Set<SubscriptionHandlers<unknown>>()
      consumers.add(handlers as SubscriptionHandlers<unknown>)

      // Built without a placeholder `unsubscribeFromTransport` -- `entry` is
      // only assigned once the real one is known, right before publishing
      // (a throwaway function created solely as filler would never actually
      // run, which is exactly the kind of dead code coverage exists to catch).
      const newEntry = {
        refCount: 1,
        status: "connecting" as SubscriptionInfo["status"],
        consumers,
      }

      const fanOut: SubscriptionHandlers<TEvent> = {
        onEvent: (event) => {
          for (const consumer of consumers) {
            ;(consumer as SubscriptionHandlers<TEvent>).onEvent(event)
          }
        },
        onStatusChange: (status, detail) => {
          newEntry.status = status
          for (const consumer of consumers) {
            consumer.onStatusChange(status, detail)
          }
        },
      }

      // Runs before the registry entry is published -- if this throws, no
      // phantom entry is ever created, and the throw propagates directly to
      // this first caller.
      const unsubscribeFromTransport = subscribeFn(fanOut)
      entry = { ...newEntry, unsubscribeFromTransport }
      subscriptionRegistry.set(subscribeFn, entry)
    } else {
      entry.refCount += 1
      entry.consumers.add(handlers as SubscriptionHandlers<unknown>)
      // A late joiner immediately learns the current status rather than
      // waiting for the next transition.
      handlers.onStatusChange(entry.status)
    }

    const ownHandlers = handlers as SubscriptionHandlers<unknown>
    return () => {
      const current = subscriptionRegistry.get(subscribeFn)
      // Idempotent: a second call (or one after the entry was torn down and
      // possibly rebuilt) finds no live registration for `ownHandlers` and
      // stops here -- no double `refCount` decrement, no crash.
      if (!current?.consumers.has(ownHandlers)) return

      current.consumers.delete(ownHandlers)
      current.refCount -= 1
      if (current.refCount <= 0) {
        // The registry entry is removed even if the transport's own
        // teardown throws -- a throwing unsubscribe must never leave a
        // permanently stuck phantom entry blocking a fresh reconnect.
        try {
          current.unsubscribeFromTransport()
        } finally {
          subscriptionRegistry.delete(subscribeFn)
        }
      }
    }
  }

  return { dedupe, acquireSubscription }
}

/** The shared `Coordinator` every `createData` call uses unless `CreateDataOptions.coordinator` overrides it. */
export const defaultCoordinator: Coordinator = createCoordinator()
