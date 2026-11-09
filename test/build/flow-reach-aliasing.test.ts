import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { USER } from "./mut-flow-scan-harness.js"
import {
  effects,
  handler,
  makeHarness,
  reasonNames,
  reasons,
  unknownData,
} from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * Heap aliasing (ADR 0074 section 5). An object another name holds is the same object: a store through one name is
 * seen through every other, however the sharing was made -- by a literal that holds a reference, an array element, a
 * function's result, a shallow copy, a prototype, a closure -- and a copy is a different object. Each test pins what is
 * followed (`effects`) and what is reported (`reasons`).
 */
describe("flow-reach: aliasing through the heap", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const scan = async (body: string, extra = "") => (await h.scan(handler(body, extra))).input
  const email = `${USER}.email`

  describe("sharing that is followed", () => {
    it("a property of one literal that holds a property of another", async () => {
      const input = await scan(
        `  const a: any = { list: [] }\n  const b = { list: a.list }\n  b.list.push(${email})\n  res.json(a.list)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a nested object stored through the other literal", async () => {
      const input = await scan(
        `  const a: any = { inner: {} }\n  const b = { inner: a.inner }\n  b.inner.x = ${email}\n  res.json(a.inner.x)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an array element, by push and by property store", async () => {
      const input = await scan(
        `  const a: any[] = []\n  const o: any = {}\n  const arr = [a, o]\n  arr[0].push(${email})\n  arr[1].x = ${USER}.name\n  res.json(a)\n  res.json(o.x)`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a container returned by a function, then bound", async () => {
      const input = await scan(
        `  const a: any = { list: [] }\n  const l = get(a)\n  l.push(${email})\n  res.json(a.list)`,
        `function get(o: any) { return o.list }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a container filled by a function it was handed through another object", async () => {
      const input = await scan(
        `  const a: any = { list: [] }\n  const b = { list: a.list }\n  fill(b.list)\n  res.json(a.list)`,
        `function fill(l: any[]) { l.push(${email}) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an element of a shallow copy: the copy is a new array of the same objects", async () => {
      const input = await scan(
        `  const a: any[] = [{ items: [] }]\n  const c = a.slice()\n  c[0].items.push(${email})\n  res.json(a[0].items)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a nested container of a spread copy and of an Object.assign copy", async () => {
      const input = await scan(
        `  const a: any = { list: [] }\n  const b = { ...a }\n  b.list.push(${email})\n  res.json(a.list)\n  const c: any = { list: [] }\n  const d: any = Object.assign({}, c)\n  d.list.push(${USER}.name)\n  res.json(c.list)`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("either of two objects chosen at run time: a store is seen through the one that was not chosen", async () => {
      const input = await scan(
        `  const a: any = { list: [] }\n  const b: any = { list: [] }\n  const t = key ? a : b\n  t.list.push(${email})\n  res.json(b.list)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a closure that fills a container another object holds", async () => {
      const input = await scan(
        `  const box: any = { items: [] }\n  const add = () => box.items.push(${email})\n  const alias = { items: box.items }\n  add()\n  res.json(alias.items)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an array shared by the instances of a constructor function through its prototype", async () => {
      const input = await scan(
        `  const a: any = new Foo()\n  const b: any = new Foo()\n  a.items.push(${email})\n  res.json(b.items)`,
        `function Foo(this: any) {}\nFoo.prototype.items = [] as any[]\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("two names for one instance", async () => {
      const input = await scan(
        `  const a = new Box()\n  const b = a\n  a.items.push(${email})\n  res.json(b.items)`,
        `class Box { items: any[] = [] }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a reader analyzed before the writer of module state sees the store", async () => {
      const input = await scan(
        `  store.items.push(${email})`,
        `const store = { items: [] as any[] }\nexport function read(res: any) { res.json(store.items) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("stores that are not a push or a property assignment", () => {
    it("Map.set through a map another object holds", async () => {
      const input = await scan(
        `  const box: any = { m: new Map<string, any>() }\n  const other = { m: box.m }\n  other.m.set("a", ${email})\n  res.json(box.m.get("a"))`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("Set.add through a set another object holds", async () => {
      const input = await scan(
        `  const box: any = { s: new Set<any>() }\n  const other = { s: box.s }\n  other.s.add(${email})\n  res.json([...box.s])`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("Reflect.set", async () => {
      const input = await scan(
        `  const a: any = { inner: {} }\n  const b = { inner: a.inner }\n  Reflect.set(b.inner, "x", ${email})\n  res.json(a.inner.x)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("Object.assign into a shared object", async () => {
      const input = await scan(
        `  const a: any = { inner: {} }\n  const b = { inner: a.inner }\n  Object.assign(b.inner, { x: ${email} })\n  res.json(a.inner.x)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an object made from a prototype that holds a container", async () => {
      const input = await scan(
        `  const proto: any = { list: [] }\n  const child = Object.create(proto)\n  child.list.push(${email})\n  res.json(proto.list)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("different objects stay different", () => {
    it("two literals with the same shape", async () => {
      const input = await scan(
        `  const a: any = { list: [] }\n  const b: any = { list: [] }\n  a.list.push(${email})\n  res.json(b.list)`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("a spread copy does not see a later store to its own top level", async () => {
      const input = await scan(
        `  const a: any = {}\n  const b: any = { ...a }\n  b.x = ${email}\n  res.json(a.x)`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("two instances made by two `new` expressions", async () => {
      const input = await scan(
        `  const a = new Box()\n  const b = new Box()\n  a.items.push(${email})\n  res.json(b.items)`,
        `class Box { items: any[] = [] }\n`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("the rest of an object is a new object", async () => {
      const input = await scan(
        `  const obj: any = { id: 1, tags: [] }\n  const { id, ...rest } = obj\n  rest.x = ${email}\n  res.json(obj.x)\n  res.json(id)`,
      )
      // What the original sends does not include what was stored into the rest (a destructured name is still reported as possibly shared).
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual(["unsupported-construct 5:3"])
    })

    it("a copy made by a JSON round trip, structuredClone or Array.from", async () => {
      for (const copy of ["JSON.parse(JSON.stringify(a))", "structuredClone(a)", "Array.from(a)"]) {
        const input = await scan(
          `  const a: any = [{ list: [] }]\n  const b = ${copy}\n  b.push(${email})\n  res.json(a)`,
        )
        expect(effects(input), copy).toEqual([])
        expect(reasons(input), copy).toEqual([])
      }
    })

    it("a deep copy does not share the objects inside it either", async () => {
      const input = await scan(
        `  const a: any = { list: [] }\n  const b = structuredClone(a)\n  b.list.push(${email})\n  res.json(a.list)`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("a shallow copy of an array shares the objects inside it, a deep copy does not", async () => {
      const shallow = await scan(
        `  const a: any[] = [{ list: [] }]\n  const b = Array.from(a)\n  b[0].list.push(${email})\n  res.json(a[0].list)`,
      )
      expect(effects(shallow)).toEqual(["email|static"])
    })

    it("two arrays handed to the same function", async () => {
      const input = await scan(
        `  const a: any[] = []\n  const b: any[] = []\n  fill(a)\n  res.json(b)`,
        `function fill(l: any[]) { l.push(${email}) }\n`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("a store after the object was sent is not sent", async () => {
      const input = await scan(
        `  const o: any = { list: [] }\n  res.json(o)\n  o.list.push(${email})`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("a store made later by a callee is not seen by the caller's earlier send", async () => {
      const input = await scan(
        `  const o: any = { v: 0 }\n  res.json(o.v)\n  fill(o)`,
        `function fill(o: any) { o.v = ${email} }\n`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("objects the analysis did not see made", () => {
    it("a store into the result of a call into a package is reported", async () => {
      const input = await scan(
        `  const l = make()\n  l.push(${email})\n  res.json(l)`,
        `import { make } from "some-lib"\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasonNames(input)).toEqual(["unsupported-construct"])
      expect(reasons(input)).toEqual(["unsupported-construct 5:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a store into an object a package exports is reported", async () => {
      const input = await scan(`  store.items.push(${email})`, `import { store } from "some-lib"\n`)
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual(["unsupported-construct 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a store that carries no tracked data into such an object is not reported", async () => {
      const input = await scan(`  store.items.push(1)`, `import { store } from "some-lib"\n`)
      expect(reasons(input)).toEqual([])
    })
  })

  describe("sharing that stays reported", () => {
    it("the result of a call that is filled in is reported as it always was, and also followed", async () => {
      const input = await scan(
        `  const a: any = { list: [] }\n  get(a).push(${email})\n  res.json(a.list)`,
        `function get(o: any) { return o.list }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual(["unresolved-call 5:3"])
    })

    it("an element of a loop is reported and also followed", async () => {
      const input = await scan(
        `  const objs: any[] = [{ list: [] }]\n  for (const o of objs) o.list.push(${email})\n  res.json(objs[0].list)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual(["unsupported-construct 4:25"])
    })
  })
})
