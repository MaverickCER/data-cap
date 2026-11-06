import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { USER } from "./mut-flow-scan-harness.js"
import { effects, handler, makeHarness, reasons, unknownData } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * Reach of the flow pass over builtins whose semantics the language fixes (ADR 0074): `Map` and `Set`, `Promise`
 * constructed and combined, `Reflect`, `groupBy`, a JSON round trip, `Array.prototype` methods called on something
 * else, `bind`, and keys that are constants. Each is followed instead of reported, and what it approximates is pinned.
 */
describe("flow-reach: builtins with known semantics", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const scan = async (body: string, extra = "", keyword = "") => {
    const source = handler(body, extra)["app/p.ts"] ?? ""
    return (
      await h.scan({
        "app/p.ts": source.replace("export function h", `export ${keyword}function h`),
      })
    ).input
  }

  describe("Map and WeakMap", () => {
    it("a value put in under a key comes out of get, exactly, and the sibling field stays out", async () => {
      const input = await scan(
        `  const m = new Map<string, any>()\n  m.set("a", ${USER}.email)\n  res.json(m.get("a"))\n  void ${USER}.name`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("keys and values written as [key, value] literals are kept apart", async () => {
      const build = `  const m = new Map<string, any>([[${USER}.name, ${USER}.email]])\n`
      const values = await scan(`${build}  res.json(m.get("x"))\n  res.json([...m.values()][0])`)
      expect(effects(values)).toEqual(["email|static"])
      const keys = await scan(`${build}  res.json([...m.keys()][0])`)
      expect(effects(keys)).toEqual(["name|static"])
    })

    it("get gives every value whatever the key", async () => {
      const input = await scan(
        `  const m = new Map<string, any>([["a", ${USER}.email], ["b", ${USER}.name]])\n  res.json(m.get("a"))`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })

    it("has, delete and clear answer with nothing", async () => {
      const input = await scan(
        `  const m = new Map<string, any>([["a", ${USER}.email]])\n  res.json(m.has("a"))\n  res.json(m.delete("a"))\n  res.json(m.clear())`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("forEach runs the callback with the value, the key and the map", async () => {
      const input = await scan(
        `  new Map<string, any>([[${USER}.name, ${USER}.email]]).forEach((v, k, m) => { res.json(v); res.json(k); res.json(m.size) })`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })

    it("entries and a direct for-of give [key, value] pairs", async () => {
      const input = await scan(
        `  const m = new Map<string, any>([["a", ${USER}.email]])\n  for (const [, v] of m) res.json(v)\n  for (const [, w] of m.entries()) res.json(w)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a map copied from another keeps its keys and values apart; one built from another iterable does not", async () => {
      const copied = await scan(
        `  const a = new Map<string, any>([[${USER}.name, ${USER}.email]])\n  res.json(new Map(a).get("x"))`,
      )
      expect(effects(copied)).toEqual(["email|static"])
      const entries = await scan(
        `  const m = new Map(Object.entries({ k: ${USER}.email }))\n  res.json(m.get("k"))`,
      )
      expect(effects(entries)).toEqual(["email|inferred"])
    })

    it("a map filled by the function it is handed to is filled for the caller", async () => {
      const input = await scan(
        `  const m = new Map<string, any>()\n  fill(m)\n  res.json(m.get("a"))`,
        `function fill(m: Map<string, any>) { m.set("a", ${USER}.email) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a map held by a property of this", async () => {
      const input = await scan(
        `  const s = new Svc()\n  s.put(${USER}.email)\n  res.json(s.out())`,
        `class Svc { m = new Map<string, any>(); put(v: any) { this.m.set("a", v) } out() { return this.m.get("a") } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a store through a call result is data that went somewhere unseen", async () => {
      const input = await scan(
        `  make().set("k", ${USER}.email)`,
        `function make(): Map<string, any> { return new Map() }\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a store into a map another name may share is reported", async () => {
      const input = await scan(
        `  const m = new Map<string, any>()\n  const same = m\n  same.set("a", ${USER}.email)\n  res.json(m.get("a"))`,
      )
      expect(reasons(input)).toEqual(["unsupported-construct 5:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("chained sets on a new map store nowhere and lose nothing", async () => {
      const input = await scan(
        `  const m = new Map<string, any>().set("a", 1).set("b", ${USER}.email)\n  res.json(m.get("b"))`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("chained sets on a variable store into the variable at every link", async () => {
      const input = await scan(
        `  const m = new Map<string, any>()\n  m.set("a", ${USER}.email).set("b", ${USER}.name)\n  res.json(m.get("a"))`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })

    it("WeakMap behaves like Map", async () => {
      const input = await scan(
        `  const k = {}\n  const m = new WeakMap<object, any>()\n  m.set(k, ${USER}.email)\n  res.json(m.get(k))`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a method a Map does not have is not guessed", async () => {
      const input = await scan(
        `  const m = new Map<string, any>([["a", ${USER}.email]])\n  res.json((m as any).mystery())`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:12"])
    })

    it("a Map the project shadows is not the builtin", async () => {
      const input = await scan(
        `  const m = new Map(${USER}.email)\n  res.json(m)`,
        `class Map { constructor(public v: any) {} }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("Set and WeakSet", () => {
    it("items put in come out of iteration, values, keys and forEach", async () => {
      const input = await scan(
        `  const s = new Set<any>([${USER}.email])\n  res.json([...s][0])\n  for (const x of s.values()) res.json(x)\n  for (const y of s.keys()) res.json(y)\n  s.forEach((z) => res.json(z))`,
      )
      // One edge from the handler, one from the callback of forEach.
      expect(effects(input)).toEqual(["email|static", "email|static"])
    })

    it("add stores into the variable, and a Set made without items is empty", async () => {
      const input = await scan(
        `  const s = new Set<any>()\n  s.add(${USER}.email)\n  res.json([...s][0])\n  res.json([...new Set()][0])`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("entries are [item, item] pairs", async () => {
      const input = await scan(
        `  for (const [a, b] of new Set<any>([${USER}.email]).entries()) { res.json(a); res.json(b) }`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("has, delete and clear answer with nothing", async () => {
      const input = await scan(
        `  const s = new Set<any>([${USER}.email])\n  res.json(s.has("a"))\n  res.json(s.delete("a"))\n  res.json(s.clear())`,
      )
      expect(effects(input)).toEqual([])
    })

    it("union and symmetricDifference hold both sides; intersection and difference hold the left; the questions hold nothing", async () => {
      const left = `new Set<any>([${USER}.email])`
      const right = `new Set<any>([${USER}.name])`
      const cases: [string, string[]][] = [
        ["union", ["email|static", "name|static"]],
        ["symmetricDifference", ["email|static", "name|static"]],
        ["intersection", ["email|static"]],
        ["difference", ["email|static"]],
        ["isSubsetOf", []],
        ["isSupersetOf", []],
        ["isDisjointFrom", []],
      ]
      for (const [method, expected] of cases) {
        const input = await scan(
          `  const r: any = (${left} as any).${method}(${right})\n  res.json(r === true || r === false ? 0 : [...r][0])`,
        )
        expect(effects(input).sort(), method).toEqual(expected)
      }
    })

    it("a Set made from a Map holds its [key, value] pairs", async () => {
      const input = await scan(
        `  const s = new Set(new Map<string, any>([["a", ${USER}.email]]))\n  for (const [, v] of s) res.json(v)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("WeakSet behaves like Set", async () => {
      const input = await scan(
        `  const k = {}\n  const s = new WeakSet<object>()\n  s.add(k)\n  res.json(s.has(k))\n  void ${USER}.email`,
      )
      expect(effects(input)).toEqual([])
    })
  })

  describe("groupBy", () => {
    it("Map.groupBy keys the groups by what the callback returns", async () => {
      const input = await scan(
        `  const g = Map.groupBy([${USER}.email], (x: any) => ${USER}.role)\n  res.json(g.get("k"))\n  res.json([...g.keys()][0])`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "role|static"])
    })

    it("Object.groupBy reads every group under any key", async () => {
      const input = await scan(
        `  const g: any = Object.groupBy([${USER}.email], (x: any) => "k")\n  res.json(g.k)\n  res.json(g.other)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("the callback receives each item", async () => {
      const input = await scan(
        `  Object.groupBy([${USER}.email], (x: any) => { res.json(x); return "k" })`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a callback the scan cannot resolve is an unknown, as before", async () => {
      const input = await scan(
        `  Object.groupBy([${USER}.email], pick)`,
        `import { pick } from "some-lib";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })

    it("groupBy without a callback is an unknown too", async () => {
      const input = await scan(`  Object.groupBy([${USER}.email])`)
      expect(reasons(input)).toEqual(["unresolved-call 3:3"])
    })
  })

  describe("Promise", () => {
    it("resolve settles the promise when the executor is an arrow", async () => {
      const input = await scan(
        `  res.json(await new Promise((resolve) => resolve(${USER}.email)))`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("resolve settles the promise when the executor is a named function", async () => {
      const input = await scan(
        `  res.json(await new Promise(exec))`,
        `function exec(resolve: any) { resolve(${USER}.email) }\n`,
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("resolve settles the promise when a later callback calls it", async () => {
      const input = await scan(
        `  res.json(await new Promise((resolve) => { setTimeout(() => resolve(${USER}.email), 0) }))`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a value awaited before the callback that settles it ran is picked up by another round", async () => {
      const input = await scan(
        `  const p = new Promise<any>((resolve) => { later = () => resolve(${USER}.email) })\n  res.json(await p)`,
        `let later: () => void = () => {}\n`,
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("reject rejects, and what the executor throws rejects too", async () => {
      const input = await scan(
        `  new Promise((_, reject) => reject(${USER}.email)).catch((e) => res.json(e))\n  try { await new Promise(() => { throw ${USER}.name }) } catch (e) { res.json(e) }`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("a rejected promise is not a fulfilled one: then without a handler for it passes the rejection on", async () => {
      const input = await scan(
        `  new Promise((_, reject) => reject(${USER}.email)).then((v) => res.json(v))`,
      )
      expect(effects(input)).toEqual([])
    })

    it("two promises from one helper called with different data stay apart", async () => {
      const input = await scan(
        `  const a = wrap(${USER}.email)\n  const b = wrap(${USER}.name)\n  res.json(await a)`,
        `function wrap(v: any) { return new Promise<any>((resolve) => resolve(v)) }\n`,
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("resolving with another promise adopts what that one settles with", async () => {
      const input = await scan(
        `  res.json(await new Promise((resolve) => resolve(Promise.resolve(${USER}.email))))`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("an executor the scan cannot read is an unknown, and the promise holds what it was given", async () => {
      const input = await scan(
        `  res.json(await new Promise(lib.run(${USER}.email)))`,
        `import * as lib from "some-lib";\n`,
        "async ",
      )
      expect(reasons(input).map((r) => r.split(" ")[0])).toContain("unresolved-call")
      expect(effects(input)).toEqual(["email|inferred"])
    })

    it("resolve handed to code the scan cannot read, with tracked data, is an unknown", async () => {
      const input = await scan(
        `  await new Promise((resolve) => lib.once(${USER}.email, resolve))`,
        `import * as lib from "some-lib";\n`,
        "async ",
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:34"])
    })

    it("a promise held in a collection or an object is still settled when it is read back", async () => {
      const input = await scan(
        `  const m = new Map<string, any>()\n  m.set("a", new Promise((resolve) => resolve(${USER}.email)))\n  res.json(await m.get("a"))\n  const ps = { a: new Promise((resolve) => resolve(${USER}.name)) }\n  res.json(await Promise.all(Object.values(ps)))`,
        "",
        "async ",
      )
      // Object.values approximates what the object holds, and the promise settled with `name`.
      expect(effects(input)).toEqual(["email|static", "name|inferred"])
    })

    it("all gives the settled values as elements, and its rejection", async () => {
      const input = await scan(
        `  const [a] = await Promise.all([Promise.resolve(${USER}.email)])\n  res.json(a)\n  Promise.all([Promise.reject(${USER}.name)]).catch((e) => res.json(e))`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("allSettled gives value and reason objects", async () => {
      const input = await scan(
        `  const [r] = await Promise.allSettled([Promise.resolve(${USER}.email)]) as any[]\n  res.json(r.value)\n  res.json(r.reason)`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("race and any give the settled value", async () => {
      const input = await scan(
        `  res.json(await Promise.race([Promise.resolve(${USER}.email), 1]))\n  res.json(await Promise.any([Promise.resolve(${USER}.name)]))`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("for await takes the value of each promise", async () => {
      const input = await scan(
        `  for await (const x of [new Promise((resolve) => resolve(${USER}.email))]) res.json(x)`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a Promise the project shadows is not the builtin", async () => {
      const input = await scan(
        `  res.json(new Promise(${USER}.email).v)`,
        `class Promise { v: any; constructor(v: any) { this.v = v } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("Reflect", () => {
    it("get is a property read, with a literal or constant key; with another key it is the dynamic access that is reported", async () => {
      const input = await scan(
        `  const k = "email"\n  res.json(Reflect.get(${USER}, "email"))\n  res.json(Reflect.get(${USER}, k))\n  res.json(Reflect.get(${USER}, key))`,
      )
      // The constant and the literal key read the same field; the third key could be any.
      expect(effects(input)).toEqual(["email|static", "|inferred"])
      expect(reasons(input)).toEqual(["dynamic-access 6:12"])
    })

    it("set is a property store, with its aliasing and dynamic-key reports", async () => {
      const input = await scan(
        `  const o: any = {}\n  Reflect.set(o, "a", ${USER}.email)\n  res.json(o.a)\n  Reflect.set(o, key, ${USER}.name)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual(["dynamic-access 6:3"])
      const fresh = await scan(
        `  Reflect.set(make(), "a", ${USER}.email)`,
        `function make(): any { return {} }\n`,
      )
      expect(reasons(fresh)).toEqual(["unsupported-construct 4:3"])
    })

    it("apply calls the function with the elements of the list and the given receiver", async () => {
      const input = await scan(
        `  res.json(Reflect.apply(out, { v: ${USER}.email }, [${USER}.name]))`,
        `function out(this: any, w: any) { return [this.v, w] }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })

    it("apply on something the scan cannot call is an unknown", async () => {
      const input = await scan(
        `  Reflect.apply(lib.run, null, [${USER}.email])`,
        `import * as lib from "some-lib";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })

    it("construct makes an instance of a class or of a constructor function", async () => {
      const input = await scan(
        `  res.json(Reflect.construct(Box, [${USER}.email]).v)\n  res.json(Reflect.construct(Old, [${USER}.name]).w)`,
        `class Box { v: any; constructor(v: any) { this.v = v } }\nfunction Old(this: any, w: any) { this.w = w }\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("getOwnPropertyDescriptor holds the value read", async () => {
      const input = await scan(
        `  res.json(Reflect.getOwnPropertyDescriptor(${USER}, "email")?.value)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("defineProperty and setPrototypeOf change their target, getPrototypeOf gives an approximation", async () => {
      const input = await scan(
        `  const o: any = {}\n  Reflect.defineProperty(o, "a", { value: ${USER}.email })\n  res.json(o.a)\n  const p: any = { m: ${USER}.name }\n  const q: any = {}\n  Reflect.setPrototypeOf(q, p)\n  res.json(q.m)\n  res.json((Reflect.getPrototypeOf(p) as any).m)`,
      )
      // A property defined through a descriptor, and a prototype read back, are approximations.
      expect(effects(input)).toEqual(["email.a|inferred", "name|static", "name|inferred"])
    })

    it("has, deleteProperty, ownKeys and isExtensible answer with names and booleans", async () => {
      const input = await scan(
        `  res.json(Reflect.has(${USER}, "email"))\n  res.json(Reflect.ownKeys(${USER}))\n  res.json(Reflect.deleteProperty(${USER} as any, "email"))\n  res.json(Reflect.isExtensible(${USER}))`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("any other Reflect function is an unknown when it receives tracked data", async () => {
      const input = await scan(`  Reflect.preventExtensions(${USER} as any)`)
      expect(reasons(input)).toEqual(["unresolved-call 3:3"])
    })
  })

  describe("a JSON round trip, structuredClone, and Array.prototype methods called on something else", () => {
    it("JSON.parse(JSON.stringify(x)) is x: exact, and reading a field of it is a field read", async () => {
      const input = await scan(
        `  res.json(JSON.parse(JSON.stringify(${USER})).email)\n  res.json(JSON.parse(JSON.stringify({ v: ${USER}.name }, null, 2)).v)`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("JSON.parse of anything else is an approximation of its argument", async () => {
      const input = await scan(
        `  res.json(JSON.parse(\`\${${USER}.email}\`))\n  res.json(JSON.parse(JSON.parse(1 as any)))`,
      )
      expect(effects(input)).toEqual(["email|inferred"])
    })

    it("JSON.stringify alone is an approximation", async () => {
      const input = await scan(`  res.json(JSON.stringify(${USER}.email))`)
      expect(effects(input)).toEqual(["email|inferred"])
    })

    it("structuredClone is exact", async () => {
      const input = await scan(`  res.json(structuredClone(${USER}.email))`)
      expect(effects(input)).toEqual(["email|static"])
    })

    it("Array.prototype.map.call runs the callback on the elements of its first argument", async () => {
      const input = await scan(
        `  res.json(Array.prototype.map.call([${USER}.email], (x: any) => x)[0])\n  res.json([].map.call([${USER}.name], (x: any) => x)[0])`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("Array.prototype.push.call stores into the array it names", async () => {
      const input = await scan(
        `  const a: any[] = []\n  Array.prototype.push.call(a, ${USER}.email)\n  res.json(a[0])`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("Object.prototype.hasOwnProperty.call answers with a boolean", async () => {
      const input = await scan(
        `  res.json(Object.prototype.hasOwnProperty.call(${USER}, "email"))\n  res.json(String.prototype.toUpperCase.call(${USER}.name))`,
      )
      expect(effects(input)).toEqual(["name|inferred"])
    })

    it("a prototype the project shadows is not the builtin one", async () => {
      const input = await scan(
        `  res.json(Array.prototype.map.call([${USER}.email], (x: any) => x))`,
        `const Array: any = { prototype: { map: { call: (a: any, f: any) => f } } }\n`,
      )
      expect(reasons(input)).toEqual([])
    })
  })

  describe("bind", () => {
    it("fixes leading arguments and the receiver", async () => {
      const input = await scan(
        `  res.json(add.bind(null, ${USER}.email)(1))\n  res.json(out.bind({ v: ${USER}.name })())`,
        `function add(a: any, b: any) { return a }\nfunction out(this: any) { return this.v }\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("a function bound twice keeps the first receiver and both sets of arguments", async () => {
      const input = await scan(
        `  const once = pair.bind({ w: ${USER}.id }, ${USER}.email)\n  const twice = once.bind({ w: ${USER}.name }, ${USER}.role)\n  res.json(twice())`,
        `function pair(this: any, a: any, b: any) { return [this.w, a, b] }\n`,
      )
      expect(new Set(effects(input))).toEqual(new Set(["id|static", "email|static", "role|static"]))
    })

    it("a bound function is called by call, apply and as a callback", async () => {
      const input = await scan(
        `  const f = show.bind(null, res)\n  f.call(null, ${USER}.email)\n  f.apply(null, [${USER}.name])\n  ;[${USER}.id].forEach(f)\n  ;[${USER}.role].forEach(show.bind(null, res))`,
        `function show(res: any, v: any) { res.json(v) }\n`,
      )
      expect(new Set(effects(input))).toEqual(
        new Set(["email|static", "name|static", "id|static", "role|static"]),
      )
    })

    it("a bound function that leaves the program takes what it fixed with it", async () => {
      const input = await scan(
        `  lib.run(show.bind(null, ${USER}.email))`,
        `import * as lib from "some-lib";\nfunction show(v: any) { console.log(v) }\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 5:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("bind on a capability method is still the method", async () => {
      const input = await scan(
        `  res.json(userData.getSnapshot.bind(userData)().fields.user.email)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("bind on a function the scan cannot read is an unknown, as before", async () => {
      const input = await scan(
        `  lib.run.bind(null, ${USER}.email)()`,
        `import * as lib from "some-lib";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })
  })

  describe("keys that are constants", () => {
    it("a const initialized with a string stands for that key in reads, stores and method calls", async () => {
      const input = await scan(
        `  const k = "email"\n  res.json(${USER}[k])\n  const o: any = {}\n  o[k] = ${USER}.name\n  res.json(o.email)\n  const m = "m"\n  const t = { m(v: any) { return v } }\n  res.json(t[m](${USER}.id))`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static", "id|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a constant that is copied to another const is the same key", async () => {
      const input = await scan(`  const a = "email"\n  const b = a\n  res.json(${USER}[b])`)
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a let, a parameter, a reassigned name and a shadowing name are not constants", async () => {
      for (const body of [
        `let k = "email"\n  res.json(${USER}[k])`,
        `res.json(${USER}[key])`,
        `const k = "email"\n  { const k = key; res.json(${USER}[k]) }`,
        `var k = "email"\n  res.json(${USER}[k])`,
      ]) {
        const input = await scan(`  ${body}`)
        expect(
          reasons(input).map((r) => r.split(" ")[0]),
          body,
        ).toEqual(["dynamic-access"])
      }
    })

    it("a constant read inside a closure is the constant of the scope that declares it", async () => {
      const input = await scan(
        `  const k = "email"\n  const read = () => ${USER}[k]\n  res.json(read())`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a constant number or template without substitutions", async () => {
      const input = await scan(
        "  const k = `email`\n  res.json(" + USER + "[k])\n  res.json([" + USER + ".name][0])",
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })
  })
})
