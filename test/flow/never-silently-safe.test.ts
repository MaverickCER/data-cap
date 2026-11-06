/**
 * The headline guarantee of the flow pass (ADR 0070, ADR 0071): it is never silently safe.
 *
 * A catalog of syntactic forms, each a tiny project whose code leaks exactly one field of `userData.user` to a sink
 * through that form. Every row says which of two outcomes the evidence must end in -- (A) the leak is followed to the
 * sink, with the sibling field not reported as leaked, or (B) the trace is reported incomplete through an unknown
 * that concerns the leaked field -- and the test fails on the third outcome, (C) a complete trace that misses the
 * leak. The table pins what is supported today: when reach improves, a row flips from B to A on purpose.
 */
import fc from "fast-check"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { makeHarness } from "../build/mut-flow-scan-harness.js"
import type { Harness } from "../build/mut-flow-scan-harness.js"
import { classifyProject, fn, userField } from "../support/flow-catalog.js"
import { catalog } from "../support/flow-catalog-forms.js"

const forms = catalog()

describe("the catalog", () => {
  it("has at least sixty distinct forms across every group", () => {
    expect(forms.length).toBeGreaterThanOrEqual(60)
    expect(new Set(forms.map((form) => form.id)).size).toBe(forms.length)
    expect(new Set(forms.map((form) => form.group))).toEqual(
      new Set([
        "basics",
        "control flow",
        "functions",
        "builtins and higher-order data",
        "opaque and dynamic code",
        "classes and this",
        "default exports and re-exports",
        "dynamic import",
        "generators and iteration",
        "whole record and capability values",
        "prototypes and mixins",
        "CommonJS",
        "decorators",
        "heap aliasing",
      ]),
    )
  })
})

describe("never silently safe", () => {
  describe.each(forms.map((form) => [`${form.group}: ${form.id}`, form] as const))(
    "%s",
    (_, form) => {
      it(`is class ${form.expect} when it leaks email`, async () => {
        const result = await classifyProject(form.files("email"), {
          leaked: "email",
          other: "passwordHash",
        })
        expect(result.cls, JSON.stringify(result)).toBe(form.expect)
      })

      it(`is class ${form.expect} when the same code leaks passwordHash instead (metamorphic)`, async () => {
        const result = await classifyProject(form.files("passwordHash"), {
          leaked: "passwordHash",
          other: "email",
        })
        expect(result.cls, JSON.stringify(result)).toBe(form.expect)
      })
    },
  )

  it("reports class B only through an unknown, class A with the sibling field clean, and class W with both reaching", async () => {
    for (const form of forms) {
      const result = await classifyProject(form.files("email"), {
        leaked: "email",
        other: "passwordHash",
      })
      if (form.expect === "B") {
        expect(result.complete, form.id).toBe(false)
        expect(result.unknownReasons.length, form.id).toBeGreaterThan(0)
      } else if (form.expect === "W") {
        expect(result.reaches, form.id).toBe(true)
        expect(result.otherReaches, form.id).toBe(true)
        expect(result.complete, form.id).toBe(true)
      } else {
        expect(result.reaches, form.id).toBe(true)
        expect(result.otherReaches, form.id).toBe(false)
        expect(result.otherComplete, form.id).toBe(true)
      }
    }
  })
})

/** A step that carries a value from one variable to the next. */
interface Step {
  readonly id: string
  readonly supported: boolean
  /** Declarations (module level) this step needs. */
  readonly extra: string
  /** The statements moving `from` into `to`. */
  readonly code: (from: string, to: string) => string
}

function steps(): readonly Step[] {
  return [
    { id: "rename", supported: true, extra: "", code: (a, b) => `const ${b} = ${a}` },
    {
      id: "wrapper function",
      supported: true,
      extra: "function wrap(v: any) { return v }\n",
      code: (a, b) => `const ${b} = wrap(${a})`,
    },
    {
      id: "object pack and unpack",
      supported: true,
      extra: "",
      code: (a, b) => `const ${b}o = { k: ${a} }\nconst ${b} = ${b}o.k`,
    },
    {
      id: "destructuring",
      supported: true,
      extra: "",
      code: (a, b) => `const { k: ${b} } = { k: ${a} }`,
    },
    {
      id: "array pack and unpack",
      supported: true,
      extra: "",
      code: (a, b) => `const ${b}a = [${a}]\nconst ${b} = ${b}a[0]`,
    },
    {
      id: "await",
      supported: true,
      extra: "",
      code: (a, b) => `const ${b} = await Promise.resolve(${a})`,
    },
    {
      id: "closure",
      supported: true,
      extra: "",
      code: (a, b) => `const ${b} = (() => ${a})()`,
    },
    {
      id: "ternary",
      supported: true,
      extra: "",
      code: (a, b) => `const ${b} = key ? ${a} : "none"`,
    },
    {
      id: "package call",
      supported: false,
      extra: `import { opaque } from "some-lib";\n`,
      code: (a, b) => `const ${b} = opaque(${a})`,
    },
    {
      id: "computed key read",
      supported: false,
      extra: "",
      code: (a, b) => `const ${b}o: any = { k: ${a} }\nconst ${b} = ${b}o[key]`,
    },
    {
      id: "call through an alias of a method",
      supported: false,
      extra: "",
      code: (a, b) => `const { json: ${b}j } = res\nconst ${b} = ${b}j(${a})`,
    },
  ]
}

function chainProject(field: string, chain: readonly Step[]): Record<string, string> {
  const lines = [`const v0 = ${userField(field)}`]
  chain.forEach((step, index) => lines.push(step.code(`v${index}`, `v${index + 1}`)))
  lines.push(`res.json(v${chain.length})`)
  const extras = [...new Set(chain.map((step) => step.extra))]
  const imports = extras.filter((extra) => extra.startsWith("import")).join("")
  const declarations = extras.filter((extra) => !extra.startsWith("import")).join("")
  return fn(lines.join("\n"), `${imports}${declarations}`, "async ")
}

describe("random chains between a field and a sink", () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await makeHarness()
  })

  afterAll(async () => {
    await harness.cleanup()
  })

  const chains = fc.array(fc.constantFrom(...steps()), { minLength: 0, maxLength: 6 })

  it("reaches the sink iff every step is supported, and is otherwise always an honest unknown", async () => {
    await fc.assert(
      fc.asyncProperty(chains, fc.constantFrom("email", "passwordHash"), async (chain, field) => {
        const other = field === "email" ? "passwordHash" : "email"
        const result = await classifyProject(
          chainProject(field, chain),
          { leaked: field, other },
          harness,
        )
        const supported = chain.every((step) => step.supported)
        // Never a complete trace that misses the leak, and the sibling field is never reported.
        expect(result.cls).not.toBe("C")
        expect(result.cls).toBe(supported ? "A" : "B")
        if (supported) {
          expect(result.reaches).toBe(true)
          expect(result.otherReaches).toBe(false)
        }
      }),
      { numRuns: 60 },
    )
  }, 30_000)
})
