import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readObservationsFile, readRulesFile, writeFlowSummary } from "../../src/cli/index.js"
import { nodeBuildFileSystem } from "../../src/cli/filesystem.js"
import type { ReportResult } from "../../src/build/index.js"

function capture(fn: () => void): string {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return chunks.join("")
}

function evidence(parts: Record<string, unknown>): ReportResult["evidence"] {
  return parts as unknown as ReportResult["evidence"]
}

const coverage = (parts: Record<string, unknown> = {}) => ({
  functionsAnalyzed: 4,
  functionsUnanalyzed: 0,
  unknowns: 0,
  complete: true,
  ...parts,
})

describe("writeFlowSummary", () => {
  it("writes nothing without evidence or without any flow sub-model", () => {
    expect(
      capture(() => {
        writeFlowSummary(undefined)
      }),
    ).toBe("")
    expect(
      capture(() => {
        writeFlowSummary(evidence({}))
      }),
    ).toBe("")
  })

  it("describes the flow coverage, naming only the non-zero parts", () => {
    expect(
      capture(() => {
        writeFlowSummary(evidence({ flow: { coverage: coverage() } }))
      }),
    ).toBe("Flow analysis: 4 function(s) analyzed -- complete.\n")
    expect(
      capture(() => {
        writeFlowSummary(
          evidence({
            flow: {
              coverage: coverage({ functionsUnanalyzed: 2, unknowns: 3, complete: false }),
            },
          }),
        )
      }),
    ).toBe(
      "Flow analysis: 4 function(s) analyzed, 2 not fully analyzed, 3 unknown(s) -- not complete.\n",
    )
    expect(
      capture(() => {
        writeFlowSummary(
          evidence({ flow: { coverage: coverage({ unknowns: 1, complete: false }) } }),
        )
      }),
    ).toBe("Flow analysis: 4 function(s) analyzed, 1 unknown(s) -- not complete.\n")
  })

  it("describes the policy summary", () => {
    expect(
      capture(() => {
        writeFlowSummary(
          evidence({ policy: { summary: { satisfied: 5, violated: 1, indeterminate: 2 } } }),
        )
      }),
    ).toBe("Policy: 5 satisfied, 1 violated, 2 indeterminate.\n")
  })

  it("describes the observations, mentioning skipped events only when there are some", () => {
    const observation = (skipped: number) => ({
      observation: { skipped, observations: [{}, {}, {}], scopes: ["a", "b"] },
    })
    expect(
      capture(() => {
        writeFlowSummary(evidence(observation(0)))
      }),
    ).toBe("Observations: 3 across 2 scope(s).\n")
    expect(
      capture(() => {
        writeFlowSummary(evidence(observation(1)))
      }),
    ).toBe("Observations: 3 across 2 scope(s), 1 skipped as malformed.\n")
  })

  it("describes the claims, omitting zero counts, or says none", () => {
    expect(
      capture(() => {
        writeFlowSummary(
          evidence({ claims: { summary: { verified: 2, unobserved: 0, contradicted: 1 } } }),
        )
      }),
    ).toBe("Claims: 2 verified, 1 contradicted.\n")
    expect(
      capture(() => {
        writeFlowSummary(evidence({ claims: { summary: { verified: 0, unobserved: 0 } } }))
      }),
    ).toBe("Claims: none.\n")
  })

  it("writes the sections in order", () => {
    const out = capture(() => {
      writeFlowSummary(
        evidence({
          flow: { coverage: coverage() },
          policy: { summary: { satisfied: 0, violated: 0, indeterminate: 0 } },
          observation: { skipped: 0, observations: [], scopes: [] },
          claims: { summary: { verified: 1 } },
        }),
      )
    })
    expect(out).toBe(
      [
        "Flow analysis: 4 function(s) analyzed -- complete.",
        "Policy: 0 satisfied, 0 violated, 0 indeterminate.",
        "Observations: 0 across 0 scope(s).",
        "Claims: 1 verified.",
        "",
      ].join("\n"),
    )
  })
})

describe("readRulesFile and readObservationsFile: exact errors", () => {
  let dir: string
  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "data-cap-mut-cli-"))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fsPromises.rm(dir, { recursive: true, force: true })
  })

  it("reads both files as utf8", async () => {
    const rules = path.join(dir, "rules.json")
    const obs = path.join(dir, "obs.json")
    await fsPromises.writeFile(rules, '{"maxUnknowns": 1}', "utf8")
    await fsPromises.writeFile(obs, "[]", "utf8")
    const spy = vi.spyOn(nodeBuildFileSystem, "readFile")
    await readRulesFile(rules)
    await readObservationsFile(obs)
    expect(spy.mock.calls).toEqual([
      [rules, "utf8"],
      [obs, "utf8"],
    ])
  })

  it("lists every rules problem on its own bulleted line", async () => {
    const file = path.join(dir, "rules.json")
    await fsPromises.writeFile(file, '{"bogus": 1, "maxUnknowns": -1}', "utf8")
    await expect(readRulesFile(file)).rejects.toThrow(
      new RegExp(
        `^--rules ${file.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not a valid rules file:\\n  - "bogus" is not a rule\\. Rules are: [^\\n]*\\.\\n  - "maxUnknowns" must be a non-negative whole number\\.$`,
      ),
    )
  })

  it("keeps the read failure as the cause and its message in the text", async () => {
    const failure = new Error("boom")
    vi.spyOn(nodeBuildFileSystem, "readFile").mockRejectedValue(failure)
    const rules = await readRulesFile("r.json").catch((error: unknown) => error)
    expect(rules).toBeInstanceOf(Error)
    expect((rules as Error).message).toBe("--rules r.json could not be read: boom")
    expect((rules as Error).cause).toBe(failure)
    const obs = await readObservationsFile("o.json").catch((error: unknown) => error)
    expect((obs as Error).message).toBe("--observations o.json could not be read: boom")
    expect((obs as Error).cause).toBe(failure)
  })

  it("stringifies a non-Error read failure", async () => {
    vi.spyOn(nodeBuildFileSystem, "readFile").mockRejectedValue("plain")
    const rules = await readRulesFile("r.json").catch((error: unknown) => error)
    expect((rules as Error).message).toBe("--rules r.json could not be read: plain")
    const obs = await readObservationsFile("o.json").catch((error: unknown) => error)
    expect((obs as Error).message).toBe("--observations o.json could not be read: plain")
  })

  it("has exact messages for invalid observations JSON and non-arrays", async () => {
    const file = path.join(dir, "obs.json")
    await fsPromises.writeFile(file, "{no", "utf8")
    await expect(readObservationsFile(file)).rejects.toThrow(
      `--observations ${file} is not valid JSON.`,
    )
    await fsPromises.writeFile(file, "{}", "utf8")
    await expect(readObservationsFile(file)).rejects.toThrow(
      `--observations ${file} must contain a JSON array of observation events.`,
    )
  })
})
