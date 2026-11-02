import { describe, expect, it } from "vitest"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowModel, FlowNodeInput } from "../../src/flow/flow-model.js"
import { traceFlow, traceFlowBetween } from "../../src/flow/flow-projections.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"
import type { FlowPolicyRule } from "../../src/flow/policy-model.js"
import { analyzeLeastData } from "../../src/flow/least-data.js"
import { buildClaimsModel } from "../../src/flow/claims-model.js"
import type { CapabilityInventory, FieldNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

/**
 * The analyses that run after the flow scan must cost time linear in the size of the Flow Model: a model of 8000
 * nodes is analysed in about twice the time of one of 4000, never four times. The models are built directly (no scanner)
 * with the shape of a real application: many independent field -> function chains of five hops ending at a boundary, a
 * few helper functions many fields pass through, and some unknowns.
 */
const FILE = "features/user.ts"
const HOPS = 4
const HELPERS = 4
const BOUNDARIES = 10

const fieldId = (index: number): string => flowNodeId("field", FILE, `userData.f${index}`)
const fnId = (chain: number, hop: number): string =>
  flowNodeId("function", "app.ts", `c${chain}.h${hop}`)
const helperId = (index: number): string => flowNodeId("function", "app.ts", `helper${index}`)
const boundaryId = (index: number): string => flowNodeId("boundary", "boundary:code", `b${index}`)

function syntheticModel(nodeCount: number): { readonly flow: FlowModel; readonly chains: number } {
  const chains = Math.floor(nodeCount / (HOPS + 1))
  const nodes: FlowNodeInput[] = []
  const edges: FlowEdgeInput[] = []
  const unknowns: {
    reason: "unresolved-call"
    source: { file: string; line: number; column: number }
    subject: string
    data: { origin: string; path: string[] }[]
  }[] = []
  const flow = (
    kind: FlowEdgeInput["kind"],
    from: string,
    to: string,
    origin: string,
  ): FlowEdgeInput => ({
    kind,
    from,
    to,
    status: "static",
    path: ["a"],
    origin,
  })
  for (let index = 0; index < BOUNDARIES; index += 1) {
    nodes.push({
      kind: "boundary",
      scope: "boundary:code",
      name: `b${index}`,
      status: "static",
      boundaryKind: index % 3 === 0 ? "log" : "client-response",
    })
  }
  for (let index = 0; index < HELPERS; index += 1) {
    nodes.push({ kind: "function", scope: "app.ts", name: `helper${index}`, status: "static" })
  }
  for (let chain = 0; chain < chains; chain += 1) {
    const origin = fieldId(chain)
    nodes.push({
      kind: "field",
      scope: FILE,
      name: `userData.f${chain}`,
      status: "static",
      ...(chain % 3 === 0 ? { classification: "pii" } : {}),
    })
    for (let hop = 1; hop <= HOPS; hop += 1) {
      nodes.push({ kind: "function", scope: "app.ts", name: `c${chain}.h${hop}`, status: "static" })
    }
    edges.push(flow("reads", origin, fnId(chain, 1), origin))
    edges.push(flow("passes", fnId(chain, 1), fnId(chain, 2), origin))
    if (chain % 5 === 0) {
      const helper = helperId(chain % HELPERS)
      edges.push(flow("passes", fnId(chain, 2), helper, origin))
      edges.push(flow("passes", helper, fnId(chain, 3), origin))
    } else {
      edges.push(flow("passes", fnId(chain, 2), fnId(chain, 3), origin))
    }
    edges.push(flow("passes", fnId(chain, 3), fnId(chain, 4), origin))
    edges.push(flow("side-effect", fnId(chain, 4), boundaryId(chain % BOUNDARIES), origin))
    edges.push({ kind: "calls", from: fnId(chain, 1), to: fnId(chain, 2), status: "static" })
    if (chain % 40 === 7) {
      unknowns.push({
        reason: "unresolved-call",
        source: { file: "app.ts", line: chain + 1, column: 1 },
        subject: fnId(chain, 3),
        data: [{ origin, path: ["a"] }],
      })
    }
  }
  return { flow: buildFlowModel({ nodes, edges, unknowns }), chains }
}

function inventory(chains: number): CapabilityInventory {
  const fields: FieldNode[] = []
  for (let index = 0; index < chains; index += 1) {
    fields.push({
      path: [`f${index}`],
      docs: undefined,
      owner: { value: undefined, declaredOn: undefined },
      sensitivity: { value: undefined, declaredOn: undefined },
      purpose: { value: undefined, declaredOn: undefined },
      legalBasis: { value: undefined, declaredOn: undefined },
      dataResidency: { value: undefined, declaredOn: undefined },
      auditRequired: { value: undefined, declaredOn: undefined },
      declarationPosition: undefined,
      writtenBy: [],
      shape: { a: "", b: "" },
    })
  }
  return {
    schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
    capabilities: [
      {
        file: FILE,
        exportName: "userData",
        kind: "createData",
        docs: undefined,
        active: true,
        exclusiveGroup: undefined,
        declarationPosition: { line: 1, column: 1 },
        fields,
        getters: [],
        mutators: [],
        subscriptions: [],
      },
    ],
    warnings: [],
  }
}

const RULES: readonly FlowPolicyRule[] = [
  { id: "no-log", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
  {
    id: "client-only",
    appliesTo: { scope: FILE, classification: "pii" },
    allowedDestinations: ["client-response"],
  },
]

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function time(run: () => void): number {
  const samples: number[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  return median(samples)
}

const analyses: Readonly<Record<string, (n: number) => () => void>> = {
  traceFlow: (n) => {
    const { flow } = syntheticModel(n)
    const fields = flow.nodes.filter((node) => node.kind === "field")
    return () => {
      for (const field of fields) traceFlow(flow, field.id, "downstream")
    }
  },
  traceFlowBetween: (n) => {
    const { flow } = syntheticModel(n)
    const fields = flow.nodes.filter((node) => node.kind === "field")
    return () => {
      for (const [index, field] of fields.entries()) {
        traceFlowBetween(flow, field.id, boundaryId(index % BOUNDARIES))
      }
    }
  },
  buildPolicyModel: (n) => {
    const { flow } = syntheticModel(n)
    return () => void buildPolicyModel(flow, RULES)
  },
  analyzeLeastData: (n) => {
    const { flow, chains } = syntheticModel(n)
    const capability = inventory(chains)
    return () => void analyzeLeastData({ capability, flow })
  },
  buildClaimsModel: (n) => {
    const { flow } = syntheticModel(n)
    const policy = buildPolicyModel(flow, RULES)
    return () => void buildClaimsModel({ flow, policy })
  },
}

describe("post-scan analyses scale linearly with the size of the Flow Model", () => {
  it("the synthetic model has the advertised size and shape", () => {
    const { flow, chains } = syntheticModel(2000)
    expect(chains).toBe(400)
    expect(flow.nodes).toHaveLength(BOUNDARIES + HELPERS + chains * (HOPS + 1))
    expect(flow.unknowns).toHaveLength(10)
    const trace = traceFlow(flow, fieldId(0), "downstream")
    // chain 0 goes through helper0 and ends at boundary b0
    expect(trace.nodes.map((node) => node.name)).toEqual([
      "b0",
      "userData.f0",
      "c0.h1",
      "c0.h2",
      "c0.h3",
      "c0.h4",
      "helper0",
    ])
    expect(trace.complete).toBe(true)
    expect(traceFlow(flow, fieldId(7), "downstream").complete).toBe(false)
  })

  for (const [name, prepare] of Object.entries(analyses)) {
    it(`${name}: doubling the model less than triples the time`, () => {
      const t2000 = time(prepare(2000))
      const t4000 = time(prepare(4000))
      const t8000 = time(prepare(8000))
      // Only compare ratios once the work is large enough to measure above timer and GC noise.
      if (t4000 > 100) expect(t8000 / t4000).toBeLessThan(3)
      if (t2000 > 100) expect(t4000 / t2000).toBeLessThan(3)
      expect(t8000).toBeLessThan(3000)
    }, 120_000)
  }
})
