import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { evidenceOptionsKey } from "../../src/build/evidence-fingerprint.js"
import { computeDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import type { FlowSummary } from "../../src/build/flow-scan.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

const clone: FlowSummary = { module: "some-lib", export: "clone", effect: "pass-through" }

describe("evidenceOptionsKey and the flow summaries", () => {
  const key = (flowSummaries: readonly FlowSummary[] | undefined): string | undefined =>
    evidenceOptionsKey({ flowEvidence: true, flowSummaries })

  it("is the key it always was when there are none, or none that mean anything", () => {
    expect(key(undefined)).toBe(evidenceOptionsKey({ flowEvidence: true }))
    expect(key([])).toBe(key(undefined))
  })

  it("is nothing when the flow pass does not run, whatever summaries were given", () => {
    expect(evidenceOptionsKey({ flowSummaries: [clone] })).toBeUndefined()
    expect(evidenceOptionsKey({ flowEvidence: false, flowSummaries: [clone] })).toBeUndefined()
  })

  it("differs once a summary is declared", () => {
    expect(key([clone])).not.toBe(key(undefined))
  })

  it.each<[string, FlowSummary]>([
    ["module", { ...clone, module: "other-lib" }],
    ["export", { ...clone, export: "cloneDeep" }],
    ["effect", { module: "some-lib", export: "clone", effect: "sanitizes" }],
    ["arg", { module: "some-lib", export: "clone", effect: "returns-arg", arg: 0 }],
    [
      "approximate",
      { module: "some-lib", export: "clone", effect: "pass-through", approximate: true },
    ],
    [
      "boundary kind",
      {
        module: "some-lib",
        export: "clone",
        effect: "sink",
        boundary: { kind: "log", name: "x" },
      },
    ],
  ])("differs when the %s of a summary differs", (_, other) => {
    expect(key([other])).not.toBe(key([clone]))
  })

  it("differs between two summaries that differ only in the argument, the boundary name or the handling", () => {
    const returns = (arg: number): FlowSummary => ({
      module: "m",
      export: "e",
      effect: "returns-arg",
      arg,
    })
    expect(key([returns(0)])).not.toBe(key([returns(1)]))
    const sink = (name: string, handling?: "hashed" | "redacted"): FlowSummary => ({
      module: "m",
      export: "e",
      effect: "sink",
      boundary: { kind: "api", name },
      ...(handling === undefined ? {} : { handling }),
    })
    expect(key([sink("a")])).not.toBe(key([sink("b")]))
    expect(key([sink("a")])).not.toBe(key([sink("a", "hashed")]))
    expect(key([sink("a", "hashed")])).not.toBe(key([sink("a", "redacted")]))
  })

  it("keeps the order, because the first summary that matches a call wins", () => {
    const other: FlowSummary = { module: "some-lib", export: "clone", effect: "sanitizes" }
    expect(key([clone, other])).not.toBe(key([other, clone]))
  })

  it("is the same for the same summaries, and does not mix up fields that would read alike", () => {
    expect(key([{ ...clone }])).toBe(key([clone]))
    const a: FlowSummary = { module: "ab", export: "c", effect: "pass-through" }
    const b: FlowSummary = { module: "a", export: "bc", effect: "pass-through" }
    expect(key([a])).not.toBe(key([b]))
  })

  it("is independent of the sinks, which have their own part of the key", () => {
    const withSink = evidenceOptionsKey({
      flowEvidence: true,
      flowSinks: [{ callee: "a.b", boundary: { kind: "log", name: "x" } }],
      flowSummaries: [clone],
    })
    expect(withSink).not.toBe(key([clone]))
  })
})

describe("flowSummaries through computeDataArtifacts", () => {
  let root: string
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-flow-summaries-"))
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.writeFile(
      path.join(root, "src/user.ts"),
      `export const userData = createData({ fields: { user: { name: "", email: "" } } })\n`,
      "utf8",
    )
    await fs.writeFile(
      path.join(root, "src/handler.ts"),
      `import { clone } from "some-lib"\nimport { userData } from "./user.js"\nexport function h(res: any) {\n  res.json(clone(userData.getSnapshot().fields.user.email))\n}\n`,
      "utf8",
    )
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const run = async (flowSummaries?: readonly FlowSummary[]) => {
    const { result } = await computeDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      flowEvidence: true,
      ...(flowSummaries === undefined ? {} : { flowSummaries }),
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      commit: "0123456789abcdef0123456789abcdef01234567",
    })
    const { flow } = result.evidence
    if (flow === undefined) throw new Error("no flow")
    return flow
  }

  it("without a summary the package call is an explicit unknown and the trace is not complete", async () => {
    const flow = await run()
    expect(flow.unknowns.map((unknown) => unknown.reason)).toEqual(["unresolved-call"])
    expect(flow.coverage.complete).toBe(false)
    expect(flow.edges.filter((edge) => edge.status === "declared")).toEqual([])
  })

  it("with a summary the call is followed, and what it carries is declared evidence, never static", async () => {
    const flow = await run([clone])
    expect(flow.unknowns).toEqual([])
    expect(flow.coverage.complete).toBe(true)
    const sends = flow.edges.filter((edge) => edge.kind === "side-effect")
    expect(sends.map((edge) => [edge.status, edge.path?.join(".")])).toEqual([
      ["declared", "email"],
    ])
  })
})
