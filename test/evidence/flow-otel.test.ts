import { describe, expect, it } from "vitest"
import { buildObservationModel } from "../../src/flow/observation-model.js"
import { observationsFromOtlp, observationsToOtlp } from "../../src/evidence/flow-otel.js"
import type { OtlpTraces } from "../../src/evidence/flow-otel.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const provenance = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  toolVersion: "9.9.9",
  commit: undefined,
}
const events: ObservationEvent[] = [
  {
    scope: "test:profile",
    boundary: { kind: "client-response", name: "http-response" },
    field: "userData.user.email",
  },
  {
    scope: "test:profile",
    boundary: { kind: "client-response", name: "http-response" },
    field: "userData.user.email",
  },
  {
    scope: "test:profile",
    boundary: { kind: "database", name: "postgres:users" },
    field: "userData.user.id",
    handling: "hashed",
  },
  { scope: "test:other", boundary: { kind: "log", name: "console" }, field: "userData.user.name" },
]
const observation = buildObservationModel(events)

type Span = OtlpTraces["resourceSpans"][number]["scopeSpans"][number]["spans"][number]
const attr = (span: Span, key: string) => span.attributes.find((a) => a.key === key)?.value
/** The string value of an attribute, or undefined when it is absent or not a string. */
const text = (span: Span, key: string): string | undefined => {
  const value = attr(span, key)
  return value !== undefined && "stringValue" in value ? value.stringValue : undefined
}

describe("observationsToOtlp", () => {
  const traces = observationsToOtlp({ observation, provenance })!
  const spans = traces.resourceSpans[0]!.scopeSpans[0]!.spans

  it("produces one span per aggregated observation under data-cap's instrumentation scope", () => {
    expect(spans).toHaveLength(observation.observations.length)
    expect(traces.resourceSpans[0]!.scopeSpans[0]!.scope).toEqual({
      name: "data-cap",
      version: "9.9.9",
    })
  })

  it("names the service, defaulting sensibly and accepting a name", () => {
    const service = (t: OtlpTraces) =>
      t.resourceSpans[0]!.resource.attributes.find((a) => a.key === "service.name")?.value
    expect(service(traces)).toEqual({ stringValue: "data-cap" })
    expect(
      service(observationsToOtlp({ observation, provenance }, { serviceName: "checkout" })!),
    ).toEqual({ stringValue: "checkout" })
  })

  it("carries the field, boundary, scope, handling and count as data_cap.* attributes", () => {
    const email = spans.find((span) => text(span, "data_cap.field") === "userData.user.email")!
    expect(attr(email, "data_cap.boundary.kind")).toEqual({ stringValue: "client-response" })
    expect(attr(email, "data_cap.boundary.name")).toEqual({ stringValue: "http-response" })
    expect(attr(email, "data_cap.scope")).toEqual({ stringValue: "test:profile" })
    expect(attr(email, "data_cap.count")).toEqual({ intValue: "2" })
    expect(attr(email, "data_cap.handling")).toBeUndefined()
    const id = spans.find((span) => text(span, "data_cap.field") === "userData.user.id")!
    expect(attr(id, "data_cap.handling")).toEqual({ stringValue: "hashed" })
  })

  it("is valid OTLP/JSON: hex ids of the right length, an internal span kind, string nanosecond times", () => {
    for (const span of spans) {
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
      expect(span.kind).toBe(1)
      expect(span.name).toBe("data-cap.boundary.crossing")
      expect(span.startTimeUnixNano).toBe("1767225600000000000")
      expect(span.endTimeUnixNano).toBe("1767225600000000000")
      expect(span.status).toEqual({ code: 1 })
    }
    expect(new Set(spans.map((s) => s.spanId)).size).toBe(spans.length)
  })

  it("puts spans of one scope in one trace and different scopes in different traces", () => {
    const trace = (scope: string) =>
      new Set(spans.filter((s) => text(s, "data_cap.scope") === scope).map((s) => s.traceId))
    expect(trace("test:profile").size).toBe(1)
    expect(trace("test:other").size).toBe(1)
    expect([...trace("test:profile")][0]).not.toBe([...trace("test:other")][0])
  })

  it("lists attributes in a stable order and is deterministic", () => {
    for (const span of spans) {
      const keys = span.attributes.map((a) => a.key)
      expect(keys).toEqual([...keys].sort())
    }
    expect(observationsToOtlp({ observation, provenance })).toEqual(traces)
  })

  it("returns undefined when observations were not ingested, and an empty payload for none observed", () => {
    expect(observationsToOtlp({ observation: undefined, provenance })).toBeUndefined()
    const none = observationsToOtlp({ observation: buildObservationModel([]), provenance })!
    expect(none.resourceSpans[0]!.scopeSpans[0]!.spans).toEqual([])
  })

  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(traces))).toEqual(traces)
  })
})

describe("observationsFromOtlp", () => {
  const traces = observationsToOtlp({ observation, provenance })!

  it("round-trips: what was emitted is read back as the same aggregated observations", () => {
    const { events: back, skipped } = observationsFromOtlp(traces)
    expect(skipped).toBe(0)
    expect(buildObservationModel(back)).toEqual(observation)
  })

  it("reads data_cap.* attributes off a service's own spans, and ignores spans that carry none", () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "ab".repeat(16),
                  name: "GET /profile",
                  attributes: [{ key: "http.method", value: { stringValue: "GET" } }],
                },
                {
                  traceId: "cd".repeat(16),
                  name: "serialize",
                  attributes: [
                    { key: "data_cap.field", value: { stringValue: "userData.user.email" } },
                    { key: "data_cap.boundary.kind", value: { stringValue: "client-response" } },
                    { key: "data_cap.boundary.name", value: { stringValue: "http-response" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const { events: read, skipped } = observationsFromOtlp(payload)
    expect(skipped).toBe(0)
    // No data_cap.scope: the trace is the execution, so it is the scope.
    expect(read).toEqual([
      {
        scope: "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData.user.email",
      },
    ])
  })

  it("counts a span with some but not all required attributes as skipped, never guessing the rest", () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "ab".repeat(16),
                  attributes: [{ key: "data_cap.field", value: { stringValue: "a.b" } }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(observationsFromOtlp(payload)).toEqual({ events: [], skipped: 1 })
  })

  it("skips a span whose boundary kind is not one data-cap knows", () => {
    const span = (kind: string) => ({
      traceId: "ab".repeat(16),
      attributes: [
        { key: "data_cap.field", value: { stringValue: "a.b" } },
        { key: "data_cap.boundary.kind", value: { stringValue: kind } },
        { key: "data_cap.boundary.name", value: { stringValue: "x" } },
      ],
    })
    expect(
      observationsFromOtlp({ resourceSpans: [{ scopeSpans: [{ spans: [span("moon")] }] }] }),
    ).toEqual({ events: [], skipped: 1 })
    expect(
      observationsFromOtlp({ resourceSpans: [{ scopeSpans: [{ spans: [span("api")] }] }] }).events,
    ).toHaveLength(1)
  })

  it("accepts a count as a number or a decimal string, and bounds how many events one span can expand to", () => {
    const span = (count: unknown) => ({
      traceId: "ab".repeat(16),
      attributes: [
        { key: "data_cap.field", value: { stringValue: "a.b" } },
        { key: "data_cap.boundary.kind", value: { stringValue: "api" } },
        { key: "data_cap.boundary.name", value: { stringValue: "x" } },
        { key: "data_cap.count", value: count },
      ],
    })
    const read = (count: unknown, options?: { maxEventsPerSpan?: number }) =>
      observationsFromOtlp({ resourceSpans: [{ scopeSpans: [{ spans: [span(count)] }] }] }, options)
        .events.length
    expect(read({ intValue: "3" })).toBe(3)
    expect(read({ intValue: 4 })).toBe(4)
    expect(read({ intValue: "-2" })).toBe(1)
    expect(read({ stringValue: "nope" })).toBe(1)
    expect(read({ intValue: "999999999" })).toBe(10_000)
    expect(read({ intValue: "999999999" }, { maxEventsPerSpan: 5 })).toBe(5)
  })

  it("treats anything that is not an OTLP traces payload as one skipped item, without throwing", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { resourceSpans: "no" }]) {
      expect(() => observationsFromOtlp(bad)).not.toThrow()
    }
    expect(observationsFromOtlp(null)).toEqual({ events: [], skipped: 1 })
    expect(observationsFromOtlp({ resourceSpans: [] })).toEqual({ events: [], skipped: 0 })
  })

  it("never reads a value out of a span: only the documented attributes", () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "ab".repeat(16),
                  attributes: [
                    { key: "data_cap.field", value: { stringValue: "a.b" } },
                    { key: "data_cap.boundary.kind", value: { stringValue: "api" } },
                    { key: "data_cap.boundary.name", value: { stringValue: "x" } },
                    { key: "user.email", value: { stringValue: "secret@example.com" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(JSON.stringify(observationsFromOtlp(payload))).not.toContain("secret@example.com")
  })
})

describe("observationsToOtlp, with times and scope roots", () => {
  const timedEvents: ObservationEvent[] = [
    {
      scope: "s1",
      boundary: { kind: "log", name: "audit" },
      field: "userData.user.email",
      at: 1000,
    },
    {
      scope: "s1",
      boundary: { kind: "log", name: "audit" },
      field: "userData.user.email",
      at: 5000,
    },
    { scope: "s2", boundary: { kind: "database", name: "db" }, field: "userData.user.id" },
  ]
  const timed = buildObservationModel(timedEvents)

  it("emits exactly the root and observation spans, with the times and statuses of each", () => {
    const traces = observationsToOtlp({ observation: timed, provenance }, { scopeRoots: true })!
    expect(traces.resourceSpans[0]!.scopeSpans[0]!.spans).toMatchInlineSnapshot(`
      [
        {
          "attributes": [
            {
              "key": "data_cap.scope",
              "value": {
                "stringValue": "s1",
              },
            },
            {
              "key": "data_cap.scope.root",
              "value": {
                "stringValue": "true",
              },
            },
            {
              "key": "data_cap.timed",
              "value": {
                "stringValue": "true",
              },
            },
          ],
          "endTimeUnixNano": "5000000000",
          "kind": 1,
          "name": "data-cap.scope",
          "spanId": "3826a5b9ac9250c3",
          "startTimeUnixNano": "1000000000",
          "status": {
            "code": 1,
          },
          "traceId": "a2ae59ee17915464b98d7d2a31604a6f",
        },
        {
          "attributes": [
            {
              "key": "data_cap.scope",
              "value": {
                "stringValue": "s2",
              },
            },
            {
              "key": "data_cap.scope.root",
              "value": {
                "stringValue": "true",
              },
            },
          ],
          "endTimeUnixNano": "1767225600000000000",
          "kind": 1,
          "name": "data-cap.scope",
          "spanId": "019ed799c55959ae",
          "startTimeUnixNano": "1767225600000000000",
          "status": {
            "code": 1,
          },
          "traceId": "50028a566cd6539f872d1924d91661ce",
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
                "stringValue": "audit",
              },
            },
            {
              "key": "data_cap.count",
              "value": {
                "intValue": "2",
              },
            },
            {
              "key": "data_cap.field",
              "value": {
                "stringValue": "userData.user.email",
              },
            },
            {
              "key": "data_cap.scope",
              "value": {
                "stringValue": "s1",
              },
            },
            {
              "key": "data_cap.timed",
              "value": {
                "stringValue": "true",
              },
            },
          ],
          "endTimeUnixNano": "5000000000",
          "kind": 1,
          "name": "data-cap.boundary.crossing",
          "parentSpanId": "3826a5b9ac9250c3",
          "spanId": "ca162d4155c4549b",
          "startTimeUnixNano": "1000000000",
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
                "intValue": "1",
              },
            },
            {
              "key": "data_cap.field",
              "value": {
                "stringValue": "userData.user.id",
              },
            },
            {
              "key": "data_cap.scope",
              "value": {
                "stringValue": "s2",
              },
            },
          ],
          "endTimeUnixNano": "1767225600000000000",
          "kind": 1,
          "name": "data-cap.boundary.crossing",
          "parentSpanId": "019ed799c55959ae",
          "spanId": "c9044fc62c915197",
          "startTimeUnixNano": "1767225600000000000",
          "status": {
            "code": 1,
          },
          "traceId": "50028a566cd6539f872d1924d91661ce",
        },
      ]
    `)
  })

  it("does not call an observation timed when only one end of its time is known", () => {
    const [first] = timed.observations
    const half = {
      ...timed,
      observations: [
        { ...first!, firstSeen: "1970-01-01T00:00:01.000Z", lastSeen: undefined },
        { ...first!, id: "other", firstSeen: undefined, lastSeen: "1970-01-01T00:00:05.000Z" },
      ],
    } as unknown as typeof timed
    const spans = observationsToOtlp({ observation: half, provenance })!.resourceSpans[0]!
      .scopeSpans[0]!.spans
    expect(spans).toHaveLength(2)
    for (const span of spans) expect(attr(span, "data_cap.timed")).toBeUndefined()
  })
})

describe("observationsFromOtlp, with times it cannot read", () => {
  const span = (start: string, end: string) => ({
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                startTimeUnixNano: start,
                endTimeUnixNano: end,
                attributes: [
                  { key: "data_cap.scope", value: { stringValue: "s" } },
                  { key: "data_cap.field", value: { stringValue: "userData.user.email" } },
                  { key: "data_cap.boundary.kind", value: { stringValue: "log" } },
                  { key: "data_cap.boundary.name", value: { stringValue: "audit" } },
                  { key: "data_cap.count", value: { intValue: "2" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  it("counts a time that is not wholly decimal digits as ignored and still reads the one that is", () => {
    const read = observationsFromOtlp(span("abc123", "5000000"), { trustForeignTimes: true })
    expect(read.ignoredTimes).toBe(1)
    expect(read.events.map((event) => event.at)).toEqual([undefined, 5])
  })

  it("reads two decimal times as milliseconds", () => {
    const read = observationsFromOtlp(span("2000000", "5000000"), { trustForeignTimes: true })
    expect(read.ignoredTimes).toBeUndefined()
    expect(read.events.map((event) => event.at)).toEqual([2, 5])
  })
})
