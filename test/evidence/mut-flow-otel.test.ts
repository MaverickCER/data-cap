import { describe, expect, it } from "vitest"
import { flowEvidenceDisclaimer } from "../../src/evidence/flow-disclaimer.js"
import { observationsFromOtlp, observationsToOtlp } from "../../src/evidence/flow-otel.js"
import type { OtlpInput } from "../../src/evidence/flow-otel.js"
import type { ObservationModel } from "../../src/flow/observation-model.js"

const PROVENANCE = { generatedAt: "2026-01-02T03:04:05.678Z", toolVersion: "1.2.3", commit: "c" }

function input(): OtlpInput {
  const observation: ObservationModel = {
    schemaVersion: 1,
    scopes: ["s1", "s2"],
    skipped: 0,
    observations: [
      {
        id: "observation:s1|database:db|a.b|hashed",
        scope: "s1",
        boundary: { kind: "database", name: "db" },
        field: "a.b",
        handling: "hashed",
        count: 7,
        status: "observed",
      },
      {
        id: "observation:s2|log:out|a.c|-",
        scope: "s2",
        boundary: { kind: "log", name: "out" },
        field: "a.c",
        count: 1,
        status: "observed",
      },
    ],
  }
  return { observation, provenance: PROVENANCE }
}

describe("observationsToOtlp exact output", () => {
  it("returns undefined without an observation model", () => {
    expect(observationsToOtlp({ observation: undefined, provenance: PROVENANCE })).toBeUndefined()
  })

  it("emits the full payload with attributes in key order", () => {
    expect(observationsToOtlp(input())).toMatchInlineSnapshot(`
      {
        "resourceSpans": [
          {
            "resource": {
              "attributes": [
                {
                  "key": "service.name",
                  "value": {
                    "stringValue": "data-cap",
                  },
                },
                {
                  "key": "data_cap.disclaimer",
                  "value": {
                    "stringValue": "Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.",
                  },
                },
              ],
            },
            "scopeSpans": [
              {
                "scope": {
                  "name": "data-cap",
                  "version": "1.2.3",
                },
                "spans": [
                  {
                    "attributes": [
                      {
                        "key": "data_cap.boundary.kind",
                        "value": {
                          "stringValue": "database",
                        },
                      },
                      {
                        "key": "data_cap.boundary.name",
                        "value": {
                          "stringValue": "db",
                        },
                      },
                      {
                        "key": "data_cap.count",
                        "value": {
                          "intValue": "7",
                        },
                      },
                      {
                        "key": "data_cap.field",
                        "value": {
                          "stringValue": "a.b",
                        },
                      },
                      {
                        "key": "data_cap.handling",
                        "value": {
                          "stringValue": "hashed",
                        },
                      },
                      {
                        "key": "data_cap.scope",
                        "value": {
                          "stringValue": "s1",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1767323045678000000",
                    "kind": 1,
                    "name": "data-cap.boundary.crossing",
                    "spanId": "13e1d6f540a65546",
                    "startTimeUnixNano": "1767323045678000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "a2ae59ee17915464b98d7d2a31604a6f",
                  },
                  {
                    "attributes": [
                      {
                        "key": "data_cap.boundary.kind",
                        "value": {
                          "stringValue": "log",
                        },
                      },
                      {
                        "key": "data_cap.boundary.name",
                        "value": {
                          "stringValue": "out",
                        },
                      },
                      {
                        "key": "data_cap.count",
                        "value": {
                          "intValue": "1",
                        },
                      },
                      {
                        "key": "data_cap.field",
                        "value": {
                          "stringValue": "a.c",
                        },
                      },
                      {
                        "key": "data_cap.scope",
                        "value": {
                          "stringValue": "s2",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1767323045678000000",
                    "kind": 1,
                    "name": "data-cap.boundary.crossing",
                    "spanId": "bb62c616f44359c3",
                    "startTimeUnixNano": "1767323045678000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "50028a566cd6539f872d1924d91661ce",
                  },
                ],
              },
            ],
          },
        ],
      }
    `)
  })

  it("uses the supplied service name and stamps an unparseable instant as zero", () => {
    const traces = observationsToOtlp(
      { ...input(), provenance: { ...PROVENANCE, generatedAt: "not a date" } },
      { serviceName: "checkout" },
    )
    expect(traces?.resourceSpans[0]?.resource).toEqual({
      attributes: [
        { key: "service.name", value: { stringValue: "checkout" } },
        { key: "data_cap.disclaimer", value: { stringValue: flowEvidenceDisclaimer() } },
      ],
    })
    const span = traces?.resourceSpans[0]?.scopeSpans[0]?.spans[0]
    expect(span?.startTimeUnixNano).toBe("0")
    expect(span?.endTimeUnixNano).toBe("0")
  })

  it("stamps the instant in nanoseconds", () => {
    const span = observationsToOtlp(input())?.resourceSpans[0]?.scopeSpans[0]?.spans[0]
    expect(span?.startTimeUnixNano).toBe("1767323045678000000")
  })
})

type Attr = Record<string, unknown>
const s = (key: string, value: string): Attr => ({ key, value: { stringValue: value } })
function span(attributes: unknown, extra: Record<string, unknown> = {}): unknown {
  return { attributes, ...extra }
}
function payload(...spans: unknown[]): unknown {
  return { resourceSpans: [{ scopeSpans: [{ spans }] }] }
}
const GOOD = [
  s("data_cap.field", "a.b"),
  s("data_cap.boundary.kind", "database"),
  s("data_cap.boundary.name", "db"),
  s("data_cap.scope", "sc"),
]
const GOOD_EVENT = { scope: "sc", boundary: { kind: "database", name: "db" }, field: "a.b" }

describe("observationsFromOtlp exact behaviour", () => {
  it("reads a complete span into one event and nothing else", () => {
    expect(observationsFromOtlp(payload(span(GOOD)))).toStrictEqual({
      events: [GOOD_EVENT],
      skipped: 0,
    })
  })

  it("accepts exactly the five handlings and drops any other", () => {
    for (const handling of ["plaintext", "masked", "redacted", "hashed", "encrypted"]) {
      expect(
        observationsFromOtlp(payload(span([...GOOD, s("data_cap.handling", handling)]))).events,
      ).toStrictEqual([{ ...GOOD_EVENT, handling }])
    }
    for (const handling of ["weird", "", "Masked"]) {
      expect(
        observationsFromOtlp(payload(span([...GOOD, s("data_cap.handling", handling)]))),
      ).toStrictEqual({ events: [GOOD_EVENT], skipped: 0 })
    }
  })

  it("accepts every known boundary kind and rejects others", () => {
    expect(
      observationsFromOtlp(
        payload(
          span([s("data_cap.field", "f"), s("data_cap.boundary.kind", "nope"), GOOD[2], GOOD[3]]),
        ),
      ),
    ).toStrictEqual({ events: [], skipped: 1 })
  })

  it("expands count, treating anything unusable as one and capping at the maximum", () => {
    const events = (raw: unknown, options?: { maxEventsPerSpan?: number }): number =>
      observationsFromOtlp(
        payload(span([...GOOD, { key: "data_cap.count", value: { intValue: raw } }])),
        options,
      ).events.length
    expect(events("3")).toBe(3)
    expect(events(2)).toBe(2)
    expect(events("1")).toBe(1)
    expect(events(1)).toBe(1)
    expect(events("2.9")).toBe(2)
    expect(events("0.5")).toBe(1)
    expect(events("0")).toBe(1)
    expect(events(0)).toBe(1)
    expect(events("-4")).toBe(1)
    expect(events("abc")).toBe(1)
    expect(events("Infinity")).toBe(1)
    expect(events(true)).toBe(1)
    expect(events(["5"])).toBe(1)
    expect(events({ valueOf: () => 5 })).toBe(1)
    expect(events(null)).toBe(1)
    expect(events("50", { maxEventsPerSpan: 5 })).toBe(5)
    expect(events("5", { maxEventsPerSpan: 5 })).toBe(5)
    expect(events("4", { maxEventsPerSpan: 5 })).toBe(4)
    expect(events("9", { maxEventsPerSpan: 0 })).toBe(1)
    expect(events("9", { maxEventsPerSpan: -3 })).toBe(1)
    expect(events("20000")).toBe(10_000)
    expect(events("10000")).toBe(10_000)
    expect(events("9999")).toBe(9_999)
    expect(observationsFromOtlp(payload(span(GOOD))).events).toHaveLength(1)
    expect(
      observationsFromOtlp(payload(span([...GOOD, { key: "data_cap.count", value: {} }]))).events,
    ).toHaveLength(1)
  })

  it("expands every span and keeps order across resources, scopes and spans", () => {
    const named = (field: string): unknown =>
      span([s("data_cap.field", field), GOOD[1], GOOD[2], GOOD[3]])
    const result = observationsFromOtlp({
      resourceSpans: [
        { scopeSpans: [{ spans: [named("one"), named("two")] }, { spans: [named("three")] }] },
        { scopeSpans: [{ spans: [named("four")] }] },
      ],
    })
    expect(result.events.map((event) => event.field)).toEqual(["one", "two", "three", "four"])
    expect(result.skipped).toBe(0)
  })

  it("rejects payloads that are not OTLP traces", () => {
    for (const bad of [
      undefined,
      null,
      5,
      "x",
      [],
      {},
      { resourceSpans: {} },
      { resourceSpans: "x" },
    ]) {
      expect(observationsFromOtlp(bad)).toStrictEqual({ events: [], skipped: 1 })
    }
    expect(observationsFromOtlp({ resourceSpans: [] })).toStrictEqual({ events: [], skipped: 0 })
  })

  it("skips structure that is not a resource, scope or span without throwing", () => {
    const good = span(GOOD)
    const result = observationsFromOtlp({
      resourceSpans: [
        null,
        5,
        "x",
        [],
        { scopeSpans: {} },
        { scopeSpans: "abc" },
        { scopeSpans: 7 },
        {},
        {
          scopeSpans: [
            null,
            "x",
            [],
            { spans: {} },
            { spans: 7 },
            { spans: "abc" },
            {},
            { spans: [null, 5, "x", [], good] },
          ],
        },
      ],
    })
    expect(result).toStrictEqual({ events: [GOOD_EVENT], skipped: 0 })
  })

  it("ignores spans without data_cap.* attributes and counts incomplete ones as skipped", () => {
    const result = observationsFromOtlp(
      payload(
        span([s("http.method", "GET")]),
        span([]),
        {},
        span("not a list"),
        span({ key: "data_cap.field" }),
        span([s("other.data_cap.field", "x")]),
        span([s("data_cap", "x")]),
        span([s("xdata_cap.field", "x")]),
        span([s("data_cap.field", "only")]),
      ),
    )
    expect(result).toStrictEqual({ events: [], skipped: 1 })
  })

  it("recognises a data_cap.* attribute anywhere among other attributes", () => {
    const result = observationsFromOtlp(
      payload(span([s("http.method", "GET"), s("zzz", "1"), s("data_cap.other", "x")])),
    )
    expect(result).toStrictEqual({ events: [], skipped: 1 })
  })

  it("skips malformed attribute entries individually", () => {
    const junk = [
      null,
      5,
      "x",
      [],
      {},
      { key: 5, value: {} },
      { key: "data_cap.field" },
      { key: "data_cap.field", value: "x" },
      { key: "data_cap.field", value: [] },
      { key: "data_cap.field", value: null },
    ]
    expect(observationsFromOtlp(payload(span([...junk, ...GOOD])))).toStrictEqual({
      events: [GOOD_EVENT],
      skipped: 0,
    })
    expect(observationsFromOtlp(payload(span(junk)))).toStrictEqual({ events: [], skipped: 0 })
  })

  it("requires each of field, kind and name to be a non-empty string", () => {
    const without = (omit: string, replacement?: Attr): unknown =>
      span([
        ...GOOD.filter((a) => a["key"] !== omit),
        ...(replacement === undefined ? [] : [replacement]),
      ])
    for (const key of ["data_cap.field", "data_cap.boundary.kind", "data_cap.boundary.name"]) {
      expect(observationsFromOtlp(payload(without(key)))).toStrictEqual({ events: [], skipped: 1 })
      expect(observationsFromOtlp(payload(without(key, s(key, ""))))).toStrictEqual({
        events: [],
        skipped: 1,
      })
      expect(
        observationsFromOtlp(payload(without(key, { key, value: { stringValue: 5 } }))),
      ).toStrictEqual({ events: [], skipped: 1 })
      expect(
        observationsFromOtlp(payload(without(key, { key, value: { intValue: "5" } }))),
      ).toStrictEqual({ events: [], skipped: 1 })
    }
  })

  it("takes the scope from data_cap.scope, falling back to a non-empty traceId", () => {
    const noScope = GOOD.filter((a) => a["key"] !== "data_cap.scope")
    expect(
      observationsFromOtlp(payload(span(noScope, { traceId: "abc123" }))).events[0]?.scope,
    ).toBe("abc123")
    expect(observationsFromOtlp(payload(span(GOOD, { traceId: "abc123" }))).events[0]?.scope).toBe(
      "sc",
    )
    expect(
      observationsFromOtlp(payload(span([...noScope, s("data_cap.scope", "")], { traceId: "t" })))
        .events[0]?.scope,
    ).toBe("t")
    for (const traceId of [undefined, "", 5, null]) {
      expect(observationsFromOtlp(payload(span(noScope, { traceId })))).toStrictEqual({
        events: [],
        skipped: 1,
      })
    }
  })
})
