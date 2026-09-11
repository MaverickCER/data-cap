/**
 * The standalone runtime's state container: owns `authoritativeState` and
 * `pendingTransitions`, exposes their `project()`-folded `visibleState`
 * through the `DataStore` contract (`getSnapshot`/`subscribe`,
 * `useSyncExternalStore`-compatible without importing React).
 *
 * A completed/failed optimistic mutation is never "rolled back" by special
 * code -- `removePendingTransition` simply removes its entry, and the next
 * `project()` fold naturally omits it. No automatic rollback, no invented
 * conflict-resolution policy: `commitAuthoritative` always folds a patch
 * onto whatever is CURRENTLY authoritative, never a stale snapshot captured
 * when an operation started.
 */

import { commitState, project } from "../core/patch.js"
import type {
  DataInfo,
  DataState,
  DataStore,
  DeepPartial,
  PendingTransition,
} from "../core/types.js"

export interface DataStoreController<TFields> extends DataStore<TFields> {
  /**
   * Commits a patch directly onto authoritative state (getter/subscription-
   * style updates, and a mutator's final settle). Always folds onto the
   * CURRENT authoritative state, never a snapshot captured earlier.
   */
  commitAuthoritative(
    fieldsPatch: DeepPartial<TFields> | undefined,
    infoPatch: DeepPartial<DataInfo<TFields>> | undefined,
  ): void
  /** Adds a pending optimistic transition; the visible snapshot reflects it immediately. */
  addPendingTransition(
    fieldsPatch: DeepPartial<TFields> | undefined,
    infoPatch: DeepPartial<DataInfo<TFields>> | undefined,
  ): symbol
  /** Removes a pending transition by id (its operation settled, success or failure either way). */
  removePendingTransition(id: symbol): void
  /** The current authoritative state, independent of any pending optimistic transitions. */
  getAuthoritativeState(): DataState<TFields>
}

/** Creates a standalone `DataStoreController`, seeded with `initialState` -- the manual-control building block `createData` composes over. */
export function createDataStore<TFields>(
  initialState: DataState<TFields>,
): DataStoreController<TFields> {
  let authoritativeState = initialState
  // Stryker disable next-line ArrayDeclaration: a phantom initial element is a
  // provable no-op -- `project` folds every entry through `commitState`, which
  // treats a value lacking `fieldsPatch`/`infoPatch` as an empty (identity) patch.
  let pendingTransitions: readonly PendingTransition<TFields>[] = []
  let visibleState = initialState
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  function recomputeVisibleState(): void {
    const next = project(authoritativeState, pendingTransitions)
    // No-op suppression: a fold that changes nothing publishes nothing.
    if (next !== visibleState) {
      visibleState = next
      notify()
    }
  }

  return {
    getSnapshot(): DataState<TFields> {
      return visibleState
    },
    getAuthoritativeState(): DataState<TFields> {
      return authoritativeState
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    commitAuthoritative(fieldsPatch, infoPatch): void {
      const next = commitState(authoritativeState, fieldsPatch, infoPatch)
      if (next !== authoritativeState) {
        authoritativeState = next
        recomputeVisibleState()
      }
    },
    addPendingTransition(fieldsPatch, infoPatch): symbol {
      const id = Symbol("pending-transition")
      pendingTransitions = [...pendingTransitions, { id, fieldsPatch, infoPatch }]
      recomputeVisibleState()
      return id
    },
    removePendingTransition(id): void {
      const next = pendingTransitions.filter((transition) => transition.id !== id)
      if (next.length !== pendingTransitions.length) {
        pendingTransitions = next
        recomputeVisibleState()
      }
    },
  }
}
