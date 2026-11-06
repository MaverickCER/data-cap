import { describe, expect, it, vi } from "vitest"
import {
  accessDynamic,
  accessKey,
  atomVal,
  ELEMENT_KEY,
  EMPTY_VAL,
  flattenAtoms,
  mergeVals,
  objectVal,
  signatureOf,
} from "../../src/build/flow-values.js"
import type { Atom, Val } from "../../src/build/flow-values.js"

const atom = (origin: string, path: string[] = [], extra: Partial<Atom> = {}): Atom => ({
  origin,
  path,
  approx: false,
  entry: { kind: "read" },
  entryPath: path,
  ...extra,
})

const val = (atoms: Atom[], props: Record<string, Val> = {}): Val => ({
  atoms,
  props: new Map(Object.entries(props)),
})

describe("flow-values constants", () => {
  it("EMPTY_VAL is empty and ELEMENT_KEY is the bracket pair", async () => {
    // Loaded fresh inside the test, so the module-level initialisers run while this test does.
    vi.resetModules()
    const fresh = await import("../../src/build/flow-values.js")
    expect(fresh.EMPTY_VAL.atoms).toEqual([])
    expect([...fresh.EMPTY_VAL.props]).toEqual([])
    expect(fresh.EMPTY_VAL).toEqual({ atoms: [], props: new Map() })
    expect(fresh.ELEMENT_KEY).toBe("[]")
    expect(EMPTY_VAL.atoms).toEqual([])
    expect(ELEMENT_KEY).toBe("[]")
  })
})

describe("atom identity is injective", () => {
  it("does not merge atoms whose fields only collide when joined with separators", () => {
    const a = atom("f", ["p||x|"], { entryPath: ["|=|y", "z"] })
    const b = atom("f", ["p||x", ""], { entryPath: ["|=|y", "z"] })
    expect(mergeVals(atomVal(a), atomVal(b)).atoms).toHaveLength(2)
    expect(
      mergeVals(atomVal(atom("f", ["a", "b"])), atomVal(atom("f", ["a.b"]))).atoms,
    ).toHaveLength(2)
    expect(
      mergeVals(
        atomVal(atom("f", ["a"], { entryPath: ["x", "y"] })),
        atomVal(atom("f", ["a"], { entryPath: ["x.y"] })),
      ).atoms,
    ).toHaveLength(2)
    expect(mergeVals(atomVal(atom("f|a", [])), atomVal(atom("f", ["a"]))).atoms).toHaveLength(2)
  })
})

describe("mergeVals deduplication", () => {
  it("collapses identical atoms and keeps atoms that differ in any single component", () => {
    const base = atom("f", ["a"])
    expect(mergeVals(atomVal(base), atomVal({ ...base })).atoms).toHaveLength(1)
    const variants: Atom[] = [
      atom("g", ["a"]),
      atom("f", ["b"]),
      atom("f", ["a"], { approx: true }),
      atom("f", ["a"], { entry: { kind: "return", from: "x" } }),
      atom("f", ["a"], { entry: { kind: "param", fn: "x", index: 0 } }),
      atom("f", ["a"], { entryPath: ["z"] }),
    ]
    for (const variant of variants) {
      expect(mergeVals(atomVal(base), atomVal(variant)).atoms).toEqual([base, variant])
    }
    expect(
      mergeVals(
        atomVal(atom("f", ["a", "b"])),
        atomVal(atom("f", ["a"], { entryPath: ["a", "b"] })),
      ).atoms,
    ).toHaveLength(2)
    expect(
      mergeVals(
        atomVal(atom("f", ["a"], { entry: { kind: "param", fn: "x", index: 1 } })),
        atomVal(atom("f", ["a"], { entry: { kind: "param", fn: "x", index: 2 } })),
      ).atoms,
    ).toHaveLength(2)
  })
})

describe("mergeVals markers and properties", () => {
  it("merges a property present on both sides and keeps one-sided ones", () => {
    const merged = mergeVals(
      val([], { k: atomVal(atom("f", ["1"])), only: atomVal(atom("f", ["o"])) }),
      val([], { k: atomVal(atom("f", ["2"])) }),
    )
    expect(merged.props.get("k")?.atoms.map((a) => a.path)).toEqual([["1"], ["2"]])
    expect(merged.props.get("only")?.atoms.map((a) => a.path)).toEqual([["o"]])
    expect([...merged.props.keys()]).toEqual(["k", "only"])
  })

  it("keeps the first of each marker and omits absent ones", () => {
    const merged = mergeVals(
      { ...EMPTY_VAL, callable: "c1", capability: "cap1", fieldsOf: "fo1" },
      { ...EMPTY_VAL, callable: "c1", capability: "cap2", fieldsOf: "fo2" },
    )
    expect(merged.callable).toBe("c1")
    expect(merged.capability).toBe("cap1")
    expect(merged.fieldsOf).toBe("fo1")
    const bare = mergeVals(EMPTY_VAL, EMPTY_VAL)
    expect(Object.keys(bare).sort()).toEqual(["atoms", "props"])
    expect(Object.keys(mergeVals({ ...EMPTY_VAL, capability: "c" })).sort()).toEqual([
      "atoms",
      "capability",
      "props",
    ])
    expect(Object.keys(mergeVals({ ...EMPTY_VAL, fieldsOf: "c" })).sort()).toEqual([
      "atoms",
      "fieldsOf",
      "props",
    ])
    expect(Object.keys(mergeVals({ ...EMPTY_VAL, callable: "c" })).sort()).toEqual([
      "atoms",
      "callable",
      "props",
    ])
  })

  it("takes a callable from a later value when the first has none", () => {
    expect(mergeVals(EMPTY_VAL, { ...EMPTY_VAL, callable: "c" }).callable).toBe("c")
    expect(mergeVals({ ...EMPTY_VAL, callable: "c" }, EMPTY_VAL).callable).toBe("c")
  })

  it("drops the callable when two different callees meet, even if a third agrees with the first", () => {
    const a = { ...EMPTY_VAL, callable: "a" }
    const b = { ...EMPTY_VAL, callable: "b" }
    expect(mergeVals(a, b)).not.toHaveProperty("callable")
    expect(mergeVals(a, a, b)).not.toHaveProperty("callable")
    expect(mergeVals(a, EMPTY_VAL, b)).not.toHaveProperty("callable")
    expect(mergeVals(a, a).callable).toBe("a")
    expect(mergeVals(EMPTY_VAL, b, a)).not.toHaveProperty("callable")
  })
})

describe("objectVal, accessKey, accessDynamic, flattenAtoms", () => {
  it("objectVal keeps explicit props apart and merges spreads into the root", () => {
    const v = objectVal({ id: atomVal(atom("f", ["id"])) }, [atomVal(atom("g"))])
    expect([...v.props.keys()]).toEqual(["id"])
    expect(v.atoms.map((a) => a.origin)).toEqual(["g"])
    expect(objectVal({}, [])).toEqual({ atoms: [], props: new Map() })
  })

  it("accessKey extends root atoms and merges the explicit property", () => {
    const v = val([atom("f", ["a"])], { k: atomVal(atom("h", ["x"])) })
    const read = accessKey(v, "k")
    expect(read.atoms.map((a) => `${a.origin}:${a.path.join(".")}`)).toEqual(["h:x", "f:a.k"])
    expect([...read.props]).toEqual([])
    const miss = accessKey(v, "nope")
    expect(miss.atoms.map((a) => a.path)).toEqual([["a", "nope"]])
    expect(miss.atoms[0]?.entryPath).toEqual(["a"])
  })

  it("accessDynamic flattens everything at any depth as approximate", () => {
    const v = val([atom("f", ["a"])], {
      k: val([atom("g")], { deep: atomVal(atom("h", ["z"], { approx: true })) }),
    })
    const out = accessDynamic(v)
    expect(out.atoms.map((a) => `${a.origin}:${a.path.join(".")}:${String(a.approx)}`)).toEqual([
      "f:a:true",
      "g::true",
      "h:z:true",
    ])
    expect([...out.props]).toEqual([])
  })

  it("flattenAtoms deduplicates across depths", () => {
    const shared = atom("f", ["a"])
    const v = val([shared], { k: atomVal({ ...shared }) })
    expect(flattenAtoms(v)).toHaveLength(1)
  })
})

describe("signatureOf", () => {
  it("is empty for an empty value and ignores entry", () => {
    expect(signatureOf(EMPTY_VAL)).toBe("")
    expect(signatureOf(atomVal(atom("f", ["a"], { entry: { kind: "return", from: "q" } })))).toBe(
      signatureOf(atomVal(atom("f", ["a"]))),
    )
  })

  it("renders root atoms sorted, with the approximation marker", () => {
    expect(signatureOf(val([atom("b", ["x", "y"]), atom("a", [], { approx: true })]))).toBe(
      "[a||~,b|x.y|=]{}",
    )
  })

  it("renders children sorted by key, skipping empty ones", () => {
    const v = val([], {
      b: atomVal(atom("f", ["2"])),
      a: atomVal(atom("f", ["1"])),
      empty: EMPTY_VAL,
      c: atomVal(atom("f", ["3"])),
    })
    expect(signatureOf(v)).toBe("[]{a:{[f|1|=]{}},b:{[f|2|=]{}},c:{[f|3|=]{}}}")
  })

  it("sorts keys descending-insensitive for every insertion order", () => {
    const keys = ["m", "a", "z", "b"]
    const v = val([], Object.fromEntries(keys.map((k) => [k, atomVal(atom("f", [k]))])))
    expect(signatureOf(v)).toBe("[]{a:{[f|a|=]{}},b:{[f|b|=]{}},m:{[f|m|=]{}},z:{[f|z|=]{}}}")
    const reversed = val(
      [],
      Object.fromEntries([...keys].reverse().map((k) => [k, atomVal(atom("f", [k]))])),
    )
    expect(signatureOf(reversed)).toBe(signatureOf(v))
    const two = val([], { a: atomVal(atom("f")), b: atomVal(atom("f")) })
    expect(signatureOf(two)).toBe("[]{a:{[f||=]{}},b:{[f||=]{}}}")
    const twoRev = val([], { b: atomVal(atom("f")), a: atomVal(atom("f")) })
    expect(signatureOf(twoRev)).toBe("[]{a:{[f||=]{}},b:{[f||=]{}}}")
    const three = val([], { c: atomVal(atom("f")), a: atomVal(atom("f")), b: atomVal(atom("f")) })
    expect(signatureOf(three)).toBe("[]{a:{[f||=]{}},b:{[f||=]{}},c:{[f||=]{}}}")
    const same = val([], { a: atomVal(atom("f")) })
    expect(signatureOf(same)).toBe("[]{a:{[f||=]{}}}")
  })

  it("collapses a value nested past the depth limit into one approximate summary", () => {
    let nested: Val = val([atom("z", ["deep"]), atom("y")], {
      inner: atomVal(atom("w", ["q", "r"])),
    })
    for (let i = 0; i < 5; i++) nested = val([], { n: nested })
    // depth 0..5 wrap; the innermost value sits at depth 5, still rendered in full
    expect(signatureOf(nested)).toBe(
      "[]{n:{[]{n:{[]{n:{[]{n:{[]{n:{[y||=,z|deep|=]{inner:{*{w|q.r|~}}}}}}}}}}}}}",
    )
    nested = val([], { n: nested })
    // one level deeper: the value at depth 6 is summarised as approximate
    expect(signatureOf(nested)).toBe(
      "[]{n:{[]{n:{[]{n:{[]{n:{[]{n:{[]{n:{*{w|q.r|~,y||~,z|deep|~}}}}}}}}}}}}}",
    )
    const empty6 = (() => {
      let v: Val = val([], { k: EMPTY_VAL })
      for (let i = 0; i < 6; i++) v = val([], { n: v })
      return v
    })()
    expect(signatureOf(empty6)).toBe("")
  })
})
