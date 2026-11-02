import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CAP_FILE, capability, inventoryOf, USER } from "./mut-flow-scan-harness.js"
import {
  effects,
  fieldId,
  handler,
  makeHarness,
  reasonNames,
  reasons,
  unknownData,
} from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * Forms that used to make the flow pass go quietly safe: tracked data entered them and no edge, no unknown and no
 * incomplete trace came out. Each test names the form and pins both what is followed and what is reported. (ADR 0071:
 * what the scan cannot follow is an explicit unknown, never a smaller graph that looks complete.)
 */
describe("flow-reach: forms that must never go silently safe", () => {
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
        "app/p.ts":
          keyword === ""
            ? source
            : source.replace("export function h", `export ${keyword}function h`),
      })
    ).input
  }

  describe("scopes and names", () => {
    it("a block-scoped name shadows an outer one only inside its block", async () => {
      const input = await scan(
        `  const v = ${USER}.email\n  { const v = 1; console.log(v) }\n  res.json(v)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("`var` inside a block belongs to the function, `let` and `const` do not leave the block", async () => {
      const input = await scan(
        `  if (key) { var x = ${USER}.email; let y = ${USER}.name; void y }\n  res.json(x)\n  res.json(typeof y === "undefined" ? 1 : y)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a catch variable, a switch case and a loop variable are scoped to their blocks", async () => {
      const input = await scan(
        `  const v = ${USER}.email\n  try { throw 1 } catch (v) { console.log(v) }\n  switch (key) { case "a": { const v = 2; console.log(v) } }\n  for (const v of [3]) console.log(v)\n  res.json(v)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a function declared after the statement that calls it is already usable there", async () => {
      const input = await scan(
        `  res.json(helper(${USER}.email))\n  function helper(v: any) { return v }`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a named function expression can call itself by its name", async () => {
      const input = await scan(
        `  const f = function loop(n: number, v: any): any { return n > 0 ? loop(n - 1, v) : v }\n  res.json(f(2, ${USER}.email))`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a closure made twice from the same code keeps what each evaluation captured", async () => {
      const input = await scan(
        `  const a = mk(${USER}.id)\n  const b = mk(${USER}.name)\n  res.json(a())\n  res.json(b())`,
        `const mk = (v: any) => () => v\n`,
      )
      expect(effects(input)).toEqual(["id|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("arguments is the array of the arguments of a non-arrow function", async () => {
      const input = await scan(
        `  res.json(first(${USER}.email, ${USER}.name))`,
        `function first() { return arguments[0] }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })

    it("an undeclared name is a global that any function sees", async () => {
      const input = await scan(
        `  res.json(shared)`,
        `export function put() { shared = ${USER}.email }\ndeclare let shared: any\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("operators and expressions", () => {
    it("the comma operator yields its right operand", async () => {
      const input = await scan(`  res.json((0, ${USER}.email))`)
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a type assertion with angle brackets, and a non-null assertion, are transparent", async () => {
      const input = await scan(
        `  res.json(${USER}.email!)\n  res.json((${USER}.name satisfies any) as any)`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("-x, +x and ~x are approximate copies of x, and !x, ++x and typeof x carry nothing", async () => {
      const input = await scan(
        `  res.json(-${USER}.id)\n  res.json(+${USER}.name)\n  res.json(~${USER}.email)\n  res.json(!${USER}.role)\n  res.json(typeof ${USER}.passwordHash)`,
      )
      expect(effects(input)).toEqual(["id|inferred", "name|inferred", "email|inferred"])
    })

    it("bitwise operators merge both sides approximately, comparisons carry nothing", async () => {
      const input = await scan(
        `  res.json(${USER}.id | ${USER}.name)\n  res.json(${USER}.email === "x")`,
      )
      expect(effects(input)).toEqual(["id|inferred", "name|inferred"])
    })

    it("a destructuring assignment binds its targets, with defaults and nesting", async () => {
      const input = await scan(
        `  let a: any, b: any, c: any\n  ;({ email: a, name: b = "x", role: { c } = ${USER}.id } = ${USER})\n  ;[c] = [${USER}.passwordHash]\n  res.json(a)\n  res.json(b)\n  res.json(c)`,
      )
      expect(effects(input).sort()).toEqual(
        [
          "email|static",
          "id.c|static",
          "name|static",
          "passwordHash|static",
          "role.c|static",
        ].sort(),
      )
    })

    it("a tagged template calls its tag with the substituted values", async () => {
      const input = await scan(
        `  res.json(tag\`x \${${USER}.email}\`)\n  res.json(String.raw\`y \${${USER}.name}\`)`,
        `const tag = (s: any, v: any) => v\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|inferred"])
      expect(reasons(input)).toEqual([])
    })

    it("a tag the scan cannot read is an unresolved call", async () => {
      const input = await scan(`  sql\`insert \${${USER}.email}\``, `declare const sql: any\n`)
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("an object stored in a literal can be called as a method, with this", async () => {
      const input = await scan(
        `  const o = { v: ${USER}.email, m() { return this.v }, arrow: (x: any) => x }\n  res.json(o.m())\n  res.json(o.arrow(${USER}.name))`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a spread argument gives every parameter from its position an element", async () => {
      const input = await scan(
        `  res.json(second(...[${USER}.email]))`,
        `function second(a: any, b: any) { return b }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("fn.call, fn.apply and fn.bind call a project function", async () => {
      const input = await scan(
        `  res.json(id.call(null, ${USER}.email))\n  res.json(id.apply(null, [${USER}.name]))\n  res.json(id.bind(null, ${USER}.id)())`,
        `function id(v: any) { return v }\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static", "id|static"])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("exceptions and promises", () => {
    it("a thrown value reaches the catch clause, directly and through a call", async () => {
      const input = await scan(
        `  try { throw ${USER}.email } catch (e) { res.json(e) }\n  try { thrower(${USER}.name) } catch (e) { res.json(e) }`,
        `function thrower(v: any) { throw v }\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("what a try block threw is caught, and only what the handler throws goes on", async () => {
      const input = await scan(
        `  try {\n    try { throw ${USER}.email } catch (e) { void e }\n  } catch (outer) {\n    res.json(outer)\n  }`,
      )
      expect(effects(input)).toEqual([])
    })

    it("a rejected promise reaches await in a try, `.catch` and the second argument of `.then`", async () => {
      const input = await scan(
        `  try { await Promise.reject(${USER}.email) } catch (e) { res.json(e) }\n  Promise.reject(${USER}.name).catch((e: any) => res.json(e))\n  Promise.reject(${USER}.id).then(() => 1, (e: any) => res.json(e))`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static", "name|static", "id|static"])
    })

    it("a promise that was not rejected gives `.catch` nothing, and `.finally` never gets the value", async () => {
      const input = await scan(
        `  Promise.resolve(${USER}.email).catch((e: any) => res.json(e))\n  Promise.resolve(${USER}.name).finally(() => res.json(1))`,
      )
      expect(effects(input)).toEqual([])
    })

    it("`.catch` can recover: the promise it returns holds what its callback returned", async () => {
      const input = await scan(
        `  res.json(await Promise.reject(1).catch(() => ${USER}.email))`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("an async function that throws rejects the promise it returned", async () => {
      const input = await scan(
        `  try { await fail(${USER}.email) } catch (e) { res.json(e) }`,
        `async function fail(v: any) { throw v }\n`,
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("objects and arrays that are filled in elsewhere", () => {
    it("a store through a member chain is kept under the variable the chain starts from", async () => {
      const input = await scan(
        `  const o: any = { inner: {} }\n  o.inner.x = ${USER}.email\n  res.json(o.inner.x)\n  res.json(o.inner.other)`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a store under a computed key is kept, and reported because it cannot be read back by name", async () => {
      const input = await scan(`  const o: any = {}\n  o[key] = ${USER}.email\n  res.json(o.email)`)
      expect(reasons(input)).toEqual(["dynamic-access 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
      expect(input.unknowns[0]?.detail).toBe("computed property key on a store of tracked data")
    })

    it("a store into something that is not a variable is reported", async () => {
      const input = await scan(
        `  make().v = ${USER}.email\n  Object.assign(make(), { w: ${USER}.name })\n  make().push(${USER}.id)`,
        `function make(): any { return {} }\n`,
      )
      expect(reasonNames(input)).toEqual([
        "unsupported-construct",
        "unsupported-construct",
        "unresolved-call",
      ])
      expect(unknownData(input)).toEqual([["email"], ["name"], ["id"]])
    })

    it("a function that fills in the object it was given fills in the caller's object", async () => {
      const input = await scan(
        `  const o: any = {}\n  fill(o)\n  res.json(o.v)`,
        `function fill(o: any) { o.v = ${USER}.email }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a method that fills in this fills in the receiver, also when the receiver is an argument of another call", async () => {
      const input = await scan(
        `  const s = new S()\n  put(s, ${USER}.email)\n  res.json(s.v)`,
        `class S { v: any; set(v: any) { this.v = v } }\nfunction put(s: any, v: any) { s.set(v) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an object another name may share, filled in by a call or a store, is reported", async () => {
      const input = await scan(
        `  const o: any = {}\n  const alias = o\n  alias.v = ${USER}.email\n  fill(alias)\n  for (const item of [o]) item.w = ${USER}.name\n  res.json(o.v)`,
        `function fill(o: any) { o.x = ${USER}.id }\n`,
      )
      expect(reasonNames(input)).toEqual([
        "unsupported-construct",
        "unsupported-construct",
        "unsupported-construct",
      ])
      expect(unknownData(input)).toEqual([["email"], ["email", "id"], ["name"]])
    })

    it("data stored on an object a caller outside the project owns is reported, once a caller inside the project is gone", async () => {
      const input = await scan(`  res.user = ${USER}.email\n  res.list.push(${USER}.name)`)
      expect(reasonNames(input)).toEqual(["unsupported-construct", "unsupported-construct"])
      expect(unknownData(input)).toEqual([["email"], ["name"]])
      expect(input.unknowns[0]?.detail).toBe("tracked data stored on an object the caller owns")
    })

    it("data stored on a parameter of a function that only analyzed code calls is not reported: the caller's object is written back", async () => {
      const input = await scan(
        `  const req: any = {}\n  setUser(req)\n  res.json(req.user)`,
        `function setUser(req: any) { req.user = ${USER}.email }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("data stored on a parameter of an exported function stays reported even when analyzed code calls it", async () => {
      const input = await scan(
        `  setUser({})`,
        `export function setUser(req: any) { req.user = ${USER}.email }\n`,
      )
      expect(reasonNames(input)).toEqual(["unsupported-construct"])
    })

    it("module state written by a function analyzed after the reader is still seen by the reader", async () => {
      const input = await scan(
        `  put()`,
        `const store: any = {}\nexport function read(res: any) { res.json(store.v) }\nfunction put() { store.v = ${USER}.email }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an object exported by another module is filled in in that module, also through a namespace import", async () => {
      const input = (
        await h.scan({
          "app/store.ts": `export const store: any = {}\nexport const other: any = {}\n`,
          "app/w.ts": `import { userData } from "../features/user/user.js";\nimport { store } from "./store.js";\nimport * as ns from "./store.js";\nexport function put() { store.v = userData.getSnapshot().fields.user.email; ns.other.w = userData.getSnapshot().fields.user.name }\n`,
          "app/r.ts": `import { store, other } from "./store.js";\nexport function get(res: any) { res.json(store.v); res.json(other.w) }\n`,
        })
      ).input
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("globalThis keeps what any function stores on it", async () => {
      const input = await scan(
        `  res.json((globalThis as any).leak)`,
        `export function put() { (globalThis as any).leak = ${USER}.email }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("closures nothing calls", () => {
    it("a closure that returns tracked data and is never called is handed to code the scan cannot see", async () => {
      const input = await scan(`  const app: any = res\n  app.get("/x", () => ${USER}.email)`)
      expect(reasons(input)).toEqual(["unanalyzed-function 4:17"])
      expect(unknownData(input)).toEqual([["email"]])
      expect(input.unknowns[0]?.detail).toBe(
        "closure returns tracked data but nothing in the project calls it",
      )
    })

    it("a closure that analyzed code does call is not reported", async () => {
      const input = await scan(`  const get = () => ${USER}.email\n  res.json(get())`)
      expect(reasons(input)).toEqual([])
    })

    it("an unresolved call through a parameter is dropped when analyzed code calls the function, and kept for an exported one", async () => {
      const dropped = await scan(
        `  use({ send: (v: any) => console.log(v) }, ${USER}.email)`,
        `function use(client: any, v: any) { client.send(v) }\n`,
      )
      expect(reasons(dropped)).toEqual([])
      expect(effects(dropped)).toEqual(["email|static"])
      const kept = await scan(
        `  use({ send: (v: any) => console.log(v) }, ${USER}.email)`,
        `export function use(client: any, v: any) { client.send(${USER}.name) }\n`,
      )
      expect(reasons(kept)).toEqual(["unresolved-call 2:44"])
    })
  })

  describe("callbacks the scan cannot resolve", () => {
    it("forEach and the predicate methods report a callback they cannot resolve, and not a literal or Boolean", async () => {
      const input = await scan(
        `  const a: any[] = [${USER}.email]\n  a.forEach(unknownFn)\n  a.some(Boolean)\n  a.every(1 as any)\n  a.filter(unknownFn)`,
        `declare const unknownFn: any\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 5:3", "unresolved-call 8:3"])
      expect(unknownData(input)).toEqual([["email"], ["email"]])
    })

    it("find, findLast and at give one element of an array whose elements are known", async () => {
      const input = await scan(
        `  res.json([${USER}.email].find((x: any) => x))\n  res.json([${USER}.name].at(0))\n  res.json([${USER}.id].findLast((x: any) => x))`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static", "id|static"])
    })

    it("Object.values and Object.entries are arrays, fromEntries is dynamic, groupBy has run-time keys", async () => {
      const input = await scan(
        `  res.json(Object.values({ v: ${USER}.email })[0])\n  res.json(Object.entries({ w: ${USER}.name })[0][0])\n  res.json(Object.fromEntries([["k", ${USER}.id]]).k)\n  res.json(Object.groupBy([${USER}.role], (x: any) => x).g)`,
      )
      expect(effects(input)).toEqual([
        "email|inferred",
        "name|inferred",
        "id.k|inferred",
        "role|static",
      ])
      expect(reasons(input)).toEqual([])
    })

    it("Object.assign and Object.defineProperty change their first argument", async () => {
      const input = await scan(
        `  const o: any = {}\n  Object.assign(o, { a: ${USER}.email })\n  Object.defineProperty(o, "b", { value: ${USER}.name })\n  res.json(o.a)\n  res.json(o.b)`,
      )
      expect(effects(input)).toEqual(["email|static", "name.a|inferred", "name.b|inferred"])
      expect(reasons(input)).toEqual([])
    })

    it("push, unshift, splice and fill put their arguments into the array they are called on, also behind a member", async () => {
      const input = await scan(
        `  const a: any[] = []\n  a.push(${USER}.email)\n  a.splice(0, 0, ${USER}.name)\n  a.fill(${USER}.id)\n  const o: any = { list: [] }\n  o.list.unshift(${USER}.role)\n  res.json(a[0])\n  res.json(o.list[0])`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static", "id|static", "role|static"])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("statements that hold code", () => {
    it("a with statement over tracked data cannot be resolved", async () => {
      const input = await scan(`  with (${USER}) { res.json(email) }`)
      expect(reasons(input)).toEqual(["unsupported-construct 3:3"])
      expect(unknownData(input)).toEqual([[""]])
    })

    it("a function inside a namespace is analyzed like any other, and its exports are not the file's", async () => {
      const input = await scan(
        `  return`,
        `namespace N { export function leak(res: any) { res.json(${USER}.email) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("an enum member initializer is evaluated", async () => {
      const input = await scan(`  return`, `enum E { A = console.log(${USER}.email) as any }\n`)
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("the capability itself", () => {
    const fields = ["user", "team", "tags", "empty"]

    /** The origins of the data that reached each distinct sink, in order of sink. */
    const perSink = async (body: string): Promise<string[][]> => {
      const input = (await h.scanDistinct(handler(body))).input
      const byBoundary = new Map<string, string[]>()
      for (const edge of input.edges.filter((candidate) => candidate.kind === "side-effect"))
        byBoundary.set(edge.to, [
          ...(byBoundary.get(edge.to) ?? []),
          `${edge.origin}|${(edge.path ?? []).join(".")}|${edge.status}`,
        ])
      return [...byBoundary.values()]
    }
    const everyField = fields.map((name) => `${fieldId(name)}||static`)

    it("the whole snapshot, or its fields object, sent to a boundary takes every field with it", async () => {
      expect(
        await perSink(
          `  res.json(userData.getSnapshot())\n  res.json(userData.getSnapshot().fields)`,
        ),
      ).toEqual([everyField, everyField])
    })

    it("the whole fields object given to code the scan cannot read is an unresolved call that carries every field", async () => {
      const input = await scan(
        `  audit(userData.getSnapshot().fields)\n  audit(userData)`,
        `declare const audit: any\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3", "unresolved-call 5:3"])
      expect(unknownData(input)).toEqual([
        ["", "", "", ""],
        ["", "", "", ""],
      ])
    })

    it("a computed key on the fields object follows every field approximately and is a dynamic-access unknown", async () => {
      const input = await scan(`  res.json(userData.getSnapshot().fields[key])`)
      const sent = input.edges.filter((edge) => edge.kind === "side-effect")
      expect(sent.map((edge) => [edge.origin, edge.status])).toEqual(
        fields.map((name) => [fieldId(name), "inferred"]),
      )
      expect(reasons(input)).toEqual(["dynamic-access 3:12"])
      expect(unknownData(input)).toEqual([["", "", "", ""]])
    })

    it("Object.values, spread, a computed destructuring key, template strings and JSON round trips of the fields object take every field", async () => {
      expect(
        await perSink(
          `  res.json(Object.values(userData.getSnapshot().fields))\n  res.json({ ...userData.getSnapshot().fields })\n  const { [key]: v } = userData.getSnapshot().fields\n  res.json(v)\n  res.json(JSON.stringify(userData.getSnapshot()))`,
        ),
      ).toEqual([
        fields.map((name) => `${fieldId(name)}||inferred`),
        everyField,
        fields.map((name) => `${fieldId(name)}||inferred`),
        fields.map((name) => `${fieldId(name)}||inferred`),
      ])
    })

    it("a capability method read without being called is still that method, also bound or called through .call", async () => {
      const input = await scan(
        `  const { getSnapshot } = userData\n  const read = userData.getSnapshot\n  const bound = userData.getSnapshot.bind(userData)\n  res.json(getSnapshot().fields.user.email)\n  res.json(read().fields.user.name)\n  res.json(bound().fields.user.id)\n  res.json(userData.getSnapshot.call(userData).fields.user.role)`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static", "id|static", "role|static"])
      expect(reasons(input)).toEqual([])
    })

    it("the capability passed to a project function, or reached through a namespace import, is the capability", async () => {
      const input = (
        await h.scan({
          "app/p.ts": `import * as caps from "../features/user/user.js";\nimport { userData } from "../features/user/user.js";\nfunction read(c: any) { return c.getSnapshot().fields.user.email }\nexport function h(res: any) { res.json(read(userData)); res.json(caps.userData.getSnapshot().fields.user.name) }\n`,
        })
      ).input
      expect(effects(input)).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an inventory entry written ./features/... is the capability at features/..., and its nodes use the normal path", async () => {
      const input = (
        await h.scan(
          handler(`  res.json(${USER}.email)`),
          {},
          inventoryOf(capability({ file: `./${CAP_FILE}` })),
        )
      ).input
      expect(effects(input)).toEqual(["email|static"])
      expect(
        input.nodes
          .filter((node) => node.kind === "field")
          .every((node) => node.scope === CAP_FILE),
      ).toBe(true)
    })
  })

  describe("sinks named through a member", () => {
    it("`this.logger.info(x)` and `ctx.res.json(x)` are the sinks logger.info and res.json", async () => {
      const input = await scan(
        `  new S().run(${USER}.email)\n  ctx.res.json(${USER}.name)`,
        `declare const ctx: any\nclass S { logger: any; run(v: any) { this.logger.info(v) } }\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
      expect(
        input.nodes.filter((node) => node.kind === "boundary").map((node) => node.name),
      ).toEqual(["logger", "http-response"])
    })
  })
})
