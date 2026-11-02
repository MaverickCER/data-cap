import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildFlowModel } from "../../src/flow/flow-model.js"
import {
  capability,
  dump,
  field,
  IMPORT_CAP,
  inventoryOf,
  makeHarness,
  probes,
  USER,
} from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

const TAGS = "userData.getSnapshot().fields.tags"
const SHAPES = inventoryOf(
  capability({
    fields: [
      field("user", {
        id: "",
        profile: { age: "" },
        nothing: null,
        list: [{ k: "" }],
        empty: [],
      }),
      field("word", "abc"),
      field("tags", [{ label: "", secret: "" }]),
    ],
  }),
)

describe("flow-scan: targeted behaviours", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  /** One program per probe; field nodes and discards are left out unless asked for. */
  const run = async (
    bodies: readonly string[],
    extra = "",
    options: { discards?: boolean; inventory?: typeof SHAPES } = {},
  ): Promise<string> =>
    dump(
      (
        await h.scanDistinct(
          probes(bodies, extra),
          {},
          options.inventory ?? inventoryOf(capability()),
        )
      ).input,
    )
      .filter(
        (line) =>
          !line.startsWith("N field") &&
          (options.discards === true || !line.startsWith("E discards")),
      )
      .join("\n")

  const files = async (
    sources: Record<string, string>,
    options: { discards?: boolean } = {},
  ): Promise<string> =>
    dump((await h.scanDistinct(sources)).input)
      .filter(
        (line) =>
          !line.startsWith("N field") &&
          (options.discards === true || !line.startsWith("E discards")),
      )
      .join("\n")

  describe("arguments beyond the declared parameters", () => {
    it("every edge of a call with more arguments than parameters ends at a node of the model", async () => {
      const result = await h.scan(
        probes(
          [`  f(${USER}.id, ${USER}.name)\n  g(${USER}.email, ${USER}.role)`],
          `function f(a: any) { return a }\nfunction g(...all: any[]) { return all }\n`,
        ),
      )
      const model = buildFlowModel(result.input)
      expect(
        model.nodes
          .filter((n) => n.kind === "parameter" && !n.name.startsWith("p0."))
          .map((n) => n.name),
      ).toEqual(["f.a", "f.arg1", "g.all", "g.arg1"])
    })
  })

  describe("scopes", () => {
    it("a module-level variable shadows a builtin root and a global conversion in every function", async () => {
      expect(
        await run(
          [`  res.json(JSON.stringify(${USER}.id))`, `  res.json(Number(${USER}.name))`],
          `const JSON: any = { stringify: (v: any) => v }\nconst Number = (v: any) => v.email\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=4:1
        N function app/p.ts <module>>anonymous@2:32 static bk= cl= src=2:32
        N parameter app/p.ts <module>>anonymous@2:32.v static bk= cl= src=
        N return app/p.ts <module>>anonymous@2:32#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts p1 static bk= cl= src=7:1
        N function app/p.ts Number static bk= cl= src=3:16
        N parameter app/p.ts Number.v static bk= cl= src=
        N return app/p.ts Number#return static bk= cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
        E calls function:app/p.ts#p0->function:app/p.ts#<module>>anonymous@2:32 p=- static o= h= @app/p.ts:5:11
        E passes function:app/p.ts#p0->parameter:app/p.ts#<module>>anonymous@2:32.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads parameter:app/p.ts#<module>>anonymous@2:32.v->function:app/p.ts#<module>>anonymous@2:32 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:44
        E returns function:app/p.ts#<module>>anonymous@2:32->return:app/p.ts#<module>>anonymous@2:32#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:44
        E passes return:app/p.ts#<module>>anonymous@2:32#return->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:18
        E calls function:app/p.ts#p1->function:app/p.ts#Number p=- static o= h= @app/p.ts:8:11
        E passes function:app/p.ts#p1->parameter:app/p.ts#Number.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:11
        E reads parameter:app/p.ts#Number.v->function:app/p.ts#Number p=name.email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:28
        E returns function:app/p.ts#Number->return:app/p.ts#Number#return p=name.email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:28
        E passes return:app/p.ts#Number#return->function:app/p.ts#p1 p=name.email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#p1->boundary:boundary:code#b1 p=name.email static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3"
      `)
    })

    it("a module-level variable that is not a function also shadows a builtin root", async () => {
      expect(
        await run(
          [`  res.json(Math.max(${USER}.id))`, `  res.json(JSON.parse(${USER}.name))`],
          `const Math: any = {}\nlet JSON: any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=4:1
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts p1 static bk= cl= src=7:1
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:20
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:20
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:22
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:22
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#p1->boundary:boundary:code#b1 p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        U unresolved-call app/p.ts:5:11 subject=function:app/p.ts#p0 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
        U unresolved-call app/p.ts:8:11 subject=function:app/p.ts#p1 detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
      `)
    })

    it("a local function value named like a global keeps being followed as that function", async () => {
      expect(
        await run([
          `  const parseInt = (v: any) => v.id\n  res.json(parseInt(${USER}))`,
          `  const cb = (t: any) => t.label\n  res.json(${TAGS}.map(cb))`,
          `  function inner(t: any) { return t.secret }\n  res.json(${TAGS}.map(inner))`,
        ]),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=2:1
        N function app/p.ts p0>anonymous@3:20 static bk= cl= src=3:20
        N parameter app/p.ts p0>anonymous@3:20.v static bk= cl= src=
        N return app/p.ts p0>anonymous@3:20#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts p1 static bk= cl= src=6:1
        N function app/p.ts p1>anonymous@7:14 static bk= cl= src=7:14
        N parameter app/p.ts p1>anonymous@7:14.t static bk= cl= src=
        N return app/p.ts p1>anonymous@7:14#return static bk= cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N function app/p.ts p2 static bk= cl= src=10:1
        N function app/p.ts p2>inner@11:3 static bk= cl= src=11:3
        N parameter app/p.ts p2>inner@11:3.t static bk= cl= src=
        N return app/p.ts p2>inner@11:3#return static bk= cl= src=
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
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:20
        E calls function:app/p.ts#p0->function:app/p.ts#p0>anonymous@3:20 p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#p0->parameter:app/p.ts#p0>anonymous@3:20.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/p.ts#p0>anonymous@3:20.v->function:app/p.ts#p0>anonymous@3:20 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
        E returns function:app/p.ts#p0>anonymous@3:20->return:app/p.ts#p0>anonymous@3:20#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
        E passes return:app/p.ts#p0>anonymous@3:20#return->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:11
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#p1 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:11
        E calls function:app/p.ts#p1->function:app/p.ts#p1>anonymous@7:14 p=- static o= h= @app/p.ts:8:11
        E passes function:app/p.ts#p1->parameter:app/p.ts#p1>anonymous@7:14.t p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:11
        E reads parameter:app/p.ts#p1>anonymous@7:14.t->function:app/p.ts#p1>anonymous@7:14 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:7:26
        E returns function:app/p.ts#p1>anonymous@7:14->return:app/p.ts#p1>anonymous@7:14#return p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:7:26
        E passes return:app/p.ts#p1>anonymous@7:14#return->function:app/p.ts#p1 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:3
        E side-effect function:app/p.ts#p1->boundary:boundary:code#b1 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:3
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#p2 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:12:11
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#p2 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:12:11
        E calls function:app/p.ts#p2->function:app/p.ts#p2>inner@11:3 p=- static o= h= @app/p.ts:12:11
        E passes function:app/p.ts#p2->parameter:app/p.ts#p2>inner@11:3.t p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:12:11
        E reads parameter:app/p.ts#p2>inner@11:3.t->function:app/p.ts#p2>inner@11:3 p=[].secret static o=field:features/user/user.ts#userData.tags h= @app/p.ts:11:35
        E returns function:app/p.ts#p2>inner@11:3->return:app/p.ts#p2>inner@11:3#return p=[].secret static o=field:features/user/user.ts#userData.tags h= @app/p.ts:11:28
        E passes return:app/p.ts#p2>inner@11:3#return->function:app/p.ts#p2 p=[].secret static o=field:features/user/user.ts#userData.tags h= @app/p.ts:12:3
        E side-effect function:app/p.ts#p2->boundary:boundary:code#b2 p=[].secret static o=field:features/user/user.ts#userData.tags h= @app/p.ts:12:3"
      `)
    })

    it("a module-level assignment to an undeclared name defines it", async () => {
      expect(await run([`  res.json(later)`], `later = ${USER}.id\nlater = ${USER}.name\n`))
        .toMatchInlineSnapshot(`
          "N function app/p.ts <module> static bk= cl= src=
          N boundary boundary:code b0 static bk=log cl= src=
          N function app/p.ts p0 static bk= cl= src=4:1
          N parameter app/p.ts p0.res static bk= cl= src=
          N parameter app/p.ts p0.key static bk= cl= src=
          N return app/p.ts p0#return static bk= cl= src=
          E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:9
          E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:9
          E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:9
          E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
          E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
          E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
          E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
        `)
    })

    it("assigning through a computed or call base never defines a variable called undefined", async () => {
      expect(
        await run(
          [
            `  f().x = ${USER}.id\n  res.json(undefined)`,
            `  const o: any = {}\n  o.a.b = ${USER}.name\n  res.json(undefined)`,
            `  const o: any = {}\n  for (o.k of ${TAGS}) res.json(undefined)`,
          ],
          `declare function f(): any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=3:1
        N function app/p.ts p1 static bk= cl= src=7:1
        N function app/p.ts p2 static bk= cl= src=12:1
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        N parameter app/p.ts p2.res static bk= cl= src=
        N parameter app/p.ts p2.key static bk= cl= src=
        N return app/p.ts p2#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:11
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#p2 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:14:15
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#p2 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:14:3
        U unsupported-construct app/p.ts:4:3 subject=function:app/p.ts#p0 detail=assignment target is not a variable data=field:features/user/user.ts#userData.user/id"
      `)
    })

    it("a catch variable shadows an outer one of the same name", async () => {
      expect(
        await run(
          [
            `  const e = ${USER}.id\n  try { f() } catch (e) { res.json(e) }`,
            `  const e = ${USER}.name\n  try { f() } catch { res.json(e) }`,
          ],
          `declare function f(): any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=3:1
        N function app/p.ts p1 static bk= cl= src=7:1
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:13
        E side-effect function:app/p.ts#p1->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:23"
      `)
    })
  })

  describe("module-level code", () => {
    it("reads, sinks, unresolved calls and calls at module level have a function node of their own", async () => {
      expect(
        await files({
          "app/p.ts": `${IMPORT_CAP}declare function mystery(v: any): any\nfunction pick(v: any) { return v.id }\nconsole.log(${USER}.name)\nmystery(${USER}.email)\npick(${USER})\nconst role = ${USER}.role.length\nvoid role\nif (Math.random()) mystery(${USER}.passwordHash)\nexport const kept = ${USER}.id\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts <module> static bk= cl= src=
        N function app/p.ts pick static bk= cl= src=3:1
        N parameter app/p.ts pick.v static bk= cl= src=
        N return app/p.ts pick#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:9
        E calls function:app/p.ts#<module>->function:app/p.ts#pick p=- static o= h= @app/p.ts:6:1
        E passes function:app/p.ts#<module>->parameter:app/p.ts#pick.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:1
        E reads parameter:app/p.ts#pick.v->function:app/p.ts#pick p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
        E returns function:app/p.ts#pick->return:app/p.ts#pick#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:14
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=role.length static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:14
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:28
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:21
        U unresolved-call app/p.ts:4:1 subject=function:app/p.ts#<module> detail=call target is not a project function data=field:features/user/user.ts#userData.user/name
        U unresolved-call app/p.ts:5:1 subject=function:app/p.ts#<module> detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
        U unresolved-call app/p.ts:9:20 subject=function:app/p.ts#<module> detail=call target is not a project function data=field:features/user/user.ts#userData.user/passwordHash"
      `)
    })

    it("two files with module-level code keep their module functions apart", async () => {
      expect(
        await files({
          "app/a.ts": `${IMPORT_CAP}declare function mystery(v: any): any\nmystery(${USER}.id)\n`,
          "app/b.ts": `${IMPORT_CAP}declare function mystery(v: any): any\nmystery(${USER}.name)\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/a.ts <module> static bk= cl= src=
        N function app/b.ts <module> static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/a.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/a.ts:3:9
        E reads field:features/user/user.ts#userData.user->function:app/a.ts#<module> p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:3:9
        E reads field:features/user/user.ts#userData.user->function:app/b.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/b.ts:3:9
        E reads field:features/user/user.ts#userData.user->function:app/b.ts#<module> p=name static o=field:features/user/user.ts#userData.user h= @app/b.ts:3:9
        U unresolved-call app/a.ts:3:1 subject=function:app/a.ts#<module> detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
        U unresolved-call app/b.ts:3:1 subject=function:app/b.ts#<module> detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
      `)
    })

    it("module code runs once even when many functions use the module", async () => {
      expect(
        await files({
          "app/p.ts": `${IMPORT_CAP}declare function mystery(v: any): any\nmystery(${USER}.id)\nexport function a() { return 1 }\nexport function b() { return a() }\nexport function c() { return b() + a() }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts <module> static bk= cl= src=
        N function app/p.ts b static bk= cl= src=5:1
        N function app/p.ts a static bk= cl= src=4:1
        N function app/p.ts c static bk= cl= src=6:1
        N return app/p.ts a#return static bk= cl= src=
        N return app/p.ts b#return static bk= cl= src=
        N return app/p.ts c#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:9
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:9
        E calls function:app/p.ts#b->function:app/p.ts#a p=- static o= h= @app/p.ts:5:30
        E calls function:app/p.ts#c->function:app/p.ts#b p=- static o= h= @app/p.ts:6:30
        E calls function:app/p.ts#c->function:app/p.ts#a p=- static o= h= @app/p.ts:6:36
        U unresolved-call app/p.ts:3:1 subject=function:app/p.ts#<module> detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
      `)
    })

    it("a function called from another file's module code sees its own module's values", async () => {
      expect(
        await files({
          "app/a.ts": `import { g } from "./z.js";\n${IMPORT_CAP}g(${USER}.id)\n`,
          "app/z.ts": `${IMPORT_CAP}const K = ${USER}.name\nexport function g(v: any) { return [v, K] }\nexport function h(res: any) { res.json(K) }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/a.ts <module> static bk= cl= src=
        N function app/z.ts g static bk= cl= src=3:1
        N parameter app/z.ts g.v static bk= cl= src=
        N function app/z.ts <module> static bk= cl= src=
        N return app/z.ts g#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/z.ts h static bk= cl= src=4:1
        N parameter app/z.ts h.res static bk= cl= src=
        N return app/z.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/a.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/a.ts:3:3
        E reads field:features/user/user.ts#userData.user->function:app/a.ts#<module> p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:3:3
        E calls function:app/a.ts#<module>->function:app/z.ts#g p=- static o= h= @app/a.ts:3:1
        E passes function:app/a.ts#<module>->parameter:app/z.ts#g.v p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:3:1
        E reads field:features/user/user.ts#userData.user->function:app/z.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/z.ts:2:11
        E reads field:features/user/user.ts#userData.user->function:app/z.ts#<module> p=name static o=field:features/user/user.ts#userData.user h= @app/z.ts:2:11
        E reads parameter:app/z.ts#g.v->function:app/z.ts#g p=id static o=field:features/user/user.ts#userData.user h= @app/z.ts:3:29
        E returns function:app/z.ts#g->return:app/z.ts#g#return p=id static o=field:features/user/user.ts#userData.user h= @app/z.ts:3:29
        E reads field:features/user/user.ts#userData.user->function:app/z.ts#g p=name static o=field:features/user/user.ts#userData.user h= @app/z.ts:3:29
        E returns function:app/z.ts#g->return:app/z.ts#g#return p=name static o=field:features/user/user.ts#userData.user h= @app/z.ts:3:29
        E reads field:features/user/user.ts#userData.user->function:app/z.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/z.ts:4:31
        E side-effect function:app/z.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/z.ts:4:31"
      `)
    })

    it("a module with no code of its own gets no module node", async () => {
      expect(await files({ "app/p.ts": `export function only() { return 1 }\n` }))
        .toMatchInlineSnapshot(`
        "N function app/p.ts only static bk= cl= src=1:1
        N return app/p.ts only#return static bk= cl= src="
      `)
    })

    it("a capability file imported under its own export name by another capability file", async () => {
      const other = capability({
        file: "features/other/user.ts",
        exportName: "userData",
        fields: [field("o", { v: "" })],
      })
      const result = await h.scanDistinct(
        {
          "features/other/user.ts": `export const userData = createData({});\n`,
          [capability().file]:
            `import { userData } from "../other/user.js";\nexport const own = createData({});\nexport function peek(res: any) { res.json(userData.getSnapshot().fields.o.v) }\n`,
        },
        {},
        inventoryOf(capability(), other),
      )
      expect(
        dump(result.input)
          .filter((l) => !l.startsWith("N field") && !l.startsWith("E discards"))
          .join("\n"),
      ).toMatchInlineSnapshot(`
        "N function features/user/user.ts peek static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter features/user/user.ts peek.res static bk= cl= src=
        N return features/user/user.ts peek#return static bk= cl= src=
        E reads field:features/other/user.ts#userData.o->function:features/user/user.ts#peek p= static o=field:features/other/user.ts#userData.o h= @features/user/user.ts:3:42
        E reads field:features/other/user.ts#userData.o->function:features/user/user.ts#peek p=v static o=field:features/other/user.ts#userData.o h= @features/user/user.ts:3:42
        E side-effect function:features/user/user.ts#peek->boundary:boundary:code#b0 p=v static o=field:features/other/user.ts#userData.o h= @features/user/user.ts:3:34"
      `)
    })

    it("a name that is not imported is not bound to a capability, even when a capability has that export name", async () => {
      expect(
        await files({
          "app/p.ts": `export function h(res: any) {\n  res.json(userData.getSnapshot().fields.user.email)\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=1:1
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src="
      `)
    })
  })

  describe("exports and imports", () => {
    it("only a function with an export modifier is exported, whatever other modifiers it has; a default export is exported as `default` and not by its own name", async () => {
      expect(
        await files({
          "app/util.ts": `export async function exp(v: any) { return v.id }\nasync function priv(v: any) { return v.name }\nexport default function dflt(v: any) { return v.email }\nexport const arrowExp = async (v: any) => v.role\nconst arrowPriv = async (v: any) => v.id\n`,
          "app/p.ts": `import { exp, priv, dflt, arrowExp, arrowPriv } from "./util.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(exp(${USER}))\n  res.json(priv(${USER}))\n  res.json(dflt(${USER}))\n  res.json(arrowExp(${USER}))\n  res.json(arrowPriv(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/util.ts exp static bk= cl= src=1:1
        N parameter app/util.ts exp.v static bk= cl= src=
        N return app/util.ts exp#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N function app/util.ts arrowExp static bk= cl= src=4:25
        N parameter app/util.ts arrowExp.v static bk= cl= src=
        N return app/util.ts arrowExp#return static bk= cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N function app/util.ts priv static bk= cl= src=2:1
        N parameter app/util.ts priv.v static bk= cl= src=
        N return app/util.ts priv#return static bk= cl= src=
        N function app/util.ts dflt static bk= cl= src=3:1
        N parameter app/util.ts dflt.v static bk= cl= src=
        N return app/util.ts dflt#return static bk= cl= src=
        N function app/util.ts arrowPriv static bk= cl= src=5:19
        N parameter app/util.ts arrowPriv.v static bk= cl= src=
        N return app/util.ts arrowPriv#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:15
        E calls function:app/p.ts#h->function:app/util.ts#exp p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/util.ts#exp.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/util.ts#exp.v->function:app/util.ts#exp p=id static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:44
        E returns function:app/util.ts#exp->return:app/util.ts#exp#return p=id static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:37
        E passes return:app/util.ts#exp#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E calls function:app/p.ts#h->function:app/util.ts#arrowExp p=- static o= h= @app/p.ts:7:11
        E passes function:app/p.ts#h->parameter:app/util.ts#arrowExp.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
        E reads parameter:app/util.ts#arrowExp.v->function:app/util.ts#arrowExp p=role static o=field:features/user/user.ts#userData.user h= @app/util.ts:4:43
        E returns function:app/util.ts#arrowExp->return:app/util.ts#arrowExp#return p=role static o=field:features/user/user.ts#userData.user h= @app/util.ts:4:43
        E passes return:app/util.ts#arrowExp#return->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        U unresolved-call app/p.ts:5:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
        U unresolved-call app/p.ts:6:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
        U unresolved-call app/p.ts:8:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("a variable statement mixing a schema constant and a helper keeps the helper", async () => {
      expect(
        await files({
          "app/util.ts": `const schema = { run: () => 1 }, helper = (v: any) => v.id\nexport { helper }\nexport const made = createData(schema)\n`,
          "app/p.ts": `import { helper } from "./util.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(helper(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/util.ts helper static bk= cl= src=1:43
        N parameter app/util.ts helper.v static bk= cl= src=
        N return app/util.ts helper#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N function app/util.ts <module>>anonymous@1:23 static bk= cl= src=1:23
        N return app/util.ts <module>>anonymous@1:23#return static bk= cl= src=
        N function app/util.ts <module>>anonymous@1:43 static bk= cl= src=1:43
        N parameter app/util.ts <module>>anonymous@1:43.v static bk= cl= src=
        N return app/util.ts <module>>anonymous@1:43#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
        E calls function:app/p.ts#h->function:app/util.ts#helper p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/util.ts#helper.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/util.ts#helper.v->function:app/util.ts#helper p=id static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:55
        E returns function:app/util.ts#helper->return:app/util.ts#helper#return p=id static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:55
        E passes return:app/util.ts#helper#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
      `)
    })

    it("an export aliased to default is reachable through a default import and through `{ default as x }`", async () => {
      expect(
        await files({
          "app/d.ts": `function d(v: any) { return v.id }\nexport { d as default }\n`,
          "app/p.ts": `import dd from "./d.js";\nimport { default as named } from "./d.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(dd(${USER}))\n  res.json(named(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=4:1
        N function app/d.ts d static bk= cl= src=1:1
        N parameter app/d.ts d.v static bk= cl= src=
        N return app/d.ts d#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:14
        E calls function:app/p.ts#h->function:app/d.ts#d p=- static o= h= @app/p.ts:5:11
        E passes function:app/p.ts#h->parameter:app/d.ts#d.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads parameter:app/d.ts#d.v->function:app/d.ts#d p=id static o=field:features/user/user.ts#userData.user h= @app/d.ts:1:29
        E returns function:app/d.ts#d->return:app/d.ts#d#return p=id static o=field:features/user/user.ts#userData.user h= @app/d.ts:1:22
        E passes return:app/d.ts#d#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
      `)
    })

    it("an import of a file the scan skipped resolves to nothing", async () => {
      expect(
        await files({
          "app/gen.ts": `// GENERATED FILE -- do not edit by hand. Run it.\nexport function g(v: any) { return v.id }\n`,
          "app/p.ts": `import { g } from "./gen.js";\nimport * as ns from "./gen.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(g(${USER}))\n  res.json(ns.g(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=4:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        U unresolved-call app/p.ts:5:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
        U unresolved-call app/p.ts:6:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("a re-export chain is followed through exactly 9 files", async () => {
      const chain = (hops: number): Record<string, string> => {
        const out: Record<string, string> = {
          "app/r0.ts": `export function real(v: any) { return v.id }\n`,
        }
        for (let i = 1; i <= hops; i += 1)
          out[`app/r${i}.ts`] = `export { real } from "./r${i - 1}.js"\n`
        out["app/p.ts"] =
          `import { real } from "./r${hops}.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(real(${USER}))\n}\n`
        return out
      }
      const outcome = async (hops: number) => {
        const text = await files(chain(hops))
        return text.includes("E calls function:app/p.ts#h->function:app/r0.ts#real")
      }
      expect([await outcome(7), await outcome(8), await outcome(9)]).toEqual([true, true, false])
    })

    it("a cyclic re-export chain ends", async () => {
      expect(
        await files({
          "app/a.ts": `export { x } from "./b.js"\n`,
          "app/b.ts": `export { x } from "./a.js"\n`,
          "app/p.ts": `import { x } from "./a.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(x(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        U unresolved-call app/p.ts:4:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("a star re-export is followed and a name that does not exist is not a function", async () => {
      expect(
        await files({
          "app/a.ts": `export function real(v: any) { return v.id }\n`,
          "app/b.ts": `export * from "./a.js"\n`,
          "app/p.ts": `import { real, missing } from "./a.js";\nimport { real as viaStar } from "./b.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(real(${USER}))\n  res.json(missing(${USER}))\n  res.json(viaStar(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=4:1
        N function app/a.ts real static bk= cl= src=1:1
        N parameter app/a.ts real.v static bk= cl= src=
        N return app/a.ts real#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:16
        E calls function:app/p.ts#h->function:app/a.ts#real p=- static o= h= @app/p.ts:5:11
        E passes function:app/p.ts#h->parameter:app/a.ts#real.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads parameter:app/a.ts#real.v->function:app/a.ts#real p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:1:39
        E returns function:app/a.ts#real->return:app/a.ts#real#return p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:1:32
        E passes return:app/a.ts#real#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        U unresolved-call app/p.ts:6:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })
  })

  describe("statements and expressions", () => {
    it("object literal keys of every spelling, and calls through stored methods", async () => {
      expect(
        await run([
          `  const o = { 1n: ${USER}.id }\n  res.json(o)`,
          `  const o = { m() { return ${USER}.id } }\n  res.json(o.m())`,
          `  const o = { [key]() { return ${USER}.name } }\n  res.json(o.undefined())\n  res.json(o.key())`,
          `  const o = { "quoted": ${USER}.email, 3: ${USER}.role }\n  res.json(o.quoted)\n  res.json(o[3])`,
        ]),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts p1 static bk= cl= src=6:1
        N function app/p.ts p1>m@7:15 static bk= cl= src=7:15
        N return app/p.ts p1>m@7:15#return static bk= cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N function app/p.ts p3 static bk= cl= src=15:1
        N boundary boundary:code b4 static bk=log cl= src=
        N function app/p.ts p2>anonymous@11:15 static bk= cl= src=11:15
        N return app/p.ts p2>anonymous@11:15#return static bk= cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        N function app/p.ts p2 static bk= cl= src=10:1
        N parameter app/p.ts p2.res static bk= cl= src=
        N parameter app/p.ts p2.key static bk= cl= src=
        N return app/p.ts p2#return static bk= cl= src=
        N parameter app/p.ts p3.res static bk= cl= src=
        N parameter app/p.ts p3.key static bk= cl= src=
        N return app/p.ts p3#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:19
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:19
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E calls function:app/p.ts#p1->function:app/p.ts#p1>m@7:15 p=- static o= h= @app/p.ts:8:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1>m@7:15 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:28
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1>m@7:15 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:28
        E returns function:app/p.ts#p1>m@7:15->return:app/p.ts#p1>m@7:15#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:21
        E passes return:app/p.ts#p1>m@7:15#return->function:app/p.ts#p1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#p1->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:16:25
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:16:25
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:16:70
        E side-effect function:app/p.ts#p3->boundary:boundary:code#b4 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:17:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2>anonymous@11:15 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:32
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2>anonymous@11:15 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:32
        E returns function:app/p.ts#p2>anonymous@11:15->return:app/p.ts#p2>anonymous@11:15#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:25
        U unanalyzed-function app/p.ts:11:15 subject=function:app/p.ts#p2>anonymous@11:15 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/name"
      `)
    })

    it("a method without a body in an object literal is not a function value", async () => {
      expect(await run([`  const o = { m(): void }\n  res.json(o)`])).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=2:1
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src="
      `)
    })

    it("a closure created in two contexts keeps the environment of its own", async () => {
      expect(
        await run(
          [
            `  const a = mk(${USER}.id)\n  const b = mk(${USER}.name)\n  res.json(a())\n  res.json(b())`,
          ],
          `function mk(v: any) { return () => v }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=3:1
        N function app/p.ts mk static bk= cl= src=2:1
        N parameter app/p.ts mk.v static bk= cl= src=
        N function app/p.ts mk>anonymous@2:30 static bk= cl= src=2:30
        N return app/p.ts mk>anonymous@2:30#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N return app/p.ts mk#return static bk= cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E calls function:app/p.ts#p0->function:app/p.ts#mk p=- static o= h= @app/p.ts:4:13
        E passes function:app/p.ts#p0->parameter:app/p.ts#mk.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:16
        E passes function:app/p.ts#p0->parameter:app/p.ts#mk.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
        E calls function:app/p.ts#p0->function:app/p.ts#mk>anonymous@2:30 p=- static o= h= @app/p.ts:6:11
        E reads parameter:app/p.ts#mk.v->function:app/p.ts#mk>anonymous@2:30 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:36
        E returns function:app/p.ts#mk>anonymous@2:30->return:app/p.ts#mk>anonymous@2:30#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:36
        E passes return:app/p.ts#mk>anonymous@2:30#return->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E reads parameter:app/p.ts#mk.v->function:app/p.ts#mk>anonymous@2:30 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:36
        E returns function:app/p.ts#mk>anonymous@2:30->return:app/p.ts#mk>anonymous@2:30#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:36
        E passes return:app/p.ts#mk>anonymous@2:30#return->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"
      `)
    })

    it("a rest parameter holds only the arguments from its own position", async () => {
      expect(
        await run(
          [`  res.json(f(${USER}.id, ${USER}.name, ${USER}.email))`],
          `function f(a: any, ...rest: any[]) { return rest }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=3:1
        N function app/p.ts f static bk= cl= src=2:1
        N parameter app/p.ts f.a static bk= cl= src=
        N parameter app/p.ts f.rest static bk= cl= src=
        N parameter app/p.ts f.arg2 static bk= cl= src=
        N return app/p.ts f#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:52
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:93
        E calls function:app/p.ts#p0->function:app/p.ts#f p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#p0->parameter:app/p.ts#f.a p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E passes function:app/p.ts#p0->parameter:app/p.ts#f.rest p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E passes function:app/p.ts#p0->parameter:app/p.ts#f.arg2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/p.ts#f.rest->function:app/p.ts#f p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:38
        E returns function:app/p.ts#f->return:app/p.ts#f#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:38
        E reads parameter:app/p.ts#f.arg2->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:38
        E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:38
        E passes return:app/p.ts#f#return->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E passes return:app/p.ts#f#return->function:app/p.ts#p0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
      `)
    })

    it("then and friends evaluate their other arguments", async () => {
      expect(
        await run(
          [
            `  const p: any = ${USER}.id\n  p.then(() => 1, ${USER}.name)`,
            `  const p: any = ${USER}.id\n  p.catch(mystery(${USER}.email))`,
            `  const p: any = ${USER}.id\n  res.json(p.catch(() => 1))\n`,
            `  const p: any = ${USER}.id\n  res.json(p.finally(() => 1))\n`,
            `  const p: any = ${USER}.id\n  res.json(p.then(() => 1))\n`,
          ],
          `declare function mystery(v: any): any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=3:1
        N function app/p.ts p0>anonymous@5:10 static bk= cl= src=5:10
        N parameter app/p.ts p0>anonymous@5:10.arg0 static bk= cl= src=
        N function app/p.ts p1 static bk= cl= src=7:1
        N function app/p.ts p2 static bk= cl= src=11:1
        N function app/p.ts p2>anonymous@13:19 static bk= cl= src=13:19
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts p3 static bk= cl= src=16:1
        N function app/p.ts p3>anonymous@18:21 static bk= cl= src=18:21
        N boundary boundary:code b1 static bk=log cl= src=
        N function app/p.ts p4 static bk= cl= src=21:1
        N function app/p.ts p4>anonymous@23:18 static bk= cl= src=23:18
        N parameter app/p.ts p4>anonymous@23:18.arg0 static bk= cl= src=
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
        N parameter app/p.ts p4.res static bk= cl= src=
        N parameter app/p.ts p4.key static bk= cl= src=
        N return app/p.ts p4#return static bk= cl= src=
        N return app/p.ts p0>anonymous@5:10#return static bk= cl= src=
        N return app/p.ts p2>anonymous@13:19#return static bk= cl= src=
        N return app/p.ts p3>anonymous@18:21#return static bk= cl= src=
        N return app/p.ts p4>anonymous@23:18#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:19
        E calls function:app/p.ts#p0->function:app/p.ts#p0>anonymous@5:10 p=- static o= h= @app/p.ts:5:3
        E passes function:app/p.ts#p0->parameter:app/p.ts#p0>anonymous@5:10.arg0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:19
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:18
        E calls function:app/p.ts#p2->function:app/p.ts#p2>anonymous@13:19 p=- static o= h= @app/p.ts:13:11
        E side-effect function:app/p.ts#p2->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:13:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:17:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:17:18
        E calls function:app/p.ts#p3->function:app/p.ts#p3>anonymous@18:21 p=- static o= h= @app/p.ts:18:11
        E side-effect function:app/p.ts#p3->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:18:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p4 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:22:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p4 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:22:18
        E calls function:app/p.ts#p4->function:app/p.ts#p4>anonymous@23:18 p=- static o= h= @app/p.ts:23:11
        E passes function:app/p.ts#p4->parameter:app/p.ts#p4>anonymous@23:18.arg0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:23:11
        U unresolved-call app/p.ts:9:11 subject=function:app/p.ts#p1 detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
      `)
    })

    it("a computed index is evaluated, and so is a destructuring assignment target", async () => {
      expect(
        await run([
          `  const o: any = {}\n  res.json(o[${USER}.name])`,
          `  const o: any = {}\n  ;[o[${USER}.email]] = [1]`,
          `  const o: any = {}\n  ;({ k: o[${USER}.role] } = { k: 1 })`,
        ]),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=2:1
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N function app/p.ts p1 static bk= cl= src=6:1
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        N function app/p.ts p2 static bk= cl= src=10:1
        N parameter app/p.ts p2.res static bk= cl= src=
        N parameter app/p.ts p2.key static bk= cl= src=
        N return app/p.ts p2#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13"
      `)
    })

    it("nested JSX is evaluated, text is ignored, and an expression child is evaluated", async () => {
      expect(
        await h
          .scanDistinct({
            "app/p.tsx": `${IMPORT_CAP}function Inner(props: any) { return props.v }\nexport function h(res: any) {\n  const x = <div>text<Inner v={${USER}.id} />{${USER}.name}<>{${USER}.email}</></div>\n  void x\n}\n`,
          })
          .then((r) =>
            dump(r.input)
              .filter((l) => !l.startsWith("N field") && !l.startsWith("E discards"))
              .join("\n"),
          ),
      ).toMatchInlineSnapshot(`
        "N function app/p.tsx h static bk= cl= src=3:1
        N function app/p.tsx Inner static bk= cl= src=2:1
        N parameter app/p.tsx Inner.props static bk= cl= src=
        N return app/p.tsx Inner#return static bk= cl= src=
        N parameter app/p.tsx h.res static bk= cl= src=
        N return app/p.tsx h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p= static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:32
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:32
        E calls function:app/p.tsx#h->function:app/p.tsx#Inner p=- static o= h= @app/p.tsx:4:22
        E passes function:app/p.tsx#h->parameter:app/p.tsx#Inner.props p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:22
        E reads parameter:app/p.tsx#Inner.props->function:app/p.tsx#Inner p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:2:37
        E returns function:app/p.tsx#Inner->return:app/p.tsx#Inner#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:2:30
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:74
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:117"
      `)
    })

    it("a capability member that is not fields has no fields", async () => {
      expect(
        await run([
          `  res.json(userData.other.user.email)`,
          `  res.json(userData.fields.user.email)`,
        ]),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p1 static bk= cl= src=5:1
        N boundary boundary:code b1 static bk=log cl= src=
        N function app/p.ts p0 static bk= cl= src=2:1
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E side-effect function:app/p.ts#p1->boundary:boundary:code#b1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
      `)
    })

    it("new without arguments and with a function argument", async () => {
      expect(
        await run(
          [`  new Thing\n  new Thing(() => ${USER}.id)\n  new Thing(${USER}.name)`],
          `declare class Thing { constructor(...a: any[]) }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=3:1
        N function app/p.ts p0>anonymous@5:13 static bk= cl= src=5:13
        N return app/p.ts p0>anonymous@5:13#return static bk= cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0>anonymous@5:13 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:19
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0>anonymous@5:13 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:19
        E returns function:app/p.ts#p0>anonymous@5:13->return:app/p.ts#p0>anonymous@5:13#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:19
        U unresolved-call app/p.ts:6:3 subject=function:app/p.ts#p0 detail=call target is not a project function data=field:features/user/user.ts#userData.user/name
        U unanalyzed-function app/p.ts:5:13 subject=function:app/p.ts#p0>anonymous@5:13 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/id"
      `)
    })
  })

  describe("discards by shape", () => {
    const shaped = (bodies: readonly string[], extra = "") =>
      run(bodies, `function ignore(v: any) { return 1 }\n${extra}`, {
        discards: true,
        inventory: SHAPES,
      }).then((text) =>
        text
          .split("\n")
          .filter((l) => l.startsWith("E discards"))
          .join("\n"),
      )

    it("measures what is dropped at each depth of the shape", async () => {
      expect(
        await shaped([
          `  ignore(${USER}.list[0])`,
          `  ignore(${USER}.profile)`,
          `  ignore(${USER}.nothing)`,
          `  ignore(${USER}.nothing.x)`,
          `  ignore(${USER}.list.foo)`,
          `  ignore(${USER}.empty[0])`,
          `  ignore(${USER}.id.length)`,
          `  ignore(userData.getSnapshot().fields.word)`,
          `  ignore(${TAGS}[0])`,
          `  ignore(${USER}.profile.age)`,
        ]),
      ).toMatchInlineSnapshot(`
        "E discards function:app/p.ts#p0->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p0->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p0->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p0->field:features/user/user.ts#userData.user p=empty static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#ignore->field:features/user/user.ts#userData.user p=list.[].k static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p1->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p1->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p1->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p1->field:features/user/user.ts#userData.user p=empty static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#ignore->field:features/user/user.ts#userData.user p=profile.age static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p2->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p2->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p2->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p2->field:features/user/user.ts#userData.user p=empty static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p3->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p3->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p3->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p3->field:features/user/user.ts#userData.user p=empty static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p4->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p4->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p4->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p4->field:features/user/user.ts#userData.user p=empty static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p5->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p5->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p5->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p5->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p6->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p6->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p6->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p6->field:features/user/user.ts#userData.user p=empty static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#ignore->field:features/user/user.ts#userData.tags p=[].label static o=field:features/user/user.ts#userData.tags h= @
        E discards function:app/p.ts#ignore->field:features/user/user.ts#userData.tags p=[].secret static o=field:features/user/user.ts#userData.tags h= @
        E discards function:app/p.ts#p9->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p9->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p9->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#p9->field:features/user/user.ts#userData.user p=empty static o=field:features/user/user.ts#userData.user h= @"
      `)
    })
  })
})
