import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { computeDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import type { FlowModel } from "../../src/flow/flow-model.js"
import { analyzeRedundantTransforms } from "../../src/flow/redundant-transform.js"
import { nodeBuildFs } from "../support/build-filesystem.js"
import { examplesRoot, isInstalled } from "./support.js"

/**
 * The false-positive guard for redundant transformations (ADR 0075): the repository's four consumer examples are real
 * application source written without this rule in mind, so a noisy rule would show here. Today none of them has a needless
 * round trip, a chain of three wrappers or a derivation nobody reads, and the one copy the scan notices is a single
 * copy of data that was not itself a copy -- information, not a finding. A change that makes this list grow is either a
 * real discovery (update the pin and read the example) or a rule that has become noisy.
 */
const NAMES = ["enterprise-platform", "nextjs-app", "team-service", "application"] as const
type ExampleName = (typeof NAMES)[number]

async function flowOf(name: ExampleName): Promise<FlowModel> {
  const { result } = await computeDataArtifacts({
    fs: nodeBuildFs,
    root: path.join(examplesRoot, name),
    include: ["src/**"],
    flowEvidence: true,
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    commit: "0123456789abcdef0123456789abcdef01234567",
  })
  if (result.evidence.flow === undefined) throw new Error(`${name}: no flow was computed`)
  return result.evidence.flow
}

describe("redundant transformations over the consumer examples", () => {
  const flows = new Map<ExampleName, FlowModel>()
  beforeAll(async () => {
    for (const name of NAMES) if (isInstalled(name)) flows.set(name, await flowOf(name))
  }, 120_000)

  it.each(NAMES)("%s has none", (name) => {
    if (!isInstalled(name)) return
    const flow = flows.get(name)
    expect(flow).toBeDefined()
    expect(analyzeRedundantTransforms(flow!)).toEqual([])
  })

  it.each([
    ["enterprise-platform", []],
    ["nextjs-app", []],
    ["application", []],
    ["team-service", [["copy", undefined, undefined, "src/main.ts", 152, 19]]],
  ] as const)("%s: the copies and derivations the scan noticed are pinned", (name, expected) => {
    if (!isInstalled(name)) return
    const tags = (flows.get(name)?.edgeTags ?? []).map((tag) => [
      tag.via,
      tag.fresh,
      tag.unused,
      tag.source.file,
      tag.source.line,
      tag.source.column,
    ])
    expect(tags).toEqual(expected)
  })
})
