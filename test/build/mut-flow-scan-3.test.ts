import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { dump, handler, IMPORT_CAP, makeHarness, USER } from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

const TAGS = "userData.getSnapshot().fields.tags"

describe("flow-scan: statements, bindings and expressions", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })
  /** Everything but the field nodes and the discards, which every program repeats. */
  const lines = async (body: string, extra = ""): Promise<string> =>
    dump((await h.scanDistinct(handler(body, extra))).input)
      .filter((line) => !line.startsWith("N field") && !line.startsWith("E discards"))
      .join("\n")

  describe("statements", () => {
    it("if / else if / else follow every branch and read the condition", async () => {
      expect(
        await lines(
          `  if (${USER}.id) { res.json(${USER}.name) } else if (${USER}.role) { res.json(1) } else res.json(${USER}.email)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:7
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:7
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:56
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:48
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:108
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:177
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:169"
      `)
    })

    it("an if without else", async () => {
      expect(await lines(`  if (${USER}.id) res.json(${USER}.name)`)).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:7
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:7
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:54
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:46"
      `)
    })

    it("for-of binds the element to a declaration or assigns it to an existing variable", async () => {
      expect(
        await lines(
          `  for (const t of ${TAGS}) res.json(t.label)\n  let x: any\n  for (x of ${TAGS}) res.json(x.secret)\n  for (const { label } of ${TAGS}) res.json(label)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:19
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:3
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:63
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:55
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[].secret static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:57
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=[].secret static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:49
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:6:63"
      `)
    })

    it("for-in reads the object but binds nothing from it", async () => {
      expect(
        await lines(
          `  for (const k in ${USER}) res.json(k)\n  let y: any\n  for (y in ${USER}) res.json(y)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:19"
      `)
    })

    it("a for-in or for-of whose initializer is neither declaration nor identifier binds nothing", async () => {
      expect(await lines(`  const o: any = {}\n  for (o.k of ${TAGS}) res.json(o.k)`))
        .toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:15
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:51"
      `)
    })

    it("a classic for evaluates initializer, condition, incrementor and body", async () => {
      expect(
        await lines(
          `  for (let i = ${USER}.id, j; ${USER}.name; ${USER}.email) { res.json(i) }\n  let k: any\n  for (k = ${USER}.role; ; ) { res.json(k); break }`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:58
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:99
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:143
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:59"
      `)
    })

    it("a for with nothing but a body", async () => {
      expect(await lines(`  for (;;) { res.json(${USER}.id); break }`)).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:22
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:22
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:14"
      `)
    })

    it("while and do-while read their condition and run their body", async () => {
      expect(
        await lines(
          `  while (${USER}.id) { res.json(${USER}.name); break }\n  do { res.json(${USER}.role) } while (${USER}.email)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:10
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:10
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:59
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:51
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:66
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:8"
      `)
    })

    it("switch reads the discriminant, every case and every clause body", async () => {
      expect(
        await lines(
          `  switch (${USER}.id) {\n    case ${USER}.name:\n      res.json(${USER}.email)\n      break\n    default:\n      res.json(${USER}.role)\n  }`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:10
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:15
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:7
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:15
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:7"
      `)
    })

    it("try binds the catch variable to nothing and walks catch and finally", async () => {
      expect(
        await lines(
          `  try { res.json(${USER}.id) } catch (e) { res.json(e); res.json(${USER}.name) } finally { res.json(${USER}.email) }`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:9
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:90
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:82
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:151
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:143"
      `)
    })

    it("a catch without a binding and a try without finally", async () => {
      expect(await lines(`  try { res.json(${USER}.id) } catch { res.json(${USER}.name) }`))
        .toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:9
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:74
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:66"
      `)
    })

    it("try / finally without a catch", async () => {
      expect(await lines(`  try { res.json(${USER}.id) } finally { res.json(${USER}.name) }`))
        .toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:9
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:76
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:68"
      `)
    })

    it("throw reads its expression; labels and blocks are walked", async () => {
      expect(
        await lines(
          `  outer: { res.json(${USER}.id) }\n  { res.json(${USER}.name) }\n  if (key) throw new Error(${USER}.email)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:20
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:20
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:5
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:28
        U unresolved-call app/p.ts:5:18 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
      `)
    })

    it("a nested function declaration becomes a callable local", async () => {
      expect(
        await lines(
          `  function inner(v: any) { return v.name }\n  res.json(inner(${USER}))\n  function noBody(): void;\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N function app/p.ts h>inner@3:3 static bk= cl= src=3:3
        N parameter app/p.ts h>inner@3:3.v static bk= cl= src=
        N return app/p.ts h>inner@3:3#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:17
        E calls function:app/p.ts#h->function:app/p.ts#h>inner@3:3 p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>inner@3:3.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/p.ts#h>inner@3:3.v->function:app/p.ts#h>inner@3:3 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:35
        E returns function:app/p.ts#h>inner@3:3->return:app/p.ts#h>inner@3:3#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:28
        E passes return:app/p.ts#h>inner@3:3#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
      `)
    })

    it("variable statements: no initializer, several declarations", async () => {
      expect(
        await lines(
          `  let a: any, b = ${USER}.id, c: any = ${USER}.name\n  res.json(a)\n  res.json(b)\n  res.json(c)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:19
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:19
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:67
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
      `)
    })

    it("bare return and return of a value", async () => {
      expect(await lines(`  if (key) return\n  return ${USER}.id`)).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N return app/p.ts h#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:10
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:10
        E returns function:app/p.ts#h->return:app/p.ts#h#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
      `)
    })

    it("an arrow with an expression body returns it", async () => {
      expect(
        await lines(
          ``,
          `export const arrow = (v: any) => v.name\nexport const call = () => arrow(${USER})\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts call static bk= cl= src=3:21
        N function app/p.ts arrow static bk= cl= src=2:22
        N parameter app/p.ts arrow.v static bk= cl= src=
        N return app/p.ts arrow#return static bk= cl= src=
        N return app/p.ts call#return static bk= cl= src=
        N function app/p.ts h static bk= cl= src=4:1
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#call p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:33
        E calls function:app/p.ts#call->function:app/p.ts#arrow p=- static o= h= @app/p.ts:3:27
        E passes function:app/p.ts#call->parameter:app/p.ts#arrow.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
        E reads parameter:app/p.ts#arrow.v->function:app/p.ts#arrow p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:34
        E returns function:app/p.ts#arrow->return:app/p.ts#arrow#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:34
        E passes return:app/p.ts#arrow#return->function:app/p.ts#call p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
        E returns function:app/p.ts#call->return:app/p.ts#call#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27"
      `)
    })

    it("statements it does not model are skipped", async () => {
      expect(
        await lines(
          `  class K {}\n  enum E { A }\n  type T = string\n  interface I {}\n  debugger\n  ;\n  res.json(${USER}.id)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3"
      `)
    })
  })

  describe("binding", () => {
    it("object destructuring: renamed, defaulted, computed, string-keyed and rest", async () => {
      expect(
        await lines(
          `  const { id, name: n, email = "x", ["role"]: r, ...rest } = ${USER}\n  res.json(id)\n  res.json(n)\n  res.json(email)\n  res.json(r)\n  res.json(rest)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:62
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:15
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:24
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3"
      `)
    })

    it("object destructuring with a computed key reads everything approximately", async () => {
      expect(await lines(`  const { [key]: v } = ${USER}\n  res.json(v)`)).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:24
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
      `)
    })

    it("a numeric-keyed destructuring and a nested pattern", async () => {
      expect(
        await lines(
          `  const { 0: z, id: { length } } = ${USER}\n  res.json(z)\n  res.json(length)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:36
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=0 static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id.length static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:23
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=0 static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id.length static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
      `)
    })

    it("array destructuring: elements, holes, defaults and rest", async () => {
      expect(
        await lines(
          `  const [first, , third = ${USER}.id, ...others] = ${TAGS}\n  res.json(first.label)\n  res.json(third)\n  res.json(others)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:79
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:10
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:6:3"
      `)
    })

    it("parameter defaults, rest parameters and destructured parameters", async () => {
      expect(
        await lines(
          `  res.json(f(${USER}))\n  res.json(g(${USER}, ${USER}.name))\n  res.json(d(${USER}))`,
          `function f(v: any, w = ${USER}.email) { return w }\nfunction g(...all: any[]) { return all }\nfunction d({ id, ...r }: any) { return [id, r] }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts f static bk= cl= src=2:1
        N return app/p.ts f#return static bk= cl= src=
        N function app/p.ts h static bk= cl= src=5:1
        N parameter app/p.ts f.v static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts g static bk= cl= src=3:1
        N parameter app/p.ts g.all static bk= cl= src=
        N parameter app/p.ts g.arg1 static bk= cl= src=
        N return app/p.ts g#return static bk= cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N function app/p.ts d static bk= cl= src=4:1
        N parameter app/p.ts d.arg0 static bk= cl= src=
        N return app/p.ts d#return static bk= cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts f.w static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#f p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:24
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#f p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:24
        E returns function:app/p.ts#f->return:app/p.ts#f#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:68
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:13
        E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:6:11
        E passes function:app/p.ts#h->parameter:app/p.ts#f.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E passes return:app/p.ts#f#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:49
        E calls function:app/p.ts#h->function:app/p.ts#g p=- static o= h= @app/p.ts:7:11
        E passes function:app/p.ts#h->parameter:app/p.ts#g.all p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
        E passes function:app/p.ts#h->parameter:app/p.ts#g.arg1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
        E reads parameter:app/p.ts#g.all->function:app/p.ts#g p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
        E returns function:app/p.ts#g->return:app/p.ts#g#return p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
        E reads parameter:app/p.ts#g.arg1->function:app/p.ts#g p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
        E returns function:app/p.ts#g->return:app/p.ts#g#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:29
        E passes return:app/p.ts#g#return->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E passes return:app/p.ts#g#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E calls function:app/p.ts#h->function:app/p.ts#d p=- static o= h= @app/p.ts:8:11
        E passes function:app/p.ts#h->parameter:app/p.ts#d.arg0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:11
        E reads parameter:app/p.ts#d.arg0->function:app/p.ts#d p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:14
        E returns function:app/p.ts#d->return:app/p.ts#d#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
        E reads parameter:app/p.ts#d.arg0->function:app/p.ts#d p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
        E returns function:app/p.ts#d->return:app/p.ts#d#return p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:33
        E passes return:app/p.ts#d#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E passes return:app/p.ts#d#return->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3"
      `)
    })

    it("missing arguments bind to nothing", async () => {
      expect(
        await lines(
          `  res.json(f())\n  res.json(f(${USER}.id))`,
          `function f(a?: any, b?: any) { return b }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/p.ts f static bk= cl= src=2:1
        N parameter app/p.ts f.a static bk= cl= src=
        N parameter app/p.ts f.b static bk= cl= src=
        N return app/p.ts f#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:13
        E passes function:app/p.ts#h->parameter:app/p.ts#f.a p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11"
      `)
    })
  })

  describe("operators", () => {
    const run = async (expression: string): Promise<string[]> => {
      const input = (await h.scanDistinct(handler(`  res.json(${expression})`))).input
      return input.edges
        .filter((e) => e.kind === "side-effect")
        .map((e) => `${(e.path ?? []).join(".")}|${e.status}`)
    }

    it.each([
      ["&&", "static"],
      ["||", "static"],
      ["??", "static"],
      ["+", "inferred"],
      ["-", "inferred"],
      ["*", "inferred"],
      ["/", "inferred"],
      ["%", "inferred"],
      ["**", "inferred"],
    ])("%s merges both sides (%s)", async (operator, status) => {
      expect(await run(`${USER}.id ${operator} ${USER}.name`)).toEqual([
        `id|${status}`,
        `name|${status}`,
      ])
    })

    it.each([
      "==",
      "===",
      "!=",
      "!==",
      "<",
      ">",
      "<=",
      ">=",
      "&",
      "|",
      "^",
      "<<",
      ">>",
      ">>>",
      "instanceof",
      "in",
    ])("%s carries no data", async (operator) => {
      const input = (
        await h.scanDistinct(handler(`  res.json(${USER}.id ${operator} ${USER}.name as any)`))
      ).input
      expect(input.edges.filter((e) => e.kind === "side-effect")).toEqual([])
    })

    it("the comma operator carries no data", async () => {
      expect(await run(`(${USER}.id, ${USER}.name)`)).toEqual([])
    })

    it.each([
      ["+=", ["id|static", "id|inferred", "name|inferred"]],
      ["||=", ["id|static", "name|static"]],
      ["??=", ["id|static", "name|static"]],
      ["&&=", ["id|static", "name|static"]],
      ["-=", ["id|static"]],
      ["*=", ["id|static"]],
      ["/=", ["id|static"]],
      ["%=", ["id|static"]],
      ["**=", ["id|static"]],
      ["|=", ["id|static"]],
    ])("a %s b", async (operator, expected) => {
      const input = (
        await h.scanDistinct(
          handler(`  let a: any = ${USER}.id\n  a ${operator} ${USER}.name\n  res.json(a)`),
        )
      ).input
      expect(
        input.edges
          .filter((e) => e.kind === "side-effect")
          .map((e) => `${(e.path ?? []).join(".")}|${e.status}`),
      ).toEqual(expected)
    })

    it("a compound assignment returns the merged value", async () => {
      expect(
        await lines(
          `  let a: any = ${USER}.id\n  res.json((a += ${USER}.name))\n  res.json((a ||= 1))`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
      `)
    })

    it("assignment returns the assigned value and rebinds the variable", async () => {
      expect(await lines(`  let a: any\n  res.json((a = ${USER}.id))\n  res.json(a)`))
        .toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
      `)
    })

    it("unary operators read their operand and carry nothing", async () => {
      expect(
        await lines(
          `  let n: any = ${USER}.id\n  res.json(!${USER}.name)\n  res.json(-${USER}.email)\n  n++\n  --n\n  res.json(typeof ${USER}.role)\n  res.json(void ${USER}.id)\n  delete (${USER} as any).name\n  res.json(n)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b4 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:18
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3"
      `)
    })

    it("templates and tagged templates are approximate", async () => {
      expect(
        await lines(
          `  res.json(\`a \${${USER}.id} b \${${USER}.name}\`)\n  res.json(tag\`x \${${USER}.email}\`)\n  res.json(tag\`plain\`)\n  res.json(\`plain\`)`,
          `const tag = (s: any, ...v: any[]) => v\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N function app/p.ts tag static bk= cl= src=2:13
        N parameter app/p.ts tag.s static bk= cl= src=
        N parameter app/p.ts tag.v static bk= cl= src=
        N return app/p.ts tag#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:59
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:19
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3"
      `)
    })

    it("conditional reads the condition and merges both branches", async () => {
      expect(await lines(`  res.json(${USER}.id ? ${USER}.name : ${USER}.email)`))
        .toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:51
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:93
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3"
      `)
    })

    it("await, as, satisfies, non-null, and parentheses are transparent", async () => {
      expect(
        await lines(
          `  res.json(await ${USER}.id)\n  res.json((${USER}.name))\n  res.json(${USER}.email as string)\n  res.json(${USER}.role satisfies string)\n  res.json(${USER}.id!)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"
      `)
    })

    it("spread elements in arrays, calls and objects", async () => {
      expect(
        await lines(
          `  res.json([...${TAGS}, ${USER}.id])\n  res.json({ ...${USER}, extra: ${USER}.name })\n  res.json(Math.max(...[${USER}.email]))\n  const arr = [${USER}.role]\n  res.json(arr[0])\n  res.json(arr[key])`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:15
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:51
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:51
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:3:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:59
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:24
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:16
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=role inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        U dynamic-access app/p.ts:8:11 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/role"
      `)
    })

    it("new expressions", async () => {
      expect(
        await lines(`  res.json(new Thing(${USER}.id, ...[${USER}.name]))\n  res.json(new Thing)`),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:21
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:64
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        U unresolved-call app/p.ts:3:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id,field:features/user/user.ts#userData.user/name"
      `)
    })
  })

  describe("object and array literals, member access and assignment targets", () => {
    it("property keys: identifier, string, numeric, computed; shorthand; methods; duplicates", async () => {
      expect(
        await lines(
          `  const id = ${USER}.id\n  const missing2 = 1\n  const o = { id, "s": ${USER}.name, 7: ${USER}.email, [key]: ${USER}.role, m() { return ${USER}.id }, dup: ${USER}.id, dup: ${USER}.name, get g() { return 1 }, ...${USER} }\n  res.json(o.id)\n  res.json(o.s)\n  res.json(o[7])\n  res.json(o.m)\n  res.json(o.dup)\n  res.json(o.nothing)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N boundary boundary:code b5 static bk=log cl= src=
        N function app/p.ts h>m@5:158 static bk= cl= src=5:158
        N return app/p.ts h>m@5:158#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:14
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:14
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:24
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:68
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:117
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role.id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=role.id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role.s inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=s static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=role.s inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=s static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role.[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=role.[] inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=[] static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role.m inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:9:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=m static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p=role.m inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p=m static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role.dup inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=dup static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=role.dup inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=dup static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role.nothing inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:11:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=nothing static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p=role.nothing inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p=nothing static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>m@5:158 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:171
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>m@5:158 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:171
        E returns function:app/p.ts#h>m@5:158->return:app/p.ts#h>m@5:158#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:164"
      `)
    })

    it("a shorthand property naming an unbound variable is empty", async () => {
      expect(await lines(`  const o = { unbound }\n  res.json(o)`)).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src="
      `)
    })

    it("a method with a computed name is analyzed but not stored", async () => {
      expect(await lines(`  const o = { [key]() { return ${USER}.id } }\n  res.json(o)`))
        .toMatchInlineSnapshot(`
        "N function app/p.ts h>anonymous@3:15 static bk= cl= src=3:15
        N return app/p.ts h>anonymous@3:15#return static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@3:15 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@3:15 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:32
        E returns function:app/p.ts#h>anonymous@3:15->return:app/p.ts#h>anonymous@3:15#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25"
      `)
    })

    it("element access with a string literal, a number and a computed key", async () => {
      expect(
        await lines(
          `  res.json(${USER}["email"])\n  res.json(${TAGS}[0])\n  res.json(${USER}[key])\n  res.json(({} as any)[key])\n  res.json(${USER}[("name") as any])`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        U dynamic-access app/p.ts:5:11 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("optional chaining reads like a plain access", async () => {
      expect(await lines(`  res.json(${USER}?.email)\n  res.json(${USER}?.["name"])`))
        .toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3"
      `)
    })

    it("assignment targets: property, string element, dynamic element, nested, destructuring", async () => {
      expect(
        await lines(
          `  const a: any = {}\n  a.x = ${USER}.id\n  a["y"] = ${USER}.name\n  a[key] = ${USER}.email\n  a.deep.er = ${USER}.role\n  ;({ p: a.q } = { p: ${USER}.id })\n  ;[a.r] = [${USER}.name]\n  res.json(a.x)\n  res.json(a.y)\n  res.json(a.q)\n  res.json(a.r)\n  res.json(a.deep)\n  res.json(a)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b5 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:9
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:9
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:15
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:15:3"
      `)
    })

    it("assigning to a captured variable updates the outer binding", async () => {
      expect(
        await lines(
          `  let out: any\n  const set = () => { out = ${USER}.id }\n  set()\n  res.json(out)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N function app/p.ts h>anonymous@4:15 static bk= cl= src=4:15
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N return app/p.ts h>anonymous@4:15#return static bk= cl= src=
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:15 p=- static o= h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@4:15 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:29
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@4:15 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:29
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
      `)
    })

    it("assigning to an undeclared name defines it and merges with a prior value", async () => {
      expect(
        await lines(
          `  let v: any = ${USER}.id\n  v = ${USER}.name\n  res.json(v)\n  und = ${USER}.email\n  res.json(und)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:7
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:9
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3"
      `)
    })

    it("an assignment through a non-identifier base stores nothing", async () => {
      expect(
        await lines(
          `  const a: any = {}\n  f().x = ${USER}.id\n  res.json(a)`,
          `function f(): any { return {} }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/p.ts f static bk= cl= src=2:1
        N return app/p.ts f#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11"
      `)
    })
  })

  describe("jsx", () => {
    const jsx = async (body: string, extra = "") =>
      dump(
        (
          await h.scanDistinct({
            "app/p.tsx": `${IMPORT_CAP}${extra}export function h(res: any) {\n${body}\n}\n`,
          })
        ).input,
      )
        .filter((l) => !l.startsWith("N field") && !l.startsWith("E discards"))
        .join("\n")

    it("attributes, spreads, children and component resolution", async () => {
      expect(
        await jsx(
          `  const a = <Comp id={${USER}.id} flag label="x" {...${USER}} data-x={${USER}.name} xlink:href={${USER}.role}>{${USER}.email}</Comp>\n  const b = <Comp id={${USER}.id} />\n  const c = <div id={${USER}.id}>{${USER}.name}text</div>\n  const d = <ns.Comp id={${USER}.id} />\n  const e = <Empty>{}</Empty>\n  void a, b, c, d, e`,
          `function Comp(props: any) { return props.id }\nfunction Empty(props: any) { return 1 }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.tsx h static bk= cl= src=4:1
        N function app/p.tsx Comp static bk= cl= src=2:1
        N parameter app/p.tsx Comp.props static bk= cl= src=
        N return app/p.tsx Comp#return static bk= cl= src=
        N function app/p.tsx Empty static bk= cl= src=3:1
        N parameter app/p.tsx Empty.props static bk= cl= src=
        N return app/p.tsx Empty#return static bk= cl= src=
        N parameter app/p.tsx h.res static bk= cl= src=
        N return app/p.tsx h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p= static o=field:features/user/user.ts#userData.user h= @app/p.tsx:5:23
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:5:23
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.tsx:5:125
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.tsx:5:178
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.tsx:5:220
        E calls function:app/p.tsx#h->function:app/p.tsx#Comp p=- static o= h= @app/p.tsx:5:13
        E passes function:app/p.tsx#h->parameter:app/p.tsx#Comp.props p= static o=field:features/user/user.ts#userData.user h= @app/p.tsx:5:13
        E passes function:app/p.tsx#h->parameter:app/p.tsx#Comp.props p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:5:13
        E passes function:app/p.tsx#h->parameter:app/p.tsx#Comp.props p=name static o=field:features/user/user.ts#userData.user h= @app/p.tsx:5:13
        E reads parameter:app/p.tsx#Comp.props->function:app/p.tsx#Comp p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:2:36
        E returns function:app/p.tsx#Comp->return:app/p.tsx#Comp#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:2:29
        E calls function:app/p.tsx#h->function:app/p.tsx#Empty p=- static o= h= @app/p.tsx:9:13
        U unresolved-call app/p.tsx:7:13 subject=function:app/p.tsx#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
        U unresolved-call app/p.tsx:8:13 subject=function:app/p.tsx#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
      `)
    })

    it("fragments evaluate their expression children", async () => {
      expect(
        await jsx(
          `  const f = <>{${USER}.id}text{}<Comp id={1} /></>\n  void f`,
          `function Comp(props: any) { return props }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.tsx h static bk= cl= src=3:1
        N function app/p.tsx Comp static bk= cl= src=2:1
        N parameter app/p.tsx Comp.props static bk= cl= src=
        N return app/p.tsx Comp#return static bk= cl= src=
        N parameter app/p.tsx h.res static bk= cl= src=
        N return app/p.tsx h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p= static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:16
        E calls function:app/p.tsx#h->function:app/p.tsx#Comp p=- static o= h= @app/p.tsx:4:60"
      `)
    })

    it("a lowercase element is never a component", async () => {
      expect(
        await jsx(
          `  const f = <comp id={${USER}.id} />\n  void f`,
          `function comp(props: any) { return props.id }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.tsx h static bk= cl= src=3:1
        N function app/p.tsx comp static bk= cl= src=2:1
        N parameter app/p.tsx comp.props static bk= cl= src=
        N return app/p.tsx comp#return static bk= cl= src=
        N parameter app/p.tsx h.res static bk= cl= src=
        N return app/p.tsx h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p= static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:23
        E reads field:features/user/user.ts#userData.user->function:app/p.tsx#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:23
        E calls function:app/p.tsx#h->function:app/p.tsx#comp p=- static o= h= @app/p.tsx:4:13
        E passes function:app/p.tsx#h->parameter:app/p.tsx#comp.props p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:4:13
        E reads parameter:app/p.tsx#comp.props->function:app/p.tsx#comp p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:2:36
        E returns function:app/p.tsx#comp->return:app/p.tsx#comp#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.tsx:2:29"
      `)
    })
  })
})
