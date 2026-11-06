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
 * Reach of the flow pass over module syntax (ADR 0070): default exports and default imports, barrel re-exports
 * (`export *`, `export * as`, `export { a as b } from`) and dynamic `import("./literal.js")`. A name the scan cannot
 * resolve stays an explicit unresolved call, and a cycle of re-exports ends the search instead of the process.
 */
describe("flow-reach: default exports, barrels and dynamic import", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  /** Scans `files` plus a handler `h(res, key)` with `imports` above it. */
  const scan = async (files: Record<string, string>, body: string, imports = "", keyword = "") => {
    const source = handler(body, imports)["app/p.ts"] ?? ""
    return (
      await h.scan({
        ...files,
        "app/p.ts":
          keyword === ""
            ? source
            : source.replace("export function h", `export ${keyword}function h`),
      })
    ).input
  }

  describe("default exports", () => {
    const sink = `console.log(v)`
    it.each([
      [
        "a default-exported function declaration",
        `export default function fx(v: any) { ${sink} }\n`,
      ],
      ["an anonymous default-exported function", `export default function (v: any) { ${sink} }\n`],
      ["a default-exported arrow function", `export default (v: any) => ${sink}\n`],
      [
        "a default-exported function expression",
        `export default function named(v: any) { ${sink} }\n`,
      ],
      [
        "a default export naming a function",
        `function fx(v: any) { ${sink} }\nexport default fx\n`,
      ],
      [
        "a function exported under the name default",
        `function fx(v: any) { ${sink} }\nexport { fx as default }\n`,
      ],
      [
        "a default-exported arrow held in a constant",
        `const fx = (v: any) => ${sink}\nexport default fx\n`,
      ],
    ])("%s is what a default import calls", async (_, source) => {
      const input = await scan(
        { "app/f.ts": source },
        `  anything(${USER}.email)`,
        `import anything from "./f.js";\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("any local name can be given to a default import, and `{ default as x }` is the same import", async () => {
      const input = await scan(
        { "app/f.ts": `export default function fx(v: any) { console.log(v) }\n` },
        `  one(${USER}.email)\n  two(${USER}.name)`,
        `import one from "./f.js";\nimport { default as two } from "./f.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a default import and named imports can come from one statement", async () => {
      const input = await scan(
        {
          "app/f.ts": `export default function fx(v: any) { console.log(v) }\nexport function gx(v: any) { console.log(v) }\n`,
        },
        `  fx(${USER}.email)\n  gx(${USER}.name)`,
        `import fx, { gx } from "./f.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
    })

    it("a default-exported class is what a default import constructs", async () => {
      const input = await scan(
        { "app/f.ts": `export default class Svc { send(v: any) { console.log(v) } }\n` },
        `  new Anything().send(${USER}.email)`,
        `import Anything from "./f.js";\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("an anonymous default-exported class, and a default export naming a class, are classes too", async () => {
      const input = await scan(
        {
          "app/a.ts": `export default class { send(v: any) { console.log(v) } }\n`,
          "app/b.ts": `class Svc { send(v: any) { console.log(v) } }\nexport default Svc\n`,
        },
        `  new A().send(${USER}.email)\n  new B().send(${USER}.name)`,
        `import A from "./a.js";\nimport B from "./b.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a default-exported object is a value whose methods can be called", async () => {
      const input = await scan(
        {
          "app/f.ts": `export default { send(v: any) { console.log(v) }, later: (v: any) => console.log(v) }\n`,
        },
        `  o.send(${USER}.email)\n  o.later(${USER}.name)`,
        `import o from "./f.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a default export made by a call to code outside the project cannot be called into", async () => {
      const input = await scan(
        {
          "app/f.ts": `import { wrap } from "some-lib";\nexport default wrap((v: any) => console.log(v))\n`,
        },
        `  anything(${USER}.email)`,
        `import anything from "./f.js";\n`,
      )
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("a module with no default export gives a default import nothing to call", async () => {
      const input = await scan(
        { "app/f.ts": `export function fx(v: any) { console.log(v) }\n` },
        `  anything(${USER}.email)`,
        `import anything from "./f.js";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })

    it("a default-exported function is exported as default only, not under its own name", async () => {
      const input = await scan(
        { "app/f.ts": `export default function fx(v: any) { console.log(v) }\n` },
        `  fx(${USER}.email)`,
        `import { fx } from "./f.js";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })

    it("a default import of a module outside the project is an unresolved call", async () => {
      const input = await scan(
        {},
        `  audit(${USER}.email)`,
        `import audit from "some-analytics-lib";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
      expect(unknownData(input)).toEqual([["email"]])
    })

    it("exported constants are values other modules can read and fill in", async () => {
      const input = await scan(
        {
          "app/store.ts": `export const store: any = {}\nexport const tools = { send(v: any) { console.log(v) } }\n`,
          "app/w.ts": `import { userData } from "../features/user/user.js";\nimport { store } from "./store.js";\nexport function put() { store.v = userData.getSnapshot().fields.user.email }\n`,
        },
        `  res.json(store.v)\n  tools.send(${USER}.name)`,
        `import { store, tools } from "./store.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })
  })

  describe("re-exports", () => {
    const lib = {
      "app/lib.ts": `export function fx(v: any) { console.log(v) }\nexport default function dx(v: any) { console.log(v) }\nexport class Svc { send(v: any) { console.log(v) } }\n`,
    }

    it("`export *` carries every named export of the other module", async () => {
      const input = await scan(
        { ...lib, "app/barrel.ts": `export * from "./lib.js"\n` },
        `  fx(${USER}.email)\n  new Svc().send(${USER}.name)`,
        `import { fx, Svc } from "./barrel.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("`export *` does not carry the default export", async () => {
      const input = await scan(
        { ...lib, "app/barrel.ts": `export * from "./lib.js"\n` },
        `  dx(${USER}.email)`,
        `import dx from "./barrel.js";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })

    it("`export * as ns` makes a namespace that can be called into", async () => {
      const input = await scan(
        { ...lib, "app/barrel.ts": `export * as ns from "./lib.js"\n` },
        `  ns.fx(${USER}.email)\n  const f = ns.fx\n  f(${USER}.name)`,
        `import { ns } from "./barrel.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("`export { a as b } from` renames, and `export { default as x } from` exposes a default", async () => {
      const input = await scan(
        { ...lib, "app/barrel.ts": `export { fx as gx, default as hx } from "./lib.js"\n` },
        `  gx(${USER}.email)\n  hx(${USER}.name)`,
        `import { gx, hx } from "./barrel.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("`export { default } from` re-exports the default under the name default", async () => {
      const input = await scan(
        { ...lib, "app/barrel.ts": `export { default } from "./lib.js"\n` },
        `  anything(${USER}.email)`,
        `import anything from "./barrel.js";\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a namespace import of a barrel sees what the barrel re-exports", async () => {
      const input = await scan(
        { ...lib, "app/barrel.ts": `export * from "./lib.js"\n` },
        `  everything.fx(${USER}.email)`,
        `import * as everything from "./barrel.js";\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("barrels can be chained, and a name declared in the barrel itself wins over a star", async () => {
      const input = await scan(
        {
          ...lib,
          "app/b1.ts": `export * from "./lib.js"\n`,
          "app/b2.ts": `export * from "./b1.js"\nexport function fx(v: any) { console.log("own", v) }\n`,
          "app/b3.ts": `export { fx, Svc } from "./b2.js"\n`,
        },
        `  fx(${USER}.email)\n  new Svc().send(${USER}.name)`,
        `import { fx, Svc } from "./b3.js";\n`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
      expect(facts(input).some((line) => line.includes("#fx p="))).toBe(true)
    })

    it("a chain of `export *` is followed through exactly 9 files", async () => {
      const chain = (files: number): Record<string, string> => {
        const out: Record<string, string> = {
          "app/r0.ts": `export function real(v: any) { console.log(v) }\n`,
        }
        for (let i = 1; i < files; i += 1)
          out[`app/r${String(i)}.ts`] = `export * from "./r${String(i - 1)}.js"\n`
        return out
      }
      const through = async (files: number): Promise<string[]> =>
        effects(
          await scan(
            chain(files),
            `  real(${USER}.email)`,
            `import { real } from "./r${String(files - 1)}.js";\n`,
          ),
        )
      expect([await through(9), await through(10)]).toEqual([["email|static"], []])
    })

    it("a cycle of `export *` ends the search, still finds what a member of the cycle declares, and reports what it cannot find", async () => {
      const files = {
        "app/a.ts": `export * from "./b.js"\n`,
        "app/b.ts": `export * from "./a.js"\nexport function found(v: any) { console.log(v) }\n`,
      }
      const input = await scan(
        files,
        `  found(${USER}.email)\n  missing(${USER}.name)`,
        `import { found, missing } from "./a.js";\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual(["unresolved-call 5:3"])
      expect(unknownData(input)).toEqual([["name"]])
    })

    it("a star re-export of a module outside the project provides no names", async () => {
      const input = await scan(
        { "app/barrel.ts": `export * from "some-lib"\n` },
        `  anything(${USER}.email)`,
        `import { anything } from "./barrel.js";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })

    it("a name re-exported from a module outside the project is never taken for a local of the same name", async () => {
      const input = await scan(
        {
          "app/barrel.ts": `import { fx } from "./lib.js"\nexport { fx } from "some-lib"\n`,
          ...lib,
        },
        `  fx(${USER}.email)`,
        `import { fx } from "./barrel.js";\n`,
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })

    it("a namespace in a function is looked through only when it is a module's namespace", async () => {
      const input = await scan(
        { ...lib },
        `  const lib = { fx: (v: any) => console.log(v) }\n  lib.fx(${USER}.email)`,
        `import * as other from "./lib.js";\nvoid other\n`,
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("dynamic import", () => {
    const lib = {
      "app/lib.ts": `export function fx(v: any) { console.log(v) }\nexport default function dx(v: any) { console.log(v) }\nexport const tools = { send(v: any) { console.log(v) } }\n`,
    }

    it("a namespace read from await import() is called like a namespace import", async () => {
      const input = await scan(
        lib,
        `  const m = await import("./lib.js")\n  m.fx(${USER}.email)\n  m.tools.send(${USER}.name)`,
        "",
        "async ",
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("destructuring the namespace, including its default, binds the exports", async () => {
      const input = await scan(
        lib,
        `  const { fx, default: dx } = await import("./lib.js")\n  fx(${USER}.email)\n  dx(${USER}.name)`,
        "",
        "async ",
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("`.then` receives the namespace, whole or destructured", async () => {
      const input = await scan(
        lib,
        `  import("./lib.js").then((m) => m.fx(${USER}.email))\n  import("./lib.js").then(({ fx }) => fx(${USER}.name))`,
      )
      expect(effects(input).sort()).toEqual(["email|static", "name|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a specifier written as a template literal without substitutions is a literal", async () => {
      const input = await scan(
        lib,
        "  const m = await import(`./lib.js`)\n  m.fx(" + USER + ".email)",
        "",
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
    })

    it("the namespace can be passed on and used elsewhere", async () => {
      const input = await scan(
        { ...lib, "app/use.ts": `export function use(m: any, v: any) { m.fx(v) }\n` },
        `  use(await import("./lib.js"), ${USER}.email)`,
        `import { use } from "./use.js";\n`,
        "async ",
      )
      expect(effects(input)).toEqual(["email|static"])
      expect(reasons(input)).toEqual([])
    })

    it("a specifier decided at run time by tracked data is an unresolved import that carries that data", async () => {
      const input = await scan({}, `  await import(${USER}.email)`, "", "async ")
      expect(reasons(input)).toEqual(["unresolved-import 3:9"])
      expect(unknownData(input)).toEqual([["email"]])
      expect(input.unknowns[0]?.detail).toBe("module specifier is computed from tracked data")
    })

    it("a computed specifier that tracked data has nothing to do with is not reported", async () => {
      const input = await scan(
        lib,
        `  const m = await import(key)\n  void m\n  res.json(${USER}.email)`,
        "",
        "async ",
      )
      expect(reasons(input)).toEqual([])
      expect(effects(input)).toEqual(["email|static"])
    })

    it("a literal specifier that is not a project module gives a namespace nothing can be called on", async () => {
      const input = await scan(
        {},
        `  const lib: any = await import("some-lib")\n  lib.send(${USER}.email)\n  const gone: any = await import("./gone.js")\n  gone.send(${USER}.name)`,
        "",
        "async ",
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3", "unresolved-call 6:3"])
    })

    it("a member the module does not export is an unresolved call", async () => {
      const input = await scan(
        lib,
        `  const m: any = await import("./lib.js")\n  m.nothing(${USER}.email)`,
        "",
        "async ",
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:3"])
    })
  })
})
