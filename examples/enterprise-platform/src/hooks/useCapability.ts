/**
 * Wires any `createData` capability into React -- `getSnapshot`/`subscribe`
 * are already `useSyncExternalStore`-compatible by construction (see
 * AGENTS.md's own non-negotiable invariants), so this hook is a thin,
 * generic adapter, not a data-cap-specific integration layer. The same
 * function works for `identityData`, `projectsData`, and `billingData`
 * alike, and would work for any other `createData` capability this app
 * added later.
 */
import { useSyncExternalStore } from "react"

interface CapabilityLike<TSnapshot> {
  getSnapshot(): TSnapshot
  subscribe(listener: () => void): () => void
}

export function useCapability<TSnapshot>(capability: CapabilityLike<TSnapshot>): TSnapshot {
  return useSyncExternalStore(
    (listener) => capability.subscribe(listener),
    () => capability.getSnapshot(),
    // Server snapshot, for TanStack Start's own SSR pass (`examples/
    // enterprise-platform/` is the only one of this session's three
    // examples with a real SSR framework in front of it) -- the same,
    // ordinary synchronous `getSnapshot()` call works identically on the
    // server, since it's never a browser-only API, only a return of
    // whatever state the capability already holds (its declared defaults,
    // pre-fetch). Omitting this argument entirely is what React's own
    // `useSyncExternalStore` requires for any SSR-rendered tree; omitting it
    // silently falls back to client-only rendering instead of throwing.
    () => capability.getSnapshot(),
  )
}
