import { describe, expect, it } from "vitest"
import { observationsFromOtlp, observationsToOtlp } from "../../src/evidence/flow-otel.js"
import type { OtlpInput, OtlpTraces } from "../../src/evidence/flow-otel.js"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const PROVENANCE = { generatedAt: "2026-01-02T03:04:05.678Z", toolVersion: "1.2.3", commit: "c" }
const boundary = { kind: "database", name: "pg" } as const
const ev = (over: Partial<ObservationEvent> = {}): ObservationEvent => ({
  scope: "s1",
  boundary,
  field: "a.b",
  ...over,
})
const input = (events: ObservationEvent[]): OtlpInput => ({
  observation: buildObservationModel(events),
  provenance: PROVENANCE,
})

function payload(times: Record<string, unknown>, extra: [string, string][] = []): unknown {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId: "t",
                ...times,
                attributes: [
                  { key: "data_cap.field", value: { stringValue: "a.b" } },
                  { key: "data_cap.boundary.kind", value: { stringValue: "database" } },
                  { key: "data_cap.boundary.name", value: { stringValue: "pg" } },
                  { key: "data_cap.scope", value: { stringValue: "svc" } },
                  { key: "data_cap.count", value: { intValue: "2" } },
                  ...extra.map(([key, value]) => ({ key, value: { stringValue: value } })),
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

describe("observationsFromOtlp: foreign times", () => {
  const times = { startTimeUnixNano: "1000000000", endTimeUnixNano: "4500000000" }

  it("ignores the times of a span not marked timed by default", () => {
    const read = observationsFromOtlp(payload(times))
    expect(read.events).toHaveLength(2)
    expect(read.events.every((e) => e.at === undefined)).toBe(true)
  })

  it("trustForeignTimes: false is the default behaviour", () => {
    expect(observationsFromOtlp(payload(times), { trustForeignTimes: false })).toEqual(
      observationsFromOtlp(payload(times)),
    )
  })

  it("with trustForeignTimes, start goes to the first event and end to the rest", () => {
    const read = observationsFromOtlp(payload(times), { trustForeignTimes: true })
    expect(read.events.map((e) => e.at)).toEqual([1000, 4500])
    expect(read.skipped).toBe(0)
    expect(read.ignoredTimes).toBeUndefined()
  })

  it("a single-event span gets its start time", () => {
    const one = payload(times, [])
    const spans = (
      one as { resourceSpans: { scopeSpans: { spans: { attributes: unknown[] }[] }[] }[] }
    ).resourceSpans[0]?.scopeSpans[0]?.spans[0]
    spans?.attributes.splice(4, 1)
    const read = observationsFromOtlp(one, { trustForeignTimes: true })
    expect(read.events.map((e) => e.at)).toEqual([1000])
  })

  it("still requires the data_cap.* attributes: a foreign span without them is not read", () => {
    const other = {
      resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "t", ...times, attributes: [] }] }] }],
    }
    expect(observationsFromOtlp(other, { trustForeignTimes: true })).toEqual({
      events: [],
      skipped: 0,
    })
  })

  it("counts invalid times as ignored, never throws, and keeps the events", () => {
    const bad = observationsFromOtlp(payload({ startTimeUnixNano: "12x", endTimeUnixNano: 5 }), {
      trustForeignTimes: true,
    })
    expect(bad.events).toHaveLength(2)
    expect(bad.events.every((e) => e.at === undefined)).toBe(true)
    expect(bad.ignoredTimes).toBe(2)
  })

  it("counts a missing time as ignored too, one per bad field", () => {
    const read = observationsFromOtlp(payload({ startTimeUnixNano: "1000000000" }), {
      trustForeignTimes: true,
    })
    expect(read.events.map((e) => e.at)).toEqual([1000, undefined])
    expect(read.ignoredTimes).toBe(1)
  })

  it("does not count invalid times when times are not trusted and the span is untimed", () => {
    const read = observationsFromOtlp(payload({ startTimeUnixNano: "oops" }))
    expect(read.ignoredTimes).toBeUndefined()
  })

  it("counts invalid times on spans marked timed as well", () => {
    const read = observationsFromOtlp(
      payload({ startTimeUnixNano: "oops", endTimeUnixNano: "2000000000" }, [
        ["data_cap.timed", "true"],
      ]),
    )
    expect(read.events.map((e) => e.at)).toEqual([undefined, 2000])
    expect(read.ignoredTimes).toBe(1)
  })

  it("sums ignored times across spans", () => {
    const one = payload({ startTimeUnixNano: "x", endTimeUnixNano: "y" }) as OtlpTraces
    const two = payload({ startTimeUnixNano: "z", endTimeUnixNano: "5000000000" }) as OtlpTraces
    const merged = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                ...(one.resourceSpans[0]?.scopeSpans[0]?.spans ?? []),
                ...(two.resourceSpans[0]?.scopeSpans[0]?.spans ?? []),
              ],
            },
          ],
        },
      ],
    }
    expect(observationsFromOtlp(merged, { trustForeignTimes: true }).ignoredTimes).toBe(3)
  })
})

describe("observationsToOtlp: scope roots", () => {
  const events = [
    ev({ at: 1_000 }),
    ev({ field: "a.c", at: 4_500 }),
    ev({ scope: "s2", at: 9_000 }),
  ]
  const spansOf = (traces: OtlpTraces | undefined) =>
    traces?.resourceSpans[0]?.scopeSpans[0]?.spans ?? []

  it("emits no root unless asked: the default output is unchanged", () => {
    const spans = spansOf(observationsToOtlp(input(events)))
    expect(spans).toHaveLength(3)
    expect(spans.some((s) => s.attributes.some((a) => a.key === "data_cap.scope.root"))).toBe(false)
    expect(spans.every((s) => s.parentSpanId === undefined)).toBe(true)
  })

  it("scopeRoots adds one root per scope, first, spanning the scope's first..last seen", () => {
    const spans = spansOf(observationsToOtlp(input(events), { scopeRoots: true }))
    expect(spans).toHaveLength(5)
    const roots = spans.slice(0, 2)
    expect(roots.map((s) => s.name)).toEqual(["data-cap.scope", "data-cap.scope"])
    expect(roots.map((s) => [s.startTimeUnixNano, s.endTimeUnixNano])).toEqual([
      ["1000000000", "4500000000"],
      ["9000000000", "9000000000"],
    ])
    expect(roots[0]?.attributes.map((a) => a.key)).toEqual([
      "data_cap.scope",
      "data_cap.scope.root",
      "data_cap.timed",
    ])
    expect(roots[0]?.attributes[1]?.value).toEqual({ stringValue: "true" })
  })

  it("children point at their scope's root and share its trace", () => {
    const spans = spansOf(observationsToOtlp(input(events), { scopeRoots: true }))
    const [rootS1, rootS2] = spans
    const children = spans.slice(2)
    for (const child of children) {
      const root = child.attributes.find((a) => a.key === "data_cap.scope")
      const expected =
        (root?.value as { stringValue: string }).stringValue === "s1" ? rootS1 : rootS2
      expect(child.parentSpanId).toBe(expected?.spanId)
      expect(child.traceId).toBe(expected?.traceId)
    }
    expect(rootS1?.spanId).not.toBe(rootS2?.spanId)
    expect(rootS1?.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(rootS1?.parentSpanId).toBeUndefined()
  })

  it("an untimed scope's root is stamped with the generation instant and not marked timed", () => {
    const spans = spansOf(observationsToOtlp(input([ev()]), { scopeRoots: true }))
    expect(spans[0]?.startTimeUnixNano).toBe("1767323045678000000")
    expect(spans[0]?.endTimeUnixNano).toBe("1767323045678000000")
    expect(spans[0]?.attributes.map((a) => a.key)).toEqual([
      "data_cap.scope",
      "data_cap.scope.root",
    ])
  })

  it("the reader skips roots without counting them as skipped and without events", () => {
    const traces = observationsToOtlp(input(events), { scopeRoots: true })
    const read = observationsFromOtlp(traces)
    expect(read.skipped).toBe(0)
    expect(read.events).toHaveLength(3)
  })

  it("round-trips: the model rebuilt from the events is the same with and without roots", () => {
    const plain = observationsFromOtlp(observationsToOtlp(input(events)))
    const rooted = observationsFromOtlp(observationsToOtlp(input(events), { scopeRoots: true }))
    expect(buildObservationModel([...rooted.events])).toEqual(
      buildObservationModel([...plain.events]),
    )
    expect(buildObservationModel([...rooted.events]).scopeTimes).toEqual([
      { scope: "s1", firstSeen: "1970-01-01T00:00:01.000Z", lastSeen: "1970-01-01T00:00:04.500Z" },
      { scope: "s2", firstSeen: "1970-01-01T00:00:09.000Z", lastSeen: "1970-01-01T00:00:09.000Z" },
    ])
  })

  it("a root alone (marked root but missing scope) is still not counted as skipped", () => {
    const lone = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "t",
                  attributes: [{ key: "data_cap.scope.root", value: { stringValue: "true" } }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(observationsFromOtlp(lone)).toEqual({ events: [], skipped: 0 })
  })

  it("data_cap.scope.root set to anything but true is not a root", () => {
    const notRoot = payload({}, [["data_cap.scope.root", "false"]])
    expect(observationsFromOtlp(notRoot).events).toHaveLength(2)
  })

  it("no roots when there are no observations", () => {
    expect(
      observationsToOtlp({ observation: undefined, provenance: PROVENANCE }, { scopeRoots: true }),
    ).toBeUndefined()
    expect(spansOf(observationsToOtlp(input([]), { scopeRoots: true }))).toEqual([])
  })
})
