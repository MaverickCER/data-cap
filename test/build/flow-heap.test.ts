import { describe, expect, it } from "vitest"
import { HeapCells } from "../../src/build/flow-heap.js"
import {
  accessDynamic,
  allocsOf,
  atomVal,
  EMPTY_VAL,
  ELEMENT_KEY,
  flattenAtoms,
  mergeVals,
  remapAllocs,
  signatureOf,
  withAlloc,
  withoutAlloc,
} from "../../src/build/flow-values.js"
import type { Atom, Val } from "../../src/build/flow-values.js"

const F = "field:src/u.ts#userData.user"

const email: Atom = {
  origin: F,
  path: ["email"],
  approx: false,
  entry: { kind: "read" },
  entryPath: [],
}

const dataVal = (): Val => atomVal(email)
const list = (element: Val): Val => ({ ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, element]]) })
const paths = (val: Val): string[] => flattenAtoms(val).map((atom) => atom.path.join("."))

describe("HeapCells.allocId", () => {
  it("gives the same site of the same evaluation the same id, and every other pair its own", () => {
    const heap = new HeapCells()
    const first = heap.allocId("f", "1:2")
    expect(first).toBe("a0")
    expect(heap.allocId("f", "1:2")).toBe("a0")
    expect(heap.allocId("f", "3:4")).toBe("a1")
    expect(heap.allocId("g", "1:2")).toBe("a2")
  })

  it("does not confuse an evaluation with the position that follows it", () => {
    const heap = new HeapCells()
    expect(heap.allocId("f1", "2")).not.toBe(heap.allocId("f", "12"))
  })
})

describe("HeapCells.expand, through a cycle", () => {
  /** Two objects that each hold the other, and one of them holds the data. */
  const cycle = () => {
    const heap = new HeapCells()
    const outerId = heap.allocId("f", "0")
    const innerId = heap.allocId("f", "1")
    const outer = withAlloc(list(EMPTY_VAL), outerId)
    const inner = withAlloc(list(EMPTY_VAL), innerId)
    heap.store([outerId], list(inner), "f")
    heap.store([innerId], list(outer), "f")
    heap.store([innerId], list(dataVal()), "f")
    return { heap, outer, inner }
  }

  it("expands an object the same whether or not another object that holds it was expanded first", () => {
    const { heap, outer, inner } = cycle()
    heap.expand(inner)
    expect(signatureOf(heap.expand(outer))).toBe(signatureOf(fresh(cycle, "outer")))
  })

  it("does not keep what was expanded below another object as the expansion of the object itself", () => {
    const { heap, outer, inner } = cycle()
    heap.expand(outer)
    expect(signatureOf(heap.expand(inner))).toBe(signatureOf(fresh(cycle, "inner")))
  })
})

/** The expansion of one object of a fresh cycle, with nothing expanded before it. */
function fresh(
  make: () => { heap: HeapCells; outer: Val; inner: Val },
  which: "outer" | "inner",
): Val {
  const made = make()
  return made.heap.expand(made[which])
}

describe("HeapCells.expand, memoized", () => {
  const stored = () => {
    const heap = new HeapCells()
    const id = heap.allocId("f", "0")
    const val = withAlloc(list(EMPTY_VAL), id)
    heap.store([id], list(dataVal()), "f")
    return { heap, id, val }
  }

  it("gives the very same expansion again while nothing changed", () => {
    const { heap, val } = stored()
    expect(heap.expand(val)).toBe(heap.expand(val))
  })

  it("keeps the expansion when the same thing is stored again", () => {
    const { heap, id, val } = stored()
    const first = heap.expand(val)
    heap.store([id], list(dataVal()), "f")
    expect(heap.expand(val)).toBe(first)
  })

  it("expands again when something new was stored", () => {
    const { heap, id, val } = stored()
    const first = heap.expand(val)
    const other: Atom = { ...email, path: ["name"] }
    heap.store([id], list(atomVal(other)), "f")
    const second = heap.expand(val)
    expect(second).not.toBe(first)
    expect(paths(second)).toEqual(["email", "name"])
  })

  it.each([
    [
      "an evaluation starting",
      (heap: HeapCells) => {
        heap.enter("g")
      },
    ],
    [
      "an evaluation ending",
      (heap: HeapCells) => {
        heap.enter("g")
        heap.leave("g")
      },
    ],
    [
      "a new round",
      (heap: HeapCells) => {
        heap.nextRound()
      },
    ],
  ])("expands again after %s", (_label, change) => {
    const { heap, val } = stored()
    const first = heap.expand(val)
    change(heap)
    expect(heap.expand(val)).not.toBe(first)
  })

  it("does not keep an expansion made while an object was open as the expansion of a value", () => {
    const heap = new HeapCells()
    const outer = heap.allocId("f", "0")
    const inner = heap.allocId("f", "1")
    const innerVal = withAlloc(list(EMPTY_VAL), inner)
    heap.store([outer], list(innerVal), "f")
    heap.store([inner], list(dataVal()), "f")
    const viaOuter = heap.expand(withAlloc(list(EMPTY_VAL), outer))
    expect(paths(viaOuter)).toEqual(["email"])
    expect(paths(heap.expand(innerVal))).toEqual(["email"])
  })

  it("returns a value without objects as it is, and rebuilds one with members", () => {
    const { heap } = stored()
    const plain = dataVal()
    expect(heap.expand(plain)).toBe(plain)
    const holder: Val = { ...EMPTY_VAL, props: new Map([["x", plain]]) }
    expect(heap.expand(holder)).not.toBe(holder)
    expect(paths(heap.expand(holder))).toEqual(["email"])
  })

  it("expands a member that is itself an object", () => {
    const { heap, val } = stored()
    const holder: Val = { ...EMPTY_VAL, props: new Map([["list", val]]) }
    expect(paths(heap.expand(holder))).toEqual(["email"])
  })

  it("leaves a value alone when what its object holds is nothing", () => {
    const heap = new HeapCells()
    const id = heap.allocId("f", "0")
    const val = withAlloc(EMPTY_VAL, id)
    heap.enter("f")
    heap.store([id], list(dataVal()), "f")
    heap.nextRound()
    expect(heap.expand(val)).toBe(val)
  })

  it("reports a store into an object with no maker as late unless the nameless evaluation is running", () => {
    const heap = new HeapCells()
    expect(heap.store(["ghost"], list(dataVal()), "w")).toBe(true)
    const running = new HeapCells()
    running.enter("")
    expect(running.store(["ghost"], list(dataVal()), "w")).toBe(false)
  })
})

describe("HeapCells.expand", () => {
  it("returns the very same value while nothing was stored", () => {
    const heap = new HeapCells()
    const val = withAlloc(list(dataVal()), heap.allocId("f", "0"))
    expect(heap.expand(val)).toBe(val)
  })

  it("adds what was stored into an object to every value that may be that object", () => {
    const heap = new HeapCells()
    const id = heap.allocId("f", "0")
    const original = withAlloc(list(EMPTY_VAL), id)
    const holder: Val = { ...EMPTY_VAL, props: new Map([["list", original]]) }
    heap.store([id], list(dataVal()), "f")
    expect(paths(heap.expand(original))).toEqual(["email"])
    expect(paths(heap.expand(holder))).toEqual(["email"])
    expect(heap.expand(holder).props.get("list")?.alloc).toEqual([id])
  })

  it("leaves an object made at another site alone", () => {
    const heap = new HeapCells()
    const one = heap.allocId("f", "0")
    const other = heap.allocId("f", "1")
    heap.store([one], list(dataVal()), "f")
    expect(paths(heap.expand(withAlloc(list(EMPTY_VAL), other)))).toEqual([])
  })

  it("follows a store that holds another object, and stops at a cycle", () => {
    const heap = new HeapCells()
    const outer = heap.allocId("f", "0")
    const inner = heap.allocId("f", "1")
    heap.store(
      [outer],
      { ...EMPTY_VAL, props: new Map([["inner", withAlloc(EMPTY_VAL, inner)]]) },
      "f",
    )
    heap.store([inner], list(dataVal()), "f")
    heap.store(
      [inner],
      { ...EMPTY_VAL, props: new Map([["back", withAlloc(EMPTY_VAL, outer)]]) },
      "f",
    )
    const expanded = heap.expand(withAlloc(EMPTY_VAL, outer))
    expect(paths(expanded)).toEqual(["email"])
    expect(allocsOf(expanded)).toEqual([outer, inner])
  })

  it("unions the stores of several objects a value may be", () => {
    const heap = new HeapCells()
    const one = heap.allocId("f", "0")
    const two = heap.allocId("f", "1")
    heap.store([one], list(dataVal()), "f")
    heap.store([two], { ...EMPTY_VAL, props: new Map([["x", dataVal()]]) }, "f")
    const either = mergeVals(withAlloc(EMPTY_VAL, one), withAlloc(EMPTY_VAL, two))
    expect([...heap.expand(either).props.keys()].sort()).toEqual([ELEMENT_KEY, "x"])
  })
})

describe("HeapCells.store", () => {
  it("keeps the identity of the stored value out of the cell", () => {
    const heap = new HeapCells()
    const id = heap.allocId("f", "0")
    const other = heap.allocId("f", "1")
    heap.store([id], withAlloc(list(dataVal()), other), "f")
    expect(allocsOf(heap.expand(withAlloc(EMPTY_VAL, id)))).toEqual([id])
  })

  it("reports a store as late only when the object was made by an evaluation that is not running", () => {
    const heap = new HeapCells()
    const id = heap.allocId("maker", "0")
    expect(heap.store([id], list(dataVal()), "other")).toBe(true)
    heap.enter("maker")
    const second = heap.allocId("maker", "1")
    expect(heap.store([second], list(dataVal()), "other")).toBe(false)
    heap.leave("maker")
  })

  it("reports an unchanged store as nothing new", () => {
    const heap = new HeapCells()
    const id = heap.allocId("maker", "0")
    expect(heap.store([id], list(dataVal()), "other")).toBe(true)
    expect(heap.store([id], list(dataVal()), "other")).toBe(false)
  })

  it("reports a store of an object it has no maker for (a package's) as late", () => {
    const heap = new HeapCells()
    expect(heap.store(["?"], list(dataVal()), "f")).toBe(true)
  })

  it("lets a value be read back after the store changed it", () => {
    const heap = new HeapCells()
    const id = heap.allocId("f", "0")
    const val = withAlloc(EMPTY_VAL, id)
    heap.store([id], list(dataVal()), "f")
    expect(paths(heap.expand(val))).toEqual(["email"])
    const name: Atom = { ...email, path: ["name"] }
    heap.store([id], list(atomVal(name)), "f")
    expect(paths(heap.expand(val))).toEqual(["email", "name"])
  })
})

describe("program order across rounds", () => {
  it("a running evaluation does not read its own stores of an earlier round back, everyone else does", () => {
    const heap = new HeapCells()
    const id = heap.allocId("writer", "0")
    const val = withAlloc(EMPTY_VAL, id)
    heap.enter("writer")
    heap.store([id], list(dataVal()), "writer")
    expect(paths(heap.expand(val))).toEqual(["email"])
    heap.leave("writer")
    heap.nextRound()
    heap.enter("writer")
    expect(paths(heap.expand(val))).toEqual([])
    heap.store([id], list(dataVal()), "writer")
    expect(paths(heap.expand(val))).toEqual(["email"])
    heap.leave("writer")
    expect(paths(heap.expand(val))).toEqual(["email"])
  })

  it("an evaluation that is not the writer sees the stores of the earlier round at once", () => {
    const heap = new HeapCells()
    const id = heap.allocId("writer", "0")
    const val = withAlloc(EMPTY_VAL, id)
    heap.store([id], list(dataVal()), "writer")
    heap.nextRound()
    heap.enter("reader")
    expect(paths(heap.expand(val))).toEqual(["email"])
    heap.leave("reader")
  })

  it("an evaluation that calls itself stays running until the outer one is done", () => {
    const heap = new HeapCells()
    const id = heap.allocId("w", "0")
    const val = withAlloc(EMPTY_VAL, id)
    heap.store([id], list(dataVal()), "w")
    heap.nextRound()
    heap.enter("w")
    heap.enter("w")
    heap.leave("w")
    expect(paths(heap.expand(val))).toEqual([])
    heap.leave("w")
    expect(paths(heap.expand(val))).toEqual(["email"])
  })

  it("a second round repeating a store is not new", () => {
    const heap = new HeapCells()
    const id = heap.allocId("maker", "0")
    expect(heap.store([id], list(dataVal()), "other")).toBe(true)
    heap.nextRound()
    expect(heap.store([id], list(dataVal()), "other")).toBe(false)
  })
})

describe("values with an allocation site", () => {
  it("a value made at a site carries it, sorted and once", () => {
    const val = withAlloc(withAlloc(withAlloc(EMPTY_VAL, "b"), "a"), "b")
    expect(val.alloc).toEqual(["a", "b"])
    expect(withoutAlloc(val).alloc).toBeUndefined()
  })

  it("merging unions the sites, and a merge of values without any has none", () => {
    expect(mergeVals(withAlloc(EMPTY_VAL, "b"), withAlloc(EMPTY_VAL, "a")).alloc).toEqual([
      "a",
      "b",
    ])
    expect(mergeVals(EMPTY_VAL, EMPTY_VAL).alloc).toBeUndefined()
  })

  it("a signature tells two sites apart, and a value with a site is not empty", () => {
    expect(signatureOf(withAlloc(EMPTY_VAL, "a1"))).toBe("[]{}@a1")
    expect(signatureOf(withAlloc(EMPTY_VAL, "a1"))).not.toBe(
      signatureOf(withAlloc(EMPTY_VAL, "a2")),
    )
    expect(signatureOf(EMPTY_VAL)).toBe("")
  })

  it("lists the sites at any depth, sorted", () => {
    const deep: Val = {
      ...EMPTY_VAL,
      props: new Map([
        ["x", withAlloc({ ...EMPTY_VAL, props: new Map([["y", withAlloc(EMPTY_VAL, "c")]]) }, "a")],
      ]),
      alloc: ["b"],
    }
    expect(allocsOf(deep)).toEqual(["a", "b", "c"])
  })
})

describe("a read of an unknown key", () => {
  it("may be any object held below the value, so it carries every site below it", () => {
    const inner = withAlloc(EMPTY_VAL, "a1")
    const holder = withAlloc({ ...EMPTY_VAL, props: new Map([["k", inner]]) }, "a0")
    expect(accessDynamic(holder).alloc).toEqual(["a1"])
    expect(accessDynamic(withAlloc(EMPTY_VAL, "a0")).alloc).toBeUndefined()
  })
})

describe("remapAllocs", () => {
  it("renames every site at any depth, sorted and once, and leaves a value without sites alone", () => {
    const inner = withAlloc(EMPTY_VAL, "a2")
    const outer = withAlloc({ ...EMPTY_VAL, props: new Map([["x", inner]]) }, "a1")
    const renamed = remapAllocs(mergeVals(outer, withAlloc(EMPTY_VAL, "a3")), (id) =>
      id === "a3" ? "b0" : `b${id}`,
    )
    expect(renamed.alloc).toEqual(["b0", "ba1"])
    expect(renamed.props.get("x")?.alloc).toEqual(["ba2"])
    expect(remapAllocs(EMPTY_VAL, () => "never").alloc).toBeUndefined()
    expect(remapAllocs(mergeVals(outer, withAlloc(EMPTY_VAL, "a3")), () => "same").alloc).toEqual([
      "same",
    ])
  })
})
