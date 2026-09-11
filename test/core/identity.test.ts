import { describe, expect, it } from "vitest"
import { computeItemIdentity, reconcileArrayInfo } from "../../src/core/identity.js"
import type { IdentityWarning } from "../../src/core/identity.js"

interface Comment {
  id: string
  body: string
}

interface WithNullableId {
  id: string | null | undefined
  body?: string
}

function keyFor(item: unknown, warnings: IdentityWarning[] = []): string {
  return computeItemIdentity(item as WithNullableId, ["id"], [], warnings)
}

describe("computeItemIdentity -- malformed-input matrix", () => {
  it("computes a stable key from a single identity field, ignoring unrelated fields", () => {
    const a = computeItemIdentity<Comment>({ id: "42", body: "hi" }, ["id"], [], [])
    const b = computeItemIdentity<Comment>({ id: "42", body: "different" }, ["id"], [], [])
    expect(a).toBe(b)
  })

  it("composite identity: joins multiple key components deterministically", () => {
    interface CompositeItem {
      postId: string
      commentId: string
    }
    const a = computeItemIdentity<CompositeItem>(
      { postId: "p1", commentId: "c1" },
      ["postId", "commentId"],
      [],
      [],
    )
    const b = computeItemIdentity<CompositeItem>(
      { postId: "p1", commentId: "c1" },
      ["postId", "commentId"],
      [],
      [],
    )
    const different = computeItemIdentity<CompositeItem>(
      { postId: "p1", commentId: "c2" },
      ["postId", "commentId"],
      [],
      [],
    )
    expect(a).toBe(b)
    expect(a).not.toBe(different)
  })

  it("a malformed item with several identity keys yields one missing-token per key, concatenated with no separator", () => {
    const warnings: IdentityWarning[] = []
    const one = computeItemIdentity("primitive" as never, ["a"], [], [])
    const three = computeItemIdentity("primitive" as never, ["a", "b", "c"], ["idx"], warnings)
    expect(three).toBe(one + one + one)
    expect(warnings).toEqual([{ path: ["idx"], reason: "malformed-item" }])
  })

  it("missing identity key: degrades to a fixed sentinel, matches a genuinely-absent property, and records a warning against `path + key`", () => {
    const warnings: IdentityWarning[] = []
    const key = computeItemIdentity(
      { body: "no id here" } as never,
      ["id"],
      ["items", "3"],
      warnings,
    )
    expect(key).toBe(keyFor({}))
    expect(warnings).toEqual([{ path: ["items", "3", "id"], reason: "missing-key" }])
  })

  it("null identity component: distinct from a missing key, never collides with it", () => {
    expect(keyFor({ id: null })).not.toBe(keyFor({}))
  })

  it("undefined identity component: canonicalizes the same as a genuinely missing key", () => {
    expect(keyFor({ id: undefined })).toBe(keyFor({}))
  })

  it("mixed primitive types never collide: 1 (number) vs '1' (string)", () => {
    expect(keyFor({ id: 1 })).not.toBe(keyFor({ id: "1" }))
  })

  it("malformed item (primitive where an object was expected): degrades to the missing-key path, records a warning", () => {
    const warnings: IdentityWarning[] = []
    const key = keyFor("not an object", warnings)
    expect(key).toBe(keyFor({}))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.reason).toBe("malformed-item")
  })

  it("malformed item: null degrades the same way", () => {
    const warnings: IdentityWarning[] = []
    const key = keyFor(null, warnings)
    expect(key).toBe(keyFor({}))
    expect(warnings[0]?.reason).toBe("malformed-item")
  })

  it("an identity value containing internal separator-lookalike characters never causes a false collision", () => {
    expect(keyFor({ id: "5:abc" })).not.toBe(keyFor({ id: "5" }))
  })

  it("a non-canonicalizable identity component (a function) degrades to the missing-key token rather than throwing", () => {
    expect(keyFor({ id: (() => undefined) as unknown as string })).toBe(keyFor({}))
  })
})

describe("reconcileArrayInfo", () => {
  it("assigns a fresh info entry per item on first computation", () => {
    const items: Comment[] = [
      { id: "1", body: "A" },
      { id: "2", body: "B" },
    ]
    const { info, warnings } = reconcileArrayInfo<Comment, { touched: boolean }>(
      undefined,
      items,
      ["id"],
      "all",
      () => ({ touched: true }),
    )
    expect(Object.keys(info)).toHaveLength(2)
    expect(warnings).toHaveLength(0)
  })

  it("preserves reference identity for untouched items across a fields-array replacement (release-blocking invariant)", () => {
    const key1 = computeItemIdentity<Comment>({ id: "1", body: "" }, ["id"], [], [])
    const key2 = computeItemIdentity<Comment>({ id: "2", body: "" }, ["id"], [], [])
    const key3 = computeItemIdentity<Comment>({ id: "3", body: "" }, ["id"], [], [])

    const items: Comment[] = [
      { id: "1", body: "A" },
      { id: "2", body: "B" },
      { id: "3", body: "C" },
    ]
    const first = reconcileArrayInfo<Comment, { status: string }>(
      undefined,
      items,
      ["id"],
      "all",
      () => ({
        status: "success",
      }),
    )

    const updatedItems: Comment[] = [
      { id: "1", body: "A" },
      { id: "2", body: "B-mutated" },
      { id: "3", body: "C" },
    ]
    // Only identity "2" was actually written by this operation.
    const second = reconcileArrayInfo<Comment, { status: string }>(
      first.info,
      updatedItems,
      ["id"],
      new Set([key2]),
      () => ({ status: "success" }),
    )

    expect(second.info[key1]).toBe(first.info[key1])
    expect(second.info[key3]).toBe(first.info[key3])
    expect(second.info[key2]).not.toBe(first.info[key2])
  })

  it("drops identities no longer present in the new items array -- no orphans", () => {
    const items: Comment[] = [{ id: "1", body: "A" }]
    const first = reconcileArrayInfo<Comment, { v: number }>(
      undefined,
      items,
      ["id"],
      "all",
      () => ({ v: 1 }),
    )
    const removed = reconcileArrayInfo<Comment, { v: number }>(
      first.info,
      [],
      ["id"],
      "all",
      () => ({ v: 2 }),
    )
    expect(Object.keys(removed.info)).toHaveLength(0)
  })

  it("duplicate identity across two items: both items keep one shared DataInfo slot, last-encountered wins, and a warning is recorded", () => {
    const items: Comment[] = [
      { id: "dup", body: "first" },
      { id: "dup", body: "second" },
    ]
    const { info, warnings } = reconcileArrayInfo<Comment, { body: string }>(
      undefined,
      items,
      ["id"],
      "all",
      (item) => ({ body: item.body }),
    )
    expect(Object.keys(info)).toHaveLength(1)
    expect(Object.values(info)[0]?.body).toBe("second")
    expect(warnings).toContainEqual({ path: ["1"], reason: "duplicate-identity" })
  })

  it("makes a fresh entry for an untouched identity when there is no previous info map at all", () => {
    const { info } = reconcileArrayInfo<{ id: string }, { fresh: boolean }>(
      undefined, // no prior info -- the `prevInfo !== undefined` guard is load-bearing
      [{ id: "1" }, { id: "2" }],
      ["id"],
      new Set(), // nothing touched
      () => ({ fresh: true }),
    )
    expect(Object.values(info)).toEqual([{ fresh: true }, { fresh: true }])
  })

  it("records a malformed-item warning against the item's own index when reconciling", () => {
    const { warnings } = reconcileArrayInfo<{ id: string }, unknown>(
      undefined,
      [{ id: "ok" }, "bad" as never, { id: "fine" }],
      ["id"],
      "all",
      () => ({}),
    )
    expect(warnings).toContainEqual({ path: ["1"], reason: "malformed-item" })
  })

  it("arrays-of-arrays: nested arrays are just ordinary item values -- identity only ever concerns the outer array's own declared keys", () => {
    interface Nested {
      id: string
      children: { id: string }[]
    }
    const items: Nested[] = [{ id: "a", children: [{ id: "x" }, { id: "y" }] }]
    const { info } = reconcileArrayInfo<Nested, { childCount: number }>(
      undefined,
      items,
      ["id"],
      "all",
      (item) => ({
        childCount: item.children.length,
      }),
    )
    expect(Object.values(info)[0]?.childCount).toBe(2)
  })
})
