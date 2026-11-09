import { describe, expect, it } from "vitest"
import { evidenceOptionsKey } from "../../src/build/evidence-fingerprint.js"

const boundary = (kind: string, name: string) => ({ kind, name })

describe("evidenceOptionsKey: exact keys", () => {
  it("is undefined when nothing is set, or flow evidence is off", () => {
    expect(evidenceOptionsKey({})).toBeUndefined()
    expect(evidenceOptionsKey({ flowEvidence: false })).toBeUndefined()
    expect(
      evidenceOptionsKey({
        flowSinks: [{ callee: "log", boundary: boundary("log", "console") }],
      }),
    ).toBeUndefined()
  })

  it("keys flow evidence alone, and flow with sinks", () => {
    expect(evidenceOptionsKey({ flowEvidence: true })).toBe('{"flow":true}')
    expect(evidenceOptionsKey({ flowEvidence: true, flowSinks: [] })).toBe(
      '{"flow":true,"sinks":[]}',
    )
  })

  it("lists each sink as callee, kind, name and handling, defaulting handling to the empty string", () => {
    expect(
      evidenceOptionsKey({
        flowEvidence: true,
        flowSinks: [
          { callee: "a.send", boundary: boundary("api", "svc") },
          { callee: "b.write", boundary: boundary("log", "out"), handling: "hashed" },
        ],
      }),
    ).toBe('{"flow":true,"sinks":[["a.send","api","svc",""],["b.write","log","out","hashed"]]}')
  })

  it("keys observations as sorted, NUL-joined tuples with handling defaulting to empty", () => {
    const key = evidenceOptionsKey({
      observations: [
        { scope: "s2", boundary: boundary("api", "x"), field: "f.b" },
        { scope: "s1", boundary: boundary("log", "y"), field: "f.a", handling: "masked" },
      ],
    })
    expect(key).toBe(
      JSON.stringify({
        observations: [
          "s1\u0000log\u0000y\u0000f.a\u0000masked",
          "s2\u0000api\u0000x\u0000f.b\u0000",
        ],
      }),
    )
  })

  it("is independent of observation order, and an empty list still changes the key", () => {
    const a = { scope: "s", boundary: boundary("api", "x"), field: "a" }
    const b = { scope: "s", boundary: boundary("api", "x"), field: "b" }
    expect(evidenceOptionsKey({ observations: [a, b] })).toBe(
      evidenceOptionsKey({ observations: [b, a] }),
    )
    expect(evidenceOptionsKey({ observations: [] })).toBe('{"observations":[]}')
  })

  it("combines flow, sinks and observations in that order", () => {
    expect(
      evidenceOptionsKey({
        flowEvidence: true,
        flowSinks: [{ callee: "c", boundary: boundary("k", "n") }],
        observations: [{ scope: "s", boundary: boundary("k", "n"), field: "f", handling: "h" }],
      }),
    ).toBe(
      JSON.stringify({
        flow: true,
        sinks: [["c", "k", "n", ""]],
        observations: ["s\u0000k\u0000n\u0000f\u0000h"],
      }),
    )
  })
})
