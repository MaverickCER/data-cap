import { describe, expect, it } from "vitest"
import { DataProjectGenerationError } from "../../src/build/errors.js"
import { DataCapError } from "../../src/core/errors.js"
import type { ReportFinding } from "../../src/build/findings.js"

function finding(overrides: Partial<ReportFinding> = {}): ReportFinding {
  return {
    code: "EXCLUSIVE_GROUP_CONFLICT",
    family: "structural",
    severity: "error",
    message: "boom",
    ...overrides,
  }
}

describe("DataProjectGenerationError", () => {
  it("is a coded DataCapError carrying every finding, blocking or not", () => {
    const findings = [
      finding({ code: "CAPABILITY_MISSING_OWNER", message: "a" }),
      finding({ code: "NONSTANDARD_SENSITIVITY_LEVEL", message: "b", severity: "warning" }),
    ]
    const error = new DataProjectGenerationError(findings)
    expect(error).toBeInstanceOf(DataCapError)
    expect(error.name).toBe("DataProjectGenerationError")
    expect(error.code).toBe("DATA_CAP_PROJECT_GENERATION_FAILED")
    expect(error.findings).toBe(findings)
  })

  it("renders exactly one blocking finding, singular, in the message -- non-blocking ones excluded", () => {
    const error = new DataProjectGenerationError([
      finding({ code: "EXCLUSIVE_GROUP_CONFLICT", message: "the sole blocker" }),
      finding({ code: "CAPABILITY_MISSING_OWNER", message: "just a warning", severity: "warning" }),
      finding({ code: "NONSTANDARD_SENSITIVITY_LEVEL", message: "info", severity: "info" }),
    ])
    expect(error.message).toBe(
      "1 blocking finding prevented artifact generation:\n  - [EXCLUSIVE_GROUP_CONFLICT] the sole blocker",
    )
  })

  it("renders multiple blocking findings, plural, one bullet each in declared order", () => {
    const error = new DataProjectGenerationError([
      finding({ code: "MANIFEST_EXPORT_NAME_COLLISION", message: "one" }),
      finding({ code: "CAPABILITY_MISSING_OWNER", message: "skipped", severity: "warning" }),
      finding({ code: "EXCLUSIVE_GROUP_CONFLICT", message: "two" }),
    ])
    expect(error.message).toBe(
      "2 blocking findings prevented artifact generation:\n" +
        "  - [MANIFEST_EXPORT_NAME_COLLISION] one\n" +
        "  - [EXCLUSIVE_GROUP_CONFLICT] two",
    )
  })

  it("renders zero blocking findings, plural, with no bullets", () => {
    const error = new DataProjectGenerationError([
      finding({ severity: "warning", code: "CAPABILITY_MISSING_OWNER", message: "w" }),
    ])
    expect(error.message).toBe("0 blocking findings prevented artifact generation:")
  })
})
