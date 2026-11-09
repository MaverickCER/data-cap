import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { FlowSummary } from "../../src/build/flow-scan.js"
import { USER } from "./mut-flow-scan-harness.js"
import { effects, handler, makeHarness, reasons, unknownData } from "../support/flow-reach.js"
import type { Harness } from "../support/flow-reach.js"

/**
 * Declared summaries (ADR 0074): what a call into a package does, stated by the project, is the only way the scan
 * follows data past `node_modules`. Everything it follows through one is `declared`, never `static`.
 */
describe("flow-reach: declared summaries for package calls", () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const scan = async (
    body: string,
    imports: string,
    summaries: readonly FlowSummary[],
    keyword = "",
  ) => {
    const source = handler(body, imports)["app/p.ts"] ?? ""
    return (
      await h.scan(
        {
          "app/p.ts": source.replace("export function h", `export ${keyword}function h`),
        },
        { summaries },
      )
    ).input
  }
  const importLine = (names: string, from: string): string =>
    `import { ${names} } from "${from}";\n`

  describe("what the effects mean", () => {
    it("without a summary, a call into a package that receives tracked data is an unknown", async () => {
      const input = await scan(
        `  res.json(clone(${USER}.email))`,
        importLine("clone", "some-lib"),
        [],
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:12"])
      expect(unknownData(input)).toEqual([["email"]])
      expect(effects(input)).toEqual(["email|inferred"])
    })

    it("pass-through: the result holds everything the arguments hold, as a declared fact", async () => {
      const input = await scan(
        `  res.json(clone(${USER}.email, ${USER}.name))`,
        importLine("clone", "some-lib"),
        [{ module: "some-lib", export: "clone", effect: "pass-through" }],
      )
      expect(effects(input)).toEqual(["email|declared", "name|declared"])
      expect(reasons(input)).toEqual([])
    })

    it("pass-through approximate: the data is still declared, and still reaches the sink", async () => {
      const input = await scan(`  res.json(pick(${USER}))`, importLine("pick", "some-lib"), [
        { module: "some-lib", export: "pick", effect: "pass-through", approximate: true },
      ])
      expect(effects(input)).toEqual(["|declared"])
      expect(reasons(input)).toEqual([])
    })

    it("returns-arg: only the argument at that index comes out", async () => {
      const input = await scan(
        `  res.json(second(${USER}.email, ${USER}.name, ${USER}.id))`,
        importLine("second", "some-lib"),
        [{ module: "some-lib", export: "second", effect: "returns-arg", arg: 1 }],
      )
      expect(effects(input)).toEqual(["name|declared"])
      expect(reasons(input)).toEqual([])
    })

    it("returns-arg with a position the call does not have returns nothing", async () => {
      const input = await scan(`  res.json(nth(${USER}.email))`, importLine("nth", "some-lib"), [
        { module: "some-lib", export: "nth", effect: "returns-arg", arg: 3 },
      ])
      expect(effects(input)).toEqual([])
      expect(reasons(input)).toEqual([])
    })

    it("returns-arg approximate: the argument comes out as a declared, inexact copy", async () => {
      const input = await scan(
        `  res.json(first(${USER}.email))`,
        importLine("first", "some-lib"),
        [{ module: "some-lib", export: "first", effect: "returns-arg", arg: 0, approximate: true }],
      )
      expect(effects(input)).toEqual(["email|declared"])
    })

    it("sink: the arguments cross the declared boundary, as a declared crossing with its handling", async () => {
      const input = await scan(
        `  track("viewed", ${USER}.email)`,
        importLine("track", "analytics-lib"),
        [
          {
            module: "analytics-lib",
            export: "track",
            effect: "sink",
            boundary: { kind: "api", name: "analytics" },
            handling: "hashed",
          },
        ],
      )
      expect(effects(input)).toEqual(["email|declared"])
      expect(reasons(input)).toEqual([])
      const edge = input.edges.find((candidate) => candidate.kind === "side-effect")
      expect(edge?.handling).toBe("hashed")
      const node = input.nodes.find((candidate) => candidate.kind === "boundary")
      expect(node).toEqual({
        kind: "boundary",
        scope: "boundary:declared",
        name: "analytics",
        status: "declared",
        boundaryKind: "api",
      })
    })

    it("sink: a call that carries no tracked data does not create the boundary", async () => {
      const input = await scan(`  track("viewed")`, importLine("track", "analytics-lib"), [
        {
          module: "analytics-lib",
          export: "track",
          effect: "sink",
          boundary: { kind: "api", name: "analytics" },
        },
      ])
      expect(input.nodes.filter((candidate) => candidate.kind === "boundary")).toEqual([])
    })

    it("sink: a whole capability record handed over takes every field with it", async () => {
      const input = await scan(
        `  track(userData.getSnapshot())`,
        importLine("track", "analytics-lib"),
        [
          {
            module: "analytics-lib",
            export: "track",
            effect: "sink",
            boundary: { kind: "api", name: "analytics" },
          },
        ],
      )
      expect(effects(input).every((effect) => effect.endsWith("|declared"))).toBe(true)
      expect(effects(input).length).toBeGreaterThan(1)
    })

    it.each(["sanitizes", "ignores"] as const)(
      "%s: the result holds nothing and the call is not an unknown",
      async (effect) => {
        const input = await scan(
          `  res.json(hash(${USER}.email))`,
          importLine("hash", "some-lib"),
          [{ module: "some-lib", export: "hash", effect }],
        )
        expect(effects(input)).toEqual([])
        expect(reasons(input)).toEqual([])
      },
    )

    it("a summarized call counts as reading what it is handed, so the field is not reported as discarded", async () => {
      const input = await scan(`  hash(${USER}.email)`, importLine("hash", "some-lib"), [
        { module: "some-lib", export: "hash", effect: "sanitizes" },
      ])
      expect(
        input.edges.filter((edge) => edge.kind === "discards" && edge.path?.join(".") === "email"),
      ).toEqual([])
    })
  })

  describe("how a call is matched to a summary", () => {
    const passThrough = (module: string, name: string): FlowSummary => ({
      module,
      export: name,
      effect: "pass-through",
    })

    it("a different module or a different export name is not matched", async () => {
      for (const summaries of [
        [passThrough("other-lib", "clone")],
        [passThrough("some-lib", "cloneDeep")],
      ]) {
        const input = await scan(
          `  res.json(clone(${USER}.email))`,
          importLine("clone", "some-lib"),
          summaries,
        )
        expect(reasons(input)).toEqual(["unresolved-call 4:12"])
      }
    })

    it("the export is matched by the name it is imported under, not the local name", async () => {
      const input = await scan(
        `  res.json(copy(${USER}.email))`,
        importLine("clone as copy", "some-lib"),
        [passThrough("some-lib", "clone")],
      )
      expect(effects(input)).toEqual(["email|declared"])
    })

    it("the first matching summary wins", async () => {
      const input = await scan(
        `  res.json(clone(${USER}.email))`,
        importLine("clone", "some-lib"),
        [
          { module: "some-lib", export: "clone", effect: "sanitizes" },
          passThrough("some-lib", "clone"),
        ],
      )
      expect(effects(input)).toEqual([])
    })

    it("a default import is `default`", async () => {
      const input = await scan(
        `  res.json(clone(${USER}.email))`,
        `import clone from "lodash/clone";\n`,
        [passThrough("lodash/clone", "default")],
      )
      expect(effects(input)).toEqual(["email|declared"])
    })

    it("a member of a namespace import is the export of that name", async () => {
      const input = await scan(
        `  res.json(_.clone(${USER}.email))`,
        `import * as _ from "lodash";\n`,
        [passThrough("lodash", "clone")],
      )
      expect(effects(input)).toEqual(["email|declared"])
    })

    it("a member of a default import matches `default.name`, and the bare name for packages whose default is their exports", async () => {
      for (const name of ["default.clone", "clone"]) {
        const input = await scan(
          `  res.json(_.clone(${USER}.email))`,
          `import _ from "lodash";\n`,
          [passThrough("lodash", name)],
        )
        expect(effects(input)).toEqual(["email|declared"])
      }
    })

    it("a member of a named import is a dotted path", async () => {
      const input = await scan(`  res.json(z.parse(${USER}.email))`, importLine("z", "zod"), [
        passThrough("zod", "z.parse"),
      ])
      expect(effects(input)).toEqual(["email|declared"])
    })

    it("a package that resolves to a file under node_modules is matched all the same", async () => {
      const input = (
        await h.scan(
          {
            ...handler(
              `  res.json(pkg.clone(${USER}.email))`,
              `import * as pkg from "vendored-lib";\n`,
            ),
            "node_modules/vendored-lib/index.js": `export function clone(v) { return v }\n`,
          },
          { summaries: [passThrough("vendored-lib", "clone")] },
        )
      ).input
      expect(effects(input)).toEqual(["email|declared"])
      expect(reasons(input)).toEqual([])
    })

    it("require of a package: the module, and what is destructured from it", async () => {
      const whole = await scan(
        `  res.json(lib.clone(${USER}.email))`,
        `const lib = require("some-lib")\n`,
        [passThrough("some-lib", "clone")],
      )
      expect(effects(whole)).toEqual(["email|declared"])
      const destructured = await scan(
        `  res.json(clone(${USER}.name))`,
        `const { clone } = require("some-lib")\n`,
        [passThrough("some-lib", "clone")],
      )
      expect(effects(destructured)).toEqual(["name|declared"])
    })

    it("import = require of a package", async () => {
      const input = await scan(
        `  res.json(lib.clone(${USER}.email))`,
        `import lib = require("some-lib")\n`,
        [passThrough("some-lib", "clone")],
      )
      expect(effects(input)).toEqual(["email|declared"])
    })

    it("a function the project defines is never replaced by a summary", async () => {
      const input = await scan(
        `  res.json(clone(${USER}.email))`,
        `function clone(v: any) { return v }\n`,
        [passThrough("some-lib", "clone")],
      )
      expect(effects(input)).toEqual(["email|static"])
    })
  })

  describe("what stays honest", () => {
    it("data that flows on from a summarized call stays declared through later hops", async () => {
      const input = await scan(
        `  const copy = clone(${USER}.email)\n  const wrapped = { v: copy }\n  res.json(relay(wrapped.v))`,
        `${importLine("clone", "some-lib")}function relay(v: any) { return v }\n`,
        [{ module: "some-lib", export: "clone", effect: "pass-through" }],
      )
      expect(effects(input)).toEqual(["email|declared"])
      const hops = input.edges.filter((edge) => edge.kind === "passes" || edge.kind === "returns")
      expect(hops.length).toBeGreaterThan(0)
      expect(hops.every((edge) => edge.status === "declared")).toBe(true)
    })

    it("the field read that feeds a summarized call is still a static fact", async () => {
      const input = await scan(
        `  res.json(clone(${USER}.email))`,
        importLine("clone", "some-lib"),
        [{ module: "some-lib", export: "clone", effect: "pass-through" }],
      )
      const reads = input.edges.filter((edge) => edge.kind === "reads")
      expect(reads.length).toBeGreaterThan(0)
      expect(reads.every((edge) => edge.status === "static")).toBe(true)
    })

    it("a sibling field that was not handed over is never reported", async () => {
      const input = await scan(
        `  res.json(clone(${USER}.email))\n  void ${USER}.name`,
        importLine("clone", "some-lib"),
        [{ module: "some-lib", export: "clone", effect: "pass-through" }],
      )
      expect(effects(input)).toEqual(["email|declared"])
    })

    it("a call through a member the summaries do not cover is still an unknown", async () => {
      const input = await scan(
        `  res.json(lib.other(${USER}.email))`,
        `import * as lib from "some-lib";\n`,
        [{ module: "some-lib", export: "clone", effect: "pass-through" }],
      )
      expect(reasons(input)).toEqual(["unresolved-call 4:12"])
    })

    it("the same summaries make the same scan", async () => {
      const summaries: FlowSummary[] = [
        { module: "some-lib", export: "clone", effect: "pass-through" },
      ]
      const body = `  res.json(clone(${USER}.email))`
      const one = await scan(body, importLine("clone", "some-lib"), summaries)
      const two = await scan(body, importLine("clone", "some-lib"), summaries)
      expect(two).toEqual(one)
    })
  })
})
