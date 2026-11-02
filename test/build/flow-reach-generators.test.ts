import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { USER } from "./mut-flow-scan-harness.js"
import {
  effects,
  facts,
  handler,
  makeHarness,
  reasons,
  unknownData,
} from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * Reach of the flow pass over generators and iteration (ADR 0070): what `yield` and `yield*` hand out flows to the
 * variable of `for...of` / `for await...of`, to spreads and array patterns, and to `next().value`.
 */
describe("flow-reach: generators and iteration", () => {
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

  describe("consuming a generator", () => {
    const gen = `function* gen(v: any) { yield v }\n`

    it("`for...of` binds each yielded value, and the data is passed through the generator's return node", async () => {
      const input = await scan(`  for (const x of gen(${USER}.email)) console.log(x)`, gen)
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
      expect(facts(input)).toMatchInlineSnapshot(`
        [
          "E calls function:app/p.ts#h->function:app/p.ts#gen p=- static o= h= @app/p.ts:4:19",
          "E passes function:app/p.ts#h->parameter:app/p.ts#gen.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:19",
          "E returns function:app/p.ts#gen->return:app/p.ts#gen#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25",
          "E passes return:app/p.ts#gen#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3",
          "E side-effect function:app/p.ts#h->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:66",
        ]
      `)
    })

    it("spread, array destructuring and Array.from take the yielded values", async () => {
      const input = await scan(
        `  console.log([...gen(${USER}.email)])\n  const [a] = gen(${USER}.name)\n  console.log(a)\n  console.log(Array.from(gen(${USER}.id))[0])`,
        gen,
      )
      expect(effects(input).sort()).toEqual(["email|static", "id|inferred", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("spread arguments take the yielded values as arguments", async () => {
      const input = await scan(
        `  show(...gen(${USER}.email))`,
        `${gen}function show(v: any) { console.log(v) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("`next().value` is what was yielded, and `done` carries nothing", async () => {
      const input = await scan(
        `  const it = gen(${USER}.email)\n  const r = it.next()\n  console.log(r.value)\n  console.log(r.done)`,
        gen,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a value sent into a project generator through next(x) is the result of the yield it is stopped at", async () => {
      const input = await scan(
        `  const it: any = gen2()\n  it.next()\n  it.next(${USER}.email)`,
        `function* gen2(): any { const x = yield 1; console.log(x) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
      expect(facts(input)).toMatchInlineSnapshot(`
        [
          "E calls function:app/p.ts#h->function:app/p.ts#gen2 p=- static o= h= @app/p.ts:4:19",
          "E passes function:app/p.ts#h->parameter:app/p.ts#gen2.arg0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3",
          "E side-effect function:app/p.ts#gen2->boundary:boundary:code#console p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:44",
        ]
      `)
    })

    it("a value sent in is followed through every yield, and out again as a yielded value", async () => {
      const input = await scan(
        `  const it: any = echo()\n  it.next()\n  console.log(it.next(${USER}.email).value)`,
        `function* echo(): any { const x = yield 0; yield x }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("two evaluations of a generator are told apart by what they were called with", async () => {
      const input = await scan(
        `  const a: any = pass(1)\n  a.next()\n  a.next(${USER}.email)\n  const b: any = pass(2)\n  b.next()\n  b.next(${USER}.name)`,
        `function* pass(n: number): any { const x = yield n; if (n === 1) console.log(x) }\n`,
      )
      expect(effects(input)).toEqual(["email|static", "name|static"])
    })

    it("a value sent into a generator the project does not define is reported, not followed", async () => {
      const input = await scan(
        `  const it: any = makeGen()\n  it.next()\n  it.next(${USER}.email)`,
        `import { makeGen } from "some-lib";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 6:3"])
      expect(unknownData(input)).toEqual([["email"]])
      expect(input.unknowns[0]?.detail).toBe("call target is not a project function")
    })

    it("a value sent into an iterator whose generator is not known is reported, not followed", async () => {
      const input = await scan(`  const it: any = [1]\n  it.next(${USER}.email)`)
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
      expect(input.unknowns[0]?.detail).toBe("value sent into a generator is not followed")
    })

    it("a value sent in after the yield was analyzed is picked up by another round", async () => {
      const input = await scan(
        `  feed()`,
        `const holder: any = { it: undefined }\nfunction* gen3(): any { const x = yield 0; console.log(x) }\nfunction start() { holder.it = gen3(); holder.it.next() }\nfunction feed() { start(); holder.it.next(${USER}.email) }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a yielded object keeps its shape: each property is read as before", async () => {
      const input = await scan(
        `  for (const x of objs(${USER}.email, ${USER}.name)) console.log(x.a)`,
        `function* objs(a: any, b: any) { yield { a, b } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a generator that is never consumed sends nothing anywhere", async () => {
      const input = await scan(`  gen(${USER}.email)`, gen)
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("a `return` in the generator is reachable through next().value as well", async () => {
      const input = await scan(
        `  console.log(gen3(${USER}.email).next().value)`,
        `function* gen3(v: any) { return v }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("delegating and nesting", () => {
    it("`yield*` of another generator, of an array, and of a recursive call hands everything on", async () => {
      const input = await scan(
        `  for (const x of outer(${USER}.email, ${USER}.name)) console.log(x)`,
        `function* inner(v: any) { yield v }\nfunction* outer(a: any, b: any) { yield* inner(a); yield* [b] }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("`yield*` of something the scan cannot read is an unresolved call", async () => {
      const input = await scan(
        `  for (const x of outer(${USER}.email)) console.log(x)`,
        `function* outer(a: any) { yield* external(a) }\ndeclare function external(v: any): any\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 2:34"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a generator method of a class or of an object literal is a generator", async () => {
      const input = await scan(
        `  for (const x of new S().items(${USER}.email)) console.log(x)\n  for (const y of o.items(${USER}.name)) console.log(y)`,
        `class S { *items(v: any) { yield v } }\nconst o = { *items(v: any) { yield v } }\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an object with a [Symbol.iterator] generator is iterable", async () => {
      const input = await scan(
        `  for (const x of bag(${USER}.email)) console.log(x)`,
        `function bag(v: any) { return { *[Symbol.iterator]() { yield v } } }\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("asynchronous iteration", () => {
    it("`for await...of` over an async generator binds each yielded value", async () => {
      const input = await scan(
        `  for await (const x of agen(${USER}.email)) console.log(x)`,
        `async function* agen(v: any) { yield v }\n`,
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("`for await...of` over an array of promises binds what they hold", async () => {
      const input = await scan(
        `  for await (const x of [Promise.resolve(${USER}.email)]) console.log(x)`,
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("an object with a [Symbol.asyncIterator] generator is async-iterable", async () => {
      const input = await scan(
        `  for await (const x of bag(${USER}.email)) console.log(x)`,
        `function bag(v: any) { return { async *[Symbol.asyncIterator]() { yield v } } }\n`,
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("iteration over ordinary values", () => {
    it("`for...of` over an array of tracked data binds the elements, and `for...in` binds only keys", async () => {
      const input = await scan(
        `  for (const x of [${USER}.email]) console.log(x)\n  for (const k in ${USER}) console.log(k)`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a destructuring `for...of` target and an assignment target are bound too", async () => {
      const input = await scan(
        `  let a: any\n  for (a of [${USER}.email]) console.log(a)\n  for (const [b] of [[${USER}.name]]) console.log(b)`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })

    it("iteration variables are not shared with another name of the same object", async () => {
      const input = await scan(
        `  const items: any[] = [{}]\n  for (const item of items) item.v = ${USER}.email`,
      )
      expect(reasons(input)).toEqual(["unsupported-construct 4:29"])
      expect(unknownData(input)).toEqual([["email"]])
    })
  })
})
