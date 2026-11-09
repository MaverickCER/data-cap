import { describe, expect, it } from "vitest"
import { Env, isBuiltinExact } from "../../src/build/flow-scan.js"
import { atomVal, EMPTY_VAL } from "../../src/build/flow-values.js"
import type { Atom, Val } from "../../src/build/flow-values.js"

const atom = (path: string): Atom => ({
  origin: "field:src/u.ts#userData.user",
  path: [path],
  approx: false,
  entry: { kind: "read" },
  entryPath: [],
})
const one: Val = atomVal(atom("one"))
const two: Val = atomVal(atom("two"))

describe("Env: names", () => {
  it("finds a name here, then in the scopes around, and gives the empty value for one it cannot find", () => {
    const outer = new Env()
    outer.set("a", one)
    const inner = new Env(outer)
    inner.set("b", two)
    expect(inner.get("a")).toBe(one)
    expect(inner.get("b")).toBe(two)
    expect(outer.get("b")).toBeUndefined()
    expect(inner.has("a")).toBe(true)
    expect(inner.has("b")).toBe(true)
    expect(outer.has("b")).toBe(false)
    expect(inner.has("missing")).toBe(false)
    expect(inner.lookup("a")).toBe(one)
    expect(inner.lookup("missing")).toBe(EMPTY_VAL)
  })

  it("lets a name here hide the same name outside", () => {
    const outer = new Env()
    outer.set("a", one)
    const inner = new Env(outer)
    inner.set("a", two)
    expect(inner.get("a")).toBe(two)
    expect(outer.get("a")).toBe(one)
  })
})

describe("Env: the text of a constant", () => {
  it("is the string a name was bound to, looked up where the name is declared", () => {
    const outer = new Env()
    outer.set("key", EMPTY_VAL)
    outer.setText("key", "email")
    const inner = new Env(outer)
    expect(outer.textOf("key")).toBe("email")
    expect(inner.textOf("key")).toBe("email")
  })

  it("is nothing for a name that is not bound anywhere, at the outermost scope too", () => {
    expect(new Env().textOf("missing")).toBeUndefined()
    expect(new Env(new Env()).textOf("missing")).toBeUndefined()
  })

  it("is hidden by a name of the same spelling declared closer, even one with no text", () => {
    const outer = new Env()
    outer.set("key", EMPTY_VAL)
    outer.setText("key", "email")
    const inner = new Env(outer)
    inner.set("key", EMPTY_VAL)
    expect(inner.textOf("key")).toBeUndefined()
    expect(outer.textOf("key")).toBe("email")
  })

  it("is forgotten when the name is bound again", () => {
    const env = new Env()
    env.set("key", EMPTY_VAL)
    env.setText("key", "email")
    env.set("key", one)
    expect(env.textOf("key")).toBeUndefined()
  })

  it("is forgotten when the name is assigned to", () => {
    const env = new Env()
    env.set("key", EMPTY_VAL)
    env.setText("key", "email")
    env.assign("key", one)
    expect(env.textOf("key")).toBeUndefined()
  })
})

describe("Env.assign", () => {
  it("defines a name that is nowhere yet, in the scope it is assigned in", () => {
    const outer = new Env()
    const inner = new Env(outer)
    expect(inner.assign("a", one)).toBe(false)
    expect(inner.get("a")).toBe(one)
    expect(outer.get("a")).toBeUndefined()
  })

  it("merges into the nearest scope that has the name, not into the scope it is assigned in", () => {
    const outer = new Env()
    outer.set("a", one)
    const inner = new Env(outer)
    inner.assign("a", two)
    expect(inner.get("a")).toBe(outer.get("a"))
    expect(outer.get("a")?.atoms.map((item) => item.path[0])).toEqual(["one", "two"])
  })

  it("keeps the value as it was when the same name is merged with itself", () => {
    const env = new Env()
    env.set("a", one)
    env.assign("a", one)
    expect(env.get("a")?.atoms).toHaveLength(1)
  })

  describe("says whether it changed something other functions can see", () => {
    const setup = (options: { persistent: boolean; boundary: boolean; middle?: boolean }) => {
      const module = new Env(undefined, true, options.persistent)
      module.set("shared", one)
      const middle = options.middle === true ? new Env(module, false, false) : module
      const fn = new Env(middle, options.boundary)
      return { module, fn }
    }

    it("when a function writes something new into a module's scope", () => {
      const { fn } = setup({ persistent: true, boundary: true })
      expect(fn.assign("shared", two)).toBe(true)
    })

    it("when the scope the boundary is crossed through is not the nearest one", () => {
      const { fn } = setup({ persistent: true, boundary: true, middle: true })
      expect(fn.assign("shared", two)).toBe(true)
    })

    it("not when the write adds nothing the scope did not have", () => {
      const { fn } = setup({ persistent: true, boundary: true })
      expect(fn.assign("shared", one)).toBe(false)
    })

    it("not when the scope does not outlive a round", () => {
      const { fn } = setup({ persistent: false, boundary: true })
      expect(fn.assign("shared", two)).toBe(false)
    })

    it("not when no boundary lies between the write and the scope", () => {
      const { fn } = setup({ persistent: true, boundary: false })
      expect(fn.assign("shared", two)).toBe(false)
    })

    it("not when the scope is the one assigned in", () => {
      const { module } = setup({ persistent: true, boundary: true })
      expect(module.assign("shared", two)).toBe(false)
    })

    it("not when the name is new to the scope it lands in", () => {
      const { fn, module } = setup({ persistent: true, boundary: true })
      expect(fn.assign("fresh", two)).toBe(false)
      expect(module.has("fresh")).toBe(false)
      expect(fn.has("fresh")).toBe(true)
    })

    it("by default a scope is no boundary, and does not outlive a round", () => {
      const module = new Env()
      module.set("shared", one)
      expect(new Env(module).assign("shared", two)).toBe(false)
      const persistentOnly = new Env(undefined, false, true)
      persistentOnly.set("shared", one)
      expect(new Env(persistentOnly).assign("shared", two)).toBe(false)
      const boundaryOnly = new Env(undefined, true)
      boundaryOnly.set("shared", one)
      expect(new Env(boundaryOnly, true).assign("shared", two)).toBe(false)
    })
  })
})

describe("isBuiltinExact", () => {
  it.each([
    "Object.assign",
    "Object.freeze",
    "Object.seal",
    "Object.setPrototypeOf",
    "Promise.resolve",
  ])("%s is one", (name) => {
    expect(isBuiltinExact(name)).toBe(true)
  })

  it.each([
    "Object.keys",
    "Object",
    "assign",
    "Object.assign ",
    "object.assign",
    "Promise.reject",
    "",
  ])("%j is not", (name) => {
    expect(isBuiltinExact(name)).toBe(false)
  })
})
