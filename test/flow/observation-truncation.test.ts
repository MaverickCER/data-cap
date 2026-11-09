import { describe, expect, it } from "vitest"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import type { ObservationEvent, ObservationSkip } from "../../src/observe/index.js"

const BOUNDARY = { kind: "client-response", name: "http-response" } as const
const ev: ObservationEvent = { scope: "s1", boundary: BOUNDARY, field: "a.b" }
const skip = (over: Partial<ObservationSkip> = {}): ObservationSkip => ({
  scope: "s1",
  boundary: BOUNDARY,
  field: "a",
  reason: "dotted-key",
  ...over,
})

describe("buildObservationModel skips", () => {
  it("has no truncation fields when none were supplied", () => {
    const model = buildObservationModel([ev])
    expect(model).not.toHaveProperty("truncations")
    expect(model).not.toHaveProperty("truncatedScopes")
    expect(buildObservationModel([ev], [])).not.toHaveProperty("truncations")
  })

  it("records a count per (scope, field, reason), sorted", () => {
    const model = buildObservationModel(
      [ev],
      [
        skip({ scope: "s2", reason: "max-depth", field: "z" }),
        skip(),
        skip(),
        skip({ reason: "cycle" }),
        skip({ field: "a.b" }),
      ],
    )
    expect(model.truncations).toEqual([
      { scope: "s1", field: "a", reason: "cycle", count: 1 },
      { scope: "s1", field: "a", reason: "dotted-key", count: 2 },
      { scope: "s1", field: "a.b", reason: "dotted-key", count: 1 },
      { scope: "s2", field: "z", reason: "max-depth", count: 1 },
    ])
    expect(model.truncatedScopes).toEqual(["s1", "s2"])
  })

  it("a scope that only had skips is truncated but has no observations", () => {
    const model = buildObservationModel([], [skip({ scope: "lonely" })])
    expect(model.scopes).toEqual([])
    expect(model.truncatedScopes).toEqual(["lonely"])
  })

  it("counts a malformed skip as skipped and drops it", () => {
    const bad: unknown[] = [
      null,
      "x",
      skip({ scope: "" }),
      skip({ field: "" }),
      skip({ reason: "because" as ObservationSkip["reason"] }),
      skip({ reason: undefined as unknown as ObservationSkip["reason"] }),
      { ...skip(), scope: 5 },
      { ...skip(), field: 5 },
    ]
    const model = buildObservationModel(
      [ev, null as unknown as ObservationEvent],
      [...(bad as ObservationSkip[]), skip()],
    )
    expect(model.skipped).toBe(1 + bad.length)
    expect(model.truncations).toEqual([{ scope: "s1", field: "a", reason: "dotted-key", count: 1 }])
  })

  it("drops any key outside the skip shape (no values can ride along)", () => {
    const smuggled = { ...skip(), value: "SECRET" } as ObservationSkip
    expect(JSON.stringify(buildObservationModel([ev], [smuggled]))).not.toContain("SECRET")
  })

  it("is deterministic regardless of skip order", () => {
    const a = skip({ scope: "s2" })
    const b = skip({ reason: "cycle" })
    expect(buildObservationModel([ev], [a, b])).toEqual(buildObservationModel([ev], [b, a]))
  })
})
