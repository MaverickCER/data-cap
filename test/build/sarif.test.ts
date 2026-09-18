import { describe, expect, it } from "vitest"
import { buildSarifLog } from "../../src/build/sarif.js"
import { buildFindingModel } from "../../src/build/finding-model.js"
import type { ReportFinding } from "../../src/build/findings.js"

describe("buildSarifLog", () => {
  it("produces a SARIF 2.1.0 log with the expected top-level shape", () => {
    const log = buildSarifLog(buildFindingModel([]))
    expect(log.version).toBe("2.1.0")
    expect(log.runs).toHaveLength(1)
    expect(log.runs[0]!.tool.driver.name).toBe("data-cap")
    expect(log.runs[0]!.tool.driver.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("maps severity to SARIF level: info -> note, warning -> warning, error -> error", () => {
    const findings: ReportFinding[] = [
      {
        code: "NONSTANDARD_SENSITIVITY_LEVEL",
        family: "governance",
        severity: "info",
        message: "a",
      },
      { code: "CAPABILITY_MISSING_OWNER", family: "governance", severity: "warning", message: "b" },
      { code: "EXCLUSIVE_GROUP_CONFLICT", family: "structural", severity: "error", message: "c" },
    ]
    const log = buildSarifLog(buildFindingModel(findings))
    expect(log.runs[0]!.results.map((r) => r.level)).toEqual(["note", "warning", "error"])
  })

  it("deduplicates rule ids across findings sharing the same code", () => {
    const findings: ReportFinding[] = [
      { code: "CAPABILITY_MISSING_OWNER", family: "governance", severity: "warning", message: "a" },
      { code: "CAPABILITY_MISSING_OWNER", family: "governance", severity: "warning", message: "b" },
    ]
    const log = buildSarifLog(buildFindingModel(findings))
    expect(log.runs[0]!.tool.driver.rules).toEqual([{ id: "CAPABILITY_MISSING_OWNER" }])
    expect(log.runs[0]!.results).toHaveLength(2)
  })

  it("includes a physicalLocation for a finding with a capability, omits locations for one without", () => {
    const findings: ReportFinding[] = [
      {
        code: "CAPABILITY_MISSING_OWNER",
        family: "governance",
        severity: "warning",
        message: "a",
        capability: { file: "/project/user.ts", exportName: "userCapability" },
      },
      {
        code: "MANIFEST_EXPORT_NAME_COLLISION",
        family: "structural",
        severity: "error",
        message: "b",
      },
    ]
    const log = buildSarifLog(buildFindingModel(findings))
    expect(log.runs[0]!.results[0]!.locations).toEqual([
      { physicalLocation: { artifactLocation: { uri: "/project/user.ts" } } },
    ])
    expect(log.runs[0]!.results[1]!.locations).toBeUndefined()
    expect("locations" in log.runs[0]!.results[1]!).toBe(false)
  })

  it("pins the SARIF schema URL and the tool driver's information URI", () => {
    const log = buildSarifLog(buildFindingModel([]))
    expect(log.$schema).toBe(
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json",
    )
    expect(log.runs[0]!.tool.driver.informationUri).toBe(
      "https://github.com/maverickcer/data-cap#readme",
    )
  })

  it("sorts rule ids, regardless of the order findings first mention each code", () => {
    const findings: ReportFinding[] = [
      { code: "EXCLUSIVE_GROUP_CONFLICT", family: "structural", severity: "error", message: "a" },
      { code: "CAPABILITY_MISSING_OWNER", family: "governance", severity: "warning", message: "b" },
      {
        code: "MANIFEST_EXPORT_NAME_COLLISION",
        family: "structural",
        severity: "error",
        message: "c",
      },
    ]
    const log = buildSarifLog(buildFindingModel(findings))
    expect(log.runs[0]!.tool.driver.rules).toEqual([
      { id: "CAPABILITY_MISSING_OWNER" },
      { id: "EXCLUSIVE_GROUP_CONFLICT" },
      { id: "MANIFEST_EXPORT_NAME_COLLISION" },
    ])
  })

  it("carries the finding's own message text through unchanged", () => {
    const log = buildSarifLog(
      buildFindingModel([
        {
          code: "CAPABILITY_MISSING_OWNER",
          family: "governance",
          severity: "warning",
          message: "no owner declared",
        },
      ]),
    )
    expect(log.runs[0]!.results[0]!.message.text).toBe("no owner declared")
  })
})
