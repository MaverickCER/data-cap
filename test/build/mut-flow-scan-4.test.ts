import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { DataFlowEndpoint } from "../../src/core/document.js"
import {
  capability,
  dump,
  field,
  handler,
  IMPORT_CAP,
  inventoryOf,
  makeHarness,
  probes,
  operation,
  USER,
} from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

const TAGS = "userData.getSnapshot().fields.tags"
const endpoint = (
  direction: "input" | "output",
  kind: string,
  name: string,
  handling?: string,
): DataFlowEndpoint =>
  ({ direction, kind, name, ...(handling === undefined ? {} : { handling }) }) as DataFlowEndpoint

describe("flow-scan: calls, sinks, limits and discards", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })
  const lines = async (body: string, extra = "", options: Parameters<Harness["scan"]>[1] = {}) =>
    dump((await h.scanDistinct(handler(body, extra), options)).input)
      .filter((line) => !line.startsWith("N field") && !line.startsWith("E discards"))
      .join("\n")

  describe("sinks", () => {
    const sinkLines = async (
      bodies: readonly string[],
      extra = "",
      options: Parameters<Harness["scan"]>[1] = {},
    ) =>
      dump((await h.scan(probes(bodies, extra), options)).input)
        .filter((line) => !line.startsWith("N field") && !line.startsWith("E discards"))
        .join("\n")

    it("matches through wrappers, call chains and member chains (a this-rooted chain by its last two names) but not computed callees", async () => {
      expect(
        await sinkLines(
          [
            `  ;(res as any).json(${USER}.id)`,
            `  getRes().json(${USER}.name)`,
            `  a.b.c.send(${USER}.email)`,
            `  this.res.json(${USER}.role)`,
            `  res["json"](${USER}.id)`,
            `  res?.json(${USER}.name)`,
            `  res.status(1).set(2).json(${USER}.email)`,
            `  ;(res).send(${USER}.id)`,
            `  ;(res!).send(${USER}.name)`,
            `  ;(res satisfies any).send(${USER}.email)`,
            `  ;((res as any) as any).send(${USER}.role)`,
            `  ;(res as any)!.send(${USER}.id)`,
            `  ;(getRes() as any).json(${USER}.name)`,
            `  ;(res.a as any).json(${USER}.email)`,
          ],
          `declare const a: any\ndeclare function getRes(): any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=4:1
        N boundary boundary:code http-response static bk=client-response cl= src=
        N function app/p.ts p1 static bk= cl= src=7:1
        N function app/p.ts p2 static bk= cl= src=10:1
        N function app/p.ts p3 static bk= cl= src=13:1
        N function app/p.ts p4 static bk= cl= src=16:1
        N function app/p.ts p5 static bk= cl= src=19:1
        N function app/p.ts p6 static bk= cl= src=22:1
        N function app/p.ts p7 static bk= cl= src=25:1
        N function app/p.ts p8 static bk= cl= src=28:1
        N function app/p.ts p9 static bk= cl= src=31:1
        N function app/p.ts p10 static bk= cl= src=34:1
        N function app/p.ts p11 static bk= cl= src=37:1
        N function app/p.ts p12 static bk= cl= src=40:1
        N function app/p.ts p13 static bk= cl= src=43:1
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
        N parameter app/p.ts p5.res static bk= cl= src=
        N parameter app/p.ts p5.key static bk= cl= src=
        N return app/p.ts p5#return static bk= cl= src=
        N parameter app/p.ts p6.res static bk= cl= src=
        N parameter app/p.ts p6.key static bk= cl= src=
        N return app/p.ts p6#return static bk= cl= src=
        N parameter app/p.ts p7.res static bk= cl= src=
        N parameter app/p.ts p7.key static bk= cl= src=
        N return app/p.ts p7#return static bk= cl= src=
        N parameter app/p.ts p8.res static bk= cl= src=
        N parameter app/p.ts p8.key static bk= cl= src=
        N return app/p.ts p8#return static bk= cl= src=
        N parameter app/p.ts p9.res static bk= cl= src=
        N parameter app/p.ts p9.key static bk= cl= src=
        N return app/p.ts p9#return static bk= cl= src=
        N parameter app/p.ts p10.res static bk= cl= src=
        N parameter app/p.ts p10.key static bk= cl= src=
        N return app/p.ts p10#return static bk= cl= src=
        N parameter app/p.ts p11.res static bk= cl= src=
        N parameter app/p.ts p11.key static bk= cl= src=
        N return app/p.ts p11#return static bk= cl= src=
        N parameter app/p.ts p12.res static bk= cl= src=
        N parameter app/p.ts p12.key static bk= cl= src=
        N return app/p.ts p12#return static bk= cl= src=
        N parameter app/p.ts p13.res static bk= cl= src=
        N parameter app/p.ts p13.key static bk= cl= src=
        N return app/p.ts p13#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:22
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:22
        E side-effect function:app/p.ts#p0->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:4
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:14
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:14
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:14:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p3 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:14:17
        E side-effect function:app/p.ts#p3->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:14:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p4 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:17:15
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p4 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:17:15
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p5 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:20:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p5 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:20:13
        E side-effect function:app/p.ts#p5->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:20:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p6 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:23:29
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p6 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:23:29
        E side-effect function:app/p.ts#p6->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:23:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p7 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:26:15
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p7 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:26:15
        E side-effect function:app/p.ts#p7->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:26:4
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p8 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:29:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p8 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:29:16
        E side-effect function:app/p.ts#p8->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:29:4
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p9 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:32:29
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p9 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:32:29
        E side-effect function:app/p.ts#p9->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:32:4
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p10 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:35:31
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p10 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:35:31
        E side-effect function:app/p.ts#p10->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:35:4
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p11 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:38:23
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p11 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:38:23
        E side-effect function:app/p.ts#p11->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:38:4
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p12 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:41:27
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p12 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:41:27
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p13 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:44:24
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p13 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:44:24
        E side-effect function:app/p.ts#p13->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:44:4
        U unresolved-call app/p.ts:8:3 subject=function:app/p.ts#p1 detail=call target is not a project function data=field:features/user/user.ts#userData.user/name
        U unresolved-call app/p.ts:11:3 subject=function:app/p.ts#p2 detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
        U unresolved-call app/p.ts:17:3 subject=function:app/p.ts#p4 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
        U unresolved-call app/p.ts:41:4 subject=function:app/p.ts#p12 detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
      `)
    })

    it("only an identifier can start a sink chain", async () => {
      expect(
        await sinkLines(
          [`  this.json(${USER}.id)`, `  ;[res].at(0).json(${USER}.id)`, `  ;(1).json(${USER}.id)`],
          "",
          {
            sinks: [{ callee: "undefined.json", boundary: { kind: "log", name: "weird" } }],
          },
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=2:1
        N function app/p.ts p1 static bk= cl= src=5:1
        N function app/p.ts p2 static bk= cl= src=8:1
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        N parameter app/p.ts p2.res static bk= cl= src=
        N parameter app/p.ts p2.key static bk= cl= src=
        N return app/p.ts p2#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:21
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:21
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p2 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:13
        U unresolved-call app/p.ts:3:3 subject=function:app/p.ts#p0 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
        U unresolved-call app/p.ts:6:4 subject=function:app/p.ts#p1 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
        U unresolved-call app/p.ts:9:4 subject=function:app/p.ts#p2 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
      `)
    })

    it("a sink whose arguments carry no tracked data creates no boundary", async () => {
      expect(await sinkLines([`  res.json(1, key, { a: 1 })`])).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=2:1
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src="
      `)
    })

    it("sink arguments are merged; function arguments are analyzed; spreads are unwrapped", async () => {
      expect(
        await sinkLines([
          `  res.json(${USER}.id, ${USER}.name, () => ${USER}.email, ...[${USER}.role])`,
          `  res.json(function () { return ${USER}.id }, (() => ${USER}.name) as any)`,
        ]),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=2:1
        N boundary boundary:code http-response static bk=client-response cl= src=
        N function app/p.ts p0>anonymous@3:92 static bk= cl= src=3:92
        N return app/p.ts p0>anonymous@3:92#return static bk= cl= src=
        N function app/p.ts p1>anonymous@6:12 static bk= cl= src=6:12
        N return app/p.ts p1>anonymous@6:12#return static bk= cl= src=
        N function app/p.ts p1>anonymous@6:75 static bk= cl= src=6:75
        N return app/p.ts p1>anonymous@6:75#return static bk= cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        N function app/p.ts p1 static bk= cl= src=5:1
        N parameter app/p.ts p1.res static bk= cl= src=
        N parameter app/p.ts p1.key static bk= cl= src=
        N return app/p.ts p1#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:51
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:144
        E side-effect function:app/p.ts#p0->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E side-effect function:app/p.ts#p0->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0>anonymous@3:92 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:98
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0>anonymous@3:92 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:98
        E returns function:app/p.ts#p0>anonymous@3:92->return:app/p.ts#p0>anonymous@3:92#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:98
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1>anonymous@6:12 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1>anonymous@6:12 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:33
        E returns function:app/p.ts#p1>anonymous@6:12->return:app/p.ts#p1>anonymous@6:12#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:26
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1>anonymous@6:75 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:81
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p1>anonymous@6:75 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:81
        E returns function:app/p.ts#p1>anonymous@6:75->return:app/p.ts#p1>anonymous@6:75#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:81
        U unanalyzed-function app/p.ts:3:92 subject=function:app/p.ts#p0>anonymous@3:92 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/email
        U unanalyzed-function app/p.ts:6:12 subject=function:app/p.ts#p1>anonymous@6:12 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/id
        U unanalyzed-function app/p.ts:6:75 subject=function:app/p.ts#p1>anonymous@6:75 detail=closure returns tracked data but nothing in the project calls it data=field:features/user/user.ts#userData.user/name"
      `)
    })

    it("a custom sink list replaces the defaults and carries its handling", async () => {
      expect(
        await sinkLines(
          [`  res.json(${USER}.id)\n  audit.write(${USER}.name)\n  plain.emit(${USER}.email)`],
          `declare const audit: any\ndeclare const plain: any\n`,
          {
            sinks: [
              {
                callee: "audit.write",
                boundary: { kind: "storage", name: "audit" },
                handling: "redacted",
              },
              { callee: "plain.emit", boundary: { kind: "queue", name: "bus" } },
            ],
          },
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=4:1
        N boundary boundary:code audit static bk=storage cl= src=
        N boundary boundary:code bus static bk=queue cl= src=
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:15
        E side-effect function:app/p.ts#p0->boundary:boundary:code#audit p=name static o=field:features/user/user.ts#userData.user h=redacted @app/p.ts:6:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:14
        E side-effect function:app/p.ts#p0->boundary:boundary:code#bus p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        U unresolved-call app/p.ts:5:3 subject=function:app/p.ts#p0 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
      `)
    })

    it("an explicit empty sink list disables sinks", async () => {
      expect(await sinkLines([`  res.json(${USER}.id)`], "", { sinks: [] })).toMatchInlineSnapshot(`
        "N function app/p.ts p0 static bk= cl= src=2:1
        N parameter app/p.ts p0.res static bk= cl= src=
        N parameter app/p.ts p0.key static bk= cl= src=
        N return app/p.ts p0#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:12
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#p0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:12
        U unresolved-call app/p.ts:3:3 subject=function:app/p.ts#p0 detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
      `)
    })
  })

  describe("capability calls", () => {
    const withOps = inventoryOf(
      capability({
        fields: [field("user", { id: "", name: "" }), field("team", { name: "" })],
        getters: [operation("getter", "load", { endpoints: [endpoint("output", "db", "store")] })],
        mutators: [
          operation("mutator", "save", {
            endpoints: [
              endpoint("output", "db", "store", "encrypted"),
              endpoint("output", "queue", "bus"),
              endpoint("input", "http", "form"),
            ],
          }),
          operation("mutator", "bare", {}),
        ],
        subscriptions: [
          operation("subscription", "watch", { endpoints: [endpoint("output", "ws", "feed")] }),
        ],
      }),
    )
    const ops = async (body: string) =>
      dump((await h.scanDistinct(handler(body), {}, withOps)).input)
        .filter((line) => !line.startsWith("E discards"))
        .join("\n")

    it("a mutator passes the data to the operation and out through its output endpoints", async () => {
      expect(
        await ops(
          `  userData.save(${USER}.id, ${USER}.name)\n  userData.bare(${USER}.id)\n  userData.watch(${USER}.id)\n  userData.load(${USER}.id)`,
        ),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl= src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N function features/user/user.ts userData.save static bk= cl= src=
        N boundary boundary store declared bk=db cl= src=
        N boundary boundary bus declared bk=queue cl= src=
        N function features/user/user.ts userData.bare static bk= cl= src=
        N function features/user/user.ts userData.watch static bk= cl= src=
        N function features/user/user.ts userData.load static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:56
        E calls function:app/p.ts#h->function:features/user/user.ts#userData.save p=- static o= h= @app/p.ts:3:3
        E passes function:app/p.ts#h->function:features/user/user.ts#userData.save p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E crosses-boundary function:features/user/user.ts#userData.save->boundary:boundary#store p=id declared o=field:features/user/user.ts#userData.user h=encrypted @
        E crosses-boundary function:features/user/user.ts#userData.save->boundary:boundary#bus p=id declared o=field:features/user/user.ts#userData.user h= @
        E passes function:app/p.ts#h->function:features/user/user.ts#userData.save p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:3
        E crosses-boundary function:features/user/user.ts#userData.save->boundary:boundary#store p=name declared o=field:features/user/user.ts#userData.user h=encrypted @
        E crosses-boundary function:features/user/user.ts#userData.save->boundary:boundary#bus p=name declared o=field:features/user/user.ts#userData.user h= @
        E calls function:app/p.ts#h->function:features/user/user.ts#userData.bare p=- static o= h= @app/p.ts:4:3
        E passes function:app/p.ts#h->function:features/user/user.ts#userData.bare p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E calls function:app/p.ts#h->function:features/user/user.ts#userData.watch p=- static o= h= @app/p.ts:5:3
        E passes function:app/p.ts#h->function:features/user/user.ts#userData.watch p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E calls function:app/p.ts#h->function:features/user/user.ts#userData.load p=- static o= h= @app/p.ts:6:3
        E passes function:app/p.ts#h->function:features/user/user.ts#userData.load p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3"
      `)
    })

    it("an operation called with no tracked data still records the call", async () => {
      expect(await ops(`  userData.save(1)\n  userData.load()`)).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl= src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N function features/user/user.ts userData.save static bk= cl= src=
        N function features/user/user.ts userData.load static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E calls function:app/p.ts#h->function:features/user/user.ts#userData.save p=- static o= h= @app/p.ts:3:3
        E calls function:app/p.ts#h->function:features/user/user.ts#userData.load p=- static o= h= @app/p.ts:4:3"
      `)
    })

    it("an unknown member of a capability yields nothing", async () => {
      expect(await ops(`  userData.nope(${USER}.id)\n  res.json(userData.nope2())`))
        .toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl= src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:17"
      `)
    })

    it("a capability value bound to a variable is still the capability", async () => {
      expect(
        await ops(
          `  const d = userData\n  const snap = d.getSnapshot()\n  res.json(snap.fields.team.name)\n  res.json(snap.nothing)\n  res.json(d.fields)\n  res.json(userData.other)`,
        ),
      ).toMatchInlineSnapshot(`
        "N field features/user/user.ts userData.user static bk= cl= src=
        N field features/user/user.ts userData.team static bk= cl= src=
        N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.team->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:5:11
        E reads field:features/user/user.ts#userData.team->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.team h= @app/p.ts:5:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.team h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= static o=field:features/user/user.ts#userData.team h= @app/p.ts:7:3"
      `)
    })
  })

  describe("method calls", () => {
    it("a builtin root shadowed by a local variable is not a builtin", async () => {
      expect(await lines(`  const JSON: any = {}\n  res.json(JSON.stringify(${USER}.id))`))
        .toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:26
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:26
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        U unresolved-call app/p.ts:4:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
      `)
    })

    it("a builtin root in a parameter position is not a builtin", async () => {
      expect(
        await lines(`  res.json(f(${USER}.id))`, `function f(Math: any) { return Math.max(1) }\n`),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/p.ts f static bk= cl= src=2:1
        N parameter app/p.ts f.Math static bk= cl= src=
        N return app/p.ts f#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:13
        E calls function:app/p.ts#h->function:app/p.ts#f p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#f.Math p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/p.ts#f.Math->function:app/p.ts#f p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
        E returns function:app/p.ts#f->return:app/p.ts#f#return p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:2:25
        E passes return:app/p.ts#f#return->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        U unresolved-call app/p.ts:2:32 subject=function:app/p.ts#f detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
      `)
    })

    it("namespace calls: found, missing and with function arguments", async () => {
      expect(
        await h
          .scan({
            "app/util.ts": `export function pick(v: any, cb?: any) { return v.name }\n`,
            "app/p.ts": `import * as u from "./util.js";\n${IMPORT_CAP}export function h(res: any) {\n  res.json(u.pick(${USER}, () => 1))\n  res.json(u.missing(${USER}, () => 2))\n}\n`,
          })
          .then((r) =>
            dump(r.input)
              .filter((l) => !l.startsWith("N field") && !l.startsWith("E discards"))
              .join("\n"),
          ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/util.ts pick static bk= cl= src=1:1
        N parameter app/util.ts pick.v static bk= cl= src=
        N return app/util.ts pick#return static bk= cl= src=
        N boundary boundary:code http-response static bk=client-response cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N parameter app/util.ts pick.cb static bk= cl= src=
        N function app/p.ts h>anonymous@4:55 static bk= cl= src=4:55
        N return app/p.ts h>anonymous@4:55#return static bk= cl= src=
        N function app/p.ts h>anonymous@5:58 static bk= cl= src=5:58
        N return app/p.ts h>anonymous@5:58#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:19
        E calls function:app/p.ts#h->function:app/util.ts#pick p=- static o= h= @app/p.ts:4:12
        E passes function:app/p.ts#h->parameter:app/util.ts#pick.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:12
        E reads parameter:app/util.ts#pick.v->function:app/util.ts#pick p=name static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:49
        E returns function:app/util.ts#pick->return:app/util.ts#pick#return p=name static o=field:features/user/user.ts#userData.user h= @app/util.ts:1:42
        E passes return:app/util.ts#pick#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#http-response p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        U unresolved-call app/p.ts:5:12 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("then passes the receiver to the first callback only; catch and finally pass nothing", async () => {
      expect(
        await lines(
          `  const p: any = ${USER}.id\n  res.json(p.then((a: any) => a, (b: any) => b))\n  res.json(p.catch((c: any) => c))\n  res.json(p.finally((d: any) => d))\n  res.json(p.then())\n  res.json(p.then(unknown1))\n  res.json(p.catch(unknown2))\n  res.json(p.then(unknown3, (e: any) => e))`,
          `declare const unknown1: any\ndeclare const unknown2: any\ndeclare const unknown3: any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=5:1
        N function app/p.ts h>anonymous@7:18 static bk= cl= src=7:18
        N parameter app/p.ts h>anonymous@7:18.a static bk= cl= src=
        N return app/p.ts h>anonymous@7:18#return static bk= cl= src=
        N function app/p.ts h>anonymous@7:33 static bk= cl= src=7:33
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts h>anonymous@8:19 static bk= cl= src=8:19
        N boundary boundary:code b1 static bk=log cl= src=
        N function app/p.ts h>anonymous@9:21 static bk= cl= src=9:21
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N boundary boundary:code b5 static bk=log cl= src=
        N function app/p.ts h>anonymous@13:28 static bk= cl= src=13:28
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N parameter app/p.ts h>anonymous@7:33.b static bk= cl= src=
        N return app/p.ts h>anonymous@7:33#return static bk= cl= src=
        N parameter app/p.ts h>anonymous@8:19.c static bk= cl= src=
        N return app/p.ts h>anonymous@8:19#return static bk= cl= src=
        N parameter app/p.ts h>anonymous@9:21.d static bk= cl= src=
        N return app/p.ts h>anonymous@9:21#return static bk= cl= src=
        N parameter app/p.ts h>anonymous@13:28.e static bk= cl= src=
        N return app/p.ts h>anonymous@13:28#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:18
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@7:18 p=- static o= h= @app/p.ts:7:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@7:18.a p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
        E reads parameter:app/p.ts#h>anonymous@7:18.a->function:app/p.ts#h>anonymous@7:18 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:30
        E returns function:app/p.ts#h>anonymous@7:18->return:app/p.ts#h>anonymous@7:18#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:30
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@7:33 p=- static o= h= @app/p.ts:7:11
        E passes return:app/p.ts#h>anonymous@7:18#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:19 p=- static o= h= @app/p.ts:8:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@9:21 p=- static o= h= @app/p.ts:9:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:3
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@13:28 p=- static o= h= @app/p.ts:13:11"
      `)
    })

    it("array methods hand the element to a named callback and shape the result by method", async () => {
      expect(
        await lines(
          `  res.json(${TAGS}.map(pickLabel))\n  res.json(${TAGS}.flatMap(pickLabel))\n  ${TAGS}.forEach(pickLabel)\n  res.json(${TAGS}.filter(pickLabel))\n  res.json(${TAGS}.some(pickLabel))\n  res.json(${TAGS}.find(pickLabel))\n  res.json(${TAGS}.sort(pickLabel))`,
          `function pickLabel(t: any) { return t.label }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/p.ts pickLabel static bk= cl= src=2:1
        N parameter app/p.ts pickLabel.t static bk= cl= src=
        N return app/p.ts pickLabel#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N boundary boundary:code b5 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E calls function:app/p.ts#h->function:app/p.ts#pickLabel p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#pickLabel.t p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E reads parameter:app/p.ts#pickLabel.t->function:app/p.ts#pickLabel p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:2:37
        E returns function:app/p.ts#pickLabel->return:app/p.ts#pickLabel#return p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:2:30
        E passes return:app/p.ts#pickLabel#return->function:app/p.ts#h p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:9:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:10:3"
      `)
    })

    it("array callbacks that cannot be resolved", async () => {
      expect(
        await lines(
          `  res.json(${TAGS}.map(unknownFn))\n  res.json(${TAGS}.some(unknownFn))\n  res.json(${TAGS}.forEach(unknownFn))\n  res.json(${TAGS}.find(unknownFn))\n  res.json(${TAGS}.map())\n  res.json(${TAGS}.every())`,
          `declare const unknownFn: any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:3
        U unresolved-call app/p.ts:4:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.tags/
        U unresolved-call app/p.ts:5:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.tags/
        U unresolved-call app/p.ts:6:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.tags/
        U unresolved-call app/p.ts:7:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.tags/
        U unresolved-call app/p.ts:8:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.tags/"
      `)
    })

    it("reduce merges the initial value and the receiver into the accumulator", async () => {
      expect(
        await lines(
          `  res.json(${TAGS}.reduce((acc: any, t: any) => acc, ${USER}.id))\n  res.json(${TAGS}.reduceRight((acc: any, t: any) => t.label))\n  res.json(${TAGS}.reduce(unknownFn, 0))`,
          `declare const unknownFn: any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/p.ts h>anonymous@4:53 static bk= cl= src=4:53
        N parameter app/p.ts h>anonymous@4:53.acc static bk= cl= src=
        N parameter app/p.ts h>anonymous@4:53.t static bk= cl= src=
        N return app/p.ts h>anonymous@4:53#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts h>anonymous@5:58 static bk= cl= src=5:58
        N parameter app/p.ts h>anonymous@5:58.acc static bk= cl= src=
        N parameter app/p.ts h>anonymous@5:58.t static bk= cl= src=
        N return app/p.ts h>anonymous@5:58#return static bk= cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:80
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:80
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@4:53 p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:53.acc p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:53.acc p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@4:53.t p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:11
        E reads parameter:app/p.ts#h>anonymous@4:53.acc->function:app/p.ts#h>anonymous@4:53 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:75
        E returns function:app/p.ts#h>anonymous@4:53->return:app/p.ts#h>anonymous@4:53#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:75
        E reads parameter:app/p.ts#h>anonymous@4:53.acc->function:app/p.ts#h>anonymous@4:53 p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:75
        E returns function:app/p.ts#h>anonymous@4:53->return:app/p.ts#h>anonymous@4:53#return p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:75
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E passes return:app/p.ts#h>anonymous@4:53#return->function:app/p.ts#h p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E passes return:app/p.ts#h>anonymous@4:53#return->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:4:3
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@5:58 p=- static o= h= @app/p.ts:5:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@5:58.acc p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@5:58.t p=[] static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:11
        E reads parameter:app/p.ts#h>anonymous@5:58.t->function:app/p.ts#h>anonymous@5:58 p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:80
        E returns function:app/p.ts#h>anonymous@5:58->return:app/p.ts#h>anonymous@5:58#return p=[].label static o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:80
        E passes return:app/p.ts#h>anonymous@5:58#return->function:app/p.ts#h p=[].label inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=[].label inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:6:3
        U unresolved-call app/p.ts:6:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.tags/"
      `)
    })

    it("push and unshift store the arguments as elements of the array variable", async () => {
      expect(
        await lines(
          `  const a: any[] = []\n  a.push(${USER}.id, ${USER}.name)\n  const b: any[] = []\n  b.unshift(${USER}.email)\n  const o: any = {}\n  o.list.push(${USER}.role)\n  res.json(a)\n  res.json(b)\n  res.json(o)`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:10
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:10
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:49
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:13
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:15
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3"
      `)
    })

    it("call, apply and bind on a function value are followed", async () => {
      expect(
        await lines(
          `  const f = (v: any) => v\n  res.json(f.call(null, ${USER}.id))\n  res.json(f.apply(null, [${USER}.name]))\n  res.json(f.bind(null, ${USER}.email)())\n  const notFn: any = ${USER}\n  res.json(notFn.call(1))`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N function app/p.ts h>anonymous@3:13 static bk= cl= src=3:13
        N parameter app/p.ts h>anonymous@3:13.v static bk= cl= src=
        N return app/p.ts h>anonymous@3:13#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:24
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:24
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@3:13 p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@3:13.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/p.ts#h>anonymous@3:13.v->function:app/p.ts#h>anonymous@3:13 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E returns function:app/p.ts#h>anonymous@3:13->return:app/p.ts#h>anonymous@3:13#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E passes return:app/p.ts#h>anonymous@3:13#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:26
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@3:13.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads parameter:app/p.ts#h>anonymous@3:13.v->function:app/p.ts#h>anonymous@3:13 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E returns function:app/p.ts#h>anonymous@3:13->return:app/p.ts#h>anonymous@3:13#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E passes return:app/p.ts#h>anonymous@3:13#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:24
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@3:13.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E reads parameter:app/p.ts#h>anonymous@3:13.v->function:app/p.ts#h>anonymous@3:13 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E returns function:app/p.ts#h>anonymous@3:13->return:app/p.ts#h>anonymous@3:13#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E passes return:app/p.ts#h>anonymous@3:13#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        U unresolved-call app/p.ts:8:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("a method on an ordinary object is unresolved with the receiver's data", async () => {
      expect(
        await lines(
          `  const o = { m(v: any) { return v } }\n  res.json(o.m(${USER}.id))\n  res.json(${USER}.mystery())`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=2:1
        N function app/p.ts h>m@3:15 static bk= cl= src=3:15
        N parameter app/p.ts h>m@3:15.v static bk= cl= src=
        N return app/p.ts h>m@3:15#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:15
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:15
        E calls function:app/p.ts#h->function:app/p.ts#h>m@3:15 p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>m@3:15.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/p.ts#h>m@3:15.v->function:app/p.ts#h>m@3:15 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
        E returns function:app/p.ts#h>m@3:15->return:app/p.ts#h>m@3:15#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:27
        E passes return:app/p.ts#h>m@3:15#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        U unresolved-call app/p.ts:5:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })
  })

  describe("direct calls", () => {
    it("immediately-invoked functions, local function values and parameters that are functions", async () => {
      expect(
        await lines(
          `  res.json((() => ${USER}.id)())\n  res.json((function () { return ${USER}.name })())\n  const local = (v: any) => v.email\n  res.json(local(${USER}))\n  res.json(apply((v: any) => v.role, ${USER}))\n  res.json(shadow(${USER}))\n  res.json((key ? one : two)(${USER}))\n  res.json(({ a: one }).a(${USER}))`,
          `function apply(cb: any, v: any) { return cb(v) }\nfunction shadow(one: any) { return one(1) }\nfunction one(v: any) { return v.id }\nfunction two(v: any) { return v.name }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=6:1
        N function app/p.ts h>anonymous@7:12 static bk= cl= src=7:12
        N return app/p.ts h>anonymous@7:12#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N function app/p.ts h>anonymous@8:12 static bk= cl= src=8:12
        N return app/p.ts h>anonymous@8:12#return static bk= cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N function app/p.ts h>anonymous@9:17 static bk= cl= src=9:17
        N parameter app/p.ts h>anonymous@9:17.v static bk= cl= src=
        N return app/p.ts h>anonymous@9:17#return static bk= cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N function app/p.ts apply static bk= cl= src=2:1
        N parameter app/p.ts apply.v static bk= cl= src=
        N function app/p.ts h>anonymous@11:17 static bk= cl= src=11:17
        N parameter app/p.ts h>anonymous@11:17.v static bk= cl= src=
        N return app/p.ts h>anonymous@11:17#return static bk= cl= src=
        N return app/p.ts apply#return static bk= cl= src=
        N boundary boundary:code b3 static bk=log cl= src=
        N function app/p.ts shadow static bk= cl= src=3:1
        N parameter app/p.ts shadow.one static bk= cl= src=
        N boundary boundary:code b5 static bk=log cl= src=
        N function app/p.ts one static bk= cl= src=4:1
        N parameter app/p.ts one.v static bk= cl= src=
        N return app/p.ts one#return static bk= cl= src=
        N boundary boundary:code b6 static bk=log cl= src=
        N parameter app/p.ts apply.cb static bk= cl= src=
        N return app/p.ts shadow#return static bk= cl= src=
        N function app/p.ts two static bk= cl= src=5:1
        N parameter app/p.ts two.v static bk= cl= src=
        N return app/p.ts two#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@7:12 p=- static o= h= @app/p.ts:7:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@7:12 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@7:12 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:18
        E returns function:app/p.ts#h>anonymous@7:12->return:app/p.ts#h>anonymous@7:12#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:18
        E passes return:app/p.ts#h>anonymous@7:12#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@8:12 p=- static o= h= @app/p.ts:8:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@8:12 p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:33
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h>anonymous@8:12 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:33
        E returns function:app/p.ts#h>anonymous@8:12->return:app/p.ts#h>anonymous@8:12#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:26
        E passes return:app/p.ts#h>anonymous@8:12#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:17
        E calls function:app/p.ts#h->function:app/p.ts#h>anonymous@9:17 p=- static o= h= @app/p.ts:10:11
        E passes function:app/p.ts#h->parameter:app/p.ts#h>anonymous@9:17.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:11
        E reads parameter:app/p.ts#h>anonymous@9:17.v->function:app/p.ts#h>anonymous@9:17 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:29
        E returns function:app/p.ts#h>anonymous@9:17->return:app/p.ts#h>anonymous@9:17#return p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:9:29
        E passes return:app/p.ts#h>anonymous@9:17#return->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:10:3
        E calls function:app/p.ts#h->function:app/p.ts#apply p=- static o= h= @app/p.ts:11:11
        E passes function:app/p.ts#h->parameter:app/p.ts#apply.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:11
        E calls function:app/p.ts#apply->function:app/p.ts#h>anonymous@11:17 p=- static o= h= @app/p.ts:2:42
        E reads parameter:app/p.ts#apply.v->function:app/p.ts#apply p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:42
        E passes function:app/p.ts#apply->parameter:app/p.ts#h>anonymous@11:17.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:42
        E reads parameter:app/p.ts#h>anonymous@11:17.v->function:app/p.ts#h>anonymous@11:17 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:29
        E returns function:app/p.ts#h>anonymous@11:17->return:app/p.ts#h>anonymous@11:17#return p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:29
        E passes return:app/p.ts#h>anonymous@11:17#return->function:app/p.ts#apply p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
        E returns function:app/p.ts#apply->return:app/p.ts#apply#return p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:35
        E passes return:app/p.ts#apply#return->function:app/p.ts#h p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b3 p=role static o=field:features/user/user.ts#userData.user h= @app/p.ts:11:3
        E calls function:app/p.ts#h->function:app/p.ts#shadow p=- static o= h= @app/p.ts:12:11
        E passes function:app/p.ts#h->parameter:app/p.ts#shadow.one p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:12:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:13:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b5 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:13:3
        E calls function:app/p.ts#h->function:app/p.ts#one p=- static o= h= @app/p.ts:14:11
        E passes function:app/p.ts#h->parameter:app/p.ts#one.v p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:14:11
        E reads parameter:app/p.ts#one.v->function:app/p.ts#one p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:31
        E returns function:app/p.ts#one->return:app/p.ts#one#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:24
        E passes return:app/p.ts#one#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:14:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b6 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:14:3
        U unresolved-call app/p.ts:13:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/"
      `)
    })

    it("the same function called twice with the same shape is analyzed once; a different shape is analyzed again", async () => {
      expect(
        await lines(
          `  res.json(id(${USER}.id))\n  res.json(id(${USER}.id))\n  res.json(id(${USER}.name))\n  res.json(id(1))\n  res.json(id({ a: ${USER}.id }))`,
          `function id(v: any) { return v }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N function app/p.ts id static bk= cl= src=2:1
        N parameter app/p.ts id.v static bk= cl= src=
        N return app/p.ts id#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N boundary boundary:code b4 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:14
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:14
        E calls function:app/p.ts#h->function:app/p.ts#id p=- static o= h= @app/p.ts:4:11
        E passes function:app/p.ts#h->parameter:app/p.ts#id.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads parameter:app/p.ts#id.v->function:app/p.ts#id p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:23
        E returns function:app/p.ts#id->return:app/p.ts#id#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:23
        E passes return:app/p.ts#id#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:14
        E passes function:app/p.ts#h->parameter:app/p.ts#id.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E reads parameter:app/p.ts#id.v->function:app/p.ts#id p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:23
        E returns function:app/p.ts#id->return:app/p.ts#id#return p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:23
        E passes return:app/p.ts#id#return->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b4 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:3"
      `)
    })

    it("recursion and mutual recursion terminate", async () => {
      expect(
        await lines(
          `  res.json(rec(${USER}.id))\n  res.json(ping(${USER}.name))`,
          `function rec(v: any): any { return key ? rec(v) : v }\nfunction ping(v: any): any { return pong(v) }\nfunction pong(v: any): any { return ping(v) }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts rec static bk= cl= src=2:1
        N function app/p.ts ping static bk= cl= src=3:1
        N function app/p.ts pong static bk= cl= src=4:1
        N function app/p.ts h static bk= cl= src=5:1
        N parameter app/p.ts rec.v static bk= cl= src=
        N return app/p.ts rec#return static bk= cl= src=
        N boundary boundary:code b0 static bk=log cl= src=
        N parameter app/p.ts ping.v static bk= cl= src=
        N parameter app/p.ts pong.v static bk= cl= src=
        N return app/p.ts ping#return static bk= cl= src=
        N return app/p.ts pong#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E calls function:app/p.ts#rec->function:app/p.ts#rec p=- static o= h= @app/p.ts:2:42
        E calls function:app/p.ts#ping->function:app/p.ts#pong p=- static o= h= @app/p.ts:3:37
        E calls function:app/p.ts#pong->function:app/p.ts#ping p=- static o= h= @app/p.ts:4:37
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:15
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:15
        E calls function:app/p.ts#h->function:app/p.ts#rec p=- static o= h= @app/p.ts:6:11
        E passes function:app/p.ts#h->parameter:app/p.ts#rec.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E reads parameter:app/p.ts#rec.v->function:app/p.ts#rec p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:42
        E passes function:app/p.ts#rec->parameter:app/p.ts#rec.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:42
        E returns function:app/p.ts#rec->return:app/p.ts#rec#return p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:29
        E passes return:app/p.ts#rec#return->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:16
        E calls function:app/p.ts#h->function:app/p.ts#ping p=- static o= h= @app/p.ts:7:11
        E passes function:app/p.ts#h->parameter:app/p.ts#ping.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:11
        E reads parameter:app/p.ts#ping.v->function:app/p.ts#ping p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:37
        E passes function:app/p.ts#ping->parameter:app/p.ts#pong.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:37
        E reads parameter:app/p.ts#pong.v->function:app/p.ts#pong p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37
        E passes function:app/p.ts#pong->parameter:app/p.ts#ping.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:37"
      `)
    })

    it("a free function that returns nothing, a function without a body and calls of non-functions", async () => {
      expect(
        await lines(
          `  res.json(noop(${USER}.id))\n  res.json(num(${USER}.name))\n  res.json(String(${USER}.email))`,
          `function noop(v: any) {}\nconst num = 5 as any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=4:1
        N function app/p.ts noop static bk= cl= src=2:1
        N parameter app/p.ts noop.v static bk= cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N return app/p.ts noop#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:16
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:16
        E calls function:app/p.ts#h->function:app/p.ts#noop p=- static o= h= @app/p.ts:5:11
        E passes function:app/p.ts#h->parameter:app/p.ts#noop.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:15
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:18
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p=email inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        U unresolved-call app/p.ts:6:11 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
      `)
    })

    it("an unknown that is reached through two contexts accumulates the data of both", async () => {
      expect(
        await lines(
          `  wrap(${USER}.id)\n  wrap(${USER}.name)\n  wrap(${USER}.id)`,
          `declare function mystery(v: any): any\nfunction wrap(v: any) { return mystery(v) }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=4:1
        N function app/p.ts wrap static bk= cl= src=3:1
        N parameter app/p.ts wrap.v static bk= cl= src=
        N return app/p.ts wrap#return static bk= cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:8
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:8
        E calls function:app/p.ts#h->function:app/p.ts#wrap p=- static o= h= @app/p.ts:5:3
        E passes function:app/p.ts#h->parameter:app/p.ts#wrap.v p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:3
        E reads parameter:app/p.ts#wrap.v->function:app/p.ts#wrap p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E returns function:app/p.ts#wrap->return:app/p.ts#wrap#return p=id inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:8
        E passes function:app/p.ts#h->parameter:app/p.ts#wrap.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E reads parameter:app/p.ts#wrap.v->function:app/p.ts#wrap p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        E returns function:app/p.ts#wrap->return:app/p.ts#wrap#return p=name inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:3:25
        U unresolved-call app/p.ts:3:32 subject=function:app/p.ts#wrap detail=call target is not a project function data=field:features/user/user.ts#userData.user/id,field:features/user/user.ts#userData.user/name"
      `)
    })

    it("unknowns at distinct sites and reasons are kept apart", async () => {
      expect(
        await lines(
          `  mystery(${USER}.id)\n  mystery(${USER}.name)\n  res.json(${USER}[key])\n  res.json(${USER}[key])\n  res.json(${TAGS}[key])`,
          `declare function mystery(v: any): any\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=3:1
        N boundary boundary:code b0 static bk=log cl= src=
        N boundary boundary:code b1 static bk=log cl= src=
        N boundary boundary:code b2 static bk=log cl= src=
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=id static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:5:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b0 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:6:3
        E side-effect function:app/p.ts#h->boundary:boundary:code#b1 p= inferred o=field:features/user/user.ts#userData.user h= @app/p.ts:7:3
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:11
        E reads field:features/user/user.ts#userData.tags->function:app/p.ts#h p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:11
        E side-effect function:app/p.ts#h->boundary:boundary:code#b2 p= inferred o=field:features/user/user.ts#userData.tags h= @app/p.ts:8:3
        U unresolved-call app/p.ts:4:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
        U unresolved-call app/p.ts:5:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name
        U dynamic-access app/p.ts:6:11 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
        U dynamic-access app/p.ts:7:11 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.user/
        U dynamic-access app/p.ts:8:11 subject=function:app/p.ts#h detail=computed property key on tracked data data=field:features/user/user.ts#userData.tags/"
      `)
    })

    it("unresolved calls queue their function arguments and discard-measure through them", async () => {
      expect(
        await lines(
          `  mystery(${USER}, (u: any) => u.id)\n  new Thing(() => 1, ${USER}.email)\n  mystery2(...[${USER}.name])`,
          `declare function mystery(...a: any[]): any\ndeclare function mystery2(...a: any[]): any\ndeclare class Thing { constructor(...a: any[]) }\n`,
        ),
      ).toMatchInlineSnapshot(`
        "N function app/p.ts h static bk= cl= src=5:1
        N parameter app/p.ts h.res static bk= cl= src=
        N parameter app/p.ts h.key static bk= cl= src=
        N return app/p.ts h#return static bk= cl= src=
        N function app/p.ts h>anonymous@6:47 static bk= cl= src=6:47
        N parameter app/p.ts h>anonymous@6:47.u static bk= cl= src=
        N return app/p.ts h>anonymous@6:47#return static bk= cl= src=
        N function app/p.ts h>anonymous@7:13 static bk= cl= src=7:13
        N return app/p.ts h>anonymous@7:13#return static bk= cl= src=
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:6:11
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:7:22
        E reads field:features/user/user.ts#userData.user->function:app/p.ts#h p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:8:16
        U unresolved-call app/p.ts:6:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/
        U unresolved-call app/p.ts:7:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
        U unresolved-call app/p.ts:8:3 subject=function:app/p.ts#h detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
      `)
    })
  })

  describe("limits", () => {
    const chain = (length: number): string =>
      Array.from({ length }, (_, i) => `function f${i}(v: any): any { return f${i + 1}(v) }`).join(
        "\n",
      ) + `\nfunction f${length}(v: any): any { return v }\n`

    it("a call chain is analyzed to a depth of exactly 40 calls", async () => {
      const input = (await h.scanDistinct(handler(`  f0(${USER}.id)`, chain(45)))).input
      const unanalyzed = input.nodes.filter((n) => n.kind === "function" && n.status === "unknown")
      expect(unanalyzed.map((n) => n.name)).toEqual(["f39", "f40"])
      expect(input.unknowns.map((u) => [u.reason, u.detail, u.subject, u.data?.length])).toEqual([
        [
          "unanalyzed-function",
          "call depth or analysis budget exceeded at f40",
          "function:app/p.ts#f39",
          0,
        ],
        [
          "unanalyzed-function",
          "call depth or analysis budget exceeded at f39",
          "function:app/p.ts#f38",
          1,
        ],
      ])
    })

    it("a chain that fits is fully analyzed", async () => {
      const input = (await h.scanDistinct(handler(`  f0(${USER}.id)`, chain(38)))).input
      expect(input.nodes.filter((n) => n.status === "unknown")).toEqual([])
      expect(input.unknowns).toEqual([])
    })
  })

  describe("discards", () => {
    const nested = inventoryOf(
      capability({
        fields: [
          field("user", {
            id: "",
            profile: { age: "", city: "" },
            list: [{ k: "" }],
            nothing: null,
          }),
          field("scalar", ""),
          field("tags", [{ label: "", secret: "" }]),
        ],
      }),
    )
    const discards = async (body: string, extra = ""): Promise<string[]> =>
      dump((await h.scanDistinct(handler(body, extra), {}, nested)).input).filter((l) =>
        l.startsWith("E discards"),
      )

    it("reports each top-level key a function never touches", async () => {
      expect(await discards(`  res.json(${USER}.id)`)).toMatchInlineSnapshot(`
        [
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @",
        ]
      `)
    })

    it("a key touched deeper or shallower than the shape counts as used", async () => {
      expect(await discards(`  res.json(${USER}.profile.age)\n  res.json(${USER}.list)`))
        .toMatchInlineSnapshot(`
        [
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @",
        ]
      `)
    })

    it("a parameter's entry path is the frame the discards are measured in", async () => {
      expect(
        await discards(`  res.json(f(${USER}.profile))`, `function f(p: any) { return p.age }\n`),
      ).toMatchInlineSnapshot(`
        [
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#f->field:features/user/user.ts#userData.user p=profile.city static o=field:features/user/user.ts#userData.user h= @",
        ]
      `)
    })

    it("a scalar, an array and a null shape produce no discards", async () => {
      expect(
        await discards(
          `  res.json(userData.getSnapshot().fields.scalar)\n  res.json(${TAGS})\n  res.json(${USER}.nothing)`,
        ),
      ).toMatchInlineSnapshot(`
        [
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @",
        ]
      `)
    })

    it("a function that is handed data but never touches it discards all of it", async () => {
      expect(await discards(`  ignore(${USER})`, `function ignore(v: any) { return 1 }\n`))
        .toMatchInlineSnapshot(`
        [
          "E discards function:app/p.ts#ignore->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#ignore->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#ignore->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#ignore->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @",
        ]
      `)
    })

    it("data returned from a callee is measured against what the callee returned", async () => {
      expect(
        await discards(
          `  const r = make()\n  res.json(r.id)`,
          `function make() { return ${USER} }\n`,
        ),
      ).toMatchInlineSnapshot(`
        [
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=profile static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=list static o=field:features/user/user.ts#userData.user h= @",
          "E discards function:app/p.ts#h->field:features/user/user.ts#userData.user p=nothing static o=field:features/user/user.ts#userData.user h= @",
        ]
      `)
    })

    it("a path under an element is measured against the first element's shape", async () => {
      expect(await discards(`  const t = ${TAGS}[0]\n  res.json(t.label)`)).toMatchInlineSnapshot(
        `[]`,
      )
    })
  })
})
