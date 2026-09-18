import { describe, expect, it } from "vitest"
import {
  buildFindingModel,
  FINDING_MODEL_SCHEMA_VERSION,
  locationOf,
} from "../../src/build/finding-model.js"
import type { ReportFinding } from "../../src/build/findings.js"

const capabilityRef = { file: "/project/user.ts", exportName: "userCapability" }

describe("locationOf", () => {
  it("returns kind 'none' for a finding with no capability at all (e.g. MANIFEST_EXPORT_NAME_COLLISION)", () => {
    const finding: ReportFinding = {
      code: "MANIFEST_EXPORT_NAME_COLLISION",
      family: "structural",
      severity: "error",
      message: "collision",
    }
    expect(locationOf(finding)).toEqual({ kind: "none" })
  })

  it("returns kind 'capability' when only capability is set", () => {
    const finding: ReportFinding = {
      code: "CAPABILITY_MISSING_OWNER",
      family: "governance",
      severity: "warning",
      message: "no owner",
      capability: capabilityRef,
    }
    expect(locationOf(finding)).toEqual({ kind: "capability", capability: capabilityRef })
  })

  it("returns kind 'field' when capability and field are set", () => {
    const finding: ReportFinding = {
      code: "UNCONSUMED_FIELD",
      family: "usage",
      severity: "warning",
      message: "unconsumed",
      capability: capabilityRef,
      field: ["email"],
    }
    expect(locationOf(finding)).toEqual({
      kind: "field",
      capability: capabilityRef,
      field: ["email"],
    })
  })

  it("returns kind 'operation' when capability and operation are set", () => {
    const finding: ReportFinding = {
      code: "CAPABILITY_MISSING_OWNER",
      family: "governance",
      severity: "warning",
      message: "example",
      capability: capabilityRef,
      operation: "getUser",
    }
    expect(locationOf(finding)).toEqual({
      kind: "operation",
      capability: capabilityRef,
      operation: "getUser",
    })
  })

  it("carries a finding's position through onto the 'operation' location variant", () => {
    const finding: ReportFinding = {
      code: "CAPABILITY_MISSING_OWNER",
      family: "governance",
      severity: "warning",
      message: "example",
      capability: capabilityRef,
      operation: "getUser",
      position: { line: 7, column: 2 },
    }
    expect(locationOf(finding)).toEqual({
      kind: "operation",
      capability: capabilityRef,
      operation: "getUser",
      position: { line: 7, column: 2 },
    })
  })

  it("never attaches a position key to the 'operation' location variant when the finding has none", () => {
    const finding: ReportFinding = {
      code: "CAPABILITY_MISSING_OWNER",
      family: "governance",
      severity: "warning",
      message: "example",
      capability: capabilityRef,
      operation: "getUser",
    }
    expect("position" in locationOf(finding)).toBe(false)
  })

  it("never attaches a position key to the 'field' location variant when the finding has none", () => {
    const finding: ReportFinding = {
      code: "UNCONSUMED_FIELD",
      family: "usage",
      severity: "warning",
      message: "unconsumed",
      capability: capabilityRef,
      field: ["email"],
    }
    expect("position" in locationOf(finding)).toBe(false)
  })

  it("never attaches a position key to the 'capability' location variant when the finding has none", () => {
    const finding: ReportFinding = {
      code: "CAPABILITY_MISSING_OWNER",
      family: "governance",
      severity: "warning",
      message: "no owner",
      capability: capabilityRef,
    }
    expect("position" in locationOf(finding)).toBe(false)
  })

  it("carries a finding's indeterminateSites through onto the 'field' location variant", () => {
    const indeterminateSites = [{ line: 9, column: 4, file: "/project/user.ts" }]
    const finding: ReportFinding = {
      code: "UNCONSUMED_FIELD",
      family: "usage",
      severity: "warning",
      message: "unconsumed",
      capability: capabilityRef,
      field: ["email"],
      indeterminateSites,
    }
    expect(locationOf(finding)).toEqual({
      kind: "field",
      capability: capabilityRef,
      field: ["email"],
      indeterminateSites,
    })
  })

  it("never attaches an indeterminateSites key to the 'field' location variant when the finding has none", () => {
    const finding: ReportFinding = {
      code: "UNCONSUMED_FIELD",
      family: "usage",
      severity: "warning",
      message: "unconsumed",
      capability: capabilityRef,
      field: ["email"],
    }
    expect("indeterminateSites" in locationOf(finding)).toBe(false)
  })

  it("returns kind 'consumer' when capability and source are set (no field)", () => {
    const finding: ReportFinding = {
      code: "UNRESOLVED_CONSUMER",
      family: "usage",
      severity: "info",
      message: "unresolved",
      capability: capabilityRef,
      source: "/project/consumer.ts",
    }
    expect(locationOf(finding)).toEqual({
      kind: "consumer",
      capability: capabilityRef,
      source: "/project/consumer.ts",
    })
  })

  it("carries a finding's position through onto the 'capability' location variant (ADR 0052)", () => {
    const finding: ReportFinding = {
      code: "CAPABILITY_MISSING_OWNER",
      family: "governance",
      severity: "warning",
      message: "no owner",
      capability: capabilityRef,
      position: { line: 3, column: 1 },
    }
    expect(locationOf(finding)).toEqual({
      kind: "capability",
      capability: capabilityRef,
      position: { line: 3, column: 1 },
    })
  })

  it("carries a finding's position through onto the 'field' location variant", () => {
    const finding: ReportFinding = {
      code: "UNCONSUMED_FIELD",
      family: "usage",
      severity: "warning",
      message: "unconsumed",
      capability: capabilityRef,
      field: ["email"],
      position: { line: 5, column: 3 },
    }
    expect(locationOf(finding)).toEqual({
      kind: "field",
      capability: capabilityRef,
      field: ["email"],
      position: { line: 5, column: 3 },
    })
  })

  it("never attaches a position to the 'consumer' location variant, even if one is present on the finding", () => {
    // A consumer location names a consuming file, which has no single
    // declaration position the way a capability/field/operation does.
    const finding: ReportFinding = {
      code: "UNRESOLVED_CONSUMER",
      family: "usage",
      severity: "info",
      message: "unresolved",
      capability: capabilityRef,
      source: "/project/consumer.ts",
      position: { line: 5, column: 3 },
    }
    const location = locationOf(finding)
    expect(location.kind).toBe("consumer")
    expect("position" in location).toBe(false)
  })

  it("prefers 'field' over 'consumer' when both field and source happen to be set", () => {
    const finding: ReportFinding = {
      code: "UNCONSUMED_FIELD",
      family: "usage",
      severity: "warning",
      message: "example",
      capability: capabilityRef,
      field: ["email"],
      source: "/project/consumer.ts",
    }
    expect(locationOf(finding).kind).toBe("field")
  })
})

describe("buildFindingModel", () => {
  it("stamps schemaVersion and replaces every flat locator with one structured location (OUT-02)", () => {
    const finding: ReportFinding = {
      code: "CAPABILITY_MISSING_OWNER",
      family: "governance",
      severity: "warning",
      message: "no owner",
      capability: capabilityRef,
    }
    const model = buildFindingModel([finding])
    expect(model.schemaVersion).toBe(FINDING_MODEL_SCHEMA_VERSION)
    expect(model.findings).toEqual([
      {
        code: "CAPABILITY_MISSING_OWNER",
        family: "governance",
        severity: "warning",
        message: "no owner",
        location: { kind: "capability", capability: capabilityRef },
      },
    ])
  })

  it("never leaves a flat capability/field/operation/source/position/indeterminateSites alongside location", () => {
    const model = buildFindingModel([
      {
        code: "FIELD_ACCESS_INDETERMINATE",
        family: "usage",
        severity: "info",
        message: "maybe",
        capability: capabilityRef,
        field: ["email"],
        position: { line: 3, column: 5 },
        indeterminateSites: [{ file: "consumer.ts", line: 7, column: 2 }],
      },
    ])
    const [only] = model.findings
    expect(Object.keys(only!).sort()).toEqual(["code", "family", "location", "message", "severity"])
  })

  it("carries indeterminateSites through on the 'field' location variant rather than dropping it", () => {
    const sites = [{ file: "consumer.ts", line: 7, column: 2 }]
    const model = buildFindingModel([
      {
        code: "FIELD_ACCESS_INDETERMINATE",
        family: "usage",
        severity: "info",
        message: "maybe",
        capability: capabilityRef,
        field: ["email"],
        indeterminateSites: sites,
      },
    ])
    const location = model.findings[0]!.location
    expect(location.kind).toBe("field")
    expect(location.kind === "field" ? location.indeterminateSites : undefined).toEqual(sites)
  })

  it("preserves input order and count", () => {
    const findings: ReportFinding[] = [
      { code: "CAPABILITY_MISSING_OWNER", family: "governance", severity: "warning", message: "a" },
      { code: "ABANDONED_CAPABILITY", family: "usage", severity: "warning", message: "b" },
    ]
    const model = buildFindingModel(findings)
    expect(model.findings.map((f) => f.message)).toEqual(["a", "b"])
  })

  it("carries each finding's family through onto the model (NAM-12)", () => {
    const model = buildFindingModel([
      { code: "CAPABILITY_MISSING_OWNER", family: "governance", severity: "warning", message: "a" },
      { code: "ABANDONED_CAPABILITY", family: "usage", severity: "warning", message: "b" },
    ])
    expect(model.findings.map((f) => f.family)).toEqual(["governance", "usage"])
  })

  it("returns an empty findings array for no input", () => {
    expect(buildFindingModel([]).findings).toEqual([])
  })
})
