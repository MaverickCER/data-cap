import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { patchInto } from "../../src/core/patch.js"

// Field trees: nested records of primitive leaves. Arrays are atomic to `patchInto` and covered separately.
interface Tree {
  [key: string]: string | number | boolean | null | Tree
}
const key = fc
  .string({ minLength: 1, maxLength: 4 })
  .filter((k) => !["__proto__", "constructor", "prototype"].includes(k))
const leaf = fc.oneof(fc.string({ maxLength: 6 }), fc.integer(), fc.boolean(), fc.constant(null))
const tree: fc.Arbitrary<Tree> = fc.letrec<{ tree: Tree }>((tie) => ({
  tree: fc.dictionary(key, fc.oneof({ depthSize: "small" }, leaf, tie("tree")), { maxKeys: 4 }),
})).tree

/** What merging `patch` into `prev` should produce, written independently of `patchInto`. */
function merged(prev: unknown, patch: unknown): unknown {
  if (patch === undefined) return prev
  const bothTrees =
    prev !== null && typeof prev === "object" && patch !== null && typeof patch === "object"
  if (!bothTrees) return patch
  const result: Record<string, unknown> = { ...(prev as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    result[k] = merged((prev as Record<string, unknown>)[k], v)
  }
  return result
}

describe("patchInto -- property-based", () => {
  it("returns the previous tree itself when there is no patch", () => {
    fc.assert(
      fc.property(tree, (prev) => patchInto(prev, undefined) === prev),
      { numRuns: 100 },
    )
  })

  it("returns the previous tree itself when the patch changes nothing", () => {
    fc.assert(
      fc.property(tree, (prev) => {
        expect(patchInto(prev, {})).toBe(prev)
        expect(patchInto(prev, structuredClone(prev))).toBe(prev)
      }),
      { numRuns: 200 },
    )
  })

  it("produces the same tree as merging the patch in by hand", () => {
    fc.assert(
      fc.property(tree, tree, (prev, patch) => {
        expect(patchInto(prev, patch)).toEqual(merged(prev, patch))
      }),
      { numRuns: 300 },
    )
  })

  it("never mutates the tree or the patch it was given", () => {
    fc.assert(
      fc.property(tree, tree, (prev, patch) => {
        const prevBefore = structuredClone(prev)
        const patchBefore = structuredClone(patch)
        patchInto(prev, patch)
        expect(prev).toEqual(prevBefore)
        expect(patch).toEqual(patchBefore)
      }),
      { numRuns: 200 },
    )
  })

  it("keeps every branch the patch does not touch by reference", () => {
    fc.assert(
      fc.property(tree, tree, (prev, patch) => {
        const result = patchInto(prev, patch) as Record<string, unknown>
        for (const [k, branch] of Object.entries(prev)) {
          if (!Object.hasOwn(patch, k)) expect(result[k]).toBe(branch)
        }
      }),
      { numRuns: 300 },
    )
  })

  it("is idempotent: applying the same patch again changes nothing, by reference", () => {
    fc.assert(
      fc.property(tree, tree, (prev, patch) => {
        const once = patchInto(prev, patch)
        expect(patchInto(once, patch)).toBe(once)
      }),
      { numRuns: 300 },
    )
  })

  it("replaces an array whole instead of merging into it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 5 }),
        fc.array(fc.integer(), { maxLength: 5 }),
        (a, b) => {
          expect(patchInto({ list: a }, { list: b })).toEqual({ list: b })
        },
      ),
      { numRuns: 100 },
    )
  })
})
