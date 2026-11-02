/**
 * The negative guarantee for the auto-walker (ADR 0072): names and paths only.
 * Whatever is in the value -- strings, numbers, secrets, keys that look like
 * values -- no *value* ever reaches the sink.
 */
import { describe, expect, it } from "vitest"
import {
  createMemorySink,
  instrumentBoundary,
  observeSink,
  observeValue,
} from "../../src/observe/index.js"

const SECRETS = [
  "hunter2-PASSWORD",
  "ada@example.com",
  "4111111111111111",
  "sk_live_abc123",
  "9876543210",
]

function body(): Record<string, unknown> {
  return {
    user: {
      email: SECRETS[1],
      password: SECRETS[0],
      card: { number: SECRETS[2], expiry: 20291231 },
      token: SECRETS[3],
      phone: Number(SECRETS[4]),
    },
    tags: [SECRETS[0], { note: SECRETS[1] }],
    nested: new Map([[SECRETS[3], SECRETS[0]]]),
    members: new Set([SECRETS[2]]),
  }
}

const ctx = { scope: "s", capability: "c", boundary: { kind: "log" as const, name: "out" } }

function serialized(run: (sink: ReturnType<typeof createMemorySink>["sink"]) => void): string {
  const memory = createMemorySink()
  run(memory.sink)
  return JSON.stringify(memory.events())
}

describe("observeValue records names and paths only", () => {
  it("no secret string or number appears in any recorded event", () => {
    const events = serialized((sink) => observeValue(sink, ctx, body(), { collections: true }))
    for (const secret of SECRETS) expect(events).not.toContain(secret)
    expect(events).not.toContain("20291231")
    expect(events).toContain("c.user.password")
  })

  it("holds with collections off, through observeSink and through instrumentBoundary", () => {
    const viaDefault = serialized((sink) => observeValue(sink, ctx, body()))
    const viaSink = serialized((sink) => observeSink(sink, ctx)(body()))
    const viaWrap = serialized((sink) => {
      const target = { send: (_x: unknown) => undefined }
      instrumentBoundary(target, "send", ctx, sink)
      target.send(body())
    })
    for (const text of [viaDefault, viaSink, viaWrap]) {
      for (const secret of SECRETS) expect(text).not.toContain(secret)
    }
  })

  it("every recorded event has exactly the documented keys", () => {
    const memory = createMemorySink()
    observeValue(memory.sink, { ...ctx, handling: "hashed" }, body(), { collections: true })
    for (const event of memory.events())
      expect(Object.keys(event).sort()).toEqual(["boundary", "field", "handling", "scope"])
  })

  it("a key that itself looks like a value is a name (the walker cannot tell), but a Map key is never one", () => {
    const memory = createMemorySink()
    observeValue(memory.sink, ctx, { m: new Map([["ada@example.com", 1]]) }, { collections: true })
    expect(JSON.stringify(memory.events())).not.toContain("ada@example.com")
  })
})
