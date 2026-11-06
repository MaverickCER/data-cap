import { describe, expect, it } from "vitest"
import {
  accessDynamic,
  accessKey,
  ANY_KEY,
  approximate,
  atomVal,
  declaredVal,
  dropHandles,
  ELEMENT_KEY,
  EMPTY_VAL,
  flattenAtoms,
  GENERATOR_HANDLE,
  handlesOf,
  handleVal,
  isHandleKey,
  MAP_KEYS,
  MAP_VALUES,
  mapVal,
  mergeVals,
  objectVal,
  PROMISE_HANDLE,
  recordVal,
  REJECT_HANDLE,
  RESOLVE_HANDLE,
  setVal,
  signatureOf,
  withEntry,
  withoutExternal,
} from "../../src/build/flow-values.js"
import type { Atom, Val } from "../../src/build/flow-values.js"

const F = "field:src/u.ts#userData.user"

function atom(path: string[] = [], overrides: Partial<Atom> = {}): Atom {
  return { origin: F, path, approx: false, entry: { kind: "read" }, entryPath: [], ...overrides }
}

const marked = (markers: Partial<Val>): Val => ({ ...EMPTY_VAL, ...markers })

describe("the markers a value can carry", () => {
  it("keeps instance, classRef, namespace, boundMethod and inexact through a merge with an empty value", () => {
    const merged = mergeVals(
      marked({
        instance: "app/a.ts#A",
        classRef: "app/a.ts#B",
        namespace: "/abs/n.ts",
        capability: "app/u.ts#userData",
        boundMethod: "getSnapshot",
        inexact: true,
      }),
      EMPTY_VAL,
    )
    expect(merged).toEqual({
      atoms: [],
      props: new Map(),
      capability: "app/u.ts#userData",
      instance: "app/a.ts#A",
      classRef: "app/a.ts#B",
      namespace: "/abs/n.ts",
      boundMethod: "getSnapshot",
      inexact: true,
    })
  })

  it("takes each marker from a later value when the first has none", () => {
    const merged = mergeVals(
      EMPTY_VAL,
      marked({ instance: "i", classRef: "c", namespace: "n", boundMethod: "m", fieldsOf: "f" }),
    )
    expect(merged.instance).toBe("i")
    expect(merged.classRef).toBe("c")
    expect(merged.namespace).toBe("n")
    expect(merged.boundMethod).toBe("m")
    expect(merged.fieldsOf).toBe("f")
  })

  it("keeps a marker that every side agrees on", () => {
    const merged = mergeVals(marked({ instance: "i" }), marked({ instance: "i" }))
    expect(merged.instance).toBe("i")
  })

  it("omits inexact when no side has it, and when a side sets it to nothing", () => {
    expect("inexact" in mergeVals(marked({ instance: "i" }), EMPTY_VAL)).toBe(false)
    expect(mergeVals(EMPTY_VAL, marked({ inexact: true })).inexact).toBe(true)
  })

  it.each([
    ["instance", { instance: "a" }, { instance: "b" }],
    ["classRef", { classRef: "a" }, { classRef: "b" }],
    ["namespace", { namespace: "a" }, { namespace: "b" }],
    ["boundMethod", { boundMethod: "a" }, { boundMethod: "b" }],
  ] as const)(
    "two different %s values cannot be followed as one: the four markers all go",
    (_, left, right) => {
      const merged = mergeVals(
        marked({ instance: "i", classRef: "c", namespace: "n", boundMethod: "m", ...left }),
        marked({ ...right }),
      )
      expect(merged.instance).toBeUndefined()
      expect(merged.classRef).toBeUndefined()
      expect(merged.namespace).toBeUndefined()
      expect(merged.boundMethod).toBeUndefined()
    },
  )

  it("an ambiguity does not drop the callable, the capability or the fields marker", () => {
    const merged = mergeVals(
      marked({ instance: "a", callable: "fn", capability: "cap", fieldsOf: "cap" }),
      marked({ instance: "b" }),
    )
    expect(merged.instance).toBeUndefined()
    expect(merged.callable).toBe("fn")
    expect(merged.capability).toBe("cap")
    expect(merged.fieldsOf).toBe("cap")
  })

  it("an ambiguity of one kind survives a third value that agrees with the first", () => {
    const merged = mergeVals(
      marked({ instance: "a" }),
      marked({ instance: "b" }),
      marked({ instance: "a" }),
    )
    expect(merged.instance).toBeUndefined()
  })

  it("a different callable drops only the callable", () => {
    const merged = mergeVals(
      marked({ callable: "f", instance: "i" }),
      marked({ callable: "g", instance: "i" }),
    )
    expect(merged.callable).toBeUndefined()
    expect(merged.instance).toBe("i")
  })

  it("merging properties keeps one-sided and merges two-sided ones across three values", () => {
    const merged = mergeVals(
      objectVal({ a: atomVal(atom(["a"])) }, []),
      objectVal({ b: atomVal(atom(["b"])) }, []),
      objectVal({ a: atomVal(atom(["c"])) }, []),
    )
    expect([...merged.props.keys()].sort()).toEqual(["a", "b"])
    expect(flattenAtoms(merged.props.get("a") ?? EMPTY_VAL).map((a) => a.path[0])).toEqual([
      "a",
      "c",
    ])
  })

  it("merging nothing gives an empty value", () => {
    expect(mergeVals()).toEqual(EMPTY_VAL)
  })
})

describe("approximate and the lazy markers", () => {
  it("marks a capability or fields object inexact, so what is read from it later is approximate", () => {
    expect(approximate(marked({ capability: "c" })).inexact).toBe(true)
    expect(approximate(marked({ fieldsOf: "c" })).inexact).toBe(true)
  })

  it("does not mark an ordinary value inexact", () => {
    expect(approximate(marked({ instance: "i" })).inexact).toBeUndefined()
    expect(approximate(atomVal(atom())).inexact).toBeUndefined()
  })

  it("keeps the other markers of the value", () => {
    const approx = approximate(
      marked({ capability: "c", boundMethod: "getSnapshot", instance: "i" }),
    )
    expect(approx.boundMethod).toBe("getSnapshot")
    expect(approx.instance).toBe("i")
  })

  it("reaches a lazy value nested in a property", () => {
    const nested = approximate(objectVal({ all: marked({ fieldsOf: "c" }) }, []))
    expect(nested.props.get("all")?.inexact).toBe(true)
  })
})

describe("withEntry keeps the markers", () => {
  it("relabels atoms and leaves the markers alone", () => {
    const val = withEntry(
      { ...atomVal(atom(["a"])), instance: "i", classRef: "c", namespace: "n" },
      { kind: "return", from: "f" },
    )
    expect(val.instance).toBe("i")
    expect(val.classRef).toBe("c")
    expect(val.namespace).toBe("n")
    expect(val.atoms[0]?.entry).toEqual({ kind: "return", from: "f" })
  })
})

describe("signatureOf with the instance, class, namespace and bound-method markers", () => {
  it("is empty for a value with no atoms, no properties and no marker", () => {
    expect(signatureOf(EMPTY_VAL)).toBe("")
  })

  it.each([
    ["callable", { callable: "k" }, "k|||||||||"],
    ["instance", { instance: "k" }, "|k||||||||"],
    ["classRef", { classRef: "k" }, "||k|||||||"],
    ["namespace", { namespace: "k" }, "|||k||||||"],
    ["capability", { capability: "k" }, "||||k|||||"],
    ["fieldsOf", { fieldsOf: "k" }, "|||||k||||"],
    ["boundMethod", { boundMethod: "k" }, "||||||k|||"],
    ["inexact", { inexact: true as const }, "|||||||~||"],
    ["native", { native: "map" as const }, "||||||||map|"],
    ["external", { external: "lodash\u0000pick" }, "|||||||||lodash\u0000pick"],
  ])("renders %s in its own slot of the marker list", (_, markers, slots) => {
    expect(signatureOf(marked(markers))).toBe(`[]{}<${slots}>`)
  })

  it("tells two values apart that differ only in the instance, the class, the namespace or the bound method", () => {
    const sigs = [
      signatureOf(marked({ instance: "a" })),
      signatureOf(marked({ instance: "b" })),
      signatureOf(marked({ classRef: "a" })),
      signatureOf(marked({ namespace: "a" })),
      signatureOf(marked({ boundMethod: "a" })),
      signatureOf(marked({ capability: "a" })),
      signatureOf(marked({ capability: "a", inexact: true })),
    ]
    expect(new Set(sigs).size).toBe(sigs.length)
  })

  it("renders atoms and markers together", () => {
    const val = { ...atomVal(atom(["a"], { approx: true })), instance: "i" }
    expect(signatureOf(val)).toBe(`[${F}|a|~]{}<|i||||||||>`)
  })

  it("renders a child's markers inside the child", () => {
    const val = objectVal({ k: marked({ namespace: "n" }) }, [])
    expect(signatureOf(val)).toBe("[]{k:{[]{}<|||n||||||>}}")
  })

  it("ignores how atoms entered the frame", () => {
    const a = atomVal(atom(["a"]))
    const b = withEntry(a, { kind: "param", fn: "f", index: 0 })
    expect(signatureOf(a)).toBe(signatureOf(b))
  })

  it("does not depend on the order atoms or properties were added in", () => {
    const one = mergeVals(atomVal(atom(["a"])), atomVal(atom(["b"])))
    const two = mergeVals(atomVal(atom(["b"])), atomVal(atom(["a"])))
    expect(signatureOf(one)).toBe(signatureOf(two))
    const x = objectVal({ p: atomVal(atom(["p"])), q: atomVal(atom(["q"])) }, [])
    const y = objectVal({ q: atomVal(atom(["q"])), p: atomVal(atom(["p"])) }, [])
    expect(signatureOf(x)).toBe(signatureOf(y))
  })

  it("is equal for equal values, so a call is memoized, and different for exact versus approximate", () => {
    expect(signatureOf(atomVal(atom(["a"])))).toBe(signatureOf(atomVal(atom(["a"]))))
    expect(signatureOf(atomVal(atom(["a"])))).not.toBe(
      signatureOf(approximate(atomVal(atom(["a"])))),
    )
  })
})

describe("the signature depth cap", () => {
  const nest = (depth: number, leaf: Val): Val => {
    let val = leaf
    for (let level = 0; level < depth; level += 1) val = objectVal({ k: val }, [])
    return val
  }

  it("renders a value nested five levels deep exactly", () => {
    const sig = signatureOf(nest(5, atomVal(atom(["a"]))))
    expect(sig).toBe(`${"[]{k:{".repeat(5)}[${F}|a|=]{}${"}}".repeat(5)}`)
  })

  it("collapses the value that sits at the sixth level", () => {
    const sig = signatureOf(nest(6, atomVal(atom(["a"]))))
    expect(sig).toBe(`${"[]{k:{".repeat(6)}*{${F}|a|~}${"}}".repeat(6)}`)
  })

  it("collapses everything below depth six into one approximate summary, whatever the markers", () => {
    const deep = nest(7, { ...atomVal(atom(["a"])), instance: "i" })
    const sig = signatureOf(deep)
    expect(sig).toBe(`${"[]{k:{".repeat(6)}*{${F}|a|~}${"}}".repeat(6)}`)
  })

  it("a deeper value with the same atoms has the same signature as one even deeper", () => {
    expect(signatureOf(nest(7, atomVal(atom(["a"]))))).toBe(
      signatureOf(nest(10, atomVal(atom(["a"])))),
    )
  })

  it("a value below the cap that holds no data adds nothing", () => {
    expect(signatureOf(nest(9, EMPTY_VAL))).toBe("")
  })

  it("the summary lists every atom below the cap, sorted, approximate, and deduplicated", () => {
    const leaf = mergeVals(atomVal(atom(["b"])), atomVal(atom(["a"])), atomVal(atom(["a"])))
    const sig = signatureOf(nest(7, leaf))
    expect(sig).toContain(`*{${F}|a|~,${F}|b|~}`)
  })

  it("reading a key of a nested value keeps working past the cap", () => {
    const deep = nest(8, atomVal(atom([])))
    let current = deep
    for (let level = 0; level < 8; level += 1) current = accessKey(current, "k")
    expect(flattenAtoms(current)).toHaveLength(1)
  })
})

describe("builtin collections as values", () => {
  const key = atomVal(atom(["name"]))
  const value = atomVal(atom(["email"]))

  it("a map keeps its keys and its values apart, and each pair is an element holding both", () => {
    const map = mapVal(key, value)
    expect(map.native).toBe("map")
    expect(map.atoms).toEqual([])
    expect(map.props.get(MAP_KEYS)).toBe(key)
    expect(map.props.get(MAP_VALUES)).toBe(value)
    const pair = map.props.get(ELEMENT_KEY)
    expect(flattenAtoms(pair?.props.get(ELEMENT_KEY) ?? EMPTY_VAL).map((a) => a.path)).toEqual([
      ["name"],
      ["email"],
    ])
    expect([...map.props.keys()].sort()).toEqual([ELEMENT_KEY, MAP_KEYS, MAP_VALUES].sort())
  })

  it("a set holds its items as elements", () => {
    const set = setVal(value)
    expect(set.native).toBe("set")
    expect(set.props.get(ELEMENT_KEY)).toBe(value)
    expect([...set.props.keys()]).toEqual([ELEMENT_KEY])
  })

  it("a record answers any key with its entry, which is not an ordinary property", () => {
    const record = recordVal(value)
    expect(record.native).toBe("record")
    expect(record.props.get(ANY_KEY)).toBe(value)
    expect(ANY_KEY.startsWith("\u0000")).toBe(true)
    expect(MAP_KEYS.startsWith("\u0000")).toBe(true)
    expect(MAP_VALUES.startsWith("\u0000")).toBe(true)
  })

  it("two maps merge key with key and value with value, and a map and a set are told apart no longer", () => {
    const merged = mergeVals(mapVal(key, value), mapVal(value, key))
    expect(merged.native).toBe("map")
    expect(flattenAtoms(merged.props.get(MAP_KEYS) ?? EMPTY_VAL)).toHaveLength(2)
    expect(mergeVals(mapVal(key, value), setVal(value)).native).toBeUndefined()
  })

  it("a map, a set and a record differ in their signature, and an empty one is not an empty object", () => {
    const sigs = [
      signatureOf(mapVal(EMPTY_VAL, EMPTY_VAL)),
      signatureOf(setVal(EMPTY_VAL)),
      signatureOf(recordVal(EMPTY_VAL)),
      signatureOf(EMPTY_VAL),
    ]
    expect(new Set(sigs).size).toBe(4)
    expect(sigs[3]).toBe("")
  })
})

describe("handles: promises, settlers and generators", () => {
  it("a handle is a property that holds nothing, named for its kind and its id", () => {
    const handle = handleVal(PROMISE_HANDLE, "p1")
    expect([...handle.props.keys()]).toEqual([`${PROMISE_HANDLE}p1`])
    expect(handle.props.get(`${PROMISE_HANDLE}p1`)).toBe(EMPTY_VAL)
    expect(handle.atoms).toEqual([])
  })

  it("the four kinds are recognised, nothing else is", () => {
    for (const prefix of [PROMISE_HANDLE, RESOLVE_HANDLE, REJECT_HANDLE, GENERATOR_HANDLE])
      expect(isHandleKey(`${prefix}x`)).toBe(true)
    expect(isHandleKey("email")).toBe(false)
    expect(isHandleKey(ELEMENT_KEY)).toBe(false)
    expect(isHandleKey("promise:x")).toBe(false)
  })

  it("handlesOf lists the ids of one kind, whatever else the value holds", () => {
    const val = mergeVals(
      handleVal(PROMISE_HANDLE, "a"),
      handleVal(PROMISE_HANDLE, "b"),
      handleVal(RESOLVE_HANDLE, "c"),
      atomVal(atom(["email"])),
    )
    expect(handlesOf(val, PROMISE_HANDLE)).toEqual(["a", "b"])
    expect(handlesOf(val, RESOLVE_HANDLE)).toEqual(["c"])
    expect(handlesOf(val, GENERATOR_HANDLE)).toEqual([])
  })

  it("two promises merged keep both handles", () => {
    const merged = mergeVals(handleVal(PROMISE_HANDLE, "a"), handleVal(PROMISE_HANDLE, "b"))
    expect(handlesOf(merged, PROMISE_HANDLE)).toEqual(["a", "b"])
  })

  it("dropHandles takes the handles off and leaves everything else", () => {
    const val = mergeVals(
      handleVal(PROMISE_HANDLE, "a"),
      objectVal({ email: atomVal(atom(["email"])) }, []),
      { ...EMPTY_VAL, instance: "i" },
    )
    const dropped = dropHandles(val)
    expect(handlesOf(dropped, PROMISE_HANDLE)).toEqual([])
    expect([...dropped.props.keys()]).toEqual(["email"])
    expect(dropped.instance).toBe("i")
  })

  it("a handle tells values apart in a signature even though it holds nothing", () => {
    const a = signatureOf(handleVal(PROMISE_HANDLE, "a"))
    const b = signatureOf(handleVal(PROMISE_HANDLE, "b"))
    expect(a).not.toBe(b)
    expect(a).not.toBe("")
    expect(signatureOf(handleVal(RESOLVE_HANDLE, "a"))).not.toBe(a)
  })

  it("reading an unknown key keeps the handles the value holds at any depth", () => {
    const nested = objectVal(
      {
        inner: objectVal({ p: handleVal(PROMISE_HANDLE, "deep") }, []),
        plain: atomVal(atom(["email"])),
      },
      [],
    )
    const read = accessDynamic(nested)
    expect(handlesOf(read, PROMISE_HANDLE)).toEqual(["deep"])
    expect(flattenAtoms(read).map((a) => a.approx)).toEqual([true])
  })
})

describe("declared atoms and packages' exports", () => {
  it("declaredVal marks every atom, at any depth, and nothing else", () => {
    const val = objectVal(
      { a: atomVal(atom(["a"])), b: objectVal({ c: atomVal(atom(["c"])) }, []) },
      [atomVal(atom(["root"]))],
    )
    const declared = declaredVal(val)
    expect(flattenAtoms(declared).every((a) => a.declared === true)).toBe(true)
    expect(flattenAtoms(declared)).toHaveLength(3)
    expect(flattenAtoms(val).some((a) => a.declared === true)).toBe(false)
    expect(declared.props.get("a")?.atoms[0]?.approx).toBe(false)
  })

  it("a declared atom is not an undeclared one: they are kept, not merged", () => {
    const merged = mergeVals(atomVal(atom(["a"])), declaredVal(atomVal(atom(["a"]))))
    expect(merged.atoms).toHaveLength(2)
  })

  it("declared survives reading a key, approximating and relabeling how the atom entered", () => {
    const declared = declaredVal(atomVal(atom(["a"])))
    expect(accessKey(declared, "b").atoms[0]?.declared).toBe(true)
    expect(approximate(declared).atoms[0]?.declared).toBe(true)
    expect(withEntry(declared, { kind: "return", from: "f" }).atoms[0]?.declared).toBe(true)
  })

  it("a signature tells a declared atom from an exact one and from an inexact one", () => {
    const exact = signatureOf(atomVal(atom(["a"])))
    const declared = signatureOf(declaredVal(atomVal(atom(["a"]))))
    const inexact = signatureOf(approximate(atomVal(atom(["a"]))))
    expect(new Set([exact, declared, inexact]).size).toBe(3)
    expect(declared).toBe(`[${F}|a|=d]{}`)
    expect(signatureOf(declaredVal(approximate(atomVal(atom(["a"])))))).toBe(`[${F}|a|~d]{}`)
  })

  it("past the signature depth a declared atom is still told from the others", () => {
    let val: Val = declaredVal(atomVal(atom(["a"])))
    for (let level = 0; level < 7; level += 1) val = objectVal({ k: val }, [])
    expect(signatureOf(val)).toContain(`${F}|a|~d`)
  })

  it("an export of a package merges with itself, and two different exports cannot be told as one", () => {
    const pick = { ...EMPTY_VAL, external: "lodash\u0000pick" }
    const omit = { ...EMPTY_VAL, external: "lodash\u0000omit" }
    expect(mergeVals(pick, pick).external).toBe("lodash\u0000pick")
    expect(mergeVals(pick, EMPTY_VAL).external).toBe("lodash\u0000pick")
    expect(mergeVals(pick, omit).external).toBeUndefined()
    expect(mergeVals(pick, omit, pick).external).toBeUndefined()
  })

  it("withoutExternal takes the mark off and keeps the rest, leaving a value without it as it was", () => {
    const val = { ...atomVal(atom(["a"])), external: "m\u0000x", callable: "f" }
    const plain = withoutExternal(val)
    expect("external" in plain).toBe(false)
    expect(plain.callable).toBe("f")
    expect(plain.atoms).toEqual(val.atoms)
    const untouched = atomVal(atom(["a"]))
    expect(withoutExternal(untouched)).toEqual(untouched)
  })

  it("two different builtin collections cannot be told as one", () => {
    expect(mergeVals({ ...EMPTY_VAL, native: "map" }, { ...EMPTY_VAL, native: "map" }).native).toBe(
      "map",
    )
    expect(
      mergeVals({ ...EMPTY_VAL, native: "map" }, { ...EMPTY_VAL, native: "set" }).native,
    ).toBeUndefined()
  })
})
