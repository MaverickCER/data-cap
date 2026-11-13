import { beforeEach, describe, expect, it, vi } from "vitest"

const holder = vi.hoisted((): { view: unknown } => ({ view: undefined }))

vi.mock("../../src/evidence/flow-graph-view.js", () => ({
  buildFlowGraphView: () => holder.view,
}))

const { renderFlowText } = await import("../../src/evidence/flow-text.js")
const { flowEvidenceDisclaimer } = await import("../../src/evidence/flow-disclaimer.js")

type Loose = Record<string, unknown>

const coverage = (over: Loose = {}): Loose => ({
  functionsAnalyzed: 3,
  functionsUnanalyzed: 0,
  edgesUnresolved: 0,
  unknowns: 0,
  complete: true,
  ...over,
})

const fn = (name: string, over: Loose = {}): Loose => ({
  id: `function:${name}`,
  name,
  scope: "s.ts",
  status: "static",
  inputs: [],
  reads: [],
  forwards: [],
  sideEffects: [],
  discards: [],
  callers: [],
  callees: [],
  classifications: [],
  confidence: "static",
  unknowns: [],
  ...over,
})

const field = (name: string, over: Loose = {}): Loose => ({
  id: `field:${name}`,
  name,
  scope: "s.ts",
  sources: [],
  destinations: [],
  discardedBy: [],
  readers: [],
  claims: [],
  complete: true,
  ...over,
})

const view = (over: Loose = {}): void => {
  holder.view = {
    schemaVersion: 1,
    coverage: coverage(),
    nodes: [],
    edges: [],
    unknowns: [],
    functions: [],
    fields: [],
    statusLegend: [
      { status: "declared", meaning: "D meaning." },
      { status: "static", meaning: "S meaning." },
    ],
    ...over,
  }
}

const evidence = (claims?: Loose): never => ({ flow: {}, claims }) as never

const unknown = (id: string, reason: string, over: Loose = {}): Loose => ({
  id,
  reason,
  source: { file: "a/b.ts", line: 7, column: 9 },
  ...over,
})

beforeEach(() => {
  holder.view = undefined
})

describe("renderFlowText (exact output)", () => {
  it("returns undefined when there is no view", () => {
    expect(renderFlowText(evidence())).toBeUndefined()
  })

  it("renders an empty complete graph", () => {
    view()
    expect(renderFlowText(evidence())).toBe(
      [
        "# Data flow",
        "",
        `> ${flowEvidenceDisclaimer()}`,
        "",
        "Coverage: 3 function(s) analyzed -- complete.",
        "",
        "## Status legend",
        "",
        "- **declared**: D meaning.",
        "- **static**: S meaning.",
        "",
        "## Functions",
        "",
        "None.",
        "",
        "## Fields",
      ].join("\n") + "\n",
    )
  })

  it("lists unanalyzed functions and unknowns in the coverage line only when non-zero", () => {
    view({
      coverage: coverage({ functionsUnanalyzed: 2, unknowns: 0, complete: false }),
    })
    const a = renderFlowText(evidence()) ?? ""
    expect(a).toContain(
      "Coverage: 3 function(s) analyzed, 2 not fully analyzed -- not complete: parts of the program could not be followed, so a flow missing below is not proof that it does not exist.\n",
    )
    expect(a).not.toContain("unknown(s)")
    view({ coverage: coverage({ functionsUnanalyzed: 0, unknowns: 4, complete: false }) })
    const b = renderFlowText(evidence()) ?? ""
    expect(b).toContain("Coverage: 3 function(s) analyzed, 4 unknown(s) -- not complete:")
    expect(b).not.toContain("not fully analyzed")
    view({ coverage: coverage({ functionsUnanalyzed: 1, unknowns: 1, complete: true }) })
    expect(renderFlowText(evidence())).toContain(
      "Coverage: 3 function(s) analyzed, 1 not fully analyzed, 1 unknown(s) -- complete.\n",
    )
  })

  it("renders every function line of a maximal function", () => {
    view({
      functions: [
        fn("zeta", {
          confidence: "inferred",
          classifications: ["pii", "secret"],
          inputs: [
            { id: "p1", name: "zeta.user" },
            { id: "p2", name: "plain" },
            { id: "p3", name: "a.b.deep" },
          ],
          reads: [
            { origin: "o", field: "f2", path: ["x"], via: "field", from: "a", status: "static" },
            { origin: "o", field: "f", path: ["z"], via: "return", from: "a", status: "static" },
            { origin: "o", field: "f", path: [], via: "parameter", from: "a", status: "static" },
            { origin: "o", field: "f", path: ["a"], via: "parameter", from: "a", status: "static" },
            {
              origin: "o",
              field: "f",
              path: ["m", "n"],
              via: "parameter",
              from: "a",
              status: "static",
            },
            { origin: "o", field: "f", path: ["a"], via: "parameter", from: "a", status: "static" },
            { origin: "o", field: "f", path: ["b"], via: "field", from: "a", status: "static" },
            { origin: "o", field: "f", path: [], via: "field", from: "a", status: "static" },
          ],
          forwards: [
            {
              kind: "returns",
              to: "r2",
              toName: "r2",
              origin: "o",
              field: "b",
              path: ["q"],
              status: "static",
            },
            {
              kind: "returns",
              to: "r1",
              toName: "r1",
              origin: "o",
              field: "a",
              path: ["w"],
              status: "static",
            },
            {
              kind: "returns",
              to: "r1",
              toName: "r1",
              origin: "o",
              field: "a",
              path: [],
              status: "static",
            },
            {
              kind: "passes",
              to: "t2",
              toName: "T2",
              origin: "o",
              field: "f",
              path: ["k"],
              status: "static",
            },
            {
              kind: "transforms",
              to: "t1",
              toName: "T1",
              origin: "o",
              field: "g",
              path: ["j"],
              status: "static",
            },
            {
              kind: "passes",
              to: "t1",
              toName: "T1",
              origin: "o",
              field: "f",
              path: ["i"],
              status: "static",
            },
            {
              kind: "transforms",
              to: "t1",
              toName: "T1",
              origin: "o",
              field: "f",
              path: ["h"],
              status: "static",
            },
            {
              kind: "passes",
              to: "ab",
              toName: "AB",
              origin: "o",
              field: "c",
              path: [],
              status: "static",
            },
            {
              kind: "passes",
              to: "a",
              toName: "A",
              origin: "o",
              field: "bc",
              path: [],
              status: "static",
            },
          ],
          sideEffects: [
            {
              boundary: "b2",
              boundaryName: "B2",
              boundaryKind: "log",
              origin: "o",
              field: "f",
              path: ["p"],
              status: "static",
            },
            {
              boundary: "b1",
              boundaryName: "B1",
              boundaryKind: "database",
              origin: "o",
              field: "f",
              path: ["r"],
              handling: "masked",
              status: "static",
            },
            {
              boundary: "b1",
              boundaryName: "B1",
              boundaryKind: "database",
              origin: "o",
              field: "f",
              path: ["s"],
              handling: "encrypted",
              status: "static",
            },
            {
              boundary: "b1",
              boundaryName: "B1",
              boundaryKind: "database",
              origin: "o",
              field: "f",
              path: ["t"],
              handling: "masked",
              status: "static",
            },
            {
              boundary: "b1",
              boundaryName: "B1",
              boundaryKind: "database",
              origin: "o",
              field: "f",
              path: ["u"],
              status: "static",
            },
            {
              boundary: "b3",
              boundaryName: "B3",
              origin: "o",
              field: "f",
              path: [],
              status: "static",
            },
            {
              boundary: "xy",
              boundaryName: "XY",
              boundaryKind: "api",
              origin: "o",
              field: "z",
              path: [],
              status: "static",
            },
            {
              boundary: "x",
              boundaryName: "X",
              boundaryKind: "api",
              origin: "o",
              field: "yz",
              path: [],
              status: "static",
            },
          ],
          discards: [
            { origin: "o", field: "g", path: ["d"] },
            { origin: "o", field: "f", path: ["c"] },
            { origin: "o", field: "f", path: [] },
            { origin: "o", field: "f", path: ["c"] },
          ],
          callers: [
            { id: "1", name: "yy" },
            { id: "2", name: "aa" },
            { id: "3", name: "yy" },
          ],
          callees: [
            { id: "4", name: "mm" },
            { id: "5", name: "bb" },
          ],
          unknowns: ["u2", "missing", "u1"],
        }),
      ],
      unknowns: [
        unknown("u1", "unresolved-call"),
        unknown("u2", "dynamic-access", { detail: "x" }),
      ],
    })
    expect(renderFlowText(evidence())).toMatchInlineSnapshot(`
      "# Data flow

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.

      Coverage: 3 function(s) analyzed -- complete.

      ## Status legend

      - **declared**: D meaning.
      - **static**: S meaning.

      ## Functions

      ### zeta

      - Confidence: inferred
      - Classifications: pii, secret
      - Inputs: user, plain, deep
      - Reads: f: (whole), b; f (via parameter): (whole), a, m.n; f (via return): z; f2: x
      - Returns: a: (whole), w; b: q
      - Passes on: A -- bc: (whole); AB -- c: (whole); T1 -- f: h, i; T1 -- g: j; T2 -- f: k
      - Side effects: database B1: f: r, s, t, u (masked, encrypted); log B2: f: p; boundary B3: f: (whole); api X: yz: (whole); api XY: z: (whole)
      - Discards: f: (whole), c; g: d
      - Callers: aa, yy
      - Callees: bb, mm
      - Not followed: a/b.ts:7:9 -- a computed property key on tracked data
      - Not followed: a/b.ts:7:9 -- an unresolved call that receives tracked data

      ## Fields

      ## What the analysis could not follow

      - a/b.ts:7:9 -- an unresolved call that receives tracked data
      - a/b.ts:7:9 -- a computed property key on tracked data (x)
      "
    `)
  })

  it("keeps the input order of items sharing a key, however many there are", () => {
    for (const count of [4, 40, 150]) {
      const handlings = Array.from({ length: count }, (_, i) => `h${(i * 7) % count}`)
      view({
        functions: [
          fn("tie", {
            sideEffects: handlings.map((handling, i) => ({
              boundary: "b",
              boundaryName: "B",
              boundaryKind: "log",
              origin: "o",
              field: "f",
              path: [`p${i}`],
              handling,
              status: "static",
            })),
          }),
        ],
      })
      const line =
        (renderFlowText(evidence()) ?? "")
          .split("\n")
          .find((l) => l.startsWith("- Side effects")) ?? ""
      const paths = Array.from({ length: count }, (_, i) => `p${i}`)
        .sort()
        .join(", ")
      expect(line).toBe(
        `- Side effects: log B: f: ${paths} (${[...new Set(handlings)].join(", ")})`,
      )
    }
  })

  it("puts the whole value first even before punctuation that sorts earlier", () => {
    view({
      functions: [
        fn("w", {
          discards: [
            { origin: "o", field: "f", path: ["$id"] },
            { origin: "o", field: "f", path: ["!x"] },
            { origin: "o", field: "f", path: ["a"] },
            { origin: "o", field: "f", path: [] },
            { origin: "o", field: "f", path: ["Z"] },
          ],
        }),
        fn("v", {
          discards: [
            { origin: "o", field: "f", path: [] },
            { origin: "o", field: "f", path: ["$id"] },
          ],
        }),
      ],
    })
    const text = renderFlowText(evidence()) ?? ""
    expect(text).toContain("- Discards: f: (whole), !x, $id, Z, a\n")
    expect(text).toContain("- Discards: f: (whole), $id\n")
  })

  it("renders empty lines of a bare function as none", () => {
    view({ functions: [fn("bare")] })
    expect(renderFlowText(evidence())).toMatchInlineSnapshot(`
      "# Data flow

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.

      Coverage: 3 function(s) analyzed -- complete.

      ## Status legend

      - **declared**: D meaning.
      - **static**: S meaning.

      ## Functions

      ### bare

      - Confidence: static
      - Inputs: none
      - Reads: none
      - Returns: none
      - Passes on: none
      - Side effects: none
      - Discards: none
      - Callers: none
      - Callees: none

      ## Fields
      "
    `)
  })

  it("renders a maximal field and a bare field", () => {
    view({
      fields: [
        field("zz.bare"),
        field("a.full", {
          classification: "secret",
          complete: false,
          sources: [
            { boundary: "b", boundaryName: "pg", boundaryKind: "database", status: "declared" },
            { boundary: "c", boundaryName: "ext", status: "inferred" },
          ],
          destinations: [
            {
              boundary: "d",
              boundaryName: "out",
              boundaryKind: "client-response",
              paths: [["z"], [], ["a"], ["a"]],
              status: "static",
              handling: [],
            },
            { boundary: "e", boundaryName: "nb", paths: [[]], status: "unknown", handling: [] },
          ],
          discardedBy: [
            { function: "f1", functionName: "fb", path: ["p2"] },
            { function: "f2", functionName: "fa", path: ["p1"] },
            { function: "f1", functionName: "fb", path: [] },
          ],
          readers: [
            { function: "x", functionName: "rb" },
            { function: "y", functionName: "ra" },
            { function: "z", functionName: "rb" },
          ],
        }),
      ],
    })
    expect(renderFlowText(evidence())).toMatchInlineSnapshot(`
      "# Data flow

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.

      Coverage: 3 function(s) analyzed -- complete.

      ## Status legend

      - **declared**: D meaning.
      - **static**: S meaning.

      ## Functions

      None.

      ## Fields

      ### zz.bare

      - Fetched from: none declared
      - Reaches: nowhere in the analyzed code
      - Dropped by: none
      - Read by: none
      - Complete: yes

      ### a.full

      - Classification: secret
      - Fetched from: pg (database, declared); ext (boundary, inferred)
      - Reaches: client-response out: (whole), a, z (static); boundary nb: (whole) (unknown)
      - Dropped by: fa: p1; fb: (whole), p2
      - Read by: ra, rb
      - Complete: no -- the analysis could not follow part of this field's flow, so the destinations above may be incomplete.
      "
    `)
  })

  it("renders claims, an empty claims list, and the unknowns section", () => {
    view({
      unknowns: [
        unknown("u1", "unresolved-call"),
        unknown("u2", "missing-source", { detail: "why" }),
      ],
    })
    expect(
      renderFlowText(
        evidence({
          claims: [
            { verification: "verified", statement: "S one", status: "static" },
            { verification: "unverified", statement: "S two", status: "declared" },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      "# Data flow

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.

      Coverage: 3 function(s) analyzed -- complete.

      ## Status legend

      - **declared**: D meaning.
      - **static**: S meaning.

      ## Functions

      None.

      ## Fields

      ## Claims

      - [verified] S one (static)
      - [unverified] S two (declared)

      ## What the analysis could not follow

      - a/b.ts:7:9 -- an unresolved call that receives tracked data
      - a/b.ts:7:9 -- source that is not available (why)
      "
    `)
    expect(renderFlowText(evidence({ claims: [] }))).toMatchInlineSnapshot(`
      "# Data flow

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.

      Coverage: 3 function(s) analyzed -- complete.

      ## Status legend

      - **declared**: D meaning.
      - **static**: S meaning.

      ## Functions

      None.

      ## Fields

      ## Claims

      None.

      ## What the analysis could not follow

      - a/b.ts:7:9 -- an unresolved call that receives tracked data
      - a/b.ts:7:9 -- source that is not available (why)
      "
    `)
  })

  it("scales heading levels and clamps them to 1..4", () => {
    view({
      functions: [fn("f")],
      fields: [field("a.b")],
      unknowns: [unknown("u", "unresolved-import")],
    })
    const headings = (level?: number): string[] =>
      (
        renderFlowText(
          evidence({ claims: [] }),
          level === undefined ? {} : { headingLevel: level },
        ) ?? ""
      )
        .split("\n")
        .filter((line) => line.startsWith("#"))
    expect(headings()).toEqual([
      "# Data flow",
      "## Status legend",
      "## Functions",
      "### f",
      "## Fields",
      "### a.b",
      "## Claims",
      "## What the analysis could not follow",
    ])
    expect(headings(0)).toEqual(headings())
    expect(headings(-3)).toEqual(headings())
    expect(headings(2)[0]).toBe("## Data flow")
    expect(headings(3)[3]).toBe("##### f")
    expect(headings(4)).toEqual([
      "#### Data flow",
      "##### Status legend",
      "##### Functions",
      "###### f",
      "##### Fields",
      "###### a.b",
      "##### Claims",
      "##### What the analysis could not follow",
    ])
    expect(headings(9)).toEqual(headings(4))
  })

  it("limits to one field: matching functions only, no claims, and a missing field is stated", () => {
    const base = { origin: "o", path: [] as string[], status: "static" }
    view({
      functions: [
        fn("viaRead", { reads: [{ ...base, field: "w", via: "field", from: "a" }] }),
        fn("viaForward", {
          forwards: [{ ...base, kind: "passes", to: "t", toName: "T", field: "w" }],
        }),
        fn("viaEffect", {
          sideEffects: [{ ...base, boundary: "b", boundaryName: "B", field: "w" }],
        }),
        fn("viaDiscard", { discards: [{ origin: "o", path: [], field: "w" }] }),
        fn("other", { reads: [{ ...base, field: "x", via: "field", from: "a" }] }),
        fn("nothing"),
      ],
      fields: [field("w"), field("x")],
      unknowns: [unknown("u", "unresolved-call")],
    })
    const text = renderFlowText(
      evidence({ claims: [{ verification: "v", statement: "s", status: "t" }] }),
      {
        field: "w",
      },
    )
    expect(text).toMatchInlineSnapshot(`
      "# Data flow

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.

      Coverage: 3 function(s) analyzed -- complete.

      ## Status legend

      - **declared**: D meaning.
      - **static**: S meaning.

      ## Functions

      ### viaRead

      - Confidence: static
      - Inputs: none
      - Reads: w: (whole)
      - Returns: none
      - Passes on: none
      - Side effects: none
      - Discards: none
      - Callers: none
      - Callees: none

      ### viaForward

      - Confidence: static
      - Inputs: none
      - Reads: none
      - Returns: none
      - Passes on: T -- w: (whole)
      - Side effects: none
      - Discards: none
      - Callers: none
      - Callees: none

      ### viaEffect

      - Confidence: static
      - Inputs: none
      - Reads: none
      - Returns: none
      - Passes on: none
      - Side effects: boundary B: w: (whole)
      - Discards: none
      - Callers: none
      - Callees: none

      ### viaDiscard

      - Confidence: static
      - Inputs: none
      - Reads: none
      - Returns: none
      - Passes on: none
      - Side effects: none
      - Discards: w: (whole)
      - Callers: none
      - Callees: none

      ## Fields

      ### w

      - Fetched from: none declared
      - Reaches: nowhere in the analyzed code
      - Dropped by: none
      - Read by: none
      - Complete: yes

      ## What the analysis could not follow

      - a/b.ts:7:9 -- an unresolved call that receives tracked data
      "
    `)
    view({ functions: [], fields: [field("w")] })
    expect(renderFlowText(evidence(), { field: "nope" })).toBe(
      `# Data flow\n\n> ${flowEvidenceDisclaimer()}\n\nCoverage: 3 function(s) analyzed -- complete.\n\nNo field named nope in this evidence.\n`,
    )
    expect(renderFlowText(evidence(), { field: "w" })).toContain("None.\n")
  })
})
