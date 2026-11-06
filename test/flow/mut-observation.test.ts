import { describe, expect, it } from "vitest"
import { createMemorySink, observeBoundary } from "../../src/observe/index.js"
import type { ObservationEvent } from "../../src/observe/index.js"
import { buildObservationModel, subpathWithin } from "../../src/flow/observation-model.js"

const BOUNDARY = { kind: "client-response", name: "http-response" } as const

const event = (overrides: Record<string, unknown> = {}): ObservationEvent => ({
  scope: "s",
  boundary: BOUNDARY,
  field: "userData.user.email",
  ...overrides,
})

function named(properties: Record<string, unknown>): unknown {
  return Object.assign(function boundaryFunction() {
    return undefined
  }, properties)
}

describe("observeBoundary: input validation", () => {
  const record = (input: Record<string, unknown>) => {
    const memory = createMemorySink()
    const count = observeBoundary(memory.sink, {
      scope: "s",
      boundary: BOUNDARY,
      capability: "c",
      fields: [["a"]],
      ...input,
    })
    return { count, events: memory.events() }
  }

  it("records a valid input exactly", () => {
    expect(record({})).toEqual({
      count: 1,
      events: [
        { scope: "s", boundary: { kind: "client-response", name: "http-response" }, field: "c.a" },
      ],
    })
  })

  it("rejects a scope that is not a string, even one with a length", () => {
    expect(record({ scope: ["x"] })).toEqual({ count: 0, events: [] })
    expect(record({ scope: 5 })).toEqual({ count: 0, events: [] })
    expect(record({ scope: "" })).toEqual({ count: 0, events: [] })
  })

  it("rejects a capability that is not a string, even one with a length", () => {
    expect(record({ capability: ["x"] })).toEqual({ count: 0, events: [] })
    expect(record({ capability: "" })).toEqual({ count: 0, events: [] })
  })

  it("rejects a null boundary without throwing", () => {
    expect(record({ boundary: null })).toEqual({ count: 0, events: [] })
  })

  it("rejects an undefined boundary", () => {
    expect(record({ boundary: undefined })).toEqual({ count: 0, events: [] })
  })

  it("rejects a boundary that is a function, even one with a name", () => {
    expect(record({ boundary: named({ kind: "api" }) })).toEqual({ count: 0, events: [] })
  })

  it("rejects a boundary whose name is not a string or is empty", () => {
    expect(record({ boundary: { kind: "api", name: ["x"] } })).toEqual({ count: 0, events: [] })
    expect(record({ boundary: { kind: "api", name: "" } })).toEqual({ count: 0, events: [] })
    expect(record({ boundary: { kind: "api" } })).toEqual({ count: 0, events: [] })
  })

  it("rejects path elements that are not strings, even ones with a length", () => {
    expect(record({ fields: [[["x"]]] })).toEqual({ count: 0, events: [] })
  })
})

describe("buildObservationModel: event validation", () => {
  const build = (...events: unknown[]) => buildObservationModel(events as ObservationEvent[])

  it("keeps each recognised handling", () => {
    for (const handling of ["plaintext", "masked", "redacted", "hashed", "encrypted"] as const) {
      const [observation] = build(event({ handling })).observations
      expect(observation?.handling).toBe(handling)
      expect(observation?.id).toBe(
        `observation:s|client-response:http-response|userData.user.email|${handling}`,
      )
    }
  })

  it("drops a handling that is not a recognised string", () => {
    for (const handling of ["", "Masked", ["masked"], 1, null, { toString: () => "masked" }]) {
      const model = build(event({ handling }))
      expect(model.observations[0]).not.toHaveProperty("handling")
      expect(model.observations[0]?.id).toBe(
        "observation:s|client-response:http-response|userData.user.email|-",
      )
    }
  })

  it("skips a null boundary and a non-object event without throwing", () => {
    expect(build(event({ boundary: null }))).toMatchObject({ observations: [], skipped: 1 })
    expect(build(null, undefined, "x", 3, true)).toMatchObject({ observations: [], skipped: 5 })
  })

  it("skips a boundary that is a function, even one with kind and name", () => {
    expect(build(event({ boundary: named({ kind: "api" }) }))).toMatchObject({
      observations: [],
      skipped: 1,
    })
  })

  it("skips a boundary that is a string", () => {
    expect(build(event({ boundary: "http-response" }))).toMatchObject({ skipped: 1 })
  })

  it.each([
    ["scope", { scope: ["x"] }],
    ["field", { field: ["x"] }],
    ["kind", { boundary: { kind: ["api"], name: "n" } }],
    ["name", { boundary: { kind: "api", name: ["n"] } }],
    ["kind", { boundary: { kind: "", name: "n" } }],
    ["name", { boundary: { kind: "api", name: "" } }],
  ])("skips an event whose %s is not a non-empty string", (_what, overrides) => {
    expect(build(event(overrides))).toMatchObject({ observations: [], skipped: 1 })
  })

  it("keeps a complete valid event exactly", () => {
    expect(build(event({ handling: "hashed", extra: 1 }))).toEqual({
      schemaVersion: 1,
      scopes: ["s"],
      observations: [
        {
          id: "observation:s|client-response:http-response|userData.user.email|hashed",
          scope: "s",
          boundary: { kind: "client-response", name: "http-response" },
          field: "userData.user.email",
          handling: "hashed",
          count: 1,
          status: "observed",
        },
      ],
      skipped: 0,
    })
  })
})

describe("buildObservationModel: ordering", () => {
  it("orders observations by id and scopes by code unit, which can differ", () => {
    const model = buildObservationModel([event({ scope: "a" }), event({ scope: "a b" })])
    expect(model.observations.map((o) => o.scope)).toEqual(["a b", "a"])
    expect(model.scopes).toEqual(["a", "a b"])
  })

  it("orders observations ascending whatever the arrival order", () => {
    const fields = ["f.c", "f.a", "f.b", "f.a"]
    const model = buildObservationModel(fields.map((field) => event({ field })))
    expect(model.observations.map((o) => [o.field, o.count])).toEqual([
      ["f.a", 2],
      ["f.b", 1],
      ["f.c", 1],
    ])
    const reversed = buildObservationModel([...fields].reverse().map((field) => event({ field })))
    expect(reversed.observations.map((o) => o.field)).toEqual(["f.a", "f.b", "f.c"])
  })
})

describe("subpathWithin", () => {
  it("is the empty path for the field itself", () => {
    expect(subpathWithin("a.b", "a.b")).toEqual([])
  })
  it("is the remaining segments below the field", () => {
    expect(subpathWithin("a.b", "a.b.c.d")).toEqual(["c", "d"])
  })
  it("is undefined for a sibling that merely shares a prefix", () => {
    expect(subpathWithin("a.b", "a.bc")).toBeUndefined()
    expect(subpathWithin("a.b", "a")).toBeUndefined()
    expect(subpathWithin("a.b", "x.a.b")).toBeUndefined()
  })
})
