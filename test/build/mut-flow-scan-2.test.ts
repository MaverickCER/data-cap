import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { DataFlowEndpoint } from "../../src/core/document.js"
import {
  CAP_FILE,
  CAP_SOURCE,
  capability,
  dump,
  field,
  handler,
  IMPORT_CAP,
  inventoryOf,
  makeHarness,
  operation,
  USER,
} from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

const endpoint = (
  direction: "input" | "output",
  kind: string,
  name: string,
  handling?: string,
): DataFlowEndpoint =>
  ({ direction, kind, name, ...(handling === undefined ? {} : { handling }) }) as DataFlowEndpoint

describe("flow-scan: registration and indexing", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })
  const lines = async (...args: Parameters<Harness["scan"]>) =>
    dump((await h.scanDistinct(...args)).input).join("\n")

  describe("registerCapabilities", () => {
    it("nodes carry sensitivity as classification and the declaration position as source", async () => {
      const inventory = inventoryOf(
        capability({
          fields: [
            field("user", {}, { declarationPosition: { line: 3, column: 7 } }, "secret"),
            field("plain", {}),
            field("tagged", {}, { declarationPosition: undefined }, "public"),
          ],
        }),
      )
      expect(await lines({}, {}, inventory)).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=3:7
        N field features/user/user.ts userData.plain static bk= cl= src=
        N field features/user/user.ts userData.tagged static bk= cl=public src="
      `)
    })

    it("a nested field path is keyed by its first segment and named by the whole path", async () => {
      const inventory = inventoryOf(
        capability({ fields: [{ ...field("a", { b: "" }), path: ["a", "b"] }] }),
      )
      expect(await lines(handler(`  res.json(userData.getSnapshot().fields.a.b)`), {}, inventory))
        .toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.a.b static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.a.b->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.a.b h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.a.b->function:app/p.ts#h p=b static o=field:features/user/user.ts#userData.a.b h= @app/p.ts:3:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=b static o=field:features/user/user.ts#userData.a.b h= @app/p.ts:3:3"
      `)
    })

    it("a field with an empty path falls back to its joined name", async () => {
      const inventory = inventoryOf(capability({ fields: [{ ...field("x", {}), path: [] }] }))
      expect(await lines({}, {}, inventory)).toMatchInlineSnapshot(
        `"N field features/user/user.ts userData. static bk= cl= src="`,
      )
    })

    it("declared edges: inputs point at the field, outputs away from it, with handling when given", async () => {
      const inventory = inventoryOf(
        capability({
          fields: [field("user", USER_SHAPE_LOCAL), field("team", {})],
          getters: [
            operation("getter", "load", {
              writes: [["user"]],
              endpoints: [
                endpoint("input", "database", "db", "encrypted"),
                endpoint("output", "client-response", "api"),
              ],
            }),
          ],
          mutators: [
            operation("mutator", "save", {
              writes: [["user", "email"], ["team"], ["missing"]],
              endpoints: [
                endpoint("output", "database", "db", "plaintext"),
                endpoint("output", "database", "db", "plaintext"),
                endpoint("input", "queue", "db"),
              ],
            }),
          ],
          subscriptions: [
            operation("subscription", "watch", {
              writes: [["team"]],
              endpoints: [endpoint("output", "websocket", "api", "redacted")],
            }),
          ],
        }),
      )
      expect(await lines({}, {}, inventory)).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl= src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N boundary boundary db declared bk=database cl= src=
        N boundary boundary api declared bk=client-response cl= src=
        N boundary boundary db#queue declared bk=queue cl= src=
        N boundary boundary api#websocket declared bk=websocket cl= src=
        E crosses-boundary boundary:boundary#db->field:features/user/user.ts#userData.user p=- declared o=field:features/user/user.ts#userData.user h=encrypted @
        E crosses-boundary field:features/user/user.ts#userData.user->boundary:boundary#api p=- declared o=field:features/user/user.ts#userData.user h= @
        E crosses-boundary field:features/user/user.ts#userData.user->boundary:boundary#db p=- declared o=field:features/user/user.ts#userData.user h=plaintext @
        E crosses-boundary boundary:boundary#db#queue->field:features/user/user.ts#userData.user p=- declared o=field:features/user/user.ts#userData.user h= @
        E crosses-boundary field:features/user/user.ts#userData.team->boundary:boundary#db p=- declared o=field:features/user/user.ts#userData.team h=plaintext @
        E crosses-boundary boundary:boundary#db#queue->field:features/user/user.ts#userData.team p=- declared o=field:features/user/user.ts#userData.team h= @
        E crosses-boundary field:features/user/user.ts#userData.team->boundary:boundary#api#websocket p=- declared o=field:features/user/user.ts#userData.team h=redacted @"
      `)
    })

    it("a write with no path component is keyed by the empty name and finds no field", async () => {
      const inventory = inventoryOf(
        capability({
          getters: [
            operation("getter", "g", { writes: [[]], endpoints: [endpoint("input", "x", "y")] }),
          ],
        }),
      )
      expect(await lines({}, {}, inventory)).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src="
      `)
    })

    it("two capabilities in different files are registered separately", async () => {
      const second = capability({
        file: "features/team/team.ts",
        exportName: "teamData",
        fields: [field("members", { n: "" })],
      })
      expect(
        await lines(
          {
            "features/team/team.ts": `export const teamData = createData({});\n`,
            "app/p.ts": `import { userData } from "../features/user/user.js";\nimport { teamData } from "../features/team/team.js";\nexport function h(res: any) {\n  res.json(userData.getSnapshot().fields.user.email)\n  res.json(teamData.getSnapshot().fields.members.n)\n}\n`,
          },
          {},
          inventoryOf(capability(), second),
        ),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N field features/team/team.ts teamData.members static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/team/team.ts#teamData.members->function:app/p.ts#h p= static o=field:features/team/team.ts#teamData.members h= @app/p.ts:5:11
        E reads field:features/team/team.ts#teamData.members->function:app/p.ts#h p=n static o=field:features/team/team.ts#teamData.members h= @app/p.ts:5:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=n static o=field:features/team/team.ts#teamData.members h= @app/p.ts:5:3
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("an exported name shared by two files binds the one whose file matches", async () => {
      const other = capability({
        file: "features/other/user.ts",
        exportName: "userData",
        fields: [field("o", { v: "" })],
      })
      expect(
        await lines(
          {
            "features/other/user.ts": `export const userData = createData({});\n`,
            "app/p.ts": `import { userData } from "../features/other/user.js";\nexport function h(res: any) {\n  res.json(userData.getSnapshot().fields.o.v)\n}\n`,
          },
          {},
          inventoryOf(capability(), other),
        ),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N field features/other/user.ts userData.o static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/other/user.ts#userData.o->function:app/p.ts#h p= static o=field:features/other/user.ts#userData.o h= @app/p.ts:3:11
        E reads field:features/other/user.ts#userData.o->function:app/p.ts#h p=v static o=field:features/other/user.ts#userData.o h= @app/p.ts:3:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=v static o=field:features/other/user.ts#userData.o h= @app/p.ts:3:3"
      `)
    })
  })

  describe("indexing imports", () => {
    it("an aliased import binds the capability under its local name", async () => {
      expect(
        await lines({
          "app/p.ts": `import { userData as ud } from "../features/user/user.js";\nexport function h(res: any) {\n  res.json(ud.getSnapshot().fields.user.email)\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("an unrelated import does not bind a capability", async () => {
      expect(
        await lines({
          "app/other.ts": `export const userData = 1;\n`,
          "app/p.ts": `import { userData } from "./other.js";\nexport function h(res: any) {\n  res.json(userData.getSnapshot().fields.user.email)\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("a default import is resolved to the default-exported function", async () => {
      expect(
        await lines({
          "app/d.ts": `export default function d(v: any) { return v }\n`,
          "app/p.ts": `import d from "./d.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(d(${USER}.email))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N function app/d.ts d static bk= cl= src=1:1
        N parameter app/d.ts d.v static bk= cl= src=
        N return app/d.ts d#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E calls function:app/p.ts#h->function:app/d.ts#d p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/d.ts#d.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/d.ts#d.v->function:app/d.ts#d p=email static o=field:features/user/user.ts#userData.user h= @app/d.ts:1:37
        E returns function:app/d.ts#d->return:app/d.ts#d#return p=email static o=field:features/user/user.ts#userData.user h= @app/d.ts:1:37
        E passes return:app/d.ts#d#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("an unresolvable import leaves its calls unresolved", async () => {
      expect(
        await lines({
          "app/p.ts": `import { nope } from "./missing.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(nope(${USER}.email))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
        U unresolved-call app/p.ts:4:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
      `)
    })

    it("a named import of a function follows it across files", async () => {
      expect(
        await lines({
          "app/util.ts": `export function pick(v: any, w: any) { return v.name }\n`,
          "app/p.ts": `import { pick as choose } from "./util.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(choose(${USER}, 1))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N function app/util.ts pick static bk= cl= src=1:1
        N parameter app/util.ts pick.v static bk= cl= src=
        N return app/util.ts pick#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N parameter app/util.ts pick.w static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
        E calls function:app/p.ts#h->function:app/util.ts#pick p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/util.ts#pick.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/util.ts#pick.v->function:app/util.ts#pick p=name static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:47
        E returns function:app/util.ts#pick->return:app/util.ts#pick#return p=name static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:40
        E passes return:app/util.ts#pick#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E discards function:app/util.ts#pick->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#pick->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#pick->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#pick->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("a namespace import resolves members, also as a value, and a missing member is an unresolved call", async () => {
      expect(
        await lines({
          "app/util.ts": `export function pick(v: any) { return v.name }\n`,
          "app/p.ts": `import * as u from "./util.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(u.pick(${USER}))\n  res.json(u.nothing(${USER}))\n  const f = u.pick\n  res.json(f(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N function app/util.ts pick static bk= cl= src=1:1
        N parameter app/util.ts pick.v static bk= cl= src=
        N return app/util.ts pick#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:18
        E calls function:app/p.ts#h->function:app/util.ts#pick p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/util.ts#pick.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/util.ts#pick.v->function:app/util.ts#pick p=name static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:39
        E returns function:app/util.ts#pick->return:app/util.ts#pick#return p=name static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:32
        E passes return:app/util.ts#pick#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E discards function:app/util.ts#pick->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#pick->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#pick->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#pick->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
        U unresolved-call app/p.ts:5:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })
  })

  describe("indexing statements", () => {
    it("exported and unexported functions and arrow constants are all analyzed; only exports are importable", async () => {
      expect(
        await lines({
          "app/util.ts": `function hidden(v: any) { return v.id }\nexport function shown(v: any) { return v.name }\nexport const arrow = (v: any) => v.email\nconst local = (v: any) => v.role\nexport const fe = function (v: any) { return v.id }\nexport const notFn = 5, alsoFn = (v: any) => v\nexport const typed = ((v: any) => v) as any\n`,
          "app/p.ts": `import { shown, arrow, hidden, local, fe, notFn, alsoFn, typed } from "./util.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(shown(${USER}))\n  res.json(arrow(${USER}))\n  res.json(hidden(${USER}))\n  res.json(local(${USER}))\n  res.json(fe(${USER}))\n  res.json(notFn(${USER}))\n  res.json(alsoFn(${USER}))\n  res.json(typed(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N function app/util.ts shown static bk= cl= src=2:1
        N parameter app/util.ts shown.v static bk= cl= src=
        N return app/util.ts shown#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/util.ts arrow static bk= cl= src=3:22
        N parameter app/util.ts arrow.v static bk= cl= src=
        N return app/util.ts arrow#return static bk= cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N function app/util.ts fe static bk= cl= src=5:19
        N parameter app/util.ts fe.v static bk= cl= src=
        N return app/util.ts fe#return static bk= cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N boundary boundary:code b5 static bk=log cl= src=
        N function app/util.ts alsoFn static bk= cl= src=6:34
        N parameter app/util.ts alsoFn.v static bk= cl= src=
        N return app/util.ts alsoFn#return static bk= cl= src=
        N boundary boundary:code b6 static bk=log cl= src=
        N function app/util.ts typed static bk= cl= src=7:23
        N parameter app/util.ts typed.v static bk= cl= src=
        N return app/util.ts typed#return static bk= cl= src=
        N boundary boundary:code b7 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N function app/util.ts hidden static bk= cl= src=1:1
        N parameter app/util.ts hidden.v static bk= cl= src=
        N return app/util.ts hidden#return static bk= cl= src=
        N function app/util.ts local static bk= cl= src=4:15
        N parameter app/util.ts local.v static bk= cl= src=
        N return app/util.ts local#return static bk= cl= src=
        N function app/util.ts <module>>anonymous@6:34 static bk= cl= src=6:34
        N parameter app/util.ts <module>>anonymous@6:34.v static bk= cl= src=
        N return app/util.ts <module>>anonymous@6:34#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:17
        E calls function:app/p.ts#h->function:app/util.ts#shown p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/util.ts#shown.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/util.ts#shown.v->function:app/util.ts#shown p=name static o=field:features/user/user.ts#userData.user h= @app/util.ts:2:40
        E returns function:app/util.ts#shown->return:app/util.ts#shown#return p=name static o=field:features/user/user.ts#userData.user h= @app/util.ts:2:33
        E passes return:app/util.ts#shown#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E calls function:app/p.ts#h->function:app/util.ts#arrow p=- static o= h= @app/p.ts:5:11
        E passes function:app/p.ts#h->parameter:app/util.ts#arrow.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads parameter:app/util.ts#arrow.v->function:app/util.ts#arrow p=email static o=field:features/user/user.ts#userData.user h= @app/util.ts:3:34
        E returns function:app/util.ts#arrow->return:app/util.ts#arrow#return p=email static o=field:features/user/user.ts#userData.user h= @app/util.ts:3:34
        E passes return:app/util.ts#arrow#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E calls function:app/p.ts#h->function:app/util.ts#fe p=- static o= h= @app/p.ts:8:11
        E passes function:app/p.ts#h->parameter:app/util.ts#fe.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:11
        E reads parameter:app/util.ts#fe.v->function:app/util.ts#fe p=id static o=field:features/user/user.ts#userData.user h= @app/util.ts:5:46
        E returns function:app/util.ts#fe->return:app/util.ts#fe#return p=id static o=field:features/user/user.ts#userData.user h= @app/util.ts:5:39
        E passes return:app/util.ts#fe#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
        E calls function:app/p.ts#h->function:app/util.ts#alsoFn p=- static o= h= @app/p.ts:10:11
        E passes function:app/p.ts#h->parameter:app/util.ts#alsoFn.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:11
        E reads parameter:app/util.ts#alsoFn.v->function:app/util.ts#alsoFn p= static o=field:features/user/user.ts#userData.user h= @app/util.ts:6:46
        E returns function:app/util.ts#alsoFn->return:app/util.ts#alsoFn#return p= static o=field:features/user/user.ts#userData.user h= @app/util.ts:6:46
        E passes return:app/util.ts#alsoFn#return->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b6 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E calls function:app/p.ts#h->function:app/util.ts#typed p=- static o= h= @app/p.ts:11:11
        E passes function:app/p.ts#h->parameter:app/util.ts#typed.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:11
        E reads parameter:app/util.ts#typed.v->function:app/util.ts#typed p= static o=field:features/user/user.ts#userData.user h= @app/util.ts:7:35
        E returns function:app/util.ts#typed->return:app/util.ts#typed#return p= static o=field:features/user/user.ts#userData.user h= @app/util.ts:7:35
        E passes return:app/util.ts#typed#return->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b7 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
        E discards function:app/util.ts#shown->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#shown->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#shown->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#shown->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#arrow->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#arrow->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#arrow->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#arrow->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#fe->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#fe->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#fe->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#fe->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
        U unresolved-call app/p.ts:6:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
        U unresolved-call app/p.ts:7:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
        U unresolved-call app/p.ts:9:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("a function declaration without a body is not a function", async () => {
      expect(
        await lines({
          "app/util.ts": `export function over(v: any): any;\nexport function over(v: any): any { return v.id }\nexport declare function ambient(v: any): any;\n`,
          "app/p.ts": `import { over, ambient } from "./util.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(over(${USER}))\n  res.json(ambient(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N function app/util.ts over static bk= cl= src=2:1
        N parameter app/util.ts over.v static bk= cl= src=
        N return app/util.ts over#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E calls function:app/p.ts#h->function:app/util.ts#over p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/util.ts#over.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/util.ts#over.v->function:app/util.ts#over p=id static o=field:features/user/user.ts#userData.user h= @app/util.ts:2:44
        E returns function:app/util.ts#over->return:app/util.ts#over#return p=id static o=field:features/user/user.ts#userData.user h= @app/util.ts:2:37
        E passes return:app/util.ts#over#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E discards function:app/util.ts#over->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#over->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#over->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/util.ts#over->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
        U unresolved-call app/p.ts:5:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("export lists, aliases and re-exports resolve to the original function", async () => {
      expect(
        await lines({
          "app/a.ts": `function real(v: any) { return v.id }\nexport { real as renamed, real }\n`,
          "app/b.ts": `export { renamed as again } from "./a.js"\nexport { real } from "./a.js"\n`,
          "app/c.ts": `export { again as third } from "./b.js"\n`,
          "app/p.ts": `import { third } from "./c.js";\nimport { real } from "./b.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(third(${USER}))\n  res.json(real(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=4:1
        N function app/a.ts real static bk= cl= src=1:1
        N parameter app/a.ts real.v static bk= cl= src=
        N return app/a.ts real#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:17
        E calls function:app/p.ts#h->function:app/a.ts#real p=- static o= h= @app/p.ts:5:11
        E passes function:app/p.ts#h->parameter:app/a.ts#real.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads parameter:app/a.ts#real.v->function:app/a.ts#real p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:1:32
        E returns function:app/a.ts#real->return:app/a.ts#real#return p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:1:25
        E passes return:app/a.ts#real#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E discards function:app/a.ts#real->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/a.ts#real->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/a.ts#real->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/a.ts#real->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("a star re-export is followed to the function it re-exports", async () => {
      expect(
        await lines({
          "app/a.ts": `export function real(v: any) { return v.id }\n`,
          "app/b.ts": `export * from "./a.js"\nexport * as ns from "./a.js"\n`,
          "app/p.ts": `import { real } from "./b.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(real(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N function app/a.ts real static bk= cl= src=1:1
        N parameter app/a.ts real.v static bk= cl= src=
        N return app/a.ts real#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E calls function:app/p.ts#h->function:app/a.ts#real p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/a.ts#real.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/a.ts#real.v->function:app/a.ts#real p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:1:39
        E returns function:app/a.ts#real->return:app/a.ts#real#return p=id static o=field:features/user/user.ts#userData.user h= @app/a.ts:1:32
        E passes return:app/a.ts#real#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E discards function:app/a.ts#real->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/a.ts#real->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/a.ts#real->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/a.ts#real->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("an export list from an unresolvable module resolves to nothing", async () => {
      expect(
        await lines({
          "app/b.ts": `export { gone } from "./missing.js"\n`,
          "app/p.ts": `import { gone } from "./b.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(gone(${USER}))\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        U unresolved-call app/p.ts:4:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("a re-export chain of exactly 9 hops is followed and one of 10 is not", async () => {
      const chain = (hops: number): Record<string, string> => {
        const files: Record<string, string> = {
          "app/r0.ts": `export function real(v: any) { return v.id }\n`,
        }
        for (let i = 1; i <= hops; i += 1)
          files[`app/r${i}.ts`] = `export { real } from "./r${i - 1}.js"\n`
        files["app/p.ts"] =
          `import { real } from "./r${hops}.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(real(${USER}))\n}\n`
        return files
      }
      expect(await lines(chain(8))).toContain("calls")
      const nine = await lines(chain(9))
      const ten = await lines(chain(10))
      expect([nine.includes("real"), ten.includes("unresolved-call")]).toEqual([true, true])
      expect(nine).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N function app/r0.ts real static bk= cl= src=1:1
        N parameter app/r0.ts real.v static bk= cl= src=
        N return app/r0.ts real#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        U unresolved-call app/p.ts:4:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("module-level statements run once and give functions their top-level values", async () => {
      expect(
        await lines({
          "app/p.ts": `${IMPORT_CAP}const snap = ${USER}\nlet counter = 0\nexport const exported = 1\ntype T = string\ninterface I { a: string }\nenum E { A }\nclass C {}\ndeclare module "x" {}\nexport default snap\nexport function h(res: any) {\n  res.json(snap.email)\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts <module> static bk= cl= src=
        N function app/p.ts h static bk= cl= src=11:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:14
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:3
        E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#<module>->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("a capability file's own export is usable inside it, and its schema constant stays opaque", async () => {
      expect(
        await lines({
          [CAP_FILE]: `const schema = { fields: { user: {} }, run: () => console.log(1) }\nexport const userData = createData(schema)\nexport function leak(res: any) { res.json(userData.getSnapshot().fields.user.email) }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function features/user/user.ts leak static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter features/user/user.ts leak.res static bk= cl= src=
        N return features/user/user.ts leak#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:features/user/user.ts#leak p= static o=field:features/user/user.ts#userData.user h= @features/user/user.ts:3:42
        E reads field:features/user/user.ts#userData.user->function:features/user/user.ts#leak p=email static o=field:features/user/user.ts#userData.user h= @features/user/user.ts:3:42
        E side-effect function:features/user/user.ts#leak->boundary:boundary:code#b0 p=email static o=field:features/user/user.ts#userData.user h= @features/user/user.ts:3:34
        E discards function:features/user/user.ts#leak->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:features/user/user.ts#leak->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:features/user/user.ts#leak->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:features/user/user.ts#leak->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("two declarations with the same name get distinct nodes", async () => {
      expect(
        await lines({
          "app/p.ts": `${IMPORT_CAP}function dup(v: any) { return v.id }\nconst dup2 = 1\nexport function h(res: any) {\n  res.json(dup(${USER}))\n}\nfunction dup(v: any) { return v.name }\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=4:1
        N function app/p.ts dup@7:1 static bk= cl= src=7:1
        N parameter app/p.ts dup@7:1.v static bk= cl= src=
        N return app/p.ts dup@7:1#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts dup static bk= cl= src=2:1
        N parameter app/p.ts dup.v static bk= cl= src=
        N return app/p.ts dup#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:15
        E calls function:app/p.ts#h->function:app/p.ts#dup@7:1 p=- static o= h= @app/p.ts:5:11
        E passes function:app/p.ts#h->parameter:app/p.ts#dup@7:1.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads parameter:app/p.ts#dup@7:1.v->function:app/p.ts#dup@7:1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:31
        E returns function:app/p.ts#dup@7:1->return:app/p.ts#dup@7:1#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:24
        E passes return:app/p.ts#dup@7:1#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E discards function:app/p.ts#dup@7:1->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#dup@7:1->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#dup@7:1->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#dup@7:1->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("generated files are skipped", async () => {
      expect(
        await lines({
          "app/gen.ts": `// GENERATED FILE -- do not edit by hand. Run it.\nimport { userData } from "../features/user/user.js";\nexport function g(res: any) { res.json(userData.getSnapshot().fields.user.email) }\n`,
          "app/p.ts": `${IMPORT_CAP}export function h(res: any) {\n  res.json(${USER}.id)\n}\n`,
        }),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("files are analyzed in path order", async () => {
      const files = {
        "z/b.ts": `${IMPORT_CAP}export function zb(res: any) {\n  res.json(${USER}.id)\n}\n`,
        "a/c.ts": `${IMPORT_CAP}export function ac(res: any) {\n  res.json(${USER}.name)\n}\n`,
        "m/a.ts": `${IMPORT_CAP}export function ma(res: any) {\n  res.json(${USER}.role)\n}\n`,
      }
      expect(await lines(files)).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl=secret src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N field features/user/user.ts userData.tags static bk= cl= src=
        N field features/user/user.ts userData.empty static bk= cl= src=
        N function a/c.ts ac static bk= cl= src=2:1
        N boundary boundary:code b1 static bk=log cl= src=
        N function m/a.ts ma static bk= cl= src=2:1
        N boundary boundary:code b2 static bk=log cl= src=
        N function z/b.ts zb static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter a/c.ts ac.res static bk= cl= src=
        N return a/c.ts ac#return static bk= cl= src=
        N parameter m/a.ts ma.res static bk= cl= src=
        N return m/a.ts ma#return static bk= cl= src=
        N parameter z/b.ts zb.res static bk= cl= src=
        N return z/b.ts zb#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:a/c.ts#ac p= static o=field:features/user/user.ts#userData.user h= @a/c.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:a/c.ts#ac p=name static o=field:features/user/user.ts#userData.user h= @a/c.ts:3:11
        E side-effect function:a/c.ts#ac->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @a/c.ts:3:3
        E reads field:features/user/user.ts#userData.user->function:m/a.ts#ma p= static o=field:features/user/user.ts#userData.user h= @m/a.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:m/a.ts#ma p=role static o=field:features/user/user.ts#userData.user h= @m/a.ts:3:11
        E side-effect function:m/a.ts#ma->boundary:boundary:code#b2 p=role static o=field:features/user/user.ts#userData.user h= @m/a.ts:3:3
        E reads field:features/user/user.ts#userData.user->function:z/b.ts#zb p= static o=field:features/user/user.ts#userData.user h= @z/b.ts:3:11
        E reads field:features/user/user.ts#userData.user->function:z/b.ts#zb p=id static o=field:features/user/user.ts#userData.user h= @z/b.ts:3:11
        E side-effect function:z/b.ts#zb->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @z/b.ts:3:3
        E discards function:a/c.ts#ac->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:a/c.ts#ac->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:a/c.ts#ac->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:a/c.ts#ac->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
        E discards function:m/a.ts#ma->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
        E discards function:m/a.ts#ma->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:m/a.ts#ma->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:m/a.ts#ma->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:z/b.ts#zb->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
        E discards function:z/b.ts#zb->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
        E discards function:z/b.ts#zb->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
        E discards function:z/b.ts#zb->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
      `)
    })

    it("the capability file's own directory is relative to the root in published paths", async () => {
      expect(CAP_SOURCE).toContain("createData")
    })
  })
})

const USER_SHAPE_LOCAL = { id: "", name: "", email: "" }
