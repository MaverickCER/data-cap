import { describe, expect, it } from "vitest"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const boundary = { kind: "database", name: "pg" } as const
function event(over: Partial<ObservationEvent> & { at?: unknown } = {}): ObservationEvent {
  return { scope: "s1", boundary, field: "a.b", ...over }
}

describe("Observation Model timestamps", () => {
  it("is unchanged when no event carries a time: no first/last, no scopeTimes", () => {
    const model = buildObservationModel([event(), event()])
    expect(model).toEqual({
      schemaVersion: 1,
      scopes: ["s1"],
      skipped: 0,
      observations: [
        {
          id: "observation:s1|database:pg|a.b|-",
          scope: "s1",
          boundary,
          field: "a.b",
          count: 2,
          status: "observed",
        },
      ],
    })
    expect("scopeTimes" in model).toBe(false)
  })

  it("keeps first and last seen as ISO strings, from numbers or ISO strings, in any order", () => {
    const model = buildObservationModel([
      event({ at: 2000 }),
      event({ at: "1970-01-01T00:00:01.000Z" }),
      event({ at: 5000 }),
      event({ at: "1970-01-01T00:00:03.000+00:00" }),
    ])
    const [item] = model.observations
    expect(item?.count).toBe(4)
    expect(item?.firstSeen).toBe("1970-01-01T00:00:01.000Z")
    expect(item?.lastSeen).toBe("1970-01-01T00:00:05.000Z")
  })

  it("a single timestamp is both first and last; untimed repeats still count", () => {
    const model = buildObservationModel([event({ at: 1000 }), event()])
    expect(model.observations[0]).toMatchObject({
      count: 2,
      firstSeen: "1970-01-01T00:00:01.000Z",
      lastSeen: "1970-01-01T00:00:01.000Z",
    })
  })

  it("ignores unusable times (bad strings, NaN, infinite, out of Date range, other types) but keeps the event", () => {
    const bad: unknown[] = [
      "yesterday",
      "",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      8.64e15 + 1,
      {},
      null,
      true,
    ]
    const model = buildObservationModel(bad.map((at) => event({ at: at as never })))
    expect(model.skipped).toBe(0)
    expect(model.observations[0]?.count).toBe(bad.length)
    expect("firstSeen" in (model.observations[0] ?? {})).toBe(false)
    expect("scopeTimes" in model).toBe(false)
  })

  it("accepts the Date range extremes", () => {
    const model = buildObservationModel([event({ at: -8.64e15 }), event({ at: 8.64e15 })])
    expect(model.observations[0]?.firstSeen).toBe("-271821-04-20T00:00:00.000Z")
    expect(model.observations[0]?.lastSeen).toBe("+275760-09-13T00:00:00.000Z")
  })

  it("keeps first/last per scope, ordered by scope, only for scopes that have times", () => {
    const model = buildObservationModel([
      event({ scope: "b", at: 9000 }),
      event({ scope: "b", field: "a.c", at: 3000 }),
      event({ scope: "a", at: 7000 }),
      event({ scope: "c" }),
    ])
    expect(model.scopes).toEqual(["a", "b", "c"])
    expect(model.scopeTimes).toEqual([
      { scope: "a", firstSeen: "1970-01-01T00:00:07.000Z", lastSeen: "1970-01-01T00:00:07.000Z" },
      { scope: "b", firstSeen: "1970-01-01T00:00:03.000Z", lastSeen: "1970-01-01T00:00:09.000Z" },
    ])
  })

  it("is deterministic: event order does not change the model, and ids ignore time", () => {
    const events = [event({ at: 3000 }), event({ at: 1000 }), event({ scope: "z", at: 2000 })]
    const forward = buildObservationModel(events)
    const backward = buildObservationModel([...events].reverse())
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward))
    expect(forward.observations[0]?.id).toBe("observation:s1|database:pg|a.b|-")
  })

  it("does not let `at` smuggle anything else: only the normalised instant is kept", () => {
    const model = buildObservationModel([event({ at: "2026-01-01T00:00:00Z secret@example.com" })])
    expect(JSON.stringify(model)).not.toContain("secret")
  })
})
