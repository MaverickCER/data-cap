import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { dump, IMPORT_CAP, makeHarness, probes, USER } from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

const TAGS = "userData.getSnapshot().fields.tags"

describe("flow-scan: remaining behaviours", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const run = async (bodies: readonly string[], extra = ""): Promise<string> =>
    dump((await h.scanDistinct(probes(bodies, extra))).input)
      .filter((line) => !line.startsWith("N field") && !line.startsWith("E discards"))
      .join("\n")

  it("a method stored on an object literal is a function value when read back", async () => {
    expect(
      await run([
        `  const o = { m(v: any) { return v.id } }\n  const f = o.m\n  res.json(f(${USER}))`,
        `  const o = { [key](v: any) { return v.name } }\n  const f = o.undefined\n  res.json(f(${USER}))`,
      ]),
    ).toMatchInlineSnapshot(`
      "N function app/p.ts p0 static bk= cl= src=2:1
      N function app/p.ts p0>m@3:15 static bk= cl= src=3:15
      N parameter app/p.ts p0>m@3:15.v static bk= cl= src=
      N return app/p.ts p0>m@3:15#return static bk= cl= src=
      N boundary boundary:code b0 static bk=log cl= src=
      N function app/p.ts p1 static bk= cl= src=7:1
      N boundary boundary:code b1 static bk=log cl= src=
      N parameter app/p.ts p0.res static bk= cl= src=
      N parameter app/p.ts p0.key static bk= cl= src=
      N return app/p.ts p0#return static bk= cl= src=
      N parameter app/p.ts p1.res static bk= cl= src=
      N parameter app/p.ts p1.key static bk= cl= src=
      N return app/p.ts p1#return static bk= cl= src=
      N function app/p.ts p1>anonymous@8:15 static bk= cl= src=8:15
      N parameter app/p.ts p1>anonymous@8:15.v static bk= cl= src=
      N return app/p.ts p1>anonymous@8:15#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
      E calls function:app/p.ts#p0->function:app/p.ts#p0>m@3:15 p=- static o= h= @app/p.ts:5:11
      E passes function:app/p.ts#p0->parameter:app/p.ts#p0>m@3:15.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
      E reads parameter:app/p.ts#p0>m@3:15.v->function:app/p.ts#p0>m@3:15 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:34
      E returns function:app/p.ts#p0>m@3:15->return:app/p.ts#p0>m@3:15#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
      E passes return:app/p.ts#p0>m@3:15#return->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:13
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E side-effect function:app/p.ts#p1->boundary:boundary:code#b1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      U unresolved-call app/p.ts:10:11 subject=function:app/p.ts#p1 detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
    `)
  })

  it("a catch callback contributes its return value, a finally callback does not", async () => {
    expect(
      await run([
        `  const p: any = ${USER}.id\n  res.json(p.catch(() => ${USER}.name))`,
        `  const p: any = ${USER}.id\n  res.json(p.finally(() => ${USER}.email))`,
        `  const p: any = ${USER}.id\n  res.json(p.then(() => ${USER}.role))`,
      ]),
    ).toMatchInlineSnapshot(`
      "N function app/p.ts p0 static bk= cl= src=2:1
      N function app/p.ts p0>anonymous@4:19 static bk= cl= src=4:19
      N return app/p.ts p0>anonymous@4:19#return static bk= cl= src=
      N boundary boundary:code b0 static bk=log cl= src=
      N function app/p.ts p1 static bk= cl= src=6:1
      N function app/p.ts p1>anonymous@8:21 static bk= cl= src=8:21
      N return app/p.ts p1>anonymous@8:21#return static bk= cl= src=
      N boundary boundary:code b1 static bk=log cl= src=
      N function app/p.ts p2 static bk= cl= src=10:1
      N function app/p.ts p2>anonymous@12:18 static bk= cl= src=12:18
      N parameter app/p.ts p2>anonymous@12:18.arg0 static bk= cl= src=
      N return app/p.ts p2>anonymous@12:18#return static bk= cl= src=
      N boundary boundary:code b2 static bk=log cl= src=
      N parameter app/p.ts p0.res static bk= cl= src=
      N parameter app/p.ts p0.key static bk= cl= src=
      N return app/p.ts p0#return static bk= cl= src=
      N parameter app/p.ts p1.res static bk= cl= src=
      N parameter app/p.ts p1.key static bk= cl= src=
      N return app/p.ts p1#return static bk= cl= src=
      N parameter app/p.ts p2.res static bk= cl= src=
      N parameter app/p.ts p2.key static bk= cl= src=
      N return app/p.ts p2#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:18
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:18
      E calls function:app/p.ts#p0->function:app/p.ts#p0>anonymous@4:19 p=- static o= h= @app/p.ts:4:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0>anonymous@4:19 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:25
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0>anonymous@4:19 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:25
      E returns function:app/p.ts#p0>anonymous@4:19->return:app/p.ts#p0>anonymous@4:19#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:25
      E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E passes return:app/p.ts#p0>anonymous@4:19#return->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:18
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:18
      E calls function:app/p.ts#p1->function:app/p.ts#p1>anonymous@8:21 p=- static o= h= @app/p.ts:8:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1>anonymous@8:21 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:27
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1>anonymous@8:21 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:27
      E returns function:app/p.ts#p1>anonymous@8:21->return:app/p.ts#p1>anonymous@8:21#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:27
      E side-effect function:app/p.ts#p1->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:18
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:18
      E calls function:app/p.ts#p2->function:app/p.ts#p2>anonymous@12:18 p=- static o= h= @app/p.ts:12:11
      E passes function:app/p.ts#p2->parameter:app/p.ts#p2>anonymous@12:18.arg0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2>anonymous@12:18 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:24
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2>anonymous@12:18 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:24
      E returns function:app/p.ts#p2>anonymous@12:18->return:app/p.ts#p2>anonymous@12:18#return p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:24
      E passes return:app/p.ts#p2>anonymous@12:18#return->function:app/p.ts#p2 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:3
      E side-effect function:app/p.ts#p2->boundary:boundary:code#b2 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:3"
    `)
  })

  it("a function argument to a method that is not an array method is not called with elements", async () => {
    expect(
      await run(
        [
          `  res.json(${USER}.id.zzz(named))`,
          `  res.json(${USER}.name.includes(named))`,
          `  res.json(${USER}.email.slice(named))`,
          `  res.json(${USER}.role.toUpperCase(named))`,
        ],
        `function named(v: any) { return v }\n`,
      ),
    ).toMatchInlineSnapshot(`
      "N function app/p.ts p0 static bk= cl= src=3:1
      N boundary boundary:code b0 static bk=log cl= src=
      N function app/p.ts p1 static bk= cl= src=6:1
      N function app/p.ts p2 static bk= cl= src=9:1
      N boundary boundary:code b2 static bk=log cl= src=
      N function app/p.ts p3 static bk= cl= src=12:1
      N boundary boundary:code b3 static bk=log cl= src=
      N function app/p.ts named static bk= cl= src=2:1
      N parameter app/p.ts named.v static bk= cl= src=
      N return app/p.ts named#return static bk= cl= src=
      N parameter app/p.ts p0.res static bk= cl= src=
      N parameter app/p.ts p0.key static bk= cl= src=
      N return app/p.ts p0#return static bk= cl= src=
      N parameter app/p.ts p1.res static bk= cl= src=
      N parameter app/p.ts p1.key static bk= cl= src=
      N return app/p.ts p1#return static bk= cl= src=
      N parameter app/p.ts p2.res static bk= cl= src=
      N parameter app/p.ts p2.key static bk= cl= src=
      N return app/p.ts p2#return static bk= cl= src=
      N parameter app/p.ts p3.res static bk= cl= src=
      N parameter app/p.ts p3.key static bk= cl= src=
      N return app/p.ts p3#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:11
      E side-effect function:app/p.ts#p2->boundary:boundary:code#b2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:13:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:13:11
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p=role inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:13:3
      E side-effect function:app/p.ts#p3->boundary:boundary:code#b3 p=role inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:13:3
      U unresolved-call app/p.ts:4:11 subject=function:app/p.ts#p0 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
    `)
  })

  it("a closure that hands outer tracked data to an unresolved call", async () => {
    expect(
      await run(
        [`  const v = ${USER}.id\n  const g = () => mystery(v)\n  g()`],
        `declare function mystery(v: any): any\n`,
      ),
    ).toMatchInlineSnapshot(`
      "N function app/p.ts p0 static bk= cl= src=3:1
      N function app/p.ts p0>anonymous@5:13 static bk= cl= src=5:13
      N return app/p.ts p0>anonymous@5:13#return static bk= cl= src=
      N parameter app/p.ts p0.res static bk= cl= src=
      N parameter app/p.ts p0.key static bk= cl= src=
      N return app/p.ts p0#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
      E calls function:app/p.ts#p0->function:app/p.ts#p0>anonymous@5:13 p=- static o= h= @app/p.ts:6:3
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0>anonymous@5:13 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:19
      E returns function:app/p.ts#p0>anonymous@5:13->return:app/p.ts#p0>anonymous@5:13#return p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:19
      U unresolved-call app/p.ts:5:19 subject=function:app/p.ts#p0>anonymous@5:13 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
    `)
  })

  it("an assignment to something that is not a target evaluates it", async () => {
    expect(
      await run(
        [`  mystery(${USER}.id) = 1`, `  ;(${USER}.name as any) = 1`],
        `declare function mystery(v: any): any\n`,
      ),
    ).toMatchInlineSnapshot(`
      "N function app/p.ts p1 static bk= cl= src=6:1
      N function app/p.ts p0 static bk= cl= src=3:1
      N parameter app/p.ts p0.res static bk= cl= src=
      N parameter app/p.ts p0.key static bk= cl= src=
      N return app/p.ts p0#return static bk= cl= src=
      N parameter app/p.ts p1.res static bk= cl= src=
      N parameter app/p.ts p1.key static bk= cl= src=
      N return app/p.ts p1#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:5"
    `)
  })

  it("a for-of with a property target stores the element on the object", async () => {
    expect(await run([`  const o: any = {}\n  for (o.k of ${TAGS}) res.json(o.k)\n  res.json(o)`]))
      .toMatchInlineSnapshot(`
      "N function app/p.ts p0 static bk= cl= src=2:1
      N boundary boundary:code b0 static bk=log cl= src=
      N boundary boundary:code b1 static bk=log cl= src=
      N parameter app/p.ts p0.res static bk= cl= src=
      N parameter app/p.ts p0.key static bk= cl= src=
      N return app/p.ts p0#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.tags->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:15
      E reads field:features/user/user.ts#userData.tags->function:app/p.ts#p0 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
      E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:51
      E side-effect function:app/p.ts#p0->boundary:boundary:code#b1 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:3"
    `)
  })

  it("an allow-listed package is only followed when the caller lists it", async () => {
    const pkg = path.join(h.root(), "node_modules", "Stryker was here")
    await fs.mkdir(pkg, { recursive: true })
    await fs.writeFile(path.join(pkg, "index.js"), "module.exports = {};\n")
    await fs.writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: "Stryker was here",
        main: "./index.js",
        dataCap: { schema: "./index.ts" },
      }),
    )
    const sources = {
      "node_modules/Stryker was here/index.ts": "export function g(v: any) { return v.id }\n",
      "app/p.ts": `import { g } from "Stryker was here";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(g(${USER}))\n}\n`,
    }
    const without = dump((await h.scanDistinct(sources)).input).filter((l) => l.startsWith("U"))
    const withList = dump(
      (await h.scanDistinct(sources, { packages: ["Stryker was here"] })).input,
    ).filter((l) => l.startsWith("U"))
    expect([without.length, withList.length]).toEqual([1, 0])
  })
})
