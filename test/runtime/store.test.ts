import { describe, expect, it, vi } from "vitest"
import { createDataStore } from "../../src/runtime/store.js"
import type { DataState } from "../../src/core/types.js"

function initialState(): DataState<{ count: number; user: { email: string } }> {
  return { fields: { count: 0, user: { email: "" } }, info: {} }
}

describe("createDataStore -- DataStore contract", () => {
  it("getSnapshot returns the exact same reference when nothing has changed", () => {
    const store = createDataStore(initialState())
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it("getSnapshot returns a new reference, and notifies subscribers, after a real commit", () => {
    const store = createDataStore(initialState())
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    store.commitAuthoritative({ count: 1 }, undefined)

    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot().fields.count).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("a true no-op commit publishes nothing and never notifies subscribers", () => {
    const store = createDataStore(initialState())
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    store.commitAuthoritative({ count: 0 }, undefined) // reproduces the existing value
    store.commitAuthoritative(undefined, undefined) // no patch at all

    expect(store.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it("unsubscribe stops further notifications", () => {
    const store = createDataStore(initialState())
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()

    store.commitAuthoritative({ count: 1 }, undefined)
    expect(listener).not.toHaveBeenCalled()
  })

  it("never mutates a previously published snapshot -- each commit is a genuinely new, frozen object", () => {
    const store = createDataStore(initialState())
    const before = store.getSnapshot()
    store.commitAuthoritative({ count: 1 }, undefined)
    // The old snapshot's own fields are untouched by the later commit.
    expect(before.fields.count).toBe(0)
    expect(Object.isFrozen(store.getSnapshot())).toBe(true)
  })

  it("fields and info commit atomically -- never observable as {newFields, oldInfo} or the reverse", () => {
    const store = createDataStore(initialState())
    store.commitAuthoritative({ count: 1 }, { count: { status: "success" } })
    const snapshot = store.getSnapshot()
    expect(snapshot.fields.count).toBe(1)
    expect(snapshot.info.count?.status).toBe("success")
  })
})

describe("createDataStore -- optimistic transitions", () => {
  it("an added pending transition is immediately reflected in the visible snapshot", () => {
    const store = createDataStore(initialState())
    store.addPendingTransition({ count: 5 }, undefined)
    expect(store.getSnapshot().fields.count).toBe(5)
    // Authoritative state is untouched by an optimistic transition.
    expect(store.getAuthoritativeState().fields.count).toBe(0)
  })

  it("removing a pending transition (simulating settlement) removes its effect with no special rollback code", () => {
    const store = createDataStore(initialState())
    const id = store.addPendingTransition({ count: 5 }, undefined)
    expect(store.getSnapshot().fields.count).toBe(5)

    store.removePendingTransition(id)
    expect(store.getSnapshot().fields.count).toBe(0)
  })

  it("concurrent optimistic mutations on independent fields: A starts, B starts, B completes, A completes -- each commit sees the latest authoritative state, and A's still-pending contribution survives B's commit untouched", () => {
    const store = createDataStore(initialState())

    // A starts: optimistically updates `user.email`.
    const idA = store.addPendingTransition(
      { user: { email: "a-optimistic@example.com" } },
      undefined,
    )
    expect(store.getSnapshot().fields.user.email).toBe("a-optimistic@example.com")

    // B starts: optimistically updates the unrelated `count` field, on top of
    // the current (already A-optimistic) visible state.
    const idB = store.addPendingTransition({ count: 11 }, undefined)
    expect(store.getSnapshot().fields.count).toBe(11)
    expect(store.getSnapshot().fields.user.email).toBe("a-optimistic@example.com")

    // B completes first: its processor commits against CURRENT authoritative
    // state (still the defaults, since neither A nor B ever touched
    // authoritative yet) -- the server confirms count: 100.
    store.commitAuthoritative({ count: 100 }, undefined)
    store.removePendingTransition(idB)

    // A's pending transition automatically reapplies on top of the new
    // authoritative state -- no special code needed for this to happen, and
    // B's commit never clobbered A's still-pending, unrelated-field contribution.
    expect(store.getAuthoritativeState().fields.count).toBe(100)
    expect(store.getSnapshot().fields.count).toBe(100)
    expect(store.getSnapshot().fields.user.email).toBe("a-optimistic@example.com")

    // A completes later: whoever is about to call commitAuthoritative() for A
    // can read the LATEST authoritative state (100, established by B) --
    // never a stale snapshot captured when A started (which would have been 0).
    expect(store.getAuthoritativeState().fields.count).toBe(100)
    store.commitAuthoritative({ user: { email: "a-confirmed@example.com" } }, undefined)
    store.removePendingTransition(idA)

    expect(store.getAuthoritativeState().fields.count).toBe(100)
    expect(store.getSnapshot().fields.user.email).toBe("a-confirmed@example.com")
  })

  it("a stale pending patch on the SAME field a later commit already updated is reapplied as its own fixed absolute value, not recomputed -- documented behavior, since an optimizer's patch is a static value computed once, never re-run against updated state", () => {
    const store = createDataStore(initialState())

    const idA = store.addPendingTransition({ count: 1 }, undefined) // computed once, e.g. from optimizer({state: {count: 0}, ...})
    store.commitAuthoritative({ count: 100 }, undefined) // an unrelated commit lands on the SAME field

    // A's stale, already-computed absolute patch ({count: 1}) simply replaces
    // whatever is authoritative when reprojected -- patches are absolute
    // value replacements, never deltas, and the runtime never tries to be
    // clever about reconciling two writers of the same field automatically
    // (see "no invented conflict-resolution policy").
    expect(store.getSnapshot().fields.count).toBe(1)

    store.removePendingTransition(idA)
    expect(store.getSnapshot().fields.count).toBe(100)
  })

  it("a failed optimistic mutation is never automatically rolled back -- removal is the only mechanism, and it never touches authoritative state", () => {
    const store = createDataStore(initialState())
    const authoritativeBefore = store.getAuthoritativeState()

    const id = store.addPendingTransition({ count: 999 }, undefined)
    expect(store.getSnapshot().fields.count).toBe(999)

    // Simulates a mutation failing: its transition is simply removed, exactly
    // like a success would be -- commitAuthoritative is never called at all.
    store.removePendingTransition(id)

    expect(store.getAuthoritativeState()).toBe(authoritativeBefore)
    expect(store.getSnapshot().fields.count).toBe(0)
  })

  it("removing an already-removed (or never-added) transition id is a safe no-op and never notifies", () => {
    const store = createDataStore(initialState())
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)
    store.removePendingTransition(Symbol("never-added"))
    expect(store.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it("an added pending transition whose projection changes nothing never notifies subscribers", () => {
    const store = createDataStore(initialState())
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)
    store.addPendingTransition({ count: 0 }, undefined) // reproduces the existing value
    store.addPendingTransition(undefined, undefined) // no patch at all
    expect(store.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it("a no-op commitAuthoritative while a transition is pending does not recompute or re-notify", () => {
    // `project` allocates a fresh state per pending transition, so a spurious
    // recompute would publish a new (equal) snapshot and notify for nothing.
    const store = createDataStore(initialState())
    store.addPendingTransition({ count: 7 }, undefined)
    const visibleWithPending = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    store.commitAuthoritative({ count: 0 }, undefined) // no change to authoritative
    store.commitAuthoritative(undefined, undefined)

    expect(store.getSnapshot()).toBe(visibleWithPending)
    expect(listener).not.toHaveBeenCalled()
  })

  it("removing a never-added transition while another is pending does not recompute or re-notify", () => {
    const store = createDataStore(initialState())
    store.addPendingTransition({ count: 7 }, undefined)
    const visibleWithPending = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    store.removePendingTransition(Symbol("never-added"))

    expect(store.getSnapshot()).toBe(visibleWithPending)
    expect(listener).not.toHaveBeenCalled()
  })
})
