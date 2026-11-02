import { describe, expect, it } from "vitest"
import { buildClaimsModel } from "../../src/flow/claims-model.js"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowModel, FlowNodeInput } from "../../src/flow/flow-model.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import type { ObservationModel } from "../../src/flow/observation-model.js"
import { buildPolicyModel } from "../../src/flow/policy-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"

/**
 * Joining observations to claims must cost time linear in (fields + observations), not their product: with
 * twice the observations (and twice the fields) the work is about twice, never four times. Every field flows
 * straight to a boundary; a third of the observations corroborate that, a third are about a path the flow does
 * not carry, a third are at a boundary the field does not reach (observed-only / contradicted claims).
 */
const FILE = "features/user.ts"
const BOUNDARIES = 10

const fieldId = (index: number): string => flowNodeId("field", FILE, `userData.f${index}`)
const boundaryId = (index: number): string => flowNodeId("boundary", "boundary:code", `b${index}`)

function synthetic(observationCount: number): {
  readonly flow: FlowModel
  readonly observation: ObservationModel
} {
  const fields = Math.floor(observationCount / 2)
  const nodes: FlowNodeInput[] = []
  const edges: FlowEdgeInput[] = []
  for (let index = 0; index < BOUNDARIES; index += 1) {
    nodes.push({
      kind: "boundary",
      scope: "boundary:code",
      name: `b${index}`,
      status: "static",
      boundaryKind: "client-response",
    })
  }
  for (let index = 0; index < fields; index += 1) {
    nodes.push({
      kind: "field",
      scope: FILE,
      name: `userData.f${index}`,
      status: "static",
      classification: "pii",
    })
    edges.push({
      kind: "side-effect",
      from: fieldId(index),
      to: boundaryId(index % BOUNDARIES),
      status: "static",
      path: ["a"],
      origin: fieldId(index),
    })
  }
  const events: ObservationEvent[] = []
  for (let index = 0; index < observationCount; index += 1) {
    const target = index % fields
    const kind = index % 3
    events.push({
      scope: `s${index % 40}`,
      boundary: {
        kind: "client-response",
        name: `b${kind === 2 ? (target + 1) % BOUNDARIES : target % BOUNDARIES}`,
      },
      field: `userData.f${target}.${kind === 1 ? "zz" : "a"}`,
    })
  }
  return {
    flow: buildFlowModel({ nodes, edges, unknowns: [] }),
    observation: buildObservationModel(events),
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function time(run: () => void): number {
  const samples: number[] = []
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  return median(samples)
}

describe("buildClaimsModel scales linearly with observations", () => {
  it("the synthetic input has the advertised shape", () => {
    const { flow, observation } = synthetic(300)
    const claims = buildClaimsModel({ flow, observation })
    expect(observation.observations.length).toBeGreaterThan(250)
    const verified = claims.claims.filter((claim) => claim.verification === "verified")
    expect(verified.length).toBeGreaterThan(0)
    expect(claims.claims.some((claim) => claim.verification === "contradicted")).toBe(true)
  })

  it("doubling the observations less than triples the time", () => {
    const run = (n: number) => {
      const { flow, observation } = synthetic(n)
      const policy = buildPolicyModel(flow, [
        { id: "no-log", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
      ])
      return () => void buildClaimsModel({ flow, policy, observation })
    }
    const t2000 = time(run(2000))
    const t4000 = time(run(4000))
    const t8000 = time(run(8000))
    if (t4000 > 100) expect(t8000 / t4000).toBeLessThan(3)
    if (t2000 > 100) expect(t4000 / t2000).toBeLessThan(3)
    expect(t8000).toBeLessThan(1000)
  }, 120_000)
})
