import { describe, expect, it } from "vitest"
import {
  buildObservationModel,
  OBSERVATION_MODEL_SCHEMA_VERSION,
} from "../../src/flow/observation-model.js"
import type { ObservationEvent } from "../../src/observe/index.js"

const event = (overrides: Partial<ObservationEvent> = {}): ObservationEvent => ({
  scope: "test:profile",
  boundary: { kind: "client-response", name: "http-response" },
  field: "userData.user.email",
  ...overrides,
})

describe("buildObservationModel", () => {
  it("stamps the schema version", () => {
    expect(buildObservationModel([]).schemaVersion).toBe(OBSERVATION_MODEL_SCHEMA_VERSION)
  })

  it("is empty for no events, with no scopes", () => {
    const model = buildObservationModel([])
    expect(model.observations).toEqual([])
    expect(model.scopes).toEqual([])
  })

  it("aggregates identical events into one observation with a count", () => {
    const model = buildObservationModel([event(), event(), event()])
    expect(model.observations).toHaveLength(1)
    expect(model.observations[0]).toMatchObject({ count: 3, status: "observed" })
  })

  it("keeps events from different scopes, boundaries, fields or handling apart", () => {
    const model = buildObservationModel([
      event(),
      event({ scope: "test:other" }),
      event({ boundary: { kind: "database", name: "pg" } }),
      event({ field: "userData.user.name" }),
      event({ handling: "masked" }),
    ])
    expect(model.observations).toHaveLength(5)
  })

  it("assigns a content-addressed id", () => {
    const model = buildObservationModel([event({ handling: "masked" })])
    expect(model.observations[0]?.id).toBe(
      "observation:test:profile|client-response:http-response|userData.user.email|masked",
    )
  })

  it("uses a dash for absent handling in the id", () => {
    expect(buildObservationModel([event()]).observations[0]?.id).toBe(
      "observation:test:profile|client-response:http-response|userData.user.email|-",
    )
  })

  it("lists each scope once, sorted", () => {
    const model = buildObservationModel([
      event({ scope: "b" }),
      event({ scope: "a" }),
      event({ scope: "b" }),
    ])
    expect(model.scopes).toEqual(["a", "b"])
  })

  it("is deterministic regardless of event order", () => {
    const events = [event({ scope: "b" }), event({ scope: "a" }), event({ field: "x.y" })]
    expect(buildObservationModel([...events].reverse())).toEqual(buildObservationModel(events))
  })

  it("drops every key outside the event shape, so a smuggled value is never stored", () => {
    const smuggled = { ...event(), value: "secret@example.com", payload: { email: "x@y.z" } }
    const model = buildObservationModel([smuggled])
    expect(JSON.stringify(model)).not.toContain("secret@example.com")
    expect(JSON.stringify(model)).not.toContain("x@y.z")
    expect(Object.keys(model.observations[0] ?? {}).sort()).toEqual(
      ["boundary", "count", "field", "id", "scope", "status"].sort(),
    )
  })

  it("skips malformed events instead of throwing, and reports how many it skipped", () => {
    const model = buildObservationModel([
      event(),
      { scope: "", boundary: { kind: "api", name: "x" }, field: "a.b" },
      { scope: "s", boundary: { kind: "api", name: "" }, field: "a.b" },
      { scope: "s", boundary: { kind: "api", name: "x" }, field: "" },
      null as never,
      "nope" as never,
    ])
    expect(model.observations).toHaveLength(1)
    expect(model.skipped).toBe(5)
  })

  it("reports zero skipped for clean input", () => {
    expect(buildObservationModel([event()]).skipped).toBe(0)
  })

  it("ignores an unrecognised handling rather than storing it", () => {
    const model = buildObservationModel([{ ...event(), handling: "rot13" as never }])
    expect(model.observations[0]).not.toHaveProperty("handling")
  })
})
