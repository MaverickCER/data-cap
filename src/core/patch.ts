/**
 * The single sanctioned way to transition a resolved fields/info tree, or a
 * full `DataState`. `patchInto` gives structural sharing over one tree;
 * `commitState` wraps it to guarantee `fields` and `info` are always
 * produced and published together as one atomic object -- no runtime code
 * path may update them independently (see specs/architecture.md). `project`
 * folds pending optimistic transitions on top of authoritative state, always
 * fully recomputed, never cached.
 *
 * Internal -- not re-exported from the public `.` barrel. Consumed by the
 * (future) standalone runtime and by ownership.ts's callers.
 */

import type { DataInfo, DataState, DeepPartial, PendingTransition } from "./types.js"

/**
 * Merges `patch` into `prev`, reusing `prev`'s own branches by reference
 * wherever the patch doesn't touch them. Returns `prev` itself, unchanged,
 * when the patch produces no actual difference -- callers use `===` against
 * the input to detect a true no-op (see commitState).
 *
 * Walks the UNION of `prev`'s and `patch`'s own keys, not just `prev`'s --
 * `fields` trees are dense (every declared key exists from `buildData()`
 * onward, so a patch's keys are always already a subset), but `info` trees
 * are sparse and grow new keys over time (a field's first `FieldInfo` is a
 * genuinely new key, not an update to an existing one). Trusts its caller on
 * SAFETY (see ownership.ts) -- it does not itself enforce that a new key was
 * legitimately owned -- only on completeness of `prev`'s keys.
 */
export function patchInto<T>(prev: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) {
    return prev
  }

  if (prev === null || typeof prev !== "object") {
    // Primitive leaf -- the patch, if present at this position, replaces it outright.
    return patch as T
  }

  if (
    Array.isArray(prev) ||
    prev instanceof Date ||
    prev instanceof URL ||
    prev instanceof RegExp
  ) {
    // Arrays and opaque built-ins are atomic: a provided patch value
    // replaces the whole thing, never merged/diffed piecewise. `patch` is
    // never `undefined` here (guarded by the check above) -- including an
    // explicit `null` transition for a nullable field, which must not
    // collapse back to `prev` via nullish coalescing.
    return patch as T
  }

  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    // Patch shape doesn't match prev's -- defensive fallback, replace outright.
    return patch as T
  }

  const prevRecord = prev as Record<string, unknown>
  const patchRecord = patch as Record<string, unknown>
  const result: Record<string, unknown> = {}
  let changed = false

  const keys = new Set([...Object.keys(prevRecord), ...Object.keys(patchRecord)])
  for (const key of keys) {
    const prevHasKey = Object.hasOwn(prevRecord, key)
    // Stryker disable next-line ConditionalExpression: `patchInto(x, undefined)`
    // is `x`, so routing a prev-only key through the merge branch (mutant: `true`)
    // is behaviourally identical to the `else` here. The `false` direction (a
    // patch that adds/updates a key silently doing nothing) is covered by the
    // "merges a partial patch" cases.
    if (Object.hasOwn(patchRecord, key)) {
      const nextValue = patchInto(prevHasKey ? prevRecord[key] : undefined, patchRecord[key])
      result[key] = nextValue
      if (!prevHasKey || nextValue !== prevRecord[key]) {
        changed = true
      }
    } else {
      result[key] = prevRecord[key]
    }
  }

  return changed ? (result as T) : prev
}

/**
 * Freezes `value` and every object/array reachable from it, skipping
 * anything already frozen. Because structural sharing reuses unchanged
 * branches by reference, an already-frozen branch is always a previously
 * committed one -- this makes freeze cost proportional to what actually
 * changed in a given commit, not to total state size. See
 * specs/architecture.md's "Snapshot immutability enforcement".
 *
 * `Object.freeze` only blocks property reassignment/addition/deletion on the
 * object itself -- it does not block mutation performed through a built-in's
 * own methods on internal slots (e.g. `Date.prototype.setFullYear`,
 * `Map.prototype.set`, `Set.prototype.add` all still work on a frozen
 * instance). For those types, immutability of a published snapshot is a
 * discipline-level guarantee (never mutate a value you were handed), not a
 * runtime-enforced one.
 */
export function deepFreezeNewNodes(value: unknown): void {
  // `Object.isFrozen` is `true` for every primitive and for `null`/`undefined`,
  // so this one check also covers "leaf value, nothing to descend into" -- and
  // a previously-frozen branch is always a previously-committed one.
  if (Object.isFrozen(value)) {
    return
  }
  Object.freeze(value)
  for (const key of Object.keys(value as object)) {
    deepFreezeNewNodes((value as Record<string, unknown>)[key])
  }
}

/**
 * Produces the next `{fields, info}` pair as ONE atomic object. If the
 * resulting fields and info are both reference-equal to `prev`'s (nothing
 * actually changed), returns `prev` itself unchanged, so a store can compare
 * `next === prev` to decide whether to notify subscribers at all -- a true
 * no-op never publishes a new snapshot.
 */
export function commitState<TFields>(
  prev: DataState<TFields>,
  fieldsPatch: DeepPartial<TFields> | undefined,
  infoPatch: DeepPartial<DataInfo<TFields>> | undefined,
): DataState<TFields> {
  const nextFields = patchInto(prev.fields, fieldsPatch)
  const nextInfo = patchInto(prev.info, infoPatch)

  if (nextFields === prev.fields && nextInfo === prev.info) {
    return prev
  }

  const next: DataState<TFields> = { fields: nextFields, info: nextInfo }
  deepFreezeNewNodes(next)
  return next
}

/**
 * Projects `authoritativeState` through every `pendingTransitions` entry, in
 * order, always fully recomputed -- never cached. Folding an empty list
 * returns `authoritativeState` unchanged (same reference).
 */
export function project<TFields>(
  authoritativeState: DataState<TFields>,
  pendingTransitions: readonly PendingTransition<TFields>[],
): DataState<TFields> {
  let state = authoritativeState
  for (const transition of pendingTransitions) {
    state = commitState(state, transition.fieldsPatch, transition.infoPatch)
  }
  return state
}
