import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import type { EvidenceModel } from "../../src/build/evidence-model.js"
import { computeDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import type { FlowModel } from "../../src/flow/flow-model.js"
import { nodeBuildFs } from "../support/build-filesystem.js"
import { examplesRoot, isInstalled } from "./support.js"

/**
 * Acceptance over the repository's four consumer examples: the flow pass is run exactly as the CLI runs it
 * (`computeDataArtifacts` with `flowEvidence`, the examples' own `--include "src/**"`) over real application
 * source, and what it reports is pinned. The examples are capability-store clients, so most of their flows are
 * declared boundaries and reads; what matters is that nothing crashes, that every place the analysis could not
 * follow is listed with its reason (never a quietly complete graph), and that the answer is deterministic.
 */
const NAMES = ["enterprise-platform", "nextjs-app", "team-service", "application"] as const
type ExampleName = (typeof NAMES)[number]

interface Run {
  readonly evidence: EvidenceModel
  readonly flow: FlowModel
  readonly text: string
}

async function analyse(name: ExampleName): Promise<Run> {
  const { result } = await computeDataArtifacts({
    fs: nodeBuildFs,
    root: path.join(examplesRoot, name),
    include: ["src/**"],
    flowEvidence: true,
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    commit: "0123456789abcdef0123456789abcdef01234567",
  })
  const { flow } = result.evidence
  if (flow === undefined) throw new Error(`${name}: no flow was computed`)
  return { evidence: result.evidence, flow, text: JSON.stringify(result.evidence) }
}

const count = (items: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, "en")))
}
const edgeKinds = (run: Run) => count(run.flow.edges.map((edge) => edge.kind))
const nodeKinds = (run: Run) => count(run.flow.nodes.map((node) => node.kind))
const unknownList = (run: Run) =>
  run.flow.unknowns.map((u) => `${u.reason} ${u.source.file}:${u.source.line}:${u.source.column}`)

describe.each(NAMES)("flow corpus: %s", (name) => {
  const installed = isInstalled(name)
  let run: Run
  beforeAll(async () => {
    if (installed) run = await analyse(name)
  }, 120_000)

  it.skipIf(!installed)("completes, with a flow, a schema-versioned model and a coverage that matches its unknowns", () => {
    expect(run.flow.schemaVersion).toBe(1)
    expect(run.flow.coverage.unknowns).toBe(run.flow.unknowns.length)
    expect(run.flow.coverage.complete).toBe(run.flow.unknowns.length === 0 && run.flow.coverage.functionsUnanalyzed === 0 && run.flow.coverage.edgesUnresolved === 0)
    expect(run.flow.coverage.functionsAnalyzed).toBe(run.flow.nodes.filter((n) => n.kind === "function" && n.status !== "unknown").length)
  })

  it.skipIf(!installed)("tracks every capability the committed inventory declares, as field nodes", () => {
    const committed = JSON.parse(
      readFileSync(path.join(examplesRoot, name, "docs/data.evidence.json"), "utf8"),
    ) as { capability: { capabilities: { exportName: string; fields: { path: string[] }[] }[] } }
    const expected = committed.capability.capabilities.flatMap((cap) => cap.fields.map((f) => `${cap.exportName}.${f.path.join(".")}`)).sort()
    expect(run.flow.nodes.filter((n) => n.kind === "field").map((n) => n.name).sort()).toEqual(expected)
  })

  it.skipIf(!installed)("is deterministic: a second run is byte-identical", async () => {
    const again = await analyse(name)
    expect(again.text).toBe(run.text)
  })
})

describe("flow corpus: pinned results", () => {
  const runs = new Map<ExampleName, Run>()
  beforeAll(async () => {
    for (const name of NAMES) if (isInstalled(name)) runs.set(name, await analyse(name))
  }, 240_000)
  const get = (name: ExampleName): Run => {
    const found = runs.get(name)
    if (found === undefined) throw new Error(`${name} is not installed`)
    return found
  }

  it.skipIf(!isInstalled("application"))("application: a small client, fully analysed, nothing unknown", () => {
    const run = get("application")
    expect(nodeKinds(run)).toEqual({ boundary: 1, field: 2, function: 26, parameter: 28, return: 24 })
    // Six `new Promise((resolve) => setTimeout(resolve, 5))` executors are called now: a promise constructor runs its executor.
    expect(edgeKinds(run)).toEqual({ calls: 18, "crosses-boundary": 3 })
    expect(unknownList(run)).toEqual([])
    expect(run.flow.coverage).toEqual({ functionsAnalyzed: 26, functionsUnanalyzed: 0, edgesUnresolved: 0, unknowns: 0, complete: true })
  })

  it.skipIf(!isInstalled("nextjs-app"))("nextjs-app: route handlers answer from their own store; the client component hands the capability to React, which is listed as unknown", () => {
    const run = get("nextjs-app")
    expect(nodeKinds(run)).toEqual({ boundary: 1, field: 1, function: 44, parameter: 41, return: 40 })
    expect(edgeKinds(run)).toEqual({ calls: 33, "crosses-boundary": 4, passes: 3, reads: 9, returns: 1 })
    // `useSyncExternalStore(todoData.subscribe, todoData.getSnapshot, ...)` gives React the capability's state; the
    // intrinsic elements that render a todo's fields are calls the scan cannot follow either.
    expect(unknownList(run)).toEqual([
      "unresolved-call src/app/todo-app.tsx:114:11",
      "unresolved-call src/app/todo-app.tsx:116:15",
      "unresolved-call src/app/todo-app.tsx:32:20",
    ])
    expect(run.flow.coverage.complete).toBe(false)
    const boundaries = run.flow.nodes.filter((n) => n.kind === "boundary")
    expect(boundaries.map((b) => [b.name, b.status])).toEqual([["todos-api", "declared"]])
    expect(run.flow.edges.filter((e) => e.kind === "side-effect")).toEqual([])
  })

  it.skipIf(!isInstalled("team-service"))("team-service: 13 unresolved calls in src/main.ts, every one listed, and the trace says it is not complete", () => {
    const run = get("team-service")
    expect(nodeKinds(run)).toEqual({ boundary: 3, field: 4, function: 47, parameter: 47, return: 39 })
    // Seven promise executors are called now, and `new Set([...])` is a set the scan builds instead of an unresolved call (so the unknown at src/main.ts:153:28 and its approximate read of `tasks[].id` are gone).
    expect(edgeKinds(run)).toEqual({ calls: 37, "crosses-boundary": 6, discards: 1, passes: 9, reads: 22, returns: 2 })
    expect(run.flow.unknowns.map((u) => u.reason)).toEqual(Array.from({ length: 13 }, () => "unresolved-call"))
    expect([...unknownList(run)].sort()).toEqual(
      [
        "unresolved-call src/main.ts:111:1",
        "unresolved-call src/main.ts:115:1",
        "unresolved-call src/main.ts:121:1",
        "unresolved-call src/main.ts:127:1",
        "unresolved-call src/main.ts:161:1",
        "unresolved-call src/main.ts:162:1",
        "unresolved-call src/main.ts:162:14",
        "unresolved-call src/main.ts:57:30",
        "unresolved-call src/main.ts:65:3",
        "unresolved-call src/main.ts:78:1",
        "unresolved-call src/main.ts:79:1",
        "unresolved-call src/main.ts:80:1",
        "unresolved-call src/main.ts:91:1",
      ].sort(),
    )
    expect(run.flow.unknowns.every((u) => u.detail === "call target is not a project function")).toBe(true)
    expect(run.flow.coverage).toEqual({ functionsAnalyzed: 47, functionsUnanalyzed: 0, edgesUnresolved: 0, unknowns: 13, complete: false })
  })

  it.skipIf(!isInstalled("team-service"))("team-service: finds the explicit reads -- the project's tasks in the test driver, the member's name in withAssigneeNames", () => {
    const run = get("team-service")
    const name = (id: string) => run.flow.nodes.find((n) => n.id === id)?.name
    const reads = run.flow.edges.filter((e) => e.kind === "reads" && e.origin !== undefined && run.flow.nodes.find((n) => n.id === e.from)?.kind === "field")
    const summary = reads.map((e) => `${name(e.from)} -> ${name(e.to)}${e.path === undefined ? "" : ` [${e.path.join(".")}]`} (${e.status})`)
    expect(summary).toContain("projectData.tasks -> <module> [length] (static)")
    expect(summary).toContain("projectData.tasks -> <module> [done] (static)")
    expect(summary).toContain("projectData.tasks -> <module> [assigneeName] (static)")
    expect(summary).toContain("projectData.project -> <module> [name] (static)")
    expect(summary).toContain("memberData.members -> withAssigneeNames>anonymous@32:23 [name] (static)")
    expect(run.flow.edges.filter((e) => e.kind === "side-effect")).toEqual([])
  })

  it.skipIf(!isInstalled("enterprise-platform"))("enterprise-platform: analysed, with the declared boundaries of its three capabilities and the logger the legacy sync writes to", () => {
    const run = get("enterprise-platform")
    expect(nodeKinds(run)).toEqual({ boundary: 4, field: 3, function: 78, parameter: 63, return: 70 })
    expect(edgeKinds(run)).toEqual({ calls: 55, "crosses-boundary": 5, reads: 4, "side-effect": 2 })
    expect(run.flow.nodes.filter((n) => n.kind === "boundary").map((n) => n.name)).toEqual(["billing-api", "identity-api", "projects-api", "logger"])
  })

  // `billingData.getSnapshot().fields[fieldName]` (a computed key on the `fields` object, as in legacy-compliance-sync.ts)
  // once vanished without a trace: it now takes every field of the capability to the logger (inferred) and is an explicit
  // `dynamic-access` unknown.
  it.skipIf(!isInstalled("enterprise-platform"))(
    "enterprise-platform: capability data logged in src/server/legacy-compliance-sync.ts is either traced to the logger or reported as an unknown there -- never silently safe",
    () => {
      const run = get("enterprise-platform")
      const file = "src/server/legacy-compliance-sync.ts"
      const toLogger = run.flow.edges.filter(
        (e) =>
          e.kind === "side-effect" &&
          e.source?.file === file &&
          run.flow.nodes.find((n) => n.id === e.to)?.boundaryKind === "log",
      )
      const unknowns = run.flow.unknowns.filter((u) => u.source.file === file)
      expect(toLogger.length + unknowns.length).toBeGreaterThan(0)
    },
  )
})
