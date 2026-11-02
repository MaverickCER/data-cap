import { describe, expect, it } from "vitest"
import {
  accessDynamic,
  accessKey,
  ANY_KEY,
  approximate,
  atomVal,
  dropHandles,
  EMPTY_VAL,
  flattenAtoms,
  GENERATOR_HANDLE,
  handleVal,
  handlesOf,
  isHandleKey,
  MAP_KEYS,
  MAP_VALUES,
  mergeVals,
  objectVal,
  OPAQUE_ALLOC,
  PROMISE_HANDLE,
  REJECT_HANDLE,
  RESOLVE_HANDLE,
  signatureOf,
  withEntry,
} from "../../src/build/flow-values.js"
import type { Atom, Val } from "../../src/build/flow-values.js"

const F = "field:src/u.ts#userData.user"
const G = "field:src/u.ts#userData.team"

function atom(path: string[] = [], overrides: Partial<Atom> = {}): Atom {
  return { origin: F, path, approx: false, entry: { kind: "read" }, entryPath: [], ...overrides }
}

const keys = (val: Val): string[] =>
  flattenAtoms(val)
    .map((a) => `${a.origin}:${a.path.join(".")}${a.approx ? "~" : ""}`)
    .sort()

describe("atomVal / EMPTY_VAL", () => {
  it("an empty value flattens to nothing", () => {
    expect(flattenAtoms(EMPTY_VAL)).toEqual([])
  })

  it("an atom value flattens to that atom", () => {
    expect(flattenAtoms(atomVal(atom(["email"])))).toEqual([atom(["email"])])
  })
})

describe("accessKey", () => {
  it("extends the path of every atom at the root", () => {
    expect(keys(accessKey(atomVal(atom()), "email"))).toEqual([`${F}:email`])
  })

  it("reads an explicit property of an object literal exactly, not its siblings", () => {
    const obj = objectVal({ id: atomVal(atom(["id"])), email: atomVal(atom(["email"])) }, [])
    expect(keys(accessKey(obj, "email"))).toEqual([`${F}:email`])
  })

  it("combines an explicit property with root atoms (a spread plus an override)", () => {
    const obj = objectVal({ email: atomVal(atom(["masked"], { origin: G })) }, [atomVal(atom())])
    expect(keys(accessKey(obj, "email"))).toEqual([`${G}:masked`, `${F}:email`])
  })

  it("returns an empty value for a key nothing provides", () => {
    expect(flattenAtoms(accessKey(objectVal({ a: atomVal(atom(["a"])) }, []), "b"))).toEqual([])
  })

  it("keeps the nested structure of an explicit property so a second access stays precise", () => {
    const inner = objectVal(
      { city: atomVal(atom(["address", "city"])), zip: atomVal(atom(["address", "zip"])) },
      [],
    )
    const outer = objectVal({ address: inner }, [])
    expect(keys(accessKey(accessKey(outer, "address"), "zip"))).toEqual([`${F}:address.zip`])
  })
})

describe("accessDynamic", () => {
  it("returns every atom with the path unchanged and marks them approximate", () => {
    const obj = objectVal({ a: atomVal(atom(["a"])) }, [atomVal(atom(["b"]))])
    expect(keys(accessDynamic(obj))).toEqual([`${F}:a~`, `${F}:b~`])
  })
})

describe("mergeVals", () => {
  it("unions atoms and removes exact duplicates", () => {
    expect(
      keys(mergeVals(atomVal(atom(["a"])), atomVal(atom(["a"])), atomVal(atom(["b"])))),
    ).toEqual([`${F}:a`, `${F}:b`])
  })

  it("keeps an approximate and an exact copy of the same atom apart", () => {
    expect(keys(mergeVals(atomVal(atom(["a"])), atomVal(atom(["a"], { approx: true }))))).toEqual([
      `${F}:a`,
      `${F}:a~`,
    ])
  })

  it("merges the same explicit property from both sides", () => {
    const left = objectVal({ x: atomVal(atom(["l"])) }, [])
    const right = objectVal({ x: atomVal(atom(["r"])) }, [])
    expect(keys(accessKey(mergeVals(left, right), "x"))).toEqual([`${F}:l`, `${F}:r`])
  })

  it("is the identity for no arguments and for empty values", () => {
    expect(flattenAtoms(mergeVals())).toEqual([])
    expect(keys(mergeVals(EMPTY_VAL, atomVal(atom(["a"]))))).toEqual([`${F}:a`])
  })

  it("keeps a capability or callable marker from whichever side has one", () => {
    const callable: Val = { ...EMPTY_VAL, callable: "src/a.ts#f" }
    expect(mergeVals(EMPTY_VAL, callable).callable).toBe("src/a.ts#f")
    const cap: Val = { ...EMPTY_VAL, capability: "src/a.ts#cap" }
    expect(mergeVals(cap, EMPTY_VAL).capability).toBe("src/a.ts#cap")
    const fieldsOf: Val = { ...EMPTY_VAL, fieldsOf: "src/a.ts#cap" }
    expect(mergeVals(EMPTY_VAL, fieldsOf).fieldsOf).toBe("src/a.ts#cap")
  })
})

describe("objectVal", () => {
  it("flattening includes explicit property atoms and spread atoms", () => {
    const obj = objectVal({ a: atomVal(atom(["a"])) }, [atomVal(atom(["rest"]))])
    expect(keys(obj)).toEqual([`${F}:a`, `${F}:rest`])
  })
})

describe("approximate", () => {
  it("marks every atom, including nested ones, approximate", () => {
    const obj = objectVal({ a: atomVal(atom(["a"])) }, [atomVal(atom(["b"]))])
    expect(keys(approximate(obj))).toEqual([`${F}:a~`, `${F}:b~`])
  })

  it("leaves an empty value empty", () => {
    expect(flattenAtoms(approximate(EMPTY_VAL))).toEqual([])
  })
})

describe("withEntry", () => {
  it("replaces the entry and records the path at which the atom entered", () => {
    const result = flattenAtoms(
      withEntry(atomVal(atom(["a", "b"])), { kind: "param", fn: "f", index: 0 }),
    )[0]
    expect(result?.entry).toEqual({ kind: "param", fn: "f", index: 0 })
    expect(result?.entryPath).toEqual(["a", "b"])
  })

  it("applies to nested atoms too", () => {
    const obj = objectVal({ a: atomVal(atom(["a"])) }, [atomVal(atom(["b"]))])
    const entries = flattenAtoms(withEntry(obj, { kind: "return", from: "g" })).map((a) => a.entry)
    expect(entries).toEqual([
      { kind: "return", from: "g" },
      { kind: "return", from: "g" },
    ])
  })
})

describe("signatureOf", () => {
  it("is equal for equal values regardless of atom order", () => {
    expect(signatureOf(mergeVals(atomVal(atom(["a"])), atomVal(atom(["b"]))))).toBe(
      signatureOf(mergeVals(atomVal(atom(["b"])), atomVal(atom(["a"])))),
    )
  })

  it("ignores the entry, which differs by call site", () => {
    expect(signatureOf(atomVal(atom(["a"], { entry: { kind: "read" } })))).toBe(
      signatureOf(atomVal(atom(["a"], { entry: { kind: "param", fn: "x", index: 1 } }))),
    )
  })

  it("distinguishes origin, path and approximation", () => {
    const base = signatureOf(atomVal(atom(["a"])))
    expect(signatureOf(atomVal(atom(["a"], { origin: G })))).not.toBe(base)
    expect(signatureOf(atomVal(atom(["b"])))).not.toBe(base)
    expect(signatureOf(atomVal(atom(["a"], { approx: true })))).not.toBe(base)
  })

  it("distinguishes structure: an explicit property from a root atom", () => {
    expect(signatureOf(objectVal({ a: atomVal(atom(["a"])) }, []))).not.toBe(
      signatureOf(atomVal(atom(["a"]))),
    )
  })

  it("is the empty string for an empty value", () => {
    expect(signatureOf(EMPTY_VAL)).toBe("")
  })

  it("terminates on deeply nested values by collapsing past the depth limit", () => {
    let val: Val = atomVal(atom(["leaf"]))
    for (let i = 0; i < 40; i += 1) val = objectVal({ n: val }, [])
    expect(signatureOf(val).length).toBeLessThan(5000)
  })
})

describe("the keys the analysis keeps for itself", () => {
  it("are fixed strings that no property a program names can equal", () => {
    expect([MAP_KEYS, MAP_VALUES, ANY_KEY]).toEqual(["\u0000keys", "\u0000values", "\u0000any"])
    expect([PROMISE_HANDLE, RESOLVE_HANDLE, REJECT_HANDLE, GENERATOR_HANDLE]).toEqual([
      "\u0000promise:",
      "\u0000resolve:",
      "\u0000reject:",
      "\u0000generator:",
    ])
    expect(OPAQUE_ALLOC).toBe("?")
    const all = [MAP_KEYS, MAP_VALUES, ANY_KEY, PROMISE_HANDLE, RESOLVE_HANDLE, REJECT_HANDLE]
    expect(new Set([...all, GENERATOR_HANDLE]).size).toBe(7)
  })

  it.each([PROMISE_HANDLE, RESOLVE_HANDLE, REJECT_HANDLE, GENERATOR_HANDLE])(
    "recognises a handle of kind %j and reads its id back",
    (prefix) => {
      expect(isHandleKey(`${prefix}7`)).toBe(true)
      expect(handlesOf(handleVal(prefix, "7"), prefix)).toEqual(["7"])
      expect(dropHandles(handleVal(prefix, "7")).props.size).toBe(0)
    },
  )

  it("does not take a map's keys, a record's any-key or a plain property for a handle", () => {
    for (const key of [MAP_KEYS, MAP_VALUES, ANY_KEY, "promise:1", "plain", ""])
      expect(isHandleKey(key)).toBe(false)
  })
})

describe("accessDynamic over several objects", () => {
  it("lists the sites of the objects it may read, sorted and once", () => {
    const child = (id: string): Val => ({ ...EMPTY_VAL, alloc: [id] })
    const holder: Val = {
      ...EMPTY_VAL,
      props: new Map([
        ["x", child("b")],
        ["y", child("a")],
        ["z", child("b")],
      ]),
    }
    expect(accessDynamic(holder).alloc).toEqual(["a", "b"])
  })
})

describe("signatureOf, with several sites", () => {
  it("tells two sites from the one site whose name is the two run together", () => {
    const two: Val = { ...EMPTY_VAL, alloc: ["a", "b"] }
    const one: Val = { ...EMPTY_VAL, alloc: ["ab"] }
    expect(signatureOf(two)).not.toBe(signatureOf(one))
  })
})

describe("mergeVals, with atoms that differ only in being declared", () => {
  it("keeps both", () => {
    const merged = mergeVals(atomVal(atom(["a"])), atomVal(atom(["a"], { declared: true })))
    expect(flattenAtoms(merged)).toHaveLength(2)
  })

  it("keeps one of two atoms that are the same", () => {
    const merged = mergeVals(atomVal(atom(["a"])), atomVal(atom(["a"])))
    expect(flattenAtoms(merged)).toHaveLength(1)
  })
})
