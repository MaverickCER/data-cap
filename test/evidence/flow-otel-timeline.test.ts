import { describe, expect, it } from "vitest"
import { observationsFromOtlp, observationsToOtlp } from "../../src/evidence/flow-otel.js"
import type { OtlpInput, OtlpTraces } from "../../src/evidence/flow-otel.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const PROVENANCE = { generatedAt: "2026-01-02T03:04:05.678Z", toolVersion: "1.2.3", commit: "c" }
const boundary = { kind: "database", name: "pg" } as const
function ev(over: Partial<ObservationEvent> = {}): ObservationEvent {
  return { scope: "s1", boundary, field: "a.b", ...over }
}
function input(events: ObservationEvent[]): OtlpInput {
  return { observation: buildObservationModel(events), provenance: PROVENANCE }
}
function spansOf(events: ObservationEvent[]) {
  return observationsToOtlp(input(events))?.resourceSpans[0]?.scopeSpans[0]?.spans ?? []
}

describe("observationsToOtlp with timestamps", () => {
  it("uses first..last seen as the span's real start and end", () => {
    const [span] = spansOf([ev({ at: 1_000 }), ev({ at: 4_500 }), ev({ at: 2_000 })])
    expect(span?.startTimeUnixNano).toBe("1000000000")
    expect(span?.endTimeUnixNano).toBe("4500000000")
  })

  it("marks timed spans with data_cap.timed, last in key order, and leaves the other attributes as before", () => {
    const [span] = spansOf([ev({ at: 1_000 })])
    expect(span?.attributes.map((a) => a.key)).toEqual([
      "data_cap.boundary.kind",
      "data_cap.boundary.name",
      "data_cap.count",
      "data_cap.field",
      "data_cap.scope",
      "data_cap.timed",
    ])
    expect(span?.attributes.at(-1)?.value).toEqual({ stringValue: "true" })
  })

  it("stays byte-identical to the summary form when no observation has a time", () => {
    const [span] = spansOf([ev(), ev()])
    expect(span?.startTimeUnixNano).toBe("1767323045678000000")
    expect(span?.endTimeUnixNano).toBe("1767323045678000000")
    expect(span?.attributes.some((a) => a.key === "data_cap.timed")).toBe(false)
  })

  it("mixes: an untimed observation keeps the generation instant while a timed one gets its own", () => {
    const spans = spansOf([ev({ at: 1_000 }), ev({ field: "a.c" })])
    const times = spans.map((s) => s.startTimeUnixNano).sort()
    expect(times).toEqual(["1000000000", "1767323045678000000"])
  })

  it("span and trace ids do not depend on time", () => {
    const timed = spansOf([ev({ at: 1_000 })])[0]
    const untimed = spansOf([ev()])[0]
    expect(timed?.spanId).toBe(untimed?.spanId)
    expect(timed?.traceId).toBe(untimed?.traceId)
  })

  it("emits nanoseconds beyond Number precision exactly", () => {
    const [span] = spansOf([ev({ at: 1_767_225_600_123 })])
    expect(span?.startTimeUnixNano).toBe("1767225600123000000")
  })
})

describe("observationsFromOtlp with timestamps", () => {
  it("round-trips first and last seen and the count", () => {
    const model = buildObservationModel([ev({ at: 1_000 }), ev({ at: 2_000 }), ev({ at: 4_500 })])
    const traces = observationsToOtlp({ observation: model, provenance: PROVENANCE })
    const read = observationsFromOtlp(traces)
    expect(read.skipped).toBe(0)
    expect(read.events).toHaveLength(3)
    const again = buildObservationModel(read.events)
    expect(again.observations).toEqual(model.observations.map((o) => ({ ...o })))
    expect(again.scopeTimes).toEqual(model.scopeTimes)
  })

  it("a single-occurrence span reads back as one event at its start", () => {
    const traces = observationsToOtlp(input([ev({ at: 1_000 })]))
    expect(observationsFromOtlp(traces).events).toEqual([ev({ at: 1_000 })])
  })

  it("does not invent times for an untimed summary span (its start is the generation instant)", () => {
    const traces = observationsToOtlp(input([ev()]))
    expect(observationsFromOtlp(traces).events).toEqual([ev()])
  })

  it("ignores the span times of a timed span whose nanos are unusable, keeping the event", () => {
    const traces = observationsToOtlp(input([ev({ at: 1_000 })]))
    const broken: OtlpTraces = JSON.parse(JSON.stringify(traces)) as OtlpTraces
    Object.assign(broken.resourceSpans[0]?.scopeSpans[0]?.spans[0] ?? {}, {
      startTimeUnixNano: "not-a-number",
      endTimeUnixNano: 12,
    })
    expect(observationsFromOtlp(broken).events).toEqual([ev()])
  })
})
