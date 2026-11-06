import { describe, expect, it } from "vitest"
import { createMemorySink, fieldPathName, observeBoundary } from "../../src/observe/index.js"

describe("fieldPathName", () => {
  it("joins capability and field path with dots", () => {
    expect(fieldPathName("userData", ["user", "email"])).toBe("userData.user.email")
  })

  it("is just the capability for an empty path", () => {
    expect(fieldPathName("userData", [])).toBe("userData")
  })
})

describe("observeBoundary", () => {
  it("records one event per field path into the sink", () => {
    const memory = createMemorySink()
    const recorded = observeBoundary(memory.sink, {
      scope: "test:profile",
      boundary: { kind: "client-response", name: "http-response" },
      capability: "userData",
      fields: [
        ["user", "id"],
        ["user", "email"],
      ],
    })
    expect(recorded).toBe(2)
    expect(memory.events()).toEqual([
      {
        scope: "test:profile",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData.user.id",
      },
      {
        scope: "test:profile",
        boundary: { kind: "client-response", name: "http-response" },
        field: "userData.user.email",
      },
    ])
  })

  it("carries handling when supplied", () => {
    const memory = createMemorySink()
    observeBoundary(memory.sink, {
      scope: "s",
      boundary: { kind: "database", name: "pg" },
      capability: "c",
      fields: [["a"]],
      handling: "hashed",
    })
    expect(memory.events()[0]?.handling).toBe("hashed")
  })

  it("omits handling when not supplied", () => {
    const memory = createMemorySink()
    observeBoundary(memory.sink, {
      scope: "s",
      boundary: { kind: "database", name: "pg" },
      capability: "c",
      fields: [["a"]],
    })
    expect(memory.events()[0]).not.toHaveProperty("handling")
  })

  it("records nothing and returns 0 for an empty field list", () => {
    const memory = createMemorySink()
    expect(
      observeBoundary(memory.sink, {
        scope: "s",
        boundary: { kind: "api", name: "x" },
        capability: "c",
        fields: [],
      }),
    ).toBe(0)
    expect(memory.events()).toEqual([])
  })

  it("drops any field path segment that is not a non-empty string (never records a value by accident)", () => {
    const memory = createMemorySink()
    const recorded = observeBoundary(memory.sink, {
      scope: "s",
      boundary: { kind: "api", name: "x" },
      capability: "c",
      fields: [["ok"], ["bad", 42 as unknown as string], [""], []],
    })
    expect(recorded).toBe(1)
    expect(memory.events().map((event) => event.field)).toEqual(["c.ok"])
  })

  it("rejects an event with a blank scope, boundary name or capability by recording nothing", () => {
    const memory = createMemorySink()
    const base = { boundary: { kind: "api" as const, name: "x" }, capability: "c", fields: [["a"]] }
    expect(observeBoundary(memory.sink, { ...base, scope: "" })).toBe(0)
    expect(observeBoundary(memory.sink, { ...base, scope: "s", capability: "" })).toBe(0)
    expect(
      observeBoundary(memory.sink, { ...base, scope: "s", boundary: { kind: "api", name: "" } }),
    ).toBe(0)
    expect(memory.events()).toEqual([])
  })

  it("never stores anything but the documented keys, even if the caller passes a value", () => {
    const memory = createMemorySink()
    observeBoundary(memory.sink, {
      scope: "s",
      boundary: { kind: "api", name: "x" },
      capability: "c",
      fields: [["a"]],
      // A caller smuggling a value in must not get it recorded.
      value: "secret@example.com",
    } as never)
    const serialized = JSON.stringify(memory.events())
    expect(serialized).not.toContain("secret@example.com")
    expect(Object.keys(memory.events()[0] ?? {}).sort()).toEqual(["boundary", "field", "scope"])
  })

  it("does not throw when the sink throws, and reports what it managed to record", () => {
    let calls = 0
    const sink = {
      record() {
        calls += 1
        if (calls === 2) throw new Error("sink down")
      },
    }
    const recorded = observeBoundary(sink, {
      scope: "s",
      boundary: { kind: "api", name: "x" },
      capability: "c",
      fields: [["a"], ["b"], ["c"]],
    })
    // The second record() call throws, so exactly one event was recorded and the third is never attempted.
    expect(recorded).toBe(1)
    expect(calls).toBe(2)
  })
})

describe("createMemorySink", () => {
  it("returns a snapshot that later records do not mutate", () => {
    const memory = createMemorySink()
    observeBoundary(memory.sink, {
      scope: "s",
      boundary: { kind: "api", name: "x" },
      capability: "c",
      fields: [["a"]],
    })
    const first = memory.events()
    observeBoundary(memory.sink, {
      scope: "s",
      boundary: { kind: "api", name: "x" },
      capability: "c",
      fields: [["b"]],
    })
    expect(first).toHaveLength(1)
    expect(memory.events()).toHaveLength(2)
  })
})
