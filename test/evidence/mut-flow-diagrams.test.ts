import { describe, expect, it } from "vitest"
import { flowEvidenceDisclaimer } from "../../src/evidence/flow-disclaimer.js"
import { renderFlowDot } from "../../src/evidence/flow-dot.js"
import { renderFlowMermaid } from "../../src/evidence/flow-mermaid.js"

type Loose = Record<string, unknown>

const node = (id: string, kind: string, name: string, status: string, over: Loose = {}): Loose => ({
  id,
  kind,
  scope: "s.ts",
  name,
  status,
  ...over,
})

const edge = (
  id: string,
  kind: string,
  from: string,
  to: string,
  status: string,
  over: Loose = {},
): Loose => ({ id, kind, from, to, status, ...over })

const unknown = (id: string, reason: string, over: Loose = {}): Loose => ({
  id,
  reason,
  source: { file: "a/b.ts", line: 7, column: 9 },
  ...over,
})

const input = (flow: Loose, policy?: Loose): never =>
  ({
    flow: { schemaVersion: 1, ...flow },
    policy,
  }) as never

const coverage = (complete: boolean): Loose => ({
  functionsAnalyzed: 1,
  functionsUnanalyzed: 0,
  edgesUnresolved: 0,
  unknowns: 0,
  complete,
})

function maximal(complete = false): never {
  return input(
    {
      nodes: [
        node("n01", "field", 'd."f"\\x', "static", { classification: "secret" }),
        node("n02", "function", "fnA\nline", "static"),
        node("n03", "function", "fnB", "unknown"),
        node("n04", "parameter", "fnA.user", "declared"),
        node("n05", "return", "fnA.return", "inferred"),
        node("n06", "parameter", "fnA.hidden", "static"),
        node("n07", "return", "fnA.hiddenReturn", "static"),
        node("n08", "boundary", "pg", "declared", { boundaryKind: "database" }),
        node("n09", "boundary", "redis", "static", { boundaryKind: "cache" }),
        node("n10", "boundary", "s3", "observed", { boundaryKind: "storage" }),
        node("n11", "boundary", "mq", "inferred", { boundaryKind: "queue" }),
        node("n12", "boundary", "http", "unknown", { boundaryKind: "client-response" }),
        node("n13", "boundary", "stdout", "static", { boundaryKind: "log" }),
        node("n14", "boundary", "rest", "static", { boundaryKind: "api" }),
        node("n15", "boundary", "bare", "static"),
      ],
      edges: [
        edge("e01", "reads", "n01", "n02", "static", { path: ["a", "b"], handling: "masked" }),
        edge("e02", "calls", "n02", "n03", "static"),
        edge("e03", "crosses-boundary", "n08", "n01", "declared"),
        edge("e04", "passes", "n02", "n04", "observed", { path: [] }),
        edge("e05", "transforms", "n02", "n05", "inferred"),
        edge("e06", "side-effect", "n02", "n09", "unknown"),
        edge("e07", "returns", "n02", "n10", "static", { path: [], handling: "plain" }),
        edge("e08", "writes", "n02", "n11", "static"),
        edge("e09", "discards", "n02", "n12", "declared", { path: ["q"] }),
        edge("e10", "side-effect", "n02", "n13", "static"),
        edge("e11", "side-effect", "n02", "n14", "static"),
        edge("e12", "side-effect", "n03", "n15", "static"),
        edge("e13", "calls", "n03", "n02", "declared"),
        edge("e14", "calls", "n03", "n10", "static"),
        edge("e15", "reads", "n01", "n03", "static"),
      ],
      unknowns: [
        unknown("u1", "unresolved-call", { subject: "n02" }),
        unknown("u2", "dynamic-access", { subject: "n06" }),
        unknown("u3", "missing-source"),
        unknown("u4", "unanalyzed-function", { subject: "n03", detail: "why" }),
        unknown("u5", "unsupported-construct", { subject: "nowhere" }),
      ],
      coverage: coverage(complete),
    },
    {
      results: [
        { outcome: "violated", edges: ["e07", "e14"] },
        { outcome: "satisfied", edges: ["e08", "e09"] },
        { outcome: "violated", edges: ["e15"] },
      ],
    },
  )
}

describe("renderFlowDot (exact output)", () => {
  it("renders a maximal graph", () => {
    expect(renderFlowDot(maximal())).toMatchInlineSnapshot(`
      "// Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.
      digraph "data-flow" {
        rankdir=LR;
        labelloc=t;
        label="Data flow -- NOT complete: parts could not be followed, so a missing flow is not proof of absence";
        node [fontname=Helvetica];
        edge [fontname=Helvetica];
        "n0" [id="n01", label="d.\\"f\\"\\\\x\\n(secret)", shape=parallelogram];
        "n1" [id="n02", label="fnA\\nline", shape=box, style=rounded];
        "n2" [id="n03", label="fnB", shape=box, style=rounded, color=red, style=dashed];
        "n3" [id="n04", label="user", shape=ellipse, color=blue];
        "n4" [id="n05", label="return", shape=ellipse, color=orange, style=dashed];
        "n5" [id="n08", label="database: pg", shape=cylinder, color=blue];
        "n6" [id="n09", label="cache: redis", shape=cylinder];
        "n7" [id="n10", label="storage: s3", shape=cylinder];
        "n8" [id="n11", label="queue: mq", shape=cylinder, color=orange, style=dashed];
        "n9" [id="n12", label="client-response: http", shape=invhouse, color=red, style=dashed];
        "n10" [id="n13", label="log: stdout", shape=note];
        "n11" [id="n14", label="api: rest", shape=doubleoctagon];
        "n12" [id="n15", label="boundary: bare", shape=doubleoctagon];
        "n13" [id="u1", label="unknown: unresolved-call\\na/b.ts:7:9\\nan unresolved call that receives tracked data", shape=octagon, color=red, style=dashed];
        "n14" [id="u2", label="unknown: dynamic-access\\na/b.ts:7:9\\na computed property key on tracked data", shape=octagon, color=red, style=dashed];
        "n15" [id="u3", label="unknown: missing-source\\na/b.ts:7:9\\nsource that is not available", shape=octagon, color=red, style=dashed];
        "n16" [id="u4", label="unknown: unanalyzed-function\\na/b.ts:7:9\\na function the analysis did not complete", shape=octagon, color=red, style=dashed];
        "n17" [id="u5", label="unknown: unsupported-construct\\na/b.ts:7:9\\nan unsupported construct", shape=octagon, color=red, style=dashed];
        "n0" -> "n1" [id="e01", label="reads a.b (masked)"];
        "n5" -> "n0" [id="e03", label="crosses-boundary [declared]", style=dashed, color=blue];
        "n1" -> "n3" [id="e04", label="passes (whole) [observed]", color=green4];
        "n1" -> "n4" [id="e05", label="transforms [inferred]", style=dotted, color=orange];
        "n1" -> "n6" [id="e06", label="side-effect [unknown]", style=dashed, color=red];
        "n1" -> "n7" [id="e07", label="returns (whole) (plain)", color=red, penwidth=2];
        "n1" -> "n8" [id="e08", label="writes"];
        "n1" -> "n9" [id="e09", label="discards q [declared]", style=dashed, color=blue];
        "n1" -> "n10" [id="e10", label="side-effect"];
        "n1" -> "n11" [id="e11", label="side-effect"];
        "n2" -> "n12" [id="e12", label="side-effect"];
        "n0" -> "n2" [id="e15", label="reads", color=red, penwidth=2];
        "n1" -> "n13" [label="could not follow", style=dashed, color=red];
        "n2" -> "n16" [label="could not follow", style=dashed, color=red];
      }
      "
    `)
  })
  it("renders a maximal graph with calls edges", () => {
    expect(renderFlowDot(maximal(), { includeCalls: true })).toMatchInlineSnapshot(`
      "// Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.
      digraph "data-flow" {
        rankdir=LR;
        labelloc=t;
        label="Data flow -- NOT complete: parts could not be followed, so a missing flow is not proof of absence";
        node [fontname=Helvetica];
        edge [fontname=Helvetica];
        "n0" [id="n01", label="d.\\"f\\"\\\\x\\n(secret)", shape=parallelogram];
        "n1" [id="n02", label="fnA\\nline", shape=box, style=rounded];
        "n2" [id="n03", label="fnB", shape=box, style=rounded, color=red, style=dashed];
        "n3" [id="n04", label="user", shape=ellipse, color=blue];
        "n4" [id="n05", label="return", shape=ellipse, color=orange, style=dashed];
        "n5" [id="n08", label="database: pg", shape=cylinder, color=blue];
        "n6" [id="n09", label="cache: redis", shape=cylinder];
        "n7" [id="n10", label="storage: s3", shape=cylinder];
        "n8" [id="n11", label="queue: mq", shape=cylinder, color=orange, style=dashed];
        "n9" [id="n12", label="client-response: http", shape=invhouse, color=red, style=dashed];
        "n10" [id="n13", label="log: stdout", shape=note];
        "n11" [id="n14", label="api: rest", shape=doubleoctagon];
        "n12" [id="n15", label="boundary: bare", shape=doubleoctagon];
        "n13" [id="u1", label="unknown: unresolved-call\\na/b.ts:7:9\\nan unresolved call that receives tracked data", shape=octagon, color=red, style=dashed];
        "n14" [id="u2", label="unknown: dynamic-access\\na/b.ts:7:9\\na computed property key on tracked data", shape=octagon, color=red, style=dashed];
        "n15" [id="u3", label="unknown: missing-source\\na/b.ts:7:9\\nsource that is not available", shape=octagon, color=red, style=dashed];
        "n16" [id="u4", label="unknown: unanalyzed-function\\na/b.ts:7:9\\na function the analysis did not complete", shape=octagon, color=red, style=dashed];
        "n17" [id="u5", label="unknown: unsupported-construct\\na/b.ts:7:9\\nan unsupported construct", shape=octagon, color=red, style=dashed];
        "n0" -> "n1" [id="e01", label="reads a.b (masked)"];
        "n1" -> "n2" [id="e02", label="calls", style=dashed, color=gray50];
        "n5" -> "n0" [id="e03", label="crosses-boundary [declared]", style=dashed, color=blue];
        "n1" -> "n3" [id="e04", label="passes (whole) [observed]", color=green4];
        "n1" -> "n4" [id="e05", label="transforms [inferred]", style=dotted, color=orange];
        "n1" -> "n6" [id="e06", label="side-effect [unknown]", style=dashed, color=red];
        "n1" -> "n7" [id="e07", label="returns (whole) (plain)", color=red, penwidth=2];
        "n1" -> "n8" [id="e08", label="writes"];
        "n1" -> "n9" [id="e09", label="discards q [declared]", style=dashed, color=blue];
        "n1" -> "n10" [id="e10", label="side-effect"];
        "n1" -> "n11" [id="e11", label="side-effect"];
        "n2" -> "n12" [id="e12", label="side-effect"];
        "n2" -> "n1" [id="e13", label="calls [declared]", style=dashed, color=gray50];
        "n2" -> "n7" [id="e14", label="calls", style=dashed, color=gray50, color=red, penwidth=2];
        "n0" -> "n2" [id="e15", label="reads", color=red, penwidth=2];
        "n1" -> "n13" [label="could not follow", style=dashed, color=red];
        "n2" -> "n16" [label="could not follow", style=dashed, color=red];
      }
      "
    `)
  })
  it("renders a complete graph and a calls-free explicit option", () => {
    const text = renderFlowDot(maximal(true), { includeCalls: false }) ?? ""
    expect(text).toContain('  label="Data flow -- complete";\n')
    expect(text).not.toContain("NOT complete")
    expect(text).not.toContain("gray50")
  })
  it("states a missing field with escaping", () => {
    expect(renderFlowDot(maximal(), { field: 'a"b\\c\nd' })).toBe(
      `// ${flowEvidenceDisclaimer()}\ndigraph "data-flow" {\n  label="No field named a\\"b\\\\c\\nd in this evidence";\n}\n`,
    )
  })
  it("returns undefined without a flow", () => {
    expect(renderFlowDot({ flow: undefined } as never)).toBeUndefined()
  })
  it("renders one field's flow", () => {
    const flow = {
      nodes: [
        node("fld", "field", "d.f", "static"),
        node("src", "boundary", "pg", "declared", { boundaryKind: "database" }),
        node("fn", "function", "go", "static"),
        node("out", "boundary", "http", "static", { boundaryKind: "client-response" }),
        node("far", "function", "far", "static"),
      ],
      edges: [
        edge("c1", "crosses-boundary", "src", "fld", "declared", { origin: "fld" }),
        edge("c2", "reads", "fld", "fn", "static", { origin: "fld", path: ["a"] }),
        edge("c3", "side-effect", "fn", "out", "static", { origin: "fld", path: ["a"] }),
        edge("c4", "calls", "src", "fn", "static"),
        edge("c6", "calls", "far", "fn", "static"),
      ],
      unknowns: [unknown("u", "unresolved-call", { subject: "fn" })],
      coverage: coverage(true),
    }
    expect(renderFlowDot(input(flow), { field: "d.f" })).toMatchInlineSnapshot(`
      "// Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.
      digraph "data-flow" {
        rankdir=LR;
        labelloc=t;
        label="Data flow -- NOT complete: parts could not be followed, so a missing flow is not proof of absence";
        node [fontname=Helvetica];
        edge [fontname=Helvetica];
        "n0" [id="fld", label="d.f", shape=parallelogram];
        "n1" [id="fn", label="go", shape=box, style=rounded];
        "n2" [id="out", label="client-response: http", shape=invhouse];
        "n3" [id="src", label="database: pg", shape=cylinder, color=blue];
        "n4" [id="u", label="unknown: unresolved-call\\na/b.ts:7:9\\nan unresolved call that receives tracked data", shape=octagon, color=red, style=dashed];
        "n3" -> "n0" [id="c1", label="crosses-boundary [declared]", style=dashed, color=blue];
        "n0" -> "n1" [id="c2", label="reads a"];
        "n1" -> "n2" [id="c3", label="side-effect a"];
        "n1" -> "n4" [label="could not follow", style=dashed, color=red];
      }
      "
    `)
    expect(renderFlowDot(input(flow), { field: "d.f", includeCalls: true })).toMatchInlineSnapshot(`
      "// Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.
      digraph "data-flow" {
        rankdir=LR;
        labelloc=t;
        label="Data flow -- NOT complete: parts could not be followed, so a missing flow is not proof of absence";
        node [fontname=Helvetica];
        edge [fontname=Helvetica];
        "n0" [id="fld", label="d.f", shape=parallelogram];
        "n1" [id="fn", label="go", shape=box, style=rounded];
        "n2" [id="out", label="client-response: http", shape=invhouse];
        "n3" [id="src", label="database: pg", shape=cylinder, color=blue];
        "n4" [id="u", label="unknown: unresolved-call\\na/b.ts:7:9\\nan unresolved call that receives tracked data", shape=octagon, color=red, style=dashed];
        "n3" -> "n0" [id="c1", label="crosses-boundary [declared]", style=dashed, color=blue];
        "n0" -> "n1" [id="c2", label="reads a"];
        "n1" -> "n2" [id="c3", label="side-effect a"];
        "n3" -> "n1" [id="c4", label="calls", style=dashed, color=gray50];
        "n1" -> "n4" [label="could not follow", style=dashed, color=red];
      }
      "
    `)
    expect(renderFlowDot(input({ ...flow, unknowns: [] }), { field: "d.f", path: ["b"] }))
      .toMatchInlineSnapshot(`
        "// Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.
        digraph "data-flow" {
          rankdir=LR;
          labelloc=t;
          label="Data flow -- complete";
          node [fontname=Helvetica];
          edge [fontname=Helvetica];
          "n0" [id="fld", label="d.f", shape=parallelogram];
          "n1" [id="src", label="database: pg", shape=cylinder, color=blue];
          "n1" -> "n0" [id="c1", label="crosses-boundary [declared]", style=dashed, color=blue];
        }
        "
      `)
  })
})

describe("renderFlowMermaid (exact output)", () => {
  it("renders a maximal graph", () => {
    expect(renderFlowMermaid(maximal())).toMatchInlineSnapshot(`
      "%% Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.
      flowchart LR
        %% Data flow -- NOT complete: parts could not be followed
        cov["Coverage: NOT complete -- a missing flow is not proof of absence"]
        n0[/"d.#quot;f#quot;\\x<br/>(secret)"/]
        n1(["fnA<br/>line"])
        n2(["fnB"])
        n3("user")
        n4("return")
        n5[("database: pg")]
        n6[("cache: redis")]
        n7[("storage: s3")]
        n8[("queue: mq")]
        n9[("client-response: http")]
        n10[("log: stdout")]
        n11[("api: rest")]
        n12[("boundary: bare")]
        n13{{"unknown: unresolved-call<br/>a/b.ts:7:9<br/>an unresolved call that receives tracked data"}}
        n14{{"unknown: dynamic-access<br/>a/b.ts:7:9<br/>a computed property key on tracked data"}}
        n15{{"unknown: missing-source<br/>a/b.ts:7:9<br/>source that is not available"}}
        n16{{"unknown: unanalyzed-function<br/>a/b.ts:7:9<br/>a function the analysis did not complete"}}
        n17{{"unknown: unsupported-construct<br/>a/b.ts:7:9<br/>an unsupported construct"}}
        n0 -- "reads a.b (masked)" --> n1
        n5 -. "crosses-boundary [declared]" .-> n0
        n1 -. "passes (whole) [observed]" .-> n3
        n1 -. "transforms [inferred]" .-> n4
        n1 -. "side-effect [unknown]" .-> n6
        n1 == "returns (whole) (plain)" ==> n7
        n1 -- "writes" --> n8
        n1 -. "discards q [declared]" .-> n9
        n1 -- "side-effect" --> n10
        n1 -- "side-effect" --> n11
        n2 -- "side-effect" --> n12
        n0 == "reads" ==> n2
        n1 -. "could not follow" .-> n13
        n2 -. "could not follow" .-> n16
        linkStyle 1 stroke:#0072b2
        linkStyle 2 stroke:#888
        linkStyle 3 stroke:#e69f00
        linkStyle 4 stroke:#d00,stroke-dasharray:4
        linkStyle 5 stroke:#d00,stroke-width:3px
        linkStyle 7 stroke:#0072b2
        linkStyle 11 stroke:#d00,stroke-width:3px
        linkStyle 12 stroke:#d00,stroke-dasharray:4
        linkStyle 13 stroke:#d00,stroke-dasharray:4
      "
    `)
  })
  it("renders a maximal graph with calls edges", () => {
    expect(renderFlowMermaid(maximal(), { includeCalls: true })).toMatchInlineSnapshot(`
      "%% Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.
      flowchart LR
        %% Data flow -- NOT complete: parts could not be followed
        cov["Coverage: NOT complete -- a missing flow is not proof of absence"]
        n0[/"d.#quot;f#quot;\\x<br/>(secret)"/]
        n1(["fnA<br/>line"])
        n2(["fnB"])
        n3("user")
        n4("return")
        n5[("database: pg")]
        n6[("cache: redis")]
        n7[("storage: s3")]
        n8[("queue: mq")]
        n9[("client-response: http")]
        n10[("log: stdout")]
        n11[("api: rest")]
        n12[("boundary: bare")]
        n13{{"unknown: unresolved-call<br/>a/b.ts:7:9<br/>an unresolved call that receives tracked data"}}
        n14{{"unknown: dynamic-access<br/>a/b.ts:7:9<br/>a computed property key on tracked data"}}
        n15{{"unknown: missing-source<br/>a/b.ts:7:9<br/>source that is not available"}}
        n16{{"unknown: unanalyzed-function<br/>a/b.ts:7:9<br/>a function the analysis did not complete"}}
        n17{{"unknown: unsupported-construct<br/>a/b.ts:7:9<br/>an unsupported construct"}}
        n0 -- "reads a.b (masked)" --> n1
        n1 -. "calls" .-> n2
        n5 -. "crosses-boundary [declared]" .-> n0
        n1 -. "passes (whole) [observed]" .-> n3
        n1 -. "transforms [inferred]" .-> n4
        n1 -. "side-effect [unknown]" .-> n6
        n1 == "returns (whole) (plain)" ==> n7
        n1 -- "writes" --> n8
        n1 -. "discards q [declared]" .-> n9
        n1 -- "side-effect" --> n10
        n1 -- "side-effect" --> n11
        n2 -- "side-effect" --> n12
        n2 -. "calls [declared]" .-> n1
        n2 == "calls" ==> n7
        n0 == "reads" ==> n2
        n1 -. "could not follow" .-> n13
        n2 -. "could not follow" .-> n16
        linkStyle 1 stroke:#888
        linkStyle 2 stroke:#0072b2
        linkStyle 3 stroke:#888
        linkStyle 4 stroke:#e69f00
        linkStyle 5 stroke:#d00,stroke-dasharray:4
        linkStyle 6 stroke:#d00,stroke-width:3px
        linkStyle 8 stroke:#0072b2
        linkStyle 12 stroke:#0072b2
        linkStyle 13 stroke:#d00,stroke-width:3px
        linkStyle 14 stroke:#d00,stroke-width:3px
        linkStyle 15 stroke:#d00,stroke-dasharray:4
        linkStyle 16 stroke:#d00,stroke-dasharray:4
      "
    `)
  })
  it("renders a complete graph", () => {
    const text = renderFlowMermaid(maximal(true), { includeCalls: false }) ?? ""
    expect(text.split("\n").slice(0, 4)).toEqual([
      `%% ${flowEvidenceDisclaimer()}`,
      "flowchart LR",
      "  %% Data flow -- complete",
      '  cov["Coverage: complete"]',
    ])
    expect(text).not.toContain("NOT complete")
    expect(text).not.toContain("calls")
  })
  it("states a missing field with quote escaping", () => {
    expect(renderFlowMermaid(maximal(), { field: 'a"b\nc' })).toBe(
      `%% ${flowEvidenceDisclaimer()}\nflowchart LR\n  none["No field named a#quot;b<br/>c in this evidence"]\n`,
    )
  })
  it("returns undefined without a flow", () => {
    expect(renderFlowMermaid({ flow: undefined } as never)).toBeUndefined()
  })
  it("renders one field's flow", () => {
    const flow = {
      nodes: [
        node("fld", "field", "d.f", "static"),
        node("src", "boundary", "pg", "declared", { boundaryKind: "database" }),
        node("fn", "function", "go", "static"),
        node("out", "boundary", "http", "static", { boundaryKind: "client-response" }),
      ],
      edges: [
        edge("c1", "crosses-boundary", "src", "fld", "declared", { origin: "fld" }),
        edge("c2", "reads", "fld", "fn", "static", { origin: "fld", path: ["a"] }),
        edge("c3", "side-effect", "fn", "out", "static", { origin: "fld", path: ["a"] }),
      ],
      unknowns: [unknown("u", "unresolved-call", { subject: "fn" })],
      coverage: coverage(true),
    }
    expect(renderFlowMermaid(input(flow), { field: "d.f" })).toMatchInlineSnapshot(`
      "%% Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.
      flowchart LR
        %% Data flow -- NOT complete: parts could not be followed
        cov["Coverage: NOT complete -- a missing flow is not proof of absence"]
        n0[/"d.f"/]
        n1(["go"])
        n2[("client-response: http")]
        n3[("database: pg")]
        n4{{"unknown: unresolved-call<br/>a/b.ts:7:9<br/>an unresolved call that receives tracked data"}}
        n3 -. "crosses-boundary [declared]" .-> n0
        n0 -- "reads a" --> n1
        n1 -- "side-effect a" --> n2
        n1 -. "could not follow" .-> n4
        linkStyle 0 stroke:#0072b2
        linkStyle 3 stroke:#d00,stroke-dasharray:4
      "
    `)
  })
})
