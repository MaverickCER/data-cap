import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  capability,
  dump,
  IMPORT_CAP,
  inventoryOf,
  makeHarness,
  USER,
} from "./mut-flow-scan-harness.js"
import type { Harness } from "./mut-flow-scan-harness.js"

/** Which module forms carry a leak from one file to the sink in another, and how the scan describes it. */
describe("flow-scan: the forms a module exports in", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const lines = async (files: Record<string, string>) =>
    dump((await h.scan(files)).input).join("\n")
  const leaks = async (files: Record<string, string>) =>
    (await h.scan(files)).input.edges
      .filter((e) => e.kind === "side-effect")
      .map((e) => (e.path ?? []).join("."))
      .sort()

  const SEND = "(res: any, v: any) { res.json(v) }"
  const main = (body: string, imports: string) =>
    `${IMPORT_CAP}${imports}\nexport function go(res: any) { ${body} }\n`

  it("CommonJS: exports.x and module.exports are what require() gives", async () => {
    expect(
      await lines({
        "app/lib.ts": `exports.send = function ${SEND}\nmodule.exports.alias = exports.send\n`,
        "app/main.ts": main(`lib.send(res, ${USER}.email)`, `const lib = require("./lib")`),
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts <module>>anonymous@1:16 static bk= cl= src=1:16
      N parameter app/lib.ts <module>>anonymous@1:16.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      N parameter app/lib.ts <module>>anonymous@1:16.res static bk= cl= src=
      N return app/lib.ts <module>>anonymous@1:16#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:46
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:46
      E calls function:app/main.ts#go->function:app/lib.ts#<module>>anonymous@1:16 p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#<module>>anonymous@1:16.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#<module>>anonymous@1:16.v->function:app/lib.ts#<module>>anonymous@1:16 p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:46
      E side-effect function:app/lib.ts#<module>>anonymous@1:16->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:46
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("CommonJS: module.exports replaced by an object", async () => {
    expect(
      await lines({
        "app/lib.ts": `function send${SEND}\nmodule.exports = { send }\n`,
        "app/main.ts": main(`lib.send(res, ${USER}.email)`, `const lib = require("./lib")`),
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts send static bk= cl= src=1:1
      N parameter app/lib.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts send.res static bk= cl= src=
      N return app/lib.ts send#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:46
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:46
      E calls function:app/main.ts#go->function:app/lib.ts#send p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#send.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:35
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:35
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("export default function, named", async () => {
    expect(
      await lines({
        "app/lib.ts": `export default function send${SEND}\n`,
        "app/main.ts": main(`send(res, ${USER}.email)`, `import send from "./lib.js"`),
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts send static bk= cl= src=1:1
      N parameter app/lib.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts send.res static bk= cl= src=
      N return app/lib.ts send#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E calls function:app/main.ts#go->function:app/lib.ts#send p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#send.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:50
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:50
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("export default function, anonymous", async () => {
    expect(
      await lines({
        "app/lib.ts": `export default function ${SEND}\n`,
        "app/main.ts": main(`send(res, ${USER}.email)`, `import send from "./lib.js"`),
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts default static bk= cl= src=1:1
      N parameter app/lib.ts default.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts default.res static bk= cl= src=
      N return app/lib.ts default#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E calls function:app/main.ts#go->function:app/lib.ts#default p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#default.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#default.v->function:app/lib.ts#default p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:46
      E side-effect function:app/lib.ts#default->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:46
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("export default of an arrow function", async () => {
    expect(
      await lines({
        "app/lib.ts": `export default ${SEND.replace("{ res.json(v) }", "=> res.json(v)")}\n`,
        "app/main.ts": main(`send(res, ${USER}.email)`, `import send from "./lib.js"`),
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts default static bk= cl= src=1:16
      N parameter app/lib.ts default.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts default.res static bk= cl= src=
      N return app/lib.ts default#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E calls function:app/main.ts#go->function:app/lib.ts#default p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#default.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#default.v->function:app/lib.ts#default p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:38
      E side-effect function:app/lib.ts#default->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:38
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("export default class, named and anonymous", async () => {
    expect(
      await lines({
        "app/named.ts": `export default class Sender { run${SEND} }\n`,
        "app/anon.ts": `export default class { run${SEND} }\n`,
        "app/main.ts": `${IMPORT_CAP}import Named from "./named.js"\nimport Anon from "./anon.js"\nexport function go(res: any) { new Named().run(res, ${USER}.email); new Anon().run(res, ${USER}.name) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=4:1
      N function app/named.ts Sender.constructor static bk= cl= src=
      N function app/named.ts Sender.run static bk= cl= src=1:31
      N parameter app/named.ts Sender.run.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/anon.ts default.constructor static bk= cl= src=
      N function app/anon.ts default.run static bk= cl= src=1:24
      N parameter app/anon.ts default.run.v static bk= cl= src=
      N parameter app/anon.ts default.run.res static bk= cl= src=
      N return app/anon.ts default.run#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      N parameter app/named.ts Sender.run.res static bk= cl= src=
      N return app/named.ts Sender.run#return static bk= cl= src=
      E calls function:app/main.ts#go->function:app/named.ts#Sender.constructor p=- static o= h= @app/main.ts:4:32
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:53
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:53
      E calls function:app/main.ts#go->function:app/named.ts#Sender.run p=- static o= h= @app/main.ts:4:32
      E passes function:app/main.ts#go->parameter:app/named.ts#Sender.run.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:32
      E reads parameter:app/named.ts#Sender.run.v->function:app/named.ts#Sender.run p=email static o=field:features/user/user.ts#userData.user h= @app/named.ts:1:55
      E side-effect function:app/named.ts#Sender.run->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/named.ts:1:55
      E calls function:app/main.ts#go->function:app/anon.ts#default.constructor p=- static o= h= @app/main.ts:4:96
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:116
      E calls function:app/main.ts#go->function:app/anon.ts#default.run p=- static o= h= @app/main.ts:4:96
      E passes function:app/main.ts#go->parameter:app/anon.ts#default.run.v p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:96
      E reads parameter:app/anon.ts#default.run.v->function:app/anon.ts#default.run p=name static o=field:features/user/user.ts#userData.user h= @app/anon.ts:1:48
      E side-effect function:app/anon.ts#default.run->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/anon.ts:1:48
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("export default of a name declared elsewhere in the file", async () => {
    expect(
      await lines({
        "app/lib.ts": `function send${SEND}\nexport default send\n`,
        "app/main.ts": main(`send(res, ${USER}.email)`, `import send from "./lib.js"`),
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts send static bk= cl= src=1:1
      N parameter app/lib.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts send.res static bk= cl= src=
      N return app/lib.ts send#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E calls function:app/main.ts#go->function:app/lib.ts#send p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#send.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:35
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:35
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("export default of a value", async () => {
    expect(
      await lines({
        "app/lib.ts": `export default { send${SEND} }\n`,
        "app/main.ts": main(`lib.send(res, ${USER}.email)`, `import lib from "./lib.js"`),
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts <module>>send@1:18 static bk= cl= src=1:18
      N parameter app/lib.ts <module>>send@1:18.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      N parameter app/lib.ts <module>>send@1:18.res static bk= cl= src=
      N return app/lib.ts <module>>send@1:18#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:46
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:46
      E calls function:app/main.ts#go->function:app/lib.ts#<module>>send@1:18 p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#<module>>send@1:18.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#<module>>send@1:18.v->function:app/lib.ts#<module>>send@1:18 p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:43
      E side-effect function:app/lib.ts#<module>>send@1:18->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:43
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("export = is not a default export", async () => {
    expect(
      await lines({
        "app/lib.ts": `export = function ${SEND}\n`,
        "app/main.ts": main(`send(res, ${USER}.email)`, `import send from "./lib.js"`),
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      N function app/lib.ts <module>>anonymous@1:10 static bk= cl= src=1:10
      N parameter app/lib.ts <module>>anonymous@1:10.res static bk= cl= src=
      N parameter app/lib.ts <module>>anonymous@1:10.v static bk= cl= src=
      N return app/lib.ts <module>>anonymous@1:10#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:3:32 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("a name exported with its declaration, in a list, and renamed in a list", async () => {
    expect(
      await lines({
        "app/lib.ts": `export function direct${SEND}\nfunction listed${SEND}\nfunction other${SEND}\nexport { listed, other as renamed }\nexport const arrow = (res: any, v: any) => res.json(v)\nfunction hidden${SEND}\nexport function useHidden(res: any, v: any) { hidden(res, v) }\n`,
        "app/main.ts": `${IMPORT_CAP}import { direct, listed, renamed, arrow, useHidden } from "./lib.js"\nexport function go(res: any) { direct(res, ${USER}.id); listed(res, ${USER}.name); renamed(res, ${USER}.email); arrow(res, ${USER}.role); useHidden(res, ${USER}.passwordHash) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/lib.ts useHidden static bk= cl= src=7:1
      N function app/lib.ts hidden static bk= cl= src=6:1
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts direct static bk= cl= src=1:1
      N parameter app/lib.ts direct.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/lib.ts listed static bk= cl= src=2:1
      N parameter app/lib.ts listed.v static bk= cl= src=
      N function app/lib.ts other static bk= cl= src=3:1
      N parameter app/lib.ts other.v static bk= cl= src=
      N function app/lib.ts arrow static bk= cl= src=5:22
      N parameter app/lib.ts arrow.v static bk= cl= src=
      N parameter app/lib.ts useHidden.v static bk= cl= src=
      N parameter app/lib.ts hidden.v static bk= cl= src=
      N parameter app/lib.ts direct.res static bk= cl= src=
      N return app/lib.ts direct#return static bk= cl= src=
      N parameter app/lib.ts listed.res static bk= cl= src=
      N return app/lib.ts listed#return static bk= cl= src=
      N parameter app/lib.ts other.res static bk= cl= src=
      N return app/lib.ts other#return static bk= cl= src=
      N parameter app/lib.ts arrow.res static bk= cl= src=
      N return app/lib.ts arrow#return static bk= cl= src=
      N parameter app/lib.ts hidden.res static bk= cl= src=
      N return app/lib.ts hidden#return static bk= cl= src=
      N parameter app/lib.ts useHidden.res static bk= cl= src=
      N return app/lib.ts useHidden#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E calls function:app/lib.ts#useHidden->function:app/lib.ts#hidden p=- static o= h= @app/lib.ts:7:47
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:44
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:44
      E calls function:app/main.ts#go->function:app/lib.ts#direct p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#direct.v p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#direct.v->function:app/lib.ts#direct p=id static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:44
      E side-effect function:app/lib.ts#direct->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:44
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:96
      E calls function:app/main.ts#go->function:app/lib.ts#listed p=- static o= h= @app/main.ts:3:84
      E passes function:app/main.ts#go->parameter:app/lib.ts#listed.v p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:84
      E reads parameter:app/lib.ts#listed.v->function:app/lib.ts#listed p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:37
      E side-effect function:app/lib.ts#listed->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:37
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:151
      E calls function:app/main.ts#go->function:app/lib.ts#other p=- static o= h= @app/main.ts:3:138
      E passes function:app/main.ts#go->parameter:app/lib.ts#other.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:138
      E reads parameter:app/lib.ts#other.v->function:app/lib.ts#other p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:3:36
      E side-effect function:app/lib.ts#other->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:3:36
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=role static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:205
      E calls function:app/main.ts#go->function:app/lib.ts#arrow p=- static o= h= @app/main.ts:3:194
      E passes function:app/main.ts#go->parameter:app/lib.ts#arrow.v p=role static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:194
      E reads parameter:app/lib.ts#arrow.v->function:app/lib.ts#arrow p=role static o=field:features/user/user.ts#userData.user h= @app/lib.ts:5:44
      E side-effect function:app/lib.ts#arrow->boundary:boundary:code#http-response p=role static o=field:features/user/user.ts#userData.user h= @app/lib.ts:5:44
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:262
      E calls function:app/main.ts#go->function:app/lib.ts#useHidden p=- static o= h= @app/main.ts:3:247
      E passes function:app/main.ts#go->parameter:app/lib.ts#useHidden.v p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:247
      E reads parameter:app/lib.ts#useHidden.v->function:app/lib.ts#useHidden p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/lib.ts:7:47
      E passes function:app/lib.ts#useHidden->parameter:app/lib.ts#hidden.v p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/lib.ts:7:47
      E reads parameter:app/lib.ts#hidden.v->function:app/lib.ts#hidden p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/lib.ts:6:37
      E side-effect function:app/lib.ts#hidden->boundary:boundary:code#http-response p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/lib.ts:6:37"
    `)
  })

  it("a function that is not exported cannot be imported", async () => {
    expect(
      await leaks({
        "app/lib.ts": `function hidden${SEND}\nexport const x = 1\n`,
        "app/main.ts": main(`hidden(res, ${USER}.email)`, `import { hidden } from "./lib.js"`),
      }),
    ).toEqual([])
  })

  it("a namespace's functions belong to the file, its exports do not become the file's", async () => {
    expect(
      await lines({
        "app/lib.ts": `export namespace N { export function inner${SEND} }\nexport function outer${SEND}\nnamespace Hidden { export function secret${SEND} }\n`,
        "app/main.ts": `${IMPORT_CAP}import { N, outer, inner, secret } from "./lib.js"\nexport function go(res: any) { N.inner(res, ${USER}.email); outer(res, ${USER}.name); inner(res, ${USER}.id); secret(res, ${USER}.role) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts outer static bk= cl= src=2:1
      N parameter app/lib.ts outer.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/lib.ts inner static bk= cl= src=1:22
      N parameter app/lib.ts inner.res static bk= cl= src=
      N parameter app/lib.ts inner.v static bk= cl= src=
      N return app/lib.ts inner#return static bk= cl= src=
      N parameter app/lib.ts outer.res static bk= cl= src=
      N return app/lib.ts outer#return static bk= cl= src=
      N function app/lib.ts secret static bk= cl= src=3:20
      N parameter app/lib.ts secret.res static bk= cl= src=
      N parameter app/lib.ts secret.v static bk= cl= src=
      N return app/lib.ts secret#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:45
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:45
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:99
      E calls function:app/main.ts#go->function:app/lib.ts#outer p=- static o= h= @app/main.ts:3:88
      E passes function:app/main.ts#go->parameter:app/lib.ts#outer.v p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:88
      E reads parameter:app/lib.ts#outer.v->function:app/lib.ts#outer p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:43
      E side-effect function:app/lib.ts#outer->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:43
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:152
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=role static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:204
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:3:32 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/main.ts:3:141 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/id
      U unresolved-call app/main.ts:3:192 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/role"
    `)
  })

  it("re-exports: export *, export * as, export { x as y } from, and one from a file that is not there", async () => {
    expect(
      await lines({
        "app/lib.ts": `export function send${SEND}\nexport function other${SEND}\n`,
        "app/barrel.ts": `export * from "./lib.js"\nexport * as ns from "./lib.js"\nexport { other as renamed } from "./lib.js"\nexport { missing } from "./not-there.js"\nexport * from "./not-there.js"\n`,
        "app/main.ts": `${IMPORT_CAP}import { send, ns, renamed, missing } from "./barrel.js"\nexport function go(res: any) { send(res, ${USER}.email); ns.send(res, ${USER}.name); renamed(res, ${USER}.id); missing(res, ${USER}.role) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts send static bk= cl= src=1:1
      N parameter app/lib.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/lib.ts other static bk= cl= src=2:1
      N parameter app/lib.ts other.v static bk= cl= src=
      N parameter app/lib.ts send.res static bk= cl= src=
      N return app/lib.ts send#return static bk= cl= src=
      N parameter app/lib.ts other.res static bk= cl= src=
      N return app/lib.ts other#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E calls function:app/main.ts#go->function:app/lib.ts#send p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#send.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:98
      E passes function:app/main.ts#go->parameter:app/lib.ts#send.v p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:85
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:153
      E calls function:app/main.ts#go->function:app/lib.ts#other p=- static o= h= @app/main.ts:3:140
      E passes function:app/main.ts#go->parameter:app/lib.ts#other.v p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:140
      E reads parameter:app/lib.ts#other.v->function:app/lib.ts#other p=id static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:43
      E side-effect function:app/lib.ts#other->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:43
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=role static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:206
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:3:193 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/role"
    `)
  })

  it("a re-export of a name the barrel also declares points at the barrel's own", async () => {
    expect(
      await lines({
        "app/lib.ts": `export function send${SEND}\n`,
        "app/barrel.ts": `import { send as imported } from "./lib.js"\nfunction send(res: any, v: any) { imported(res, v) }\nexport { send }\n`,
        "app/main.ts": `${IMPORT_CAP}import { send } from "./barrel.js"\nexport function go(res: any) { send(res, ${USER}.email) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/barrel.ts send static bk= cl= src=2:1
      N function app/lib.ts send static bk= cl= src=1:1
      N function app/main.ts go static bk= cl= src=3:1
      N parameter app/barrel.ts send.v static bk= cl= src=
      N parameter app/lib.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/barrel.ts send.res static bk= cl= src=
      N return app/barrel.ts send#return static bk= cl= src=
      N parameter app/lib.ts send.res static bk= cl= src=
      N return app/lib.ts send#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E calls function:app/barrel.ts#send->function:app/lib.ts#send p=- static o= h= @app/barrel.ts:2:35
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:42
      E calls function:app/main.ts#go->function:app/barrel.ts#send p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/barrel.ts#send.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/barrel.ts#send.v->function:app/barrel.ts#send p=email static o=field:features/user/user.ts#userData.user h= @app/barrel.ts:2:35
      E passes function:app/barrel.ts#send->parameter:app/lib.ts#send.v p=email static o=field:features/user/user.ts#userData.user h= @app/barrel.ts:2:35
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("code at the top of a module runs, and what it does with a field counts", async () => {
    expect(
      await lines({
        "app/lib.ts": `${IMPORT_CAP}export function send${SEND}\nconst captured = ${USER}.passwordHash\nexport const exposed = captured\nif (true) { console.log(${USER}.id) }\n`,
        "app/main.ts": `import { send, exposed } from "./lib.js"\nexport function go(res: any) { send(res, exposed) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/lib.ts <module> static bk= cl= src=
      N boundary boundary:code console static bk=log cl= src=
      N function app/main.ts go static bk= cl= src=2:1
      N function app/lib.ts send static bk= cl= src=2:1
      N parameter app/lib.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts send.res static bk= cl= src=
      N return app/lib.ts send#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/lib.ts#<module> p= static o=field:features/user/user.ts#userData.user h= @app/lib.ts:3:18
      E reads field:features/user/user.ts#userData.user->function:app/lib.ts#<module> p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/lib.ts:3:18
      E reads field:features/user/user.ts#userData.user->function:app/lib.ts#<module> p=id static o=field:features/user/user.ts#userData.user h= @app/lib.ts:5:25
      E side-effect function:app/lib.ts#<module>->boundary:boundary:code#console p=id static o=field:features/user/user.ts#userData.user h= @app/lib.ts:5:13
      E calls function:app/main.ts#go->function:app/lib.ts#send p=- static o= h= @app/main.ts:2:32
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/main.ts:2:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#send.v p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/main.ts:2:32
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:42
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=passwordHash static o=field:features/user/user.ts#userData.user h= @app/lib.ts:2:42
      E discards function:app/lib.ts#<module>->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/lib.ts#<module>->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/lib.ts#<module>->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a dynamic import() or a require() of a file in the project is followed", async () => {
    expect(
      await lines({
        "app/lib.ts": `export function send${SEND}\n`,
        "app/main.ts": `${IMPORT_CAP}export async function go(res: any) { const lib = await import("./lib.js"); lib.send(res, ${USER}.email); const other = require("./lib.js"); other.send(res, ${USER}.name); const gone = await import("./gone.js"); gone.send(res, ${USER}.id) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=2:1
      N function app/lib.ts send static bk= cl= src=1:1
      N parameter app/lib.ts send.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts send.res static bk= cl= src=
      N return app/lib.ts send#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:2:90
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:2:90
      E calls function:app/main.ts#go->function:app/lib.ts#send p=- static o= h= @app/main.ts:2:76
      E passes function:app/main.ts#go->parameter:app/lib.ts#send.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:2:76
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:2:184
      E passes function:app/main.ts#go->parameter:app/lib.ts#send.v p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:2:168
      E reads parameter:app/lib.ts#send.v->function:app/lib.ts#send p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E side-effect function:app/lib.ts#send->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:42
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:2:281
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:2:266 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/id"
    `)
  })

  it("a capability declared in the same file as the code that uses it", async () => {
    const r = await h.scan(
      {
        "app/p.ts": `export const userData = createData({ fields: { user: {} } });\nexport function go(res: any) { res.json(${USER}.email) }\n`,
      },
      {},
      inventoryOf(capability({ file: "app/p.ts" })),
    )
    expect(
      r.input.edges.filter((e) => e.kind === "side-effect").map((e) => (e.path ?? []).join(".")),
    ).toEqual(["email"])
  })

  it("a class or a function-valued constant that is not exported cannot be imported", async () => {
    expect(
      await leaks({
        "app/lib.ts": `class Hidden { run${SEND} }\nconst arrow = ${SEND.replace("{ res.json(v) }", "=> res.json(v)")}\nexport const x = 1\n`,
        "app/main.ts": `${IMPORT_CAP}import { Hidden, arrow } from "./lib.js"\nexport function go(res: any) { new Hidden().run(res, ${USER}.email); arrow(res, ${USER}.name) }\n`,
      }),
    ).toEqual([])
  })

  it("a class that is exported can be imported, one declared ambient cannot be followed", async () => {
    expect(
      await lines({
        "app/lib.ts": `export class Real { run${SEND} }\nexport declare class Ext { send(v: any): void }\n`,
        "app/main.ts": `${IMPORT_CAP}import { Real, Ext } from "./lib.js"\nexport function go(res: any) { new Real().run(res, ${USER}.email); new Ext().send(${USER}.name) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts Real.constructor static bk= cl= src=
      N function app/lib.ts Real.run static bk= cl= src=1:21
      N parameter app/lib.ts Real.run.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts Real.run.res static bk= cl= src=
      N return app/lib.ts Real.run#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E calls function:app/main.ts#go->function:app/lib.ts#Real.constructor p=- static o= h= @app/main.ts:3:32
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:52
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:52
      E calls function:app/main.ts#go->function:app/lib.ts#Real.run p=- static o= h= @app/main.ts:3:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#Real.run.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:32
      E reads parameter:app/lib.ts#Real.run.v->function:app/lib.ts#Real.run p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:45
      E side-effect function:app/lib.ts#Real.run->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:45
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:110
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:3:95 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
    `)
  })

  it("export * as from a file that is not there points at nothing", async () => {
    expect(
      await lines({
        "app/barrel.ts": `export * as ns from "./not-there.js"\nexport function ns2(res: any, v: any) { res.json(v) }\n`,
        "app/main.ts": `${IMPORT_CAP}import { ns } from "./barrel.js"\nexport function go(res: any) { ns.send(res, ${USER}.email) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/barrel.ts ns2 static bk= cl= src=2:1
      N parameter app/barrel.ts ns2.res static bk= cl= src=
      N parameter app/barrel.ts ns2.v static bk= cl= src=
      N return app/barrel.ts ns2#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:45
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:45
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:3:32 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("a name re-exported from a file that is not there is not the barrel's own of that name", async () => {
    expect(
      await lines({
        "app/barrel.ts": `function missing${SEND}\nexport { missing } from "./not-there.js"\n`,
        "app/main.ts": `${IMPORT_CAP}import { missing } from "./barrel.js"\nexport function go(res: any) { missing(res, ${USER}.email) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/barrel.ts missing static bk= cl= src=1:1
      N parameter app/barrel.ts missing.res static bk= cl= src=
      N parameter app/barrel.ts missing.v static bk= cl= src=
      N return app/barrel.ts missing#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:45
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:45
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:3:32 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("export default of a parenthesized class, of a constant object, and of a class named elsewhere", async () => {
    expect(
      await lines({
        "app/paren.ts": `export default (class { run${SEND} })\n`,
        "app/object.ts": `const cfg = { send${SEND} }\nexport default cfg\n`,
        "app/named.ts": `class Sender { run${SEND} }\nexport default Sender\n`,
        "app/main.ts": `${IMPORT_CAP}import Paren from "./paren.js"\nimport cfg from "./object.js"\nimport Named from "./named.js"\nexport function go(res: any) { new Paren().run(res, ${USER}.email); cfg.send(res, ${USER}.name); new Named().run(res, ${USER}.id) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=5:1
      N function app/paren.ts default.constructor static bk= cl= src=
      N function app/paren.ts default.run static bk= cl= src=1:25
      N parameter app/paren.ts default.run.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/object.ts <module>>send@1:15 static bk= cl= src=1:15
      N parameter app/object.ts <module>>send@1:15.v static bk= cl= src=
      N function app/named.ts Sender.constructor static bk= cl= src=
      N function app/named.ts Sender.run static bk= cl= src=1:16
      N parameter app/named.ts Sender.run.v static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      N parameter app/named.ts Sender.run.res static bk= cl= src=
      N return app/named.ts Sender.run#return static bk= cl= src=
      N parameter app/paren.ts default.run.res static bk= cl= src=
      N return app/paren.ts default.run#return static bk= cl= src=
      N parameter app/object.ts <module>>send@1:15.res static bk= cl= src=
      N return app/object.ts <module>>send@1:15#return static bk= cl= src=
      E calls function:app/main.ts#go->function:app/paren.ts#default.constructor p=- static o= h= @app/main.ts:5:32
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:5:53
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:5:53
      E calls function:app/main.ts#go->function:app/paren.ts#default.run p=- static o= h= @app/main.ts:5:32
      E passes function:app/main.ts#go->parameter:app/paren.ts#default.run.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:5:32
      E reads parameter:app/paren.ts#default.run.v->function:app/paren.ts#default.run p=email static o=field:features/user/user.ts#userData.user h= @app/paren.ts:1:49
      E side-effect function:app/paren.ts#default.run->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/paren.ts:1:49
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:5:110
      E calls function:app/main.ts#go->function:app/object.ts#<module>>send@1:15 p=- static o= h= @app/main.ts:5:96
      E passes function:app/main.ts#go->parameter:app/object.ts#<module>>send@1:15.v p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:5:96
      E reads parameter:app/object.ts#<module>>send@1:15.v->function:app/object.ts#<module>>send@1:15 p=name static o=field:features/user/user.ts#userData.user h= @app/object.ts:1:40
      E side-effect function:app/object.ts#<module>>send@1:15->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/object.ts:1:40
      E calls function:app/main.ts#go->function:app/named.ts#Sender.constructor p=- static o= h= @app/main.ts:5:152
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:5:173
      E calls function:app/main.ts#go->function:app/named.ts#Sender.run p=- static o= h= @app/main.ts:5:152
      E passes function:app/main.ts#go->parameter:app/named.ts#Sender.run.v p=id static o=field:features/user/user.ts#userData.user h= @app/main.ts:5:152
      E reads parameter:app/named.ts#Sender.run.v->function:app/named.ts#Sender.run p=id static o=field:features/user/user.ts#userData.user h= @app/named.ts:1:40
      E side-effect function:app/named.ts#Sender.run->boundary:boundary:code#http-response p=id static o=field:features/user/user.ts#userData.user h= @app/named.ts:1:40
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("an ambient module with no body, and a namespace with a dotted name", async () => {
    expect(
      await lines({
        "app/lib.ts": `declare module "ext";\nexport namespace A.B { export function f${SEND} }\nexport function g${SEND}\n`,
        "app/main.ts": `${IMPORT_CAP}import { A, g } from "./lib.js"\nexport function go(res: any) { A.B.f(res, ${USER}.email); g(res, ${USER}.name) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=3:1
      N function app/lib.ts g static bk= cl= src=3:1
      N parameter app/lib.ts g.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N parameter app/lib.ts g.res static bk= cl= src=
      N return app/lib.ts g#return static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:43
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:43
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:93
      E calls function:app/main.ts#go->function:app/lib.ts#g p=- static o= h= @app/main.ts:3:86
      E passes function:app/main.ts#go->parameter:app/lib.ts#g.v p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:3:86
      E reads parameter:app/lib.ts#g.v->function:app/lib.ts#g p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:3:39
      E side-effect function:app/lib.ts#g->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/lib.ts:3:39
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:3:32 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/email"
    `)
  })

  it("two classes of one name in one file are told apart", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}export function a(res: any) { class K { run${SEND} }; new K().run(res, ${USER}.email) }\nexport function b(res: any) { class K { run${SEND} }; new K().run(res, ${USER}.name) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts a static bk= cl= src=2:1
      N function app/p.ts a>K.constructor static bk= cl= src=
      N function app/p.ts a>K.run static bk= cl= src=2:41
      N parameter app/p.ts a>K.run.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/p.ts b static bk= cl= src=3:1
      N function app/p.ts b>K.constructor static bk= cl= src=
      N function app/p.ts b>K.run static bk= cl= src=3:41
      N parameter app/p.ts b>K.run.v static bk= cl= src=
      N parameter app/p.ts a.res static bk= cl= src=
      N return app/p.ts a#return static bk= cl= src=
      N parameter app/p.ts b.res static bk= cl= src=
      N return app/p.ts b#return static bk= cl= src=
      N parameter app/p.ts a>K.run.res static bk= cl= src=
      N return app/p.ts a>K.run#return static bk= cl= src=
      N parameter app/p.ts b>K.run.res static bk= cl= src=
      N return app/p.ts b>K.run#return static bk= cl= src=
      E calls function:app/p.ts#a->function:app/p.ts#a>K.constructor p=- static o= h= @app/p.ts:2:82
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:99
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#a p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:99
      E calls function:app/p.ts#a->function:app/p.ts#a>K.run p=- static o= h= @app/p.ts:2:82
      E passes function:app/p.ts#a->parameter:app/p.ts#a>K.run.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:82
      E reads parameter:app/p.ts#a>K.run.v->function:app/p.ts#a>K.run p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:65
      E side-effect function:app/p.ts#a>K.run->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:65
      E calls function:app/p.ts#b->function:app/p.ts#b>K.constructor p=- static o= h= @app/p.ts:3:82
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:99
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#b p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:99
      E calls function:app/p.ts#b->function:app/p.ts#b>K.run p=- static o= h= @app/p.ts:3:82
      E passes function:app/p.ts#b->parameter:app/p.ts#b>K.run.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:82
      E reads parameter:app/p.ts#b>K.run.v->function:app/p.ts#b>K.run p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:65
      E side-effect function:app/p.ts#b>K.run->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:65
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=name static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#a->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=email static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#b->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a class written inside a function is a new class for each call, with that call's variables", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}function make(v: any) { return class { run(res: any) { res.json(v) } } }\nexport function go(res: any) { const A = make(${USER}.email); const B = make(${USER}.name); new A().run(res); new B().run(res) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=3:1
      N function app/p.ts make static bk= cl= src=2:1
      N parameter app/p.ts make.v static bk= cl= src=
      N function app/p.ts make>anonymous@2.constructor static bk= cl= src=
      N function app/p.ts make>anonymous@2.run static bk= cl= src=2:40
      N boundary boundary:code http-response static bk=client-response cl= src=
      N return app/p.ts make#return static bk= cl= src=
      N parameter app/p.ts go.res static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      N parameter app/p.ts make>anonymous@2.run.res static bk= cl= src=
      N return app/p.ts make>anonymous@2.run#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:47
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:47
      E calls function:app/p.ts#go->function:app/p.ts#make p=- static o= h= @app/p.ts:3:42
      E passes function:app/p.ts#go->parameter:app/p.ts#make.v p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:42
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:105
      E passes function:app/p.ts#go->parameter:app/p.ts#make.v p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:3:100
      E calls function:app/p.ts#go->function:app/p.ts#make>anonymous@2.constructor p=- static o= h= @app/p.ts:3:147
      E calls function:app/p.ts#go->function:app/p.ts#make>anonymous@2.run p=- static o= h= @app/p.ts:3:147
      E reads parameter:app/p.ts#make.v->function:app/p.ts#make>anonymous@2.run p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:56
      E side-effect function:app/p.ts#make>anonymous@2.run->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:56
      E reads parameter:app/p.ts#make.v->function:app/p.ts#make>anonymous@2.run p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:56
      E side-effect function:app/p.ts#make>anonymous@2.run->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:2:56
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("CommonJS: only module.exports.x, and a module that makes its exports itself", async () => {
    expect(
      await lines({
        "app/lib.ts": `module.exports.alias = function ${SEND}\n`,
        "app/other.ts": `exports = module.exports = { send${SEND} }\n`,
        "app/main.ts": `${IMPORT_CAP}const lib = require("./lib")\nconst other = require("./other")\nexport function go(res: any) { lib.alias(res, ${USER}.email); other.send(res, ${USER}.name) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=4:1
      N function app/lib.ts <module>>anonymous@1:24 static bk= cl= src=1:24
      N parameter app/lib.ts <module>>anonymous@1:24.v static bk= cl= src=
      N boundary boundary:code http-response static bk=client-response cl= src=
      N function app/other.ts <module>>send@1:30 static bk= cl= src=1:30
      N parameter app/other.ts <module>>send@1:30.v static bk= cl= src=
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      N parameter app/lib.ts <module>>anonymous@1:24.res static bk= cl= src=
      N return app/lib.ts <module>>anonymous@1:24#return static bk= cl= src=
      N parameter app/other.ts <module>>send@1:30.res static bk= cl= src=
      N return app/other.ts <module>>send@1:30#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:47
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:47
      E calls function:app/main.ts#go->function:app/lib.ts#<module>>anonymous@1:24 p=- static o= h= @app/main.ts:4:32
      E passes function:app/main.ts#go->parameter:app/lib.ts#<module>>anonymous@1:24.v p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:32
      E reads parameter:app/lib.ts#<module>>anonymous@1:24.v->function:app/lib.ts#<module>>anonymous@1:24 p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:54
      E side-effect function:app/lib.ts#<module>>anonymous@1:24->boundary:boundary:code#http-response p=email static o=field:features/user/user.ts#userData.user h= @app/lib.ts:1:54
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:106
      E calls function:app/main.ts#go->function:app/other.ts#<module>>send@1:30 p=- static o= h= @app/main.ts:4:90
      E passes function:app/main.ts#go->parameter:app/other.ts#<module>>send@1:30.v p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:90
      E reads parameter:app/other.ts#<module>>send@1:30.v->function:app/other.ts#<module>>send@1:30 p=name static o=field:features/user/user.ts#userData.user h= @app/other.ts:1:55
      E side-effect function:app/other.ts#<module>>send@1:30->boundary:boundary:code#http-response p=name static o=field:features/user/user.ts#userData.user h= @app/other.ts:1:55
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @"
    `)
  })

  it("a module variable written by a function declared after the one that reads it", async () => {
    expect(
      await leaks({
        "app/p.ts": `${IMPORT_CAP}let shared: any\nexport function reader(res: any) { res.json(shared) }\nexport function writer() { shared = ${USER}.passwordHash }\n`,
      }),
    ).toEqual(["passwordHash"])
  })

  it("CommonJS: each file has exports of its own, so one file's are not another's", async () => {
    expect(
      await lines({
        "app/lib.ts": `module.exports.alias = function ${SEND}\n`,
        "app/other.ts": `exports.send = function ${SEND}\n`,
        "app/main.ts": `${IMPORT_CAP}const lib = require("./lib")\nconst other = require("./other")\nexport function go(res: any) { lib.send(res, ${USER}.email); other.alias(res, ${USER}.name) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/main.ts go static bk= cl= src=4:1
      N parameter app/main.ts go.res static bk= cl= src=
      N return app/main.ts go#return static bk= cl= src=
      N function app/lib.ts <module>>anonymous@1:24 static bk= cl= src=1:24
      N parameter app/lib.ts <module>>anonymous@1:24.res static bk= cl= src=
      N parameter app/lib.ts <module>>anonymous@1:24.v static bk= cl= src=
      N return app/lib.ts <module>>anonymous@1:24#return static bk= cl= src=
      N function app/other.ts <module>>anonymous@1:16 static bk= cl= src=1:16
      N parameter app/other.ts <module>>anonymous@1:16.res static bk= cl= src=
      N parameter app/other.ts <module>>anonymous@1:16.v static bk= cl= src=
      N return app/other.ts <module>>anonymous@1:16#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:46
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:46
      E reads field:features/user/user.ts#userData.user->function:app/main.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/main.ts:4:106
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/main.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/main.ts:4:32 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/main.ts:4:89 subject=function:app/main.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
    `)
  })

  it("a plain value that is not exported cannot be imported", async () => {
    expect(
      await leaks({
        "app/lib.ts": `const hidden = { send${SEND} }\nexport const x = 1\n`,
        "app/main.ts": `${IMPORT_CAP}import { hidden } from "./lib.js"\nexport function go(res: any) { hidden.send(res, ${USER}.email) }\n`,
      }),
    ).toEqual([])
  })

  it("two classes of one name at the top of a file, in different namespaces, are told apart", async () => {
    expect(
      await lines({
        "app/p.ts": `${IMPORT_CAP}namespace A { export class K { run${SEND} } }\nnamespace B { export class K { run${SEND} } }\nexport function go(res: any) { new A.K().run(res, ${USER}.email); new B.K().run(res, ${USER}.name) }\n`,
      }),
    ).toMatchInlineSnapshot(`
      "N field features/user/user.ts userData.user static bk= cl=secret src=
      N field features/user/user.ts userData.team static bk= cl= src=
      N field features/user/user.ts userData.tags static bk= cl= src=
      N field features/user/user.ts userData.empty static bk= cl= src=
      N function app/p.ts go static bk= cl= src=4:1
      N function app/p.ts K.run static bk= cl= src=2:32
      N parameter app/p.ts K.run.res static bk= cl= src=
      N parameter app/p.ts K.run.v static bk= cl= src=
      N return app/p.ts K.run#return static bk= cl= src=
      N function app/p.ts K@3:15.run static bk= cl= src=3:32
      N parameter app/p.ts K@3:15.run.res static bk= cl= src=
      N parameter app/p.ts K@3:15.run.v static bk= cl= src=
      N return app/p.ts K@3:15.run#return static bk= cl= src=
      N parameter app/p.ts go.res static bk= cl= src=
      N return app/p.ts go#return static bk= cl= src=
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p= static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:51
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=email static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:51
      E reads field:features/user/user.ts#userData.user->function:app/p.ts#go p=name static o=field:features/user/user.ts#userData.user h= @app/p.ts:4:113
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=id static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=passwordHash static o=field:features/user/user.ts#userData.user h= @
      E discards function:app/p.ts#go->field:features/user/user.ts#userData.user p=role static o=field:features/user/user.ts#userData.user h= @
      U unresolved-call app/p.ts:4:32 subject=function:app/p.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/email
      U unresolved-call app/p.ts:4:94 subject=function:app/p.ts#go detail=call target is not a project function data=field:features/user/user.ts#userData.user/name"
    `)
  })
})
