import { describe, expect, it } from "vitest"
import { renderFlowDot } from "../../src/evidence/flow-dot.js"
import { renderFlowMermaid } from "../../src/evidence/flow-mermaid.js"
import { renderFlowText } from "../../src/evidence/flow-text.js"
import { buildProvDocument } from "../../src/evidence/flow-prov.js"
import { observationsFromOtlp } from "../../src/evidence/flow-otel.js"
import { selectDiagram } from "../../src/evidence/flow-diagram-selection.js"
import { buildFlowModel, flowNodeId, FlowModelError } from "../../src/flow/flow-model.js"
import type { FlowBoundaryKind, FlowEdgeInput, FlowStatus } from "../../src/flow/flow-model.js"
import { traceFlowBetween } from "../../src/flow/flow-projections.js"
import { buildPolicyModel, judgeCrossing } from "../../src/flow/policy-model.js"

const FILE = "src/a.ts"
const field = flowNodeId("field", FILE, "User.email")
const fn = flowNodeId("function", FILE, "f")
const BOUNDARIES: readonly FlowBoundaryKind[] = ["cache", "log", "api", "client-response"]
const boundary = (kind: FlowBoundaryKind) => flowNodeId("boundary", "boundary", `b-${kind}`)

/** One field read by `f`, which sends it to four boundaries over edges of every status. */
function statusModel() {
  const statuses: FlowStatus[] = ["static", "declared", "inferred", "unknown"]
  const edges: FlowEdgeInput[] = [
    { kind: "reads", from: field, to: fn, status: "static", path: ["email"], origin: field },
    { kind: "calls", from: fn, to: fn, status: "static" },
  ]
  BOUNDARIES.forEach((kind, index) => {
    edges.push({
      kind: "side-effect",
      from: fn,
      to: boundary(kind),
      status: statuses[index] ?? "static",
      path: ["email"],
      origin: field,
    })
  })
  return buildFlowModel({
    nodes: [
      { kind: "field", scope: FILE, name: "User.email", status: "static" },
      { kind: "function", scope: FILE, name: "f", status: "unknown" },
      ...BOUNDARIES.map((kind) => ({
        kind: "boundary" as const,
        scope: "boundary",
        name: `b-${kind}`,
        status: "declared" as const,
        boundaryKind: kind,
      })),
    ],
    edges,
    unknowns: [],
  })
}

describe("diagram renderers draw every status and boundary kind distinctly", () => {
  const flow = statusModel()

  it("DOT: a log is a note, a boundary of an unlisted kind is a double octagon", () => {
    const dot = renderFlowDot({ flow, policy: undefined }) ?? ""
    expect(dot).toContain("note")
    expect(dot).toContain("doubleoctagon")
    expect(dot).toContain("cylinder")
    expect(dot).toContain("invhouse")
  })

  it("Mermaid: declared, inferred, unknown and a plain call each get their own link style", () => {
    const mermaid = renderFlowMermaid({ flow, policy: undefined }, { includeCalls: true }) ?? ""
    expect(mermaid).toContain("stroke:#0072b2")
    expect(mermaid).toContain("stroke:#e69f00")
    expect(mermaid).toContain("stroke:#d00,stroke-dasharray:4")
    expect(mermaid).toContain("stroke:#888")
  })

  it("selection keeps call edges between kept nodes only when asked", () => {
    const without = selectDiagram({ flow, policy: undefined }, { field: "User.email" })
    const withCalls = selectDiagram(
      { flow, policy: undefined },
      { field: "User.email", includeCalls: true },
    )
    expect(without?.edges.some((edge) => edge.kind === "calls")).toBe(false)
    expect(withCalls?.edges.some((edge) => edge.kind === "calls")).toBe(true)
  })
})

describe("renderFlowText coverage line", () => {
  it("counts functions that were not fully analyzed and unknowns", () => {
    const flow = buildFlowModel({
      nodes: [{ kind: "function", scope: FILE, name: "f", status: "unknown" }],
      edges: [],
      unknowns: [
        { reason: "unresolved-call", source: { file: FILE, line: 1, column: 1 }, subject: fn },
      ],
    })
    const text = renderFlowText({ flow, claims: undefined }) ?? ""
    expect(text).toContain("1 not fully analyzed")
    expect(text).toContain("1 unknown(s)")
  })
})

describe("traceFlowBetween", () => {
  it("rejects a start or target that is not a node", () => {
    const flow = statusModel()
    expect(() => traceFlowBetween(flow, "field:nope", field)).toThrow(FlowModelError)
    expect(() => traceFlowBetween(flow, field, "field:nope")).toThrow(FlowModelError)
  })

  it("keeps an unknown whose data is for another path out of a path-narrowed trace", () => {
    const flow = buildFlowModel({
      nodes: [
        { kind: "field", scope: FILE, name: "User.email", status: "static" },
        { kind: "function", scope: FILE, name: "f", status: "static" },
        {
          kind: "boundary",
          scope: "boundary",
          name: "b-log",
          status: "declared",
          boundaryKind: "log",
        },
      ],
      edges: [
        { kind: "reads", from: field, to: fn, status: "static", origin: field },
        {
          kind: "side-effect",
          from: fn,
          to: boundary("log"),
          status: "static",
          origin: field,
        },
      ],
      unknowns: [
        {
          reason: "unresolved-call",
          source: { file: FILE, line: 1, column: 1 },
          subject: fn,
          data: [{ origin: field, path: ["other"] }],
        },
      ],
    })
    const narrowed = traceFlowBetween(flow, field, boundary("log"), { path: ["email"] })
    expect(narrowed.unknowns).toEqual([])
    const whole = traceFlowBetween(flow, field, boundary("log"))
    expect(whole.unknowns).toHaveLength(1)
  })
})

describe("policy results are ordered by rule, subject, boundary and outcome", () => {
  it("sorts results for two subjects stably", () => {
    const flow = statusModel()
    const model = buildPolicyModel(flow, [
      { id: "z", appliesTo: { field: "User.email" }, forbidDestinations: ["log", "api"] },
      { id: "a", appliesTo: { field: "Nothing.here" }, forbidDestinations: ["log"] },
    ])
    expect(model.results.map((result) => result.ruleId)).toEqual([
      "a",
      ...Array<string>(model.results.length - 1).fill("z"),
    ])
  })
})

describe("observationsFromOtlp scope fallback", () => {
  const span = (extra: Record<string, unknown>) => ({
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                ...extra,
                attributes: [
                  { key: "data_cap.field", value: { stringValue: "u.email" } },
                  { key: "data_cap.boundary.kind", value: { stringValue: "log" } },
                  { key: "data_cap.boundary.name", value: { stringValue: "console" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  it("uses the trace id as the scope when no scope attribute is given", () => {
    const result = observationsFromOtlp(span({ traceId: "abc" }))
    expect(result.events[0]?.scope).toBe("abc")
  })

  it("skips a span that names no scope at all", () => {
    const result = observationsFromOtlp(span({}))
    expect(result.events).toEqual([])
    expect(result.skipped).toBe(1)
  })
})

describe("PROV qualified names", () => {
  it("escape a trailing dot in an id", () => {
    const flow = buildFlowModel({
      nodes: [
        { kind: "field", scope: FILE, name: "User.", status: "static" },
        { kind: "field", scope: FILE, name: "f(x)*'!", status: "static" },
      ],
      edges: [],
      unknowns: [],
    })
    const doc = buildProvDocument({
      flow,
      claims: undefined,
      observation: undefined,
      provenance: {
        generatedAt: "2026-01-01T00:00:00.000Z",
        toolVersion: "1.0.0",
        commit: undefined,
      },
    })
    expect(Object.keys(doc?.entity ?? {}).every((key) => !key.endsWith("."))).toBe(true)
  })
})

describe("judgeCrossing combines the destination and handling constraints", () => {
  it("reports the worst verdict when both constrain the crossing", () => {
    const rule = {
      id: "r",
      appliesTo: { field: "User.email" },
      forbidDestinations: ["log"] as FlowBoundaryKind[],
      requireHandling: ["hashed"] as const,
    }
    expect(judgeCrossing(rule, "log", ["hashed"])?.outcome).toBe("violated")
    expect(judgeCrossing(rule, "database", ["hashed"])?.outcome).toBe("satisfied")
    expect(judgeCrossing(rule, "database", [undefined])?.outcome).toBe("indeterminate")
  })
})
