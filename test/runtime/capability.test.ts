import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { canonicalize } from "../../src/core/canonicalize.js"
import { fields } from "../../src/core/fields.js"
import type { DeepPartial } from "../../src/core/types.js"
import {
  buildInfoPatch,
  createData,
  isDevMode,
  mergeParams,
  warnFieldErrors,
} from "../../src/runtime/capability.js"
import type { OperationOutcome } from "../../src/runtime/capability.js"
import type { DataError } from "../../src/core/types.js"
import type { SubscriptionHandlers } from "../../src/runtime/coordinator.js"
import { UnknownGetterError } from "../../src/runtime/errors.js"

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("createData -- fields-only (no operations declared)", () => {
  it("behaves like createDataStore(buildData({fields})) -- zero bound operation methods, still a fully valid capability", () => {
    const capability = createData({ fields: { count: 0 } })

    expect(capability.getSnapshot().fields.count).toBe(0)
    expect(capability.getSnapshot().info).toEqual({})
    expect(capability.getSnapshot().operations).toEqual({})

    let notified = 0
    const unsubscribe = capability.subscribe(() => {
      notified += 1
    })
    expect(typeof unsubscribe).toBe("function")
    unsubscribe()
    expect(notified).toBe(0)

    expect(capability.describe()).toEqual({ getters: {}, mutators: {}, subscriptions: {} })
  })
})

describe("operation parameter types are independent of field nullability", () => {
  it("a getter's params type is derived purely from its own declared params, never from a nullable field's InferFieldValue", () => {
    const capability = createData({
      fields: { user: fields.nullable<{ id: string }>({ id: "" }) },
      getters: {
        getUser: {
          params: { id: "" },
          execute: async (params: { id: string }) => ({ user: { id: params.id } }),
          writes: { user: true },
        },
      },
    })

    // If params typing were (incorrectly) derived from the nullable `user`
    // field's InferFieldValue, this would be `{id: string} | null |
    // undefined`. It's a plain, non-nullable `{id?: string}` instead --
    // field nullability never leaks into operation parameter typing.
    expectTypeOf(capability.getUser)
      .parameter(0)
      .toEqualTypeOf<DeepPartial<{ id: string }> | undefined>()
  })
})

describe("getters", () => {
  it("defaults to identity when processor is omitted -- execute's raw result is used directly as the patch", async () => {
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          execute: async () => ({ user: { name: "Ada Lovelace" } }),
          writes: { user: true },
        },
      },
    })

    await capability.getUser()
    expect(capability.getSnapshot().fields.user.name).toBe("Ada Lovelace")
  })

  it("commits loading then success, and resolves with the accepted patch (normal Promise semantics)", async () => {
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          execute: async () => ({ name: "Ada Lovelace" }),
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })

    const callPromise = capability.getUser()
    expect(capability.getSnapshot().info.user?.status).toBe("loading")

    const result = await callPromise
    expect(result).toEqual({ user: { name: "Ada Lovelace" } })
    expect(capability.getSnapshot().fields.user.name).toBe("Ada Lovelace")
    expect(capability.getSnapshot().info.user?.status).toBe("success")
    expect(capability.getSnapshot().info.user?.source).toBe("getUser")
  })

  it("rejects on failure (normal Promise semantics -- never silently swallowed), and records the error into info", async () => {
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          execute: async (): Promise<{ name: string }> => {
            throw new Error("network down")
          },
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })

    await expect(capability.getUser()).rejects.toThrow("network down")
    expect(capability.getSnapshot().info.user?.status).toBe("error")
    expect(capability.getSnapshot().info.user?.error?.operator).toBe("getUser")
  })

  it("fire-and-forget is achieved by not awaiting, not by the runtime swallowing rejection", async () => {
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          execute: async (): Promise<{ name: string }> => {
            throw new Error("boom")
          },
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })

    const call = capability.getUser()
    // Deliberately not awaited at the call site -- attach a catch so the
    // real rejection above doesn't surface as an unhandled rejection in
    // this test run, while still proving the promise really did reject.
    let rejected = false
    call.catch(() => {
      rejected = true
    })
    await call.catch(() => undefined)
    expect(rejected).toBe(true)
  })

  it("drops (never applies) a processor's write outside its declared ownership, with a dev-mode warning, never throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const capability = createData({
      fields: { user: { name: "" }, post: { title: "" } },
      getters: {
        getUser: {
          execute: async () => ({ name: "Ada" }),
          // Only owns `user`, but lies and also tries to write `post` --
          // must be dropped, never applied, never thrown. A well-typed
          // processor can't do this at compile time (OwnedPatch narrows
          // it) -- this simulates a processor that ignores its own type,
          // proving the runtime boundary is real defense-in-depth, not
          // just a compile-time nicety.
          processor: (raw: { name: string }) =>
            ({ user: raw, post: { title: "sneaky" } }) as { user: { name: string } },
          writes: { user: true },
        },
      },
    })

    await expect(capability.getUser()).resolves.not.toThrow()
    expect(capability.getSnapshot().fields.user.name).toBe("Ada")
    expect(capability.getSnapshot().fields.post.title).toBe("")
    expect(warnSpy).toHaveBeenCalled()
    // Never leaks the offending value into the warning (ADR 0005).
    expect(warnSpy.mock.calls.every((call) => !String(call[0]).includes("sneaky"))).toBe(true)

    warnSpy.mockRestore()
  })

  it("stale-response discard is scoped to per-getter-identity, field-level only (ADR 0024) -- a slower older call never overwrites a newer field-level commit, but still settles its own per-params operations entry with its true outcome", async () => {
    const older = deferred<{ name: string }>()
    const newer = deferred<{ name: string }>()

    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          params: { id: "" },
          execute: async (params: { id: string }) =>
            params.id === "old" ? older.promise : newer.promise,
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })

    const olderCall = capability.getUser({ id: "old" })
    const newerCall = capability.getUser({ id: "new" })

    newer.resolve({ name: "Newer" })
    await newerCall
    expect(capability.getSnapshot().fields.user.name).toBe("Newer")

    older.resolve({ name: "Older" })
    await olderCall
    // The stale, older call must NOT have overwritten the newer commit.
    expect(capability.getSnapshot().fields.user.name).toBe("Newer")

    // But its OWN per-params operations entry still reflects its own true
    // (successful) outcome, independent of the newer call.
    const key = canonicalize({ id: "old" })
    expect(key).toBeDefined()
    expect(capability.getSnapshot().operations["getUser"]?.[key!]?.status).toBe("success")
  })

  describe("dedup identity: (capability instance x operation name x canonicalized params)", () => {
    it("dedupes concurrent calls to the same getter with canonically-equal params", async () => {
      const execute = vi.fn(async (params: { id: string }) => ({ name: `user-${params.id}` }))
      const capability = createData({
        fields: { user: { name: "" } },
        getters: {
          getUser: {
            params: { id: "" },
            execute,
            processor: (raw: { name: string }) => ({ user: raw }),
            writes: { user: true },
          },
        },
      })

      await Promise.all([capability.getUser({ id: "1" }), capability.getUser({ id: "1" })])
      expect(execute).toHaveBeenCalledTimes(1)
    })

    it("does not dedupe calls with different (canonically-distinct) params", async () => {
      const execute = vi.fn(async (params: { id: string }) => ({ name: `user-${params.id}` }))
      const capability = createData({
        fields: { user: { name: "" } },
        getters: {
          getUser: {
            params: { id: "" },
            execute,
            processor: (raw: { name: string }) => ({ user: raw }),
            writes: { user: true },
          },
        },
      })

      await Promise.all([capability.getUser({ id: "1" }), capability.getUser({ id: "2" })])
      expect(execute).toHaveBeenCalledTimes(2)
    })

    it("does not dedupe two different getters, even with the same params", async () => {
      const executeUser = vi.fn(async () => ({ name: "Ada" }))
      const executePost = vi.fn(async () => ({ title: "Post" }))
      const capability = createData({
        fields: { user: { name: "" }, post: { title: "" } },
        getters: {
          getUser: {
            execute: executeUser,
            processor: (raw: { name: string }) => ({ user: raw }),
            writes: { user: true },
          },
          getPost: {
            execute: executePost,
            processor: (raw: { title: string }) => ({ post: raw }),
            writes: { post: true },
          },
        },
      })

      await Promise.all([capability.getUser(), capability.getPost()])
      expect(executeUser).toHaveBeenCalledTimes(1)
      expect(executePost).toHaveBeenCalledTimes(1)
    })

    it("does not dedupe across two separate createData() instances of the same schema shape", async () => {
      const schema = () => ({
        fields: { user: { name: "" } },
        getters: {
          getUser: {
            execute: vi.fn(async () => ({ name: "Ada" })),
            processor: (raw: { name: string }) => ({ user: raw }),
            writes: { user: true } as const,
          },
        },
      })

      const capabilityA = createData(schema())
      const capabilityB = createData(schema())

      await Promise.all([capabilityA.getUser(), capabilityB.getUser()])
      // Each instance's own `execute` mock only ever sees its own instance's call.
      expect(capabilityA.getSnapshot().fields.user.name).toBe("Ada")
      expect(capabilityB.getSnapshot().fields.user.name).toBe("Ada")
    })
  })
})

describe("mutators", () => {
  it("optimistic() receives CURRENT AUTHORITATIVE state, never the visible/projected state -- a second concurrent optimistic transition never computes against a first transition's still-pending value", async () => {
    const firstDeferred = deferred<undefined>()
    const secondDeferred = deferred<undefined>()
    const observedAtOptimisticTime: string[] = []

    const capability = createData({
      fields: { user: { email: "authoritative@example.com" } },
      mutators: {
        updateEmail: {
          params: { which: "first" },
          execute: async (params: { which: "first" | "second" }) => {
            await (params.which === "first" ? firstDeferred.promise : secondDeferred.promise)
            return { email: `confirmed-${params.which}@example.com` }
          },
          processor: (raw: { email: string }) => ({ user: raw }),
          writes: { user: true },
          optimistic: (state: unknown, params: { which: "first" | "second" }) => {
            const typedState = state as { fields: { user: { email: string } } }
            observedAtOptimisticTime.push(typedState.fields.user.email)
            return { user: { email: `optimistic-${params.which}@example.com` } }
          },
        },
      },
    })

    const firstCall = capability.updateEmail({ which: "first" })
    const secondCall = capability.updateEmail({ which: "second" })

    // Both optimistic callbacks observed the ORIGINAL authoritative value --
    // the second never saw the first's still-pending optimistic email.
    expect(observedAtOptimisticTime).toEqual([
      "authoritative@example.com",
      "authoritative@example.com",
    ])

    firstDeferred.resolve(undefined)
    secondDeferred.resolve(undefined)
    await Promise.all([firstCall, secondCall])
  })

  it("multiple pending transitions stay independent -- removing one re-projects the rest cleanly over authoritative state", async () => {
    const aDeferred = deferred<undefined>()
    const bDeferred = deferred<undefined>()

    const capability = createData({
      fields: { count: 0, name: "original" },
      mutators: {
        bumpCount: {
          execute: async () => {
            await aDeferred.promise
            return { value: 1 }
          },
          processor: (raw: { value: number }) => ({ count: raw.value }),
          writes: { count: true },
          optimistic: () => ({ count: 99 }),
        },
        renameThing: {
          execute: async () => {
            await bDeferred.promise
            return { value: "confirmed" }
          },
          processor: (raw: { value: string }) => ({ name: raw.value }),
          writes: { name: true },
          optimistic: () => ({ name: "optimistic-name" }),
        },
      },
    })

    const countCall = capability.bumpCount()
    expect(capability.getSnapshot().fields.count).toBe(99)
    expect(capability.getSnapshot().fields.name).toBe("original")

    const nameCall = capability.renameThing()
    // Adding renameThing's own pending transition must not disturb
    // bumpCount's still-pending, unrelated contribution.
    expect(capability.getSnapshot().fields.count).toBe(99)
    expect(capability.getSnapshot().fields.name).toBe("optimistic-name")

    aDeferred.resolve(undefined)
    await countCall
    // bumpCount settled -- its optimistic transition is gone, replaced by
    // the real authoritative value -- renameThing's optimistic contribution
    // is untouched.
    expect(capability.getSnapshot().fields.count).toBe(1)
    expect(capability.getSnapshot().fields.name).toBe("optimistic-name")

    bDeferred.resolve(undefined)
    await nameCall
    expect(capability.getSnapshot().fields.name).toBe("confirmed")
  })

  it("rejects on failure -- no rollback code path, just removal of the pending transition (ADR 0023); the visible value reverts on its own", async () => {
    const capability = createData({
      fields: { user: { email: "authoritative@example.com" } },
      mutators: {
        updateEmail: {
          execute: async (): Promise<{ email: string }> => {
            throw new Error("validation failed")
          },
          processor: (raw: { email: string }) => ({ user: raw }),
          writes: { user: true },
          optimistic: () => ({ user: { email: "optimistic@example.com" } }),
        },
      },
    })

    const call = capability.updateEmail()
    expect(capability.getSnapshot().fields.user.email).toBe("optimistic@example.com")
    // getAuthoritativeState() is unaffected by the still-pending optimistic
    // transition -- only the projected getSnapshot() view reflects it.
    expect(capability.getAuthoritativeState().fields.user.email).toBe("authoritative@example.com")

    await expect(call).rejects.toThrow("validation failed")
    // Reverted automatically -- back to authoritative, no special rollback path.
    expect(capability.getSnapshot().fields.user.email).toBe("authoritative@example.com")
    expect(capability.getSnapshot().info.user?.status).toBe("error")
  })

  it("never discards by start order (unlike getters) -- whichever commit completes LAST wins, matching ADR 0025", async () => {
    const aDeferred = deferred<undefined>()
    const bDeferred = deferred<undefined>()

    const capability = createData({
      fields: { count: 0 },
      mutators: {
        setCount: {
          params: { value: 0, which: "a" },
          execute: async (params: { value: number; which: "a" | "b" }) => {
            await (params.which === "a" ? aDeferred.promise : bDeferred.promise)
            return { value: params.value }
          },
          processor: (raw: { value: number }) => ({ count: raw.value }),
          writes: { count: true },
        },
      },
    })

    // A starts first, B starts second.
    const aCall = capability.setCount({ value: 1, which: "a" })
    const bCall = capability.setCount({ value: 2, which: "b" })

    // B completes first (started second).
    bDeferred.resolve(undefined)
    await bCall
    expect(capability.getSnapshot().fields.count).toBe(2)

    // A completes LAST, even though it started FIRST -- its later commit wins.
    aDeferred.resolve(undefined)
    await aCall
    expect(capability.getSnapshot().fields.count).toBe(1)
  })
})

describe("subscriptions", () => {
  it("shares one transport across identical canonicalized params; different params get independent transports", () => {
    let connections = 0

    const capability = createData({
      fields: { price: 0 },
      subscriptions: {
        subscribeToPrice: {
          params: { symbol: "" },
          subscribe: (
            _params: { symbol: string },
            handlers: SubscriptionHandlers<{ price: number }>,
          ) => {
            connections += 1
            handlers.onStatusChange("connected")
            return () => undefined
          },
          processor: (event: { price: number }) => ({ price: event.price }),
          writes: { price: true },
        },
      },
    })

    const releaseA1 = capability.subscribeToPrice({ symbol: "AAPL" })
    const releaseA2 = capability.subscribeToPrice({ symbol: "AAPL" })
    expect(connections).toBe(1)

    const releaseB = capability.subscribeToPrice({ symbol: "MSFT" })
    expect(connections).toBe(2)

    releaseA1()
    releaseA2()
    releaseB()
  })

  it("unsubscribe is idempotent -- calling it twice never double-releases", () => {
    let connections = 0
    let disconnections = 0

    const capability = createData({
      fields: { price: 0 },
      subscriptions: {
        subscribeToPrice: {
          params: {},
          subscribe: (_params: unknown, handlers: SubscriptionHandlers<{ price: number }>) => {
            connections += 1
            handlers.onStatusChange("connected")
            return () => {
              disconnections += 1
            }
          },
          processor: (event: { price: number }) => ({ price: event.price }),
          writes: { price: true },
        },
      },
    })

    const release = capability.subscribeToPrice({})
    release()
    release()
    expect(disconnections).toBe(1)

    // A fresh acquire after full release reconnects.
    capability.subscribeToPrice({})
    expect(connections).toBe(2)
  })

  it("releasing a subscription commits this capability's OWN info as disconnected, even though acquireSubscription's fan-out never calls back a self-releasing consumer", () => {
    // The transport's own teardown here deliberately never calls
    // `handlers.onStatusChange("disconnected")` -- proving the capability
    // commits its own disconnected status unconditionally on release,
    // rather than depending on a callback the coordinator structurally
    // cannot deliver to whichever consumer just released (it's already been
    // removed from the fan-out's consumer set by the time teardown runs).
    const capability = createData({
      fields: { price: 0 },
      subscriptions: {
        subscribeToPrice: {
          params: {},
          subscribe: (_params: unknown, handlers: SubscriptionHandlers<{ price: number }>) => {
            handlers.onStatusChange("connected")
            return () => undefined
          },
          processor: (event: { price: number }) => ({ price: event.price }),
          writes: { price: true },
        },
      },
    })

    const release = capability.subscribeToPrice({})
    expect(capability.getSnapshot().info.price?.subscription?.status).toBe("connected")

    release()
    expect(capability.getSnapshot().info.price?.subscription?.status).toBe("disconnected")
  })

  it("a status transition alone never touches fields, only info.<field>.subscription (ADR 0029)", () => {
    const capability = createData({
      fields: { price: 0 },
      subscriptions: {
        subscribeToPrice: {
          params: {},
          subscribe: (_params: unknown, handlers: SubscriptionHandlers<{ price: number }>) => {
            handlers.onEvent({ price: 42 })
            handlers.onStatusChange("disconnected")
            return () => undefined
          },
          processor: (event: { price: number }) => ({ price: event.price }),
          writes: { price: true },
        },
      },
    })

    const release = capability.subscribeToPrice({})
    expect(capability.getSnapshot().fields.price).toBe(42)
    expect(capability.getSnapshot().info.price?.subscription?.status).toBe("disconnected")
    // The last known-good value is untouched by the disconnect.
    expect(capability.getSnapshot().fields.price).toBe(42)
    release()
  })
})

describe("runGetters", () => {
  it("runs requested getters concurrently, never rejects itself, and reports each outcome independently -- one failure never erases another success", async () => {
    const capability = createData({
      fields: { user: { name: "" }, post: { title: "" } },
      getters: {
        getUser: {
          params: {},
          execute: async () => ({ name: "Ada" }),
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
        getPost: {
          params: {},
          execute: async (): Promise<{ title: string }> => {
            throw new Error("network down")
          },
          processor: (raw: { title: string }) => ({ post: raw }),
          writes: { post: true },
        },
      },
    })

    const result = await capability.runGetters({ getUser: {}, getPost: {} })

    expect(result.getUser).toEqual({ status: "success", value: { user: { name: "Ada" } } })
    expect(result.getPost?.status).toBe("error")
    // getUser's success is fully committed, unaffected by getPost's failure.
    expect(capability.getSnapshot().fields.user.name).toBe("Ada")
    expect(capability.getSnapshot().info.post?.status).toBe("error")
  })

  it("reports an undeclared getter name as a structured error outcome (UnknownGetterError), never a thrown rejection", async () => {
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          params: {},
          execute: async () => ({ name: "Ada" }),
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })

    // Bypasses the generated call-site's own type constraints, matching a
    // dynamic-key caller (JS consumer, or a computed getter name).
    const calls = { notDeclared: {} } as unknown as Partial<{ getUser: Record<string, never> }>
    const result = (await capability.runGetters(calls)) as unknown as Record<
      string,
      OperationOutcome<unknown>
    >
    const outcome = result["notDeclared"]

    expect(outcome?.status).toBe("error")
    if (outcome?.status !== "error") throw new Error("expected an error outcome")
    expect(outcome.error.operator).toBe("notDeclared")
    expect(outcome.error.error).toBeInstanceOf(UnknownGetterError)
    expect((outcome.error.error as UnknownGetterError).code).toBe("DATA_CAP_UNKNOWN_GETTER")
  })
})

describe("operations snapshot", () => {
  it("stays reference-stable across reads when nothing has changed (no-op suppression)", () => {
    const capability = createData({ fields: { count: 0 } })
    const snapshotA = capability.getSnapshot()
    const snapshotB = capability.getSnapshot()
    expect(snapshotA).toBe(snapshotB)
  })

  it("a new snapshot is only produced when something actually changed", async () => {
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          execute: async () => ({ name: "Ada" }),
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })

    const before = capability.getSnapshot()
    await capability.getUser()
    const after = capability.getSnapshot()
    expect(after).not.toBe(before)
    expect(capability.getSnapshot()).toBe(after)
  })

  it("bounds retained per-operation entries via LRU eviction (maxOperationHistory)", async () => {
    const capability = createData(
      {
        fields: { user: { name: "" } },
        getters: {
          getUser: {
            params: { id: "" },
            execute: async (params: { id: string }) => ({ name: params.id }),
            processor: (raw: { name: string }) => ({ user: raw }),
            writes: { user: true },
          },
        },
      },
      { maxOperationHistory: 2 },
    )

    await capability.getUser({ id: "1" })
    await capability.getUser({ id: "2" })
    await capability.getUser({ id: "3" })

    const entries = capability.getSnapshot().operations["getUser"] ?? {}
    // The oldest ("1") is evicted; the two most recently used survive.
    expect(Object.keys(entries).map((k) => canonicalize({ id: k }))).not.toBeNull()
    expect(Object.values(entries)).toHaveLength(2)
    const idKey = (id: string) => canonicalize({ id }) ?? ""
    expect(Object.keys(entries).sort()).toEqual([idKey("2"), idKey("3")].sort())
  })

  it("re-fetching an existing key touches it, moving it to the most-recently-used end so a later eviction spares it", async () => {
    const capability = createData(
      {
        fields: { user: { name: "" } },
        getters: {
          getUser: {
            params: { id: "" },
            execute: async (params: { id: string }) => ({ name: params.id }),
            processor: (raw: { name: string }) => ({ user: raw }),
            writes: { user: true },
          },
        },
      },
      { maxOperationHistory: 2 },
    )

    await capability.getUser({ id: "1" })
    await capability.getUser({ id: "2" })
    // Touch "1" again -- it should now be the most-recently-used entry,
    // not the least, despite being inserted first.
    await capability.getUser({ id: "1" })
    await capability.getUser({ id: "3" })

    const entries = capability.getSnapshot().operations["getUser"] ?? {}
    const idKey = (id: string) => canonicalize({ id }) ?? ""
    // "2" is now the least recently touched and is evicted; the re-touched
    // "1" survives alongside the newly-inserted "3".
    expect(Object.keys(entries).sort()).toEqual([idKey("1"), idKey("3")].sort())
  })

  it("each operations entry records its own call's status, then settledAt + outcome", async () => {
    const gate = deferred<{ name: string }>()
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          params: { id: "" },
          execute: async () => gate.promise,
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })
    const key = canonicalize({ id: "7" }) ?? ""

    const call = capability.getUser({ id: "7" })
    expect(capability.getSnapshot().operations["getUser"]?.[key]).toMatchObject({
      status: "loading",
    })
    expect(capability.getSnapshot().operations["getUser"]?.[key]?.startedAt).toBeTypeOf("number")

    gate.resolve({ name: "Ada" })
    await call
    const settled = capability.getSnapshot().operations["getUser"]?.[key]
    expect(settled?.status).toBe("success")
    expect(settled?.settledAt).toBeTypeOf("number")
  })

  it("a failed call's operations entry records status error + the DataError", async () => {
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          params: { id: "" },
          execute: async (): Promise<{ name: string }> => {
            throw new Error("kaboom")
          },
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })
    const key = canonicalize({ id: "9" }) ?? ""
    await expect(capability.getUser({ id: "9" })).rejects.toThrow("kaboom")
    const entry = capability.getSnapshot().operations["getUser"]?.[key]
    expect(entry?.status).toBe("error")
    expect(entry?.error?.operator).toBe("getUser")
  })

  it("a mutator's pending optimistic transition stamps info.<field>.optimistic true, cleared on settle", async () => {
    const gate = deferred<{ v: number }>()
    const capability = createData({
      fields: { count: 0 },
      mutators: {
        bump: {
          execute: async () => gate.promise,
          processor: (raw: { v: number }) => ({ count: raw.v }),
          writes: { count: true },
          optimistic: () => ({ count: 1 }),
        },
      },
    })
    const call = capability.bump()
    expect(capability.getSnapshot().info.count).toMatchObject({
      status: "loading",
      optimistic: true,
    })
    gate.resolve({ v: 3 })
    await call
    expect(capability.getSnapshot().info.count).toMatchObject({
      status: "success",
      optimistic: false,
    })
  })

  it("a subscription's operations entry tracks its subscription status", () => {
    const capability = createData({
      fields: { price: 0 },
      subscriptions: {
        watch: {
          params: {},
          subscribe: (_p: unknown, handlers: SubscriptionHandlers<{ price: number }>) => {
            handlers.onStatusChange("connected")
            return () => undefined
          },
          processor: (event: { price: number }) => ({ price: event.price }),
          writes: { price: true },
        },
      },
    })
    const key = canonicalize({}) ?? ""
    const release = capability.watch({})
    expect(capability.getSnapshot().operations["watch"]?.[key]?.subscription?.status).toBe(
      "connected",
    )
    release()
    expect(capability.getSnapshot().operations["watch"]?.[key]?.subscription?.status).toBe(
      "disconnected",
    )
  })
})

describe("caller AbortSignal", () => {
  const oneGetter = () =>
    createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          execute: async () => ({ name: "eventually" }),
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })

  it("an already-aborted caller signal rejects the call (composeSignals + rejectOnAbort)", async () => {
    const controller = new AbortController()
    controller.abort(new Error("caller gave up"))
    await expect(oneGetter().getUser(undefined, controller.signal)).rejects.toThrow(
      "caller gave up",
    )
  })

  it("aborting the caller signal mid-flight rejects that caller's own wait", async () => {
    const abort = new AbortController()
    const gate = deferred<{ name: string }>()
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          execute: async () => gate.promise,
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })
    const call = capability.getUser(undefined, abort.signal)
    abort.abort(new Error("timeout"))
    await expect(call).rejects.toThrow("timeout")
    gate.resolve({ name: "done" })
  })

  it("with no caller signal, the call completes normally", async () => {
    await expect(oneGetter().getUser()).resolves.toEqual({ user: { name: "eventually" } })
  })
})

describe("describe()", () => {
  it("exposes static, non-reactive operation metadata distinct from the live operations snapshot", () => {
    const capability = createData({
      fields: { user: { name: "", email: "" } },
      getters: {
        getUser: {
          execute: async () => ({ name: "", email: "" }),
          processor: (raw: { name: string; email: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
      mutators: {
        updateEmail: {
          execute: async (params: { email: string }) => params,
          processor: (raw: { email: string }) => ({ user: { email: raw.email } }),
          writes: { user: { email: true } },
          optimistic: (_state, params: { email: string }) => ({ user: { email: params.email } }),
        },
      },
    })

    const descriptor = capability.describe()
    expect(descriptor.getters["getUser"]).toEqual({
      kind: "getter",
      writes: { user: true },
      hasProcessor: true,
      hasOptimistic: false,
    })
    expect(descriptor.mutators["updateEmail"]).toEqual({
      kind: "mutator",
      writes: { user: { email: true } },
      hasProcessor: true,
      hasOptimistic: true,
    })
  })
})

describe("isDevMode (direct)", () => {
  it("is false only for NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(isDevMode()).toBe(false)
    vi.stubEnv("NODE_ENV", "development")
    expect(isDevMode()).toBe(true)
    vi.stubEnv("NODE_ENV", "test")
    expect(isDevMode()).toBe(true)
    vi.unstubAllEnvs()
  })

  it("never throws when process, or process.env, is absent", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "process")
    try {
      Object.defineProperty(globalThis, "process", { value: undefined, configurable: true })
      expect(isDevMode()).toBe(true)
      Object.defineProperty(globalThis, "process", { value: {}, configurable: true })
      expect(isDevMode()).toBe(true)
    } finally {
      if (original) Object.defineProperty(globalThis, "process", original)
      else Reflect.deleteProperty(globalThis, "process")
    }
  })
})

describe("warnFieldErrors (direct)", () => {
  const err = (message: string): DataError => ({ operator: "op", error: new Error(message) })

  it("warns once per field error, using the Error's own message, in dev mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      warnFieldErrors(
        new Map([
          ["a", err("first")],
          ["b", err("second")],
        ]),
      )
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["first", "second"])
    } finally {
      warn.mockRestore()
    }
  })

  it("does not warn for an empty map, nor in production mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      warnFieldErrors(new Map())
      expect(warn).not.toHaveBeenCalled()
      vi.stubEnv("NODE_ENV", "production")
      warnFieldErrors(new Map([["a", err("hidden")]]))
      expect(warn).not.toHaveBeenCalled()
      vi.unstubAllEnvs()
    } finally {
      warn.mockRestore()
    }
  })

  it("falls back to String() for a non-Error field-error value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      warnFieldErrors(new Map([["a", { operator: "op", error: "plain string" }]]))
      expect(warn).toHaveBeenCalledWith("plain string")
    } finally {
      warn.mockRestore()
    }
  })

  it("a mutator whose processor returns an undeclared field actually warns (integration, not just the direct unit)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const capability = createData({
        fields: { user: { email: "authoritative@example.com" } },
        mutators: {
          updateEmail: {
            params: {},
            execute: async () => ({ email: "new@example.com", smuggled: true }),
            processor: (raw: { email: string; smuggled: boolean }) => ({
              user: { email: raw.email },
              smuggled: raw.smuggled,
            }),
            writes: { user: true },
          },
        },
      })
      await capability.updateEmail({})
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it("a subscription whose processor returns an undeclared field actually warns (integration, not just the direct unit)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const capability = createData({
        fields: { price: 0 },
        subscriptions: {
          subscribeToPrice: {
            params: {},
            subscribe: (
              _params: unknown,
              handlers: SubscriptionHandlers<{ price: number; smuggled: boolean }>,
            ) => {
              handlers.onEvent({ price: 42, smuggled: true })
              return () => undefined
            },
            processor: (event: { price: number; smuggled: boolean }) => ({
              price: event.price,
              smuggled: event.smuggled,
            }),
            writes: { price: true },
          },
        },
      })
      const release = capability.subscribeToPrice({})
      expect(warn).toHaveBeenCalled()
      release()
    } finally {
      warn.mockRestore()
    }
  })
})

describe("buildInfoPatch (direct)", () => {
  it("returns undefined for undefined ownership, the info verbatim for `true`", () => {
    expect(buildInfoPatch(undefined, { status: "loading" })).toBeUndefined()
    expect(buildInfoPatch(true, { status: "loading" })).toEqual({ status: "loading" })
  })

  it("places the info at every `true` leaf of a nested ownership shape, never at an interior node", () => {
    expect(
      buildInfoPatch({ user: { email: true, name: true }, id: true } as never, { s: 1 }),
    ).toEqual({ user: { email: { s: 1 }, name: { s: 1 } }, id: { s: 1 } })
  })

  it("omits a key whose ownership child is undefined (never sets it to undefined)", () => {
    const patch = buildInfoPatch({ present: true, gone: undefined } as never, { s: 1 }) as Record<
      string,
      unknown
    >
    expect(Object.keys(patch)).toEqual(["present"])
  })
})

describe("mergeParams (direct)", () => {
  it("returns the other side verbatim when one is undefined", () => {
    expect(mergeParams(undefined, { a: 1 })).toEqual({ a: 1 })
    expect(mergeParams({ a: 1 }, undefined)).toEqual({ a: 1 })
    expect(mergeParams(undefined, undefined)).toBeUndefined()
  })

  it("deep-merges the partial onto the defaults when both are present", () => {
    expect(mergeParams({ a: 1, nested: { x: 1, y: 2 } }, { nested: { y: 9 } })).toEqual({
      a: 1,
      nested: { x: 1, y: 9 },
    })
  })
})

describe("info-patch payloads (behavioural)", () => {
  it("a mutator success stamps status/source and clears the optimistic flag", async () => {
    const capability = createData({
      fields: { user: { email: "old@x.com" } },
      mutators: {
        updateEmail: {
          execute: async () => ({ email: "new@x.com" }),
          processor: (raw: { email: string }) => ({ user: raw }),
          writes: { user: true },
          optimistic: () => ({ user: { email: "pending@x.com" } }),
        },
      },
    })
    await capability.updateEmail()
    expect(capability.getSnapshot().info.user).toMatchObject({
      status: "success",
      source: "updateEmail",
      optimistic: false,
    })
  })

  it("a mutator failure stamps status/error and clears the optimistic flag", async () => {
    const capability = createData({
      fields: { user: { email: "old@x.com" } },
      mutators: {
        updateEmail: {
          execute: async (): Promise<{ email: string }> => {
            throw new Error("nope")
          },
          processor: (raw: { email: string }) => ({ user: raw }),
          writes: { user: true },
          optimistic: () => ({ user: { email: "pending@x.com" } }),
        },
      },
    })
    await expect(capability.updateEmail()).rejects.toThrow("nope")
    const info = capability.getSnapshot().info.user
    expect(info?.status).toBe("error")
    expect(info?.optimistic).toBe(false)
    expect(info?.error?.operator).toBe("updateEmail")
  })

  it("a mutator without optimistic() opens no pending transition -- the visible value only changes on commit", async () => {
    const gate = deferred<undefined>()
    const capability = createData({
      fields: { count: 0 },
      mutators: {
        bump: {
          execute: async () => {
            await gate.promise
            return { value: 5 }
          },
          processor: (raw: { value: number }) => ({ count: raw.value }),
          writes: { count: true },
        },
      },
    })
    const call = capability.bump()
    expect(capability.getSnapshot().fields.count).toBe(0) // no optimistic transition
    gate.resolve(undefined)
    await call
    expect(capability.getSnapshot().fields.count).toBe(5)
  })

  it("a subscription event stamps status success + source; a status change carries its error detail", () => {
    const capability = createData({
      fields: { price: 0 },
      subscriptions: {
        watch: {
          params: {},
          subscribe: (_p: unknown, handlers: SubscriptionHandlers<{ raw: number }>) => {
            handlers.onEvent({ raw: 7 })
            handlers.onStatusChange("error", { error: new Error("socket reset") })
            return () => undefined
          },
          processor: (event: { raw: number }) => ({ price: event.raw }),
          writes: { price: true },
        },
      },
    })
    const release = capability.watch({})
    const info = capability.getSnapshot().info.price
    expect(info?.status).toBe("success")
    expect(info?.source).toBe("watch")
    expect(info?.subscription?.status).toBe("error")
    expect(info?.subscription?.error?.operator).toBe("watch")
    release()
  })

  it("a subscription without a processor uses the raw event as the patch", () => {
    const capability = createData({
      fields: { price: 0 },
      subscriptions: {
        watch: {
          params: {},
          subscribe: (_p: unknown, handlers: SubscriptionHandlers<{ price: number }>) => {
            handlers.onEvent({ price: 99 })
            return () => undefined
          },
          writes: { price: true },
        },
      },
    })
    const release = capability.watch({})
    expect(capability.getSnapshot().fields.price).toBe(99)
    release()
  })
})

describe("describe() -- exhaustive", () => {
  it("reports hasProcessor / hasOptimistic per operation, for every section", () => {
    const capability = createData({
      fields: { a: "", b: "" },
      getters: {
        withProc: {
          execute: async () => ({}),
          processor: (r: Record<string, unknown>) => r,
          writes: true,
        },
        noProc: { execute: async () => ({}), writes: true },
      },
      mutators: {
        optimisticMut: {
          execute: async () => ({}),
          writes: true,
          optimistic: () => ({ a: "x" }),
        },
        plainMut: { execute: async () => ({}), writes: true },
      },
      subscriptions: {
        sub: { subscribe: () => () => undefined, writes: true },
      },
    })
    const d = capability.describe()
    expect(d.getters["withProc"]).toMatchObject({
      kind: "getter",
      hasProcessor: true,
      hasOptimistic: false,
    })
    expect(d.getters["noProc"]).toMatchObject({
      kind: "getter",
      hasProcessor: false,
      hasOptimistic: false,
    })
    expect(d.mutators["optimisticMut"]).toMatchObject({ kind: "mutator", hasOptimistic: true })
    expect(d.mutators["plainMut"]).toMatchObject({
      kind: "mutator",
      hasProcessor: false,
      hasOptimistic: false,
    })
    expect(d.subscriptions["sub"]).toMatchObject({ kind: "subscription", hasOptimistic: false })
  })
})

describe("non-canonicalizable params", () => {
  it("degrade to a distinct per-call synthetic key rather than colliding in one bucket", async () => {
    const capability = createData({
      fields: { n: 0 },
      getters: {
        get: {
          params: {} as { fn: () => void },
          execute: async (params: { fn: () => void }) => {
            params.fn()
            return { n: 1 }
          },
          writes: { n: true },
        },
      },
    })
    // A function param is not canonicalizable -> each call gets its own key.
    await capability.get({ fn: () => undefined })
    await capability.get({ fn: () => undefined })
    const ops = capability.getSnapshot().operations["get"] ?? {}
    // Distinct, sequentially-numbered synthetic keys -- not one shared bucket.
    expect(Object.keys(ops)).toEqual(["~uncanonicalizable-1", "~uncanonicalizable-2"])
  })
})

describe("mutation-hardening: remaining paths", () => {
  it("notifies a plain capability.subscribe() listener whenever operation state changes", async () => {
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          execute: async () => ({ name: "Ada" }),
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })
    let notified = 0
    const unsub = capability.subscribe(() => {
      notified += 1
    })
    await capability.getUser()
    expect(notified).toBeGreaterThan(0)

    // After unsubscribing, further changes never reach this listener.
    const soFar = notified
    unsub()
    await capability.getUser()
    expect(notified).toBe(soFar)
  })

  it("a stale getter's FAILURE never overwrites a newer call's committed success at the field level", async () => {
    const older = deferred<{ name: string }>()
    const newer = deferred<{ name: string }>()
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          params: { id: "" },
          execute: async (p: { id: string }) => (p.id === "old" ? older.promise : newer.promise),
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })
    const oldCall = capability.getUser({ id: "old" })
    const newCall = capability.getUser({ id: "new" })

    newer.resolve({ name: "fresh" })
    await newCall
    expect(capability.getSnapshot().info.user?.status).toBe("success")

    older.reject(new Error("stale failure"))
    await oldCall.catch(() => undefined)
    // The newer success stands; the stale failure only settles its OWN
    // per-params operations entry.
    expect(capability.getSnapshot().info.user?.status).toBe("success")
    expect(capability.getSnapshot().fields.user.name).toBe("fresh")
    const oldKey = canonicalize({ id: "old" }) ?? ""
    expect(capability.getSnapshot().operations["getUser"]?.[oldKey]?.status).toBe("error")
  })

  it("a mutator whose optimistic() returns undefined opens no pending transition", async () => {
    const gate = deferred<{ v: number }>()
    const capability = createData({
      fields: { count: 7 },
      mutators: {
        bump: {
          execute: async () => gate.promise,
          processor: (raw: { v: number }) => ({ count: raw.v }),
          writes: { count: true },
          optimistic: () => undefined,
        },
      },
    })
    const call = capability.bump()
    expect(capability.getSnapshot().fields.count).toBe(7) // unchanged -- no transition
    expect(capability.getSnapshot().info.count?.optimistic).toBeUndefined()
    gate.resolve({ v: 9 })
    await call
    expect(capability.getSnapshot().fields.count).toBe(9)
  })

  it("a mutator with no declared `writes` owns the whole capability (ADR 0011)", async () => {
    const capability = createData({
      fields: { a: "", b: "" },
      mutators: {
        setBoth: {
          execute: async () => ({ a: "x", b: "y" }),
        },
      },
    })
    await capability.setBoth()
    // `writes` defaulted to `true` -> the whole patch is accepted and applied.
    expect(capability.getSnapshot().fields).toEqual({ a: "x", b: "y" })
  })

  it("a mutator's operations entry records status + settledAt on both success and failure", async () => {
    const capability = createData({
      fields: { n: 0 },
      mutators: {
        ok: {
          execute: async () => ({ n: 1 }),
          processor: (r: { n: number }) => r,
          writes: { n: true },
        },
        bad: {
          execute: async (): Promise<{ n: number }> => {
            throw new Error("x")
          },
          processor: (r: { n: number }) => r,
          writes: { n: true },
        },
      },
    })
    const key = canonicalize(undefined) ?? ""
    await capability.ok()
    expect(capability.getSnapshot().operations["ok"]?.[key]).toMatchObject({ status: "success" })
    expect(capability.getSnapshot().operations["ok"]?.[key]?.settledAt).toBeTypeOf("number")
    await capability.bad().catch(() => undefined)
    expect(capability.getSnapshot().operations["bad"]?.[key]).toMatchObject({ status: "error" })
    expect(capability.getSnapshot().operations["bad"]?.[key]?.settledAt).toBeTypeOf("number")
  })

  it("a subscription event stamps status success + settledAt on its own operations entry", () => {
    const capability = createData({
      fields: { price: 0 },
      subscriptions: {
        watch: {
          params: {},
          subscribe: (_p: unknown, handlers: SubscriptionHandlers<{ price: number }>) => {
            handlers.onEvent({ price: 5 })
            return () => undefined
          },
          processor: (event: { price: number }) => ({ price: event.price }),
          writes: { price: true },
        },
      },
    })
    const key = canonicalize({}) ?? ""
    const release = capability.watch({})
    expect(capability.getSnapshot().operations["watch"]?.[key]).toMatchObject({ status: "success" })
    expect(capability.getSnapshot().operations["watch"]?.[key]?.settledAt).toBeTypeOf("number")
    release()
  })

  it("a fresh capability's snapshot is reference-stable and its operations map is empty", () => {
    const capability = createData({
      fields: { n: 0 },
      getters: {
        g: {
          execute: async () => ({ n: 1 }),
          processor: (r: { n: number }) => r,
          writes: { n: true },
        },
      },
    })
    const s1 = capability.getSnapshot()
    const s2 = capability.getSnapshot()
    expect(s1).toBe(s2)
    expect(s1.operations).toEqual({})
  })
})

describe("mutation-hardening: stale-settle only touches operations", () => {
  it("a stale getter's own settle notifies capability listeners and yields a fresh snapshot, without a store change", async () => {
    const older = deferred<{ name: string }>()
    const newer = deferred<{ name: string }>()
    const capability = createData({
      fields: { user: { name: "" } },
      getters: {
        getUser: {
          params: { id: "" },
          execute: async (p: { id: string }) => (p.id === "old" ? older.promise : newer.promise),
          processor: (raw: { name: string }) => ({ user: raw }),
          writes: { user: true },
        },
      },
    })
    let notified = 0
    capability.subscribe(() => {
      notified += 1
    })

    const oldCall = capability.getUser({ id: "old" })
    const newCall = capability.getUser({ id: "new" })
    newer.resolve({ name: "fresh" })
    await newCall

    const afterNewer = capability.getSnapshot()
    const notifiedAfterNewer = notified

    older.resolve({ name: "stale" })
    await oldCall

    // The stale settle changed only `operations` -- fields/info are untouched
    // (same refs) -- but it still produced a new top-level snapshot and rang
    // the capability listener.
    const afterStale = capability.getSnapshot()
    expect(notified).toBeGreaterThan(notifiedAfterNewer)
    expect(afterStale).not.toBe(afterNewer)
    expect(afterStale.operations).not.toBe(afterNewer.operations)
    expect(afterStale.fields).toBe(afterNewer.fields)
    expect(afterStale.info).toBe(afterNewer.info)
  })

  it("maxOperationHistory: 0 retains no per-operation entries at all", async () => {
    const capability = createData(
      {
        fields: { n: 0 },
        getters: {
          g: {
            params: { id: "" },
            execute: async (p: { id: string }) => ({ n: Number(p.id) }),
            processor: (r: { n: number }) => r,
            writes: { n: true },
          },
        },
      },
      { maxOperationHistory: 0 },
    )
    await capability.g({ id: "1" })
    await capability.g({ id: "2" })
    expect(capability.getSnapshot().operations["g"] ?? {}).toEqual({})
  })

  it("a nonsensical negative maxOperationHistory still terminates (retains nothing)", async () => {
    const capability = createData(
      {
        fields: { n: 0 },
        getters: {
          g: {
            execute: async () => ({ n: 1 }),
            processor: (r: { n: number }) => r,
            writes: { n: true },
          },
        },
      },
      { maxOperationHistory: -1 },
    )
    await capability.g()
    expect(capability.getSnapshot().operations["g"] ?? {}).toEqual({})
  })

  it("maxOperationHistory: 1 retains exactly the most recent call", async () => {
    const capability = createData(
      {
        fields: { n: 0 },
        getters: {
          g: {
            params: { id: "" },
            execute: async (p: { id: string }) => ({ n: Number(p.id) }),
            processor: (r: { n: number }) => r,
            writes: { n: true },
          },
        },
      },
      { maxOperationHistory: 1 },
    )
    await capability.g({ id: "1" })
    await capability.g({ id: "2" })
    const entries = capability.getSnapshot().operations["g"] ?? {}
    expect(Object.keys(entries)).toEqual([canonicalize({ id: "2" }) ?? ""])
  })
})
