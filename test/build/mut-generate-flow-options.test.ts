import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as EvidenceModelModule from "../../src/build/evidence-model.js"
import type * as FlowScanModule from "../../src/build/flow-scan.js"

const spy = vi.hoisted(() => ({ inputs: [] as Record<string, unknown>[] }))

vi.mock("../../src/build/evidence-model.js", async (importOriginal) => {
  const actual = await importOriginal<typeof EvidenceModelModule>()
  return {
    ...actual,
    buildEvidenceModel: (...args: Parameters<typeof actual.buildEvidenceModel>) => {
      spy.inputs.push({ ...args[0] })
      return actual.buildEvidenceModel(...args)
    },
  }
})

vi.mock("../../src/build/flow-scan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof FlowScanModule>()
  return {
    ...actual,
    scanFlow: async (...args: Parameters<typeof actual.scanFlow>) => {
      const scanned = await actual.scanFlow(...args)
      return {
        ...scanned,
        warnings: [
          ...scanned.warnings,
          { file: "synthetic.ts", message: "synthetic flow warning" },
        ],
      }
    },
  }
})

import { computeDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import type { GenerateDataArtifactsOptions } from "../../src/build/generate-data-artifacts.js"
import { PROFILE_CAPABILITY, PROFILE_HANDLERS } from "../support/flow-evidence-fixture.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

describe("computeDataArtifacts: the optional models handed to the evidence model", () => {
  let root: string
  beforeEach(async () => {
    spy.inputs.length = 0
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-mut-gen-"))
    await fs.mkdir(path.join(root, "features"), { recursive: true })
    await fs.mkdir(path.join(root, "app"), { recursive: true })
    await fs.writeFile(path.join(root, "features/user.ts"), PROFILE_CAPABILITY, "utf8")
    await fs.writeFile(path.join(root, "app/profile.ts"), PROFILE_HANDLERS, "utf8")
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const run = (overrides: Partial<GenerateDataArtifactsOptions> = {}) =>
    computeDataArtifacts({
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      commit: "0123456789abcdef0123456789abcdef01234567",
      ...overrides,
    })

  it("without flow evidence or observations the inputs carry no flow, policy or observation key", async () => {
    await run()
    const [inputs] = spy.inputs
    expect(inputs).toBeDefined()
    expect(Object.keys(inputs ?? {})).not.toContain("flow")
    expect(Object.keys(inputs ?? {})).not.toContain("policy")
    expect(Object.keys(inputs ?? {})).not.toContain("observation")
  })

  it("with flow evidence, flow and policy are supplied; observations only when given", async () => {
    await run({ flowEvidence: true })
    const keys = Object.keys(spy.inputs[0] ?? {})
    expect(keys).toContain("flow")
    expect(keys).toContain("policy")
    expect(keys).not.toContain("observation")
    expect(spy.inputs[0]?.["flow"]).toBeDefined()
    expect(spy.inputs[0]?.["policy"]).toBeDefined()
    spy.inputs.length = 0
    await run({ flowEvidence: true, observations: [] })
    expect(Object.keys(spy.inputs[0] ?? {})).toContain("observation")
    expect(spy.inputs[0]?.["observation"]).toBeDefined()
  })

  it("surfaces the flow scan's warnings in the result", async () => {
    const { result } = await run({ flowEvidence: true })
    expect(result.warnings).toContainEqual({
      file: "synthetic.ts",
      message: "synthetic flow warning",
    })
    const plain = await run()
    expect(plain.result.warnings.map((w) => w.message)).not.toContain("synthetic flow warning")
  })
})
