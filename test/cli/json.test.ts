import { describe, expect, it, vi } from "vitest"
import { buildEvidenceModel } from "../../src/build/evidence-model.js"
import type { ReportResult } from "../../src/build/index.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import { buildLifecycleModel } from "../../src/build/lifecycle-model.js"
import { serializeFailure, serializeSuccess, writeJson } from "../../src/cli/json.js"

const emptyInventory = {
  schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
  capabilities: [],
  warnings: [],
} as const

const emptyResult: ReportResult = {
  manifest: undefined,
  documentation: undefined,
  usage: undefined,
  flow: undefined,
  evidence: buildEvidenceModel(
    {
      capability: emptyInventory,
      lifecycle: buildLifecycleModel(emptyInventory, 30, new Date("2026-01-01T00:00:00.000Z")),
    },
    { generatedAt: "2026-01-01T00:00:00.000Z", toolVersion: "0.1.0", commit: undefined },
  ),
  findings: [],
  warnings: [],
  errorCount: 0,
  warningCount: 0,
  infoCount: 0,
  hasBlockingErrors: false,
}

describe("serializeSuccess", () => {
  it("wraps a ReportResult in the success envelope, with no checkResult by default", () => {
    const payload = serializeSuccess(emptyResult)
    expect(payload.ok).toBe(true)
    expect(payload.kind).toBe("data-cap-report")
    expect(payload.schemaVersion).toBe(1)
    expect(payload.checkResult).toBeUndefined()
    expect(payload.findings).toEqual([])
  })

  it("includes checkResult when provided", () => {
    const payload = serializeSuccess(emptyResult, { ok: false, stale: ["/a.ts"] })
    expect(payload.checkResult).toEqual({ ok: false, stale: ["/a.ts"] })
  })
})

describe("serializeFailure", () => {
  it("captures name/message from a real Error instance", () => {
    const payload = serializeFailure(new TypeError("boom"))
    expect(payload.ok).toBe(false)
    expect(payload.error.name).toBe("TypeError")
    expect(payload.error.message).toBe("boom")
    expect(payload.error.findings).toBeUndefined()
  })

  it("falls back to 'Error'/String(error) for a non-Error rejection value", () => {
    const payload = serializeFailure("a plain string rejection")
    expect(payload.error.name).toBe("Error")
    expect(payload.error.message).toBe("a plain string rejection")
  })

  it("surfaces .findings when the thrown value carries one (DataProjectGenerationError shape)", () => {
    const findings = [{ code: "CAPABILITY_MISSING_OWNER", severity: "warning", message: "x" }]
    const payload = serializeFailure({ findings })
    expect(payload.error.findings).toEqual(findings)
  })

  it("leaves .findings undefined when the thrown value has a non-array findings property", () => {
    const payload = serializeFailure({ findings: "not an array" })
    expect(payload.error.findings).toBeUndefined()
  })

  it.each([undefined, null, 42, "oops"])(
    "serializes the primitive/nullish rejection value %p without a findings lookup crashing",
    (value) => {
      const payload = serializeFailure(value)
      expect(payload).toEqual({
        schemaVersion: 1,
        kind: "data-cap-report",
        toolVersion: payload.toolVersion,
        ok: false,
        error: { name: "Error", message: String(value), findings: undefined },
      })
    },
  )
})

describe("writeJson", () => {
  it("writes a pretty-printed JSON payload with a trailing newline", () => {
    const writes: string[] = []
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk))
        return true
      })
    try {
      writeJson(serializeSuccess(emptyResult))
    } finally {
      spy.mockRestore()
    }
    const output = writes.join("")
    expect(output.endsWith("\n")).toBe(true)
    expect(JSON.parse(output)).toMatchObject({ ok: true, kind: "data-cap-report" })
  })
})
