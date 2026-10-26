import { describe, expect, it } from "vitest"
import {
  accessDynamic,
  accessKey,
  approximate,
  atomVal,
  EMPTY_VAL,
  flattenAtoms,
  mergeVals,
  objectVal,
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
