import { describe, expect, it } from "vitest"
import { evidenceOptionsKey } from "../../src/build/evidence-fingerprint.js"

const event = {
  scope: "s",
  boundary: { kind: "log", name: "console" },
  field: "u.email",
}

describe("evidenceOptionsKey: timestamps and skips change the evidence, so they change the key", () => {
  it("an event's time is part of the key (first/last seen are in the evidence)", () => {
    const untimed = evidenceOptionsKey({ observations: [event] })
    const early = evidenceOptionsKey({ observations: [{ ...event, at: 1000 }] })
    const late = evidenceOptionsKey({ observations: [{ ...event, at: 2000 }] })
    const iso = evidenceOptionsKey({ observations: [{ ...event, at: "2026-01-01T00:00:00.000Z" }] })
    expect(new Set([untimed, early, late, iso]).size).toBe(4)
  })

  it("an untimed event keeps the exact key it always had", () => {
    expect(evidenceOptionsKey({ observations: [event] })).toBe(
      `{"observations":["s\\u0000log\\u0000console\\u0000u.email\\u0000"]}`,
    )
  })

  it("skips are keyed, order-independent, and absent skips leave the key unchanged", () => {
    const skip = (field: string, reason: "dotted-key" | "max-depth") => ({
      scope: "s",
      boundary: event.boundary,
      field,
      reason,
    })
    const base = evidenceOptionsKey({ observations: [event] })
    expect(evidenceOptionsKey({ observations: [event], observationSkips: [] })).toBe(base)
    const a = evidenceOptionsKey({
      observations: [event],
      observationSkips: [skip("u.a", "dotted-key"), skip("u.b", "max-depth")],
    })
    const b = evidenceOptionsKey({
      observations: [event],
      observationSkips: [skip("u.b", "max-depth"), skip("u.a", "dotted-key")],
    })
    expect(a).toBe(b)
    expect(a).not.toBe(base)
    expect(a).toBe(
      `{"observations":["s\\u0000log\\u0000console\\u0000u.email\\u0000"],"skips":["s\\u0000log\\u0000console\\u0000u.a\\u0000dotted-key","s\\u0000log\\u0000console\\u0000u.b\\u0000max-depth"]}`,
    )
    expect(
      evidenceOptionsKey({ observations: [event], observationSkips: [skip("u.a", "max-depth")] }),
    ).not.toBe(
      evidenceOptionsKey({ observations: [event], observationSkips: [skip("u.a", "dotted-key")] }),
    )
  })
})
