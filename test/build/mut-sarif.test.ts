import { describe, expect, it } from "vitest"
import { buildSarifLog } from "../../src/build/sarif.js"
import { PACKAGE_VERSION } from "../../src/build/package-version.js"
import type { FindingModel } from "../../src/build/finding-model.js"
import type { FlowModel } from "../../src/flow/flow-model.js"

interface FindingSpec {
  code: string
  severity?: string
  message?: string
  evidence?: { model: string; id: string }[]
  file?: string | null
}

function findings(...specs: FindingSpec[]): FindingModel {
  return {
    schemaVersion: 1,
    findings: specs.map((spec) => ({
      code: spec.code,
      severity: spec.severity ?? "warning",
      message: spec.message ?? `message ${spec.code}`,
      ...(spec.evidence === undefined ? {} : { evidence: spec.evidence }),
      location:
        spec.file === null || spec.file === undefined
          ? { kind: "none" }
          : { kind: "capability", capability: { file: spec.file, exportName: "x" } },
    })),
  } as unknown as FindingModel
}

interface EdgeSpec {
  id: string
  kind?: string
  status?: string
  path?: string[]
  source?: { file: string; line: number; column: number }
}

function flow(
  parts: {
    edges?: EdgeSpec[]
    unknowns?: { id: string; source: { file: string; line: number; column: number } }[]
    nodes?: {
      id: string
      scope: string
      source?: { line: number; column: number }
    }[]
  } = {},
): FlowModel {
  return {
    edges: (parts.edges ?? []).map((e) => ({ kind: "read", status: "static", ...e })),
    unknowns: parts.unknowns ?? [],
    nodes: parts.nodes ?? [],
  } as unknown as FlowModel
}

const src = (file: string, line: number, column: number) => ({ file, line, column })
const ref = (id: string, model = "flow") => ({ model, id })

function resultOf(finding: FindingSpec, model: FlowModel | undefined) {
  const log = buildSarifLog(findings(finding), model === undefined ? {} : { flow: model })
  const [run] = log.runs
  return run?.results[0]
}

describe("buildSarifLog: log structure", () => {
  it("emits the exact envelope, sorted unique rule ids, mapped levels and coarse locations", () => {
    const log = buildSarifLog(
      findings(
        { code: "B_CODE", severity: "info", file: "a.ts", message: "m1" },
        { code: "A_CODE", severity: "error", file: null, message: "m2" },
        { code: "B_CODE", severity: "warning", file: "b.ts", message: "m3" },
      ),
    )
    expect(log).toEqual({
      $schema:
        "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "data-cap",
              informationUri: "https://github.com/maverickcer/data-cap#readme",
              version: PACKAGE_VERSION,
              rules: [{ id: "A_CODE" }, { id: "B_CODE" }],
            },
          },
          results: [
            {
              ruleId: "B_CODE",
              level: "note",
              message: { text: "m1" },
              locations: [{ physicalLocation: { artifactLocation: { uri: "a.ts" } } }],
            },
            { ruleId: "A_CODE", level: "error", message: { text: "m2" } },
            {
              ruleId: "B_CODE",
              level: "warning",
              message: { text: "m3" },
              locations: [{ physicalLocation: { artifactLocation: { uri: "b.ts" } } }],
            },
          ],
        },
      ],
    })
    const [result] = log.runs[0]?.results ?? []
    expect("codeFlows" in (result ?? {})).toBe(false)
  })

  it("maps every severity", () => {
    for (const [severity, level] of [
      ["info", "note"],
      ["warning", "warning"],
      ["error", "error"],
    ] as const) {
      expect(resultOf({ code: "C", severity }, undefined)?.level).toBe(level)
    }
  })
})

describe("buildSarifLog: flow evidence", () => {
  it("anchors at an edge's source and renders its steps", () => {
    const model = flow({
      edges: [
        { id: "e1", kind: "read", source: src("a.ts", 3, 4) },
        { id: "e2", kind: "pass", path: [], source: src("b.ts", 5, 6) },
        { id: "e3", kind: "send", path: ["x", "y"], status: "inferred", source: src("c.ts", 7, 8) },
        { id: "e4", kind: "return", path: ["z"], status: "declared", source: src("d.ts", 9, 1) },
      ],
    })
    const result = resultOf(
      { code: "C", file: "coarse.ts", evidence: [ref("e1"), ref("e2"), ref("e3"), ref("e4")] },
      model,
    )
    expect(result).toEqual({
      ruleId: "C",
      level: "warning",
      message: { text: "message C" },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "d.ts", uriBaseId: "%SRCROOT%" },
            region: { startLine: 9, startColumn: 1 },
          },
        },
      ],
      codeFlows: [
        {
          threadFlows: [
            {
              locations: [
                {
                  location: {
                    physicalLocation: {
                      artifactLocation: { uri: "a.ts", uriBaseId: "%SRCROOT%" },
                      region: { startLine: 3, startColumn: 4 },
                    },
                    message: { text: "read" },
                  },
                },
                {
                  location: {
                    physicalLocation: {
                      artifactLocation: { uri: "b.ts", uriBaseId: "%SRCROOT%" },
                      region: { startLine: 5, startColumn: 6 },
                    },
                    message: { text: "pass (whole)" },
                  },
                },
                {
                  location: {
                    physicalLocation: {
                      artifactLocation: { uri: "c.ts", uriBaseId: "%SRCROOT%" },
                      region: { startLine: 7, startColumn: 8 },
                    },
                    message: { text: "send x.y [inferred]" },
                  },
                },
                {
                  location: {
                    physicalLocation: {
                      artifactLocation: { uri: "d.ts", uriBaseId: "%SRCROOT%" },
                      region: { startLine: 9, startColumn: 1 },
                    },
                    message: { text: "return z [declared]" },
                  },
                },
              ],
            },
          ],
        },
      ],
    })
  })

  it("an edge without a source contributes nothing and does not fall through to a node of the same id", () => {
    const model = flow({
      edges: [{ id: "same", kind: "read" }],
      nodes: [{ id: "same", scope: "n.ts", source: { line: 1, column: 1 } }],
      unknowns: [{ id: "same", source: src("u.ts", 2, 2) }],
    })
    const result = resultOf({ code: "C", file: "coarse.ts", evidence: [ref("same")] }, model)
    expect(result?.locations).toEqual([
      { physicalLocation: { artifactLocation: { uri: "coarse.ts" } } },
    ])
    expect(result && "codeFlows" in result).toBe(false)
  })

  it("an edge with a source is not overridden by an unknown or node sharing its id", () => {
    const model = flow({
      edges: [{ id: "same", kind: "read", source: src("e.ts", 1, 2) }],
      nodes: [{ id: "same", scope: "n.ts", source: { line: 5, column: 5 } }],
      unknowns: [{ id: "same", source: src("u.ts", 2, 2) }],
    })
    const result = resultOf({ code: "C", evidence: [ref("same")] }, model)
    expect(result?.locations?.[0]?.physicalLocation.artifactLocation.uri).toBe("e.ts")
  })

  it("an unknown anchors the finding with no code flow", () => {
    const model = flow({
      unknowns: [{ id: "u1", source: src("u.ts", 2, 3) }],
      nodes: [{ id: "u1", scope: "n.ts", source: { line: 9, column: 9 } }],
    })
    const result = resultOf({ code: "C", file: "coarse.ts", evidence: [ref("u1")] }, model)
    expect(result?.locations).toEqual([
      {
        physicalLocation: {
          artifactLocation: { uri: "u.ts", uriBaseId: "%SRCROOT%" },
          region: { startLine: 2, startColumn: 3 },
        },
      },
    ])
    expect(result && "codeFlows" in result).toBe(false)
  })

  it("a node anchors using its scope, only when nothing earlier anchored it; a later edge or unknown wins", () => {
    const model = flow({
      nodes: [
        { id: "n1", scope: "one.ts", source: { line: 1, column: 2 } },
        { id: "n2", scope: "two.ts", source: { line: 3, column: 4 } },
        { id: "bare", scope: "bare.ts" },
      ],
      edges: [{ id: "e", kind: "read", source: src("e.ts", 7, 7) }],
      unknowns: [{ id: "u", source: src("u.ts", 8, 8) }],
    })
    const uriOf = (ids: string[]) =>
      resultOf({ code: "C", evidence: ids.map((id) => ref(id)) }, model)?.locations?.[0]
        ?.physicalLocation
    expect(uriOf(["n1", "n2"])).toEqual({
      artifactLocation: { uri: "one.ts", uriBaseId: "%SRCROOT%" },
      region: { startLine: 1, startColumn: 2 },
    })
    expect(uriOf(["n1", "e"])?.artifactLocation.uri).toBe("e.ts")
    expect(uriOf(["n1", "u"])?.artifactLocation.uri).toBe("u.ts")
    expect(uriOf(["bare", "n2"])?.artifactLocation.uri).toBe("two.ts")
    const bareOnly = resultOf({ code: "C", file: "c.ts", evidence: [ref("bare")] }, model)
    expect(bareOnly?.locations?.[0]?.physicalLocation.artifactLocation.uri).toBe("c.ts")
  })

  it("ignores references to other models even when the id matches a flow record", () => {
    const model = flow({ edges: [{ id: "e", kind: "read", source: src("e.ts", 1, 1) }] })
    const result = resultOf(
      { code: "C", file: "coarse.ts", evidence: [ref("e", "policy"), ref("e", "claims")] },
      model,
    )
    expect(result?.locations).toEqual([
      { physicalLocation: { artifactLocation: { uri: "coarse.ts" } } },
    ])
    expect(result && "codeFlows" in result).toBe(false)
  })

  it("keeps the coarse location when the finding has no evidence, or no flow is supplied, or nothing resolves", () => {
    const model = flow({ edges: [{ id: "e", kind: "read", source: src("e.ts", 1, 1) }] })
    const coarse = [{ physicalLocation: { artifactLocation: { uri: "coarse.ts" } } }]
    expect(resultOf({ code: "C", file: "coarse.ts" }, model)?.locations).toEqual(coarse)
    expect(
      resultOf({ code: "C", file: "coarse.ts", evidence: [ref("e")] }, undefined)?.locations,
    ).toEqual(coarse)
    expect(
      resultOf({ code: "C", file: "coarse.ts", evidence: [ref("missing")] }, model)?.locations,
    ).toEqual(coarse)
    expect(resultOf({ code: "C", file: null, evidence: [ref("missing")] }, model)).toEqual({
      ruleId: "C",
      level: "warning",
      message: { text: "message C" },
    })
    expect(resultOf({ code: "C", file: "coarse.ts", evidence: [] }, model)?.locations).toEqual(
      coarse,
    )
  })

  it("uses an empty flow model without failing", () => {
    expect(
      resultOf({ code: "C", file: "c.ts", evidence: [ref("e")] }, flow())?.locations,
    ).toHaveLength(1)
  })
})
