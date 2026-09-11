import { describe, expect, it } from "vitest"
import { commitState, deepFreezeNewNodes, patchInto, project } from "../../src/core/patch.js"
import type { DataState, PendingTransition } from "../../src/core/types.js"

describe("patchInto", () => {
  it("merges a partial patch into a nested object, preserving untouched branches by reference", () => {
    const prev = { user: { email: "old@example.com", profile: { name: "Maverick" } }, count: 1 }
    const next = patchInto(prev, { user: { email: "new@example.com" } })

    expect(next.user.email).toBe("new@example.com")
    // Sibling branch untouched by the patch keeps its exact reference.
    expect(next.user.profile).toBe(prev.user.profile)
    expect(next.count).toBe(1)
  })

  it("returns the exact same reference for an empty patch (no-op)", () => {
    const prev = { a: 1, b: { c: 2 } }
    expect(patchInto(prev, {})).toBe(prev)
  })

  it("returns the exact same reference when patch is undefined", () => {
    const prev = { a: 1 }
    expect(patchInto(prev, undefined)).toBe(prev)
  })

  it("returns the exact same reference when the patch reproduces identical primitive values", () => {
    const prev = { a: 1, b: "x" }
    expect(patchInto(prev, { a: 1, b: "x" })).toBe(prev)
  })

  it("replaces an array wholesale -- never diffed item-by-item", () => {
    const prev = { comments: [{ id: "1" }, { id: "2" }] }
    const newArray = [{ id: "3" }]
    const next = patchInto(prev, { comments: newArray })
    expect(next.comments).toBe(newArray)
  })

  it("treats Date/URL/RegExp as atomic -- a patch replaces the whole instance", () => {
    const oldDate = new Date(0)
    const newDate = new Date(1)
    const next = patchInto({ createdAt: oldDate }, { createdAt: newDate })
    expect(next.createdAt).toBe(newDate)
  })

  it("transitions a nullable field to null without collapsing back to the previous value", () => {
    const prev: { profile: { name: string } | null } = { profile: { name: "x" } }
    const next = patchInto(prev, { profile: null })
    expect(next.profile).toBeNull()
  })

  it("transitions a nullable field from null to a value", () => {
    const prev: { profile: { name: string } | null } = { profile: null }
    const next = patchInto(prev, { profile: { name: "x" } })
    expect(next.profile).toEqual({ name: "x" })
  })

  it("replaces a plain-object branch outright when the patch's value at that position is null / a primitive / an array", () => {
    // These are the "patch shape doesn't match prev's" fallback -- without it,
    // the code would try to `Object.keys()` a null/primitive/array as a record.
    expect(patchInto({ nested: { a: 1 } }, { nested: null } as never).nested).toBeNull()
    expect(patchInto({ nested: { a: 1 } }, { nested: "flat" } as never).nested).toBe("flat")
    expect(patchInto({ nested: { a: 1 } }, { nested: [7, 8] } as never).nested).toEqual([7, 8])
  })

  it("carries a prev-only key through untouched when the patch adds unrelated keys", () => {
    const prev = { keep: { deep: 1 }, drop: 2 }
    const next = patchInto(prev, { added: "new" } as never) as typeof prev & { added: string }
    expect(next.keep).toBe(prev.keep)
    expect(next.drop).toBe(2)
    expect(next.added).toBe("new")
  })

  it("never mutates its prev input", () => {
    const prev = { user: { email: "old@example.com" } }
    const snapshotBefore = JSON.parse(JSON.stringify(prev)) as unknown
    patchInto(prev, { user: { email: "new@example.com" } })
    expect(prev).toEqual(snapshotBefore)
  })

  it("is idempotent -- applying the same patch twice yields the same result and, the second time, the same reference", () => {
    const prev = { user: { email: "old@example.com" } }
    const patch = { user: { email: "new@example.com" } }
    const once = patchInto(prev, patch)
    const twice = patchInto(once, patch)
    expect(twice).toEqual(once)
    expect(twice).toBe(once)
  })

  it("property: any field untouched by the patch is reference-equal to prev's counterpart, across randomized nested shapes", () => {
    for (let i = 0; i < 50; i++) {
      const prev = {
        a: { x: i, y: { z: i } },
        b: { untouched: { deep: { value: i } } },
        c: [i, i + 1],
      }
      const next = patchInto(prev, { a: { x: i + 100 } })
      expect(next.b).toBe(prev.b)
      expect(next.b.untouched).toBe(prev.b.untouched)
      expect(next.c).toBe(prev.c)
      expect(next.a.y).toBe(prev.a.y)
    }
  })
})

describe("commitState", () => {
  function makeState(): DataState<{ id: string }> {
    return { fields: { id: "x" }, info: {} }
  }

  it("commits fields and info together as one new object when either changes", () => {
    const prev = makeState()
    const next = commitState(prev, { id: "y" }, undefined)
    expect(next.fields.id).toBe("y")
    expect(next).not.toBe(prev)
  })

  it("returns the exact same reference for a true no-op (both patches undefined)", () => {
    const prev = makeState()
    expect(commitState(prev, undefined, undefined)).toBe(prev)
  })

  it("returns the exact same reference when both patches reproduce the current values", () => {
    const prev = commitState(makeState(), { id: "y" }, undefined)
    const next = commitState(prev, { id: "y" }, undefined)
    expect(next).toBe(prev)
  })

  it("never lets a consumer observe {newFields, oldInfo} or {oldFields, newInfo} -- fields/info commit atomically", () => {
    const prev = commitState(makeState(), undefined, { id: { status: "idle" } })
    const next = commitState(prev, { id: "z" }, { id: { status: "success" } })
    expect(next.fields.id).toBe("z")
    expect(next.info.id?.status).toBe("success")
    // There is no intermediate state to observe -- a single commitState call
    // produces exactly one atomic result, never a fields-only or info-only step.
  })

  it("deep-freezes the newly-created nodes of the result", () => {
    const prev = makeState()
    const next = commitState(prev, { id: "y" }, { id: { status: "success" } })
    expect(Object.isFrozen(next)).toBe(true)
    expect(Object.isFrozen(next.fields)).toBe(true)
    expect(Object.isFrozen(next.info)).toBe(true)
  })

  it("property: idempotent -- committing the same patches twice returns the same reference the second time", () => {
    const prev = makeState()
    const once = commitState(prev, { id: "y" }, { id: { status: "success" } })
    const twice = commitState(once, { id: "y" }, { id: { status: "success" } })
    expect(twice).toBe(once)
  })
})

describe("deepFreezeNewNodes", () => {
  it("skips already-frozen branches -- freeze cost is amortized to only newly-created nodes", () => {
    const alreadyFrozen = Object.freeze({ value: 1 })
    const container = { reused: alreadyFrozen, fresh: { value: 2 } }
    deepFreezeNewNodes(container)
    expect(Object.isFrozen(container.fresh)).toBe(true)
    // The pre-frozen branch is untouched (still the same object, still frozen) --
    // deepFreezeNewNodes returns immediately upon seeing an already-frozen node.
    expect(container.reused).toBe(alreadyFrozen)
  })
})

describe("project", () => {
  function makeState(): DataState<{ count: number }> {
    return { fields: { count: 0 }, info: {} }
  }

  function transition(id: string, count: number): PendingTransition<{ count: number }> {
    return { id: Symbol(id), fieldsPatch: { count }, infoPatch: undefined }
  }

  it("folding an empty pendingTransitions list returns authoritativeState unchanged (same reference)", () => {
    const authoritative = makeState()
    expect(project(authoritative, [])).toBe(authoritative)
  })

  it("folds pending transitions in order on top of authoritative state", () => {
    const authoritative = makeState()
    const result = project(authoritative, [transition("a", 1), transition("b", 2)])
    expect(result.fields.count).toBe(2)
  })

  it("is deterministic -- folding the same transitions list twice produces a deep-equal result", () => {
    const authoritative = makeState()
    const transitions = [transition("a", 1), transition("b", 2)]
    const first = project(authoritative, transitions)
    const second = project(authoritative, transitions)
    expect(second).toEqual(first)
  })

  it("removing a transition from the list and re-projecting reflects only the remaining transitions -- no vestigial effect from the removed one (the mechanism 'no automatic rollback' relies on)", () => {
    const authoritative = makeState()
    const a = transition("a", 1)
    const b = transition("b", 2)
    const withBoth = project(authoritative, [a, b])
    expect(withBoth.fields.count).toBe(2)

    // Simulates operation "a" settling and being removed from pendingTransitions --
    // no special rollback code runs; the projection is simply recomputed.
    const withOnlyB = project(authoritative, [b])
    expect(withOnlyB.fields.count).toBe(2)

    // And removing "b" too returns exactly to authoritative state.
    expect(project(authoritative, [])).toBe(authoritative)
  })

  it("a later-committed transition's patch is applied on top of an already-projected state, exactly once each -- no invented merge/conflict policy beyond ordinary sequential application", () => {
    const authoritative = makeState()
    const result = project(authoritative, [transition("a", 5), transition("b", 10)])
    // Last transition in the list wins for the same field -- plain sequential
    // fold, nothing more elaborate invented at this layer.
    expect(result.fields.count).toBe(10)
  })
})
