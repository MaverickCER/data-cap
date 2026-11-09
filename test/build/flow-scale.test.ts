import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  explosiveProject,
  flowProjectFiles,
  wrapperChainProject,
  writeFlowProject,
} from "../../benchmarks/benchmark-fixtures/flow-generator.mjs"
import type { EvidenceModel } from "../../src/build/evidence-model.js"
import { computeDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import { traceFlow } from "../../src/flow/flow-projections.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

/**
 * The flow pass at the size of a real application: ~600 modules, ~3000 functions, chains of wrapper functions, run
 * through the real pipeline (`computeDataArtifacts` with `flowEvidence`, which calls `scanFlow`, builds the Flow Model
 * and evaluates the declared policy). The budgets are generous on purpose -- this proves the cost is bounded and grows
 * linearly, not that this machine is fast -- and the limits the scanner has (call depth, step budget) are proven to
 * surface as explicit unknowns rather than as a smaller graph that looks complete.
 */
const roots: string[] = []

async function scan(files: Readonly<Record<string, string>>): Promise<{
  readonly evidence: EvidenceModel
  readonly ms: number
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-flow-scale-"))
  roots.push(root)
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, text, "utf8")
  }
  const started = performance.now()
  const { result } = await computeDataArtifacts({
    fs: nodeBuildFs,
    root,
    tsconfig: false,
    flowEvidence: true,
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    commit: "0123456789abcdef0123456789abcdef01234567",
  })
  return { evidence: result.evidence, ms: performance.now() - started }
}

afterAll(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("a project of about 600 files and 3000 functions", () => {
  const FILES = 600
  let big: Awaited<ReturnType<typeof scan>>
  let half: Awaited<ReturnType<typeof scan>>
  let heapBefore = 0
  let heapAfter = 0

  beforeAll(async () => {
    half = await scan(flowProjectFiles({ files: FILES / 2 }))
    globalThis.gc?.()
    heapBefore = process.memoryUsage().heapUsed
    big = await scan(flowProjectFiles({ files: FILES }))
    heapAfter = process.memoryUsage().heapUsed
  }, 240_000)

  const flow = () => {
    const found = big.evidence.flow
    if (found === undefined) throw new Error("no flow")
    return found
  }

  it("the generated project has the advertised size", async () => {
    const files = flowProjectFiles({ files: FILES })
    expect(Object.keys(files)).toHaveLength(FILES + 1)
    const sample = await writeFlowProject(path.join(os.tmpdir(), "data-cap-flow-scale-size"), {
      files: 12,
    })
    roots.push(path.join(os.tmpdir(), "data-cap-flow-scale-size"))
    expect(sample).toEqual({ files: 12, functions: 60, written: 13 })
    expect(FILES * 5).toBe(3000)
  })

  it("completes within the budget through the real pipeline", () => {
    expect(big.ms).toBeLessThan(30_000)
    console.info(
      `flow scale: ${FILES} files / ${FILES * 5} functions in ${Math.round(big.ms)} ms (half: ${Math.round(half.ms)} ms); ` +
        `${flow().nodes.length} nodes, ${flow().edges.length} edges, ${flow().unknowns.length} unknowns; ` +
        `heap +${Math.round((heapAfter - heapBefore) / 1_048_576)} MB`,
    )
  })

  it("analyses every function and drops none silently: no unknowns, coverage complete, every function node accounted for", () => {
    const { coverage } = flow()
    expect(coverage).toEqual({
      functionsAnalyzed: FILES * 5,
      functionsUnanalyzed: 0,
      edgesUnresolved: 0,
      unknowns: 0,
      complete: true,
    })
    const functions = flow().nodes.filter((node) => node.kind === "function")
    expect(functions.length).toBe(FILES * 5)
    expect(coverage.functionsAnalyzed).toBe(FILES * 5)
    expect(flow().unknowns).toEqual([])
  })

  it("follows the field through every wrapper chain to every response, not just the first few", () => {
    const sends = flow().edges.filter((edge) => edge.kind === "side-effect")
    const senders = new Set(sends.map((edge) => edge.from))
    for (let i = 0; i < FILES; i++) {
      expect(
        senders.has(`function:app/m${String(i)}.ts#s${String(i)}`),
        `s${String(i)} reaches the response`,
      ).toBe(true)
    }
  })

  it("finds exactly the planted leaks: the whole record to the client, and the role to the log", () => {
    const results = big.evidence.policy?.results ?? []
    const byRule = (id: string) =>
      results.filter((r) => r.ruleId === `userData/${id}`).map((r) => r.outcome)
    expect(byRule("no-password-to-client")).toEqual(["violated"])
    expect(byRule("no-role-to-log")).toEqual(["violated"])
    const leakers = flow().edges.filter(
      (edge) => edge.kind === "side-effect" && edge.path?.length === 0 && edge.from.includes("#s"),
    )
    expect(leakers.map((edge) => edge.from).sort()).toEqual(
      Array.from(
        { length: FILES / 50 },
        (_, i) => `function:app/m${String(i * 50)}.ts#s${String(i * 50)}`,
      ).sort(),
    )
  })

  it("grows linearly: twice the files give twice the nodes and edges, to within a few percent", () => {
    const small = half.evidence.flow
    if (small === undefined) throw new Error("no flow")
    expect(flow().nodes.length / small.nodes.length).toBeGreaterThan(1.9)
    expect(flow().nodes.length / small.nodes.length).toBeLessThan(2.1)
    expect(flow().edges.length / small.edges.length).toBeGreaterThan(1.9)
    expect(flow().edges.length / small.edges.length).toBeLessThan(2.1)
  })

  it("stays proportionate: bounded nodes and edges per function, and a bounded evidence size", () => {
    expect(flow().nodes.length).toBeLessThan(FILES * 5 * 4)
    expect(flow().edges.length).toBeLessThan(FILES * 5 * 12)
    expect(JSON.stringify(big.evidence).length / (FILES * 5)).toBeLessThan(4_000)
    expect(heapAfter - heapBefore).toBeLessThan(1_500 * 1_048_576)
  })

  it("is deterministic at this size: a second run is byte-identical", async () => {
    const again = await scan(flowProjectFiles({ files: FILES }))
    expect(JSON.stringify(again.evidence.flow)).toBe(JSON.stringify(big.evidence.flow))
  }, 120_000)
})

describe("the limits the scanner has are explicit unknowns, never a smaller graph that looks complete", () => {
  it("a wrapper chain deeper than the call-depth limit reports where it stopped, and the trace of the leaked field says it is incomplete", async () => {
    const { evidence } = await scan(wrapperChainProject(60))
    const flow = evidence.flow
    if (flow === undefined) throw new Error("no flow")
    const stopped = flow.unknowns.filter((u) => u.reason === "unanalyzed-function")
    expect(stopped.length).toBeGreaterThan(0)
    expect(
      stopped.every((u) => (u.detail ?? "").includes("call depth or analysis budget exceeded")),
    ).toBe(true)
    expect(stopped.every((u) => u.source.file === "app/chain.ts")).toBe(true)
    expect(flow.coverage.complete).toBe(false)
    expect(flow.coverage.functionsUnanalyzed).toBeGreaterThan(0)
    const field = flow.nodes.find((node) => node.kind === "field")
    if (field === undefined) throw new Error("no field")
    expect(traceFlow(flow, field.id, "downstream").complete).toBe(false)
    const outcomes = (evidence.policy?.results ?? []).map((r) => `${r.ruleId}:${r.outcome}`)
    expect(outcomes).not.toContain("userData/no-password-to-client:satisfied")
  })

  // Spends the whole default budget of three million steps through the real pipeline (about a minute and a half). The
  // exactness of that budget and what the scanner does when it runs out are proved with a small budget in
  // `mut-flow-scan-5.test.ts`; a mutation run skips this case so that each of its mutants is not made to wait for it.
  it.skipIf(process.env["STRYKER_MUTATOR_WORKER"] !== undefined)(
    "a function that exhausts the step budget makes the rest of the analysis say so, within the time budget",
    async () => {
      const { evidence, ms } = await scan(explosiveProject(9, 6))
      const flow = evidence.flow
      if (flow === undefined) throw new Error("no flow")
      // No wall-clock assertion: the step counter (not time) ends the analysis, which the unknowns below prove; a hang would hit this test's own timeout.
      const exhausted = flow.unknowns.filter(
        (u) =>
          u.reason === "unanalyzed-function" &&
          (u.detail ?? "").includes("analysis budget exceeded"),
      )
      expect(exhausted.length).toBeGreaterThan(0)
      expect(flow.coverage.complete).toBe(false)
      expect(flow.coverage.functionsUnanalyzed).toBeGreaterThan(0)
      const outcomes = (evidence.policy?.results ?? []).map((r) => `${r.ruleId}:${r.outcome}`)
      expect(outcomes).not.toContain("userData/no-password-to-client:satisfied")
      console.info(
        `flow scale: step budget exhausted after ${Math.round(ms)} ms with ${exhausted.length} unknown(s)`,
      )
    },
    // About 90 s alone; under coverage instrumentation it took 281 s on Node 24 and over 480 s on Node 22 in CI. The
    // assertions count unknowns, not time, so a long timeout only ever ends a genuine hang.
    1_200_000,
  )
})
