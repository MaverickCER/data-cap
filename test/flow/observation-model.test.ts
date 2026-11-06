import { describe, expect, it } from "vitest"
import {
  buildObservationModel,
  nameAndAncestors,
  OBSERVATION_MODEL_SCHEMA_VERSION,
  pathWithin,
  subpathWithin,
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

describe("buildObservationModel, with what the recorder left out", () => {
  const boundary = { kind: "log", name: "audit" } as const
  const skip = (scope: string, field: string, reason: string) => ({
    scope,
    boundary,
    field,
    reason,
  })
  const build = (...skips: unknown[]) =>
    buildObservationModel([], skips as Parameters<typeof buildObservationModel>[1])

  it.each(["dotted-key", "max-depth", "max-nodes", "cycle"])(
    "keeps a report whose reason is %s",
    (reason) => {
      const model = build(skip("s", "userData.user", reason))
      expect(model.truncations).toEqual([{ scope: "s", field: "userData.user", reason, count: 1 }])
      expect(model.skipped).toBe(0)
    },
  )

  it("counts a report that cannot be used as skipped, whatever it is", () => {
    const model = build(
      undefined,
      null,
      "text",
      7,
      {},
      skip("", "f", "cycle"),
      skip("s", "", "cycle"),
      skip("s", "f", "unheard-of"),
      skip("s", "f", "cycle"),
    )
    expect(model.skipped).toBe(8)
    expect(model.truncations).toEqual([{ scope: "s", field: "f", reason: "cycle", count: 1 }])
  })

  it("counts a repeated report once with how many times it came", () => {
    const model = build(skip("s", "f", "cycle"), skip("s", "f", "cycle"), skip("s", "f", "cycle"))
    expect(model.truncations).toEqual([{ scope: "s", field: "f", reason: "cycle", count: 3 }])
  })

  it("lists truncations and their scopes in order, whatever order they came in", () => {
    const model = build(
      skip("a-1", "f", "cycle"),
      skip("a b", "f", "cycle"),
      skip("a", "g", "cycle"),
      skip("a", "f", "max-depth"),
      skip("a", "f", "cycle"),
    )
    expect(model.truncations?.map((item) => [item.scope, item.field, item.reason])).toEqual([
      ["a", "f", "cycle"],
      ["a", "f", "max-depth"],
      ["a", "g", "cycle"],
      ["a b", "f", "cycle"],
      ["a-1", "f", "cycle"],
    ])
    expect(model.truncatedScopes).toEqual(["a", "a b", "a-1"])
  })

  it("has no truncations or truncated scopes when nothing was left out", () => {
    const model = build()
    expect(model.truncations).toBeUndefined()
    expect(model.truncatedScopes).toBeUndefined()
  })
})

describe("buildObservationModel, with times", () => {
  it("keeps no time for an observation or a scope none of whose events carried one", () => {
    const model = buildObservationModel([event(), event({ scope: "other" })])
    expect(model.scopeTimes).toBeUndefined()
    for (const item of model.observations) {
      expect(item.firstSeen).toBeUndefined()
      expect(item.lastSeen).toBeUndefined()
    }
  })

  it("widens a time over the events that carry one, and ignores those that do not", () => {
    const model = buildObservationModel([
      event({ at: 5000 }),
      event(),
      event({ at: 1000 }),
      event({ scope: "other" }),
    ])
    const profile = model.observations.find((item) => item.scope === "test:profile")!
    expect([profile.firstSeen, profile.lastSeen]).toEqual([
      "1970-01-01T00:00:01.000Z",
      "1970-01-01T00:00:05.000Z",
    ])
    expect(model.scopeTimes).toEqual([
      {
        scope: "test:profile",
        firstSeen: "1970-01-01T00:00:01.000Z",
        lastSeen: "1970-01-01T00:00:05.000Z",
      },
    ])
    expect(model.observations.find((item) => item.scope === "other")?.firstSeen).toBeUndefined()
  })
})

describe("nameAndAncestors", () => {
  it.each([
    ["a", ["a"]],
    ["a.b", ["a.b", "a"]],
    ["a.b.c", ["a.b.c", "a", "a.b"]],
    [
      "userData.user.profile.email",
      ["userData.user.profile.email", "userData", "userData.user", "userData.user.profile"],
    ],
    ["a..b", ["a..b", "a", "a."]],
    [".a", [".a", ""]],
    ["", [""]],
  ])("%j is itself, then the names it lies inside of, shortest first", (name, expected) => {
    expect(nameAndAncestors(name)).toEqual(expected)
  })
})

describe("pathWithin and subpathWithin", () => {
  it.each([
    ["userData.user", "userData.user", []],
    ["userData.user", "userData.user.email", ["email"]],
    ["userData.user", "userData.user.profile.email", ["profile", "email"]],
  ])("%j seen as %j is the path %j inside it", (field, observed, expected) => {
    expect(pathWithin(field, observed)).toEqual(expected)
    expect(subpathWithin(field, observed)).toEqual(expected)
  })

  it.each([
    ["userData.user", "userData.userExtra.email"],
    ["userData.user", "userData"],
    ["userData.user", "other.user"],
    ["userData.user", "userData.use"],
  ])("%j is not inside %j", (field, observed) => {
    expect(subpathWithin(field, observed)).toBeUndefined()
  })
})
