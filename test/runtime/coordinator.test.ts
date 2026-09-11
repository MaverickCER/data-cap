import { describe, expect, it, vi } from "vitest"
import { createCoordinator, defaultCoordinator } from "../../src/runtime/coordinator.js"
import type { SubscriptionHandlers } from "../../src/runtime/coordinator.js"

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

describe("coordinator.dedupe", () => {
  it("shares one execution across concurrent calls with canonically-equal params (same function identity)", async () => {
    const coordinator = createCoordinator()
    const execute = vi.fn(
      async (params: { id: string }, _signal: AbortSignal) => `result-${params.id}`,
    )

    const controller = new AbortController()
    const [a, b] = await Promise.all([
      coordinator.dedupe(execute, { id: "1" }, controller.signal),
      coordinator.dedupe(execute, { id: "1" }, controller.signal),
    ])

    expect(execute).toHaveBeenCalledTimes(1)
    expect(a).toBe("result-1")
    expect(b).toBe("result-1")
  })

  it("does not dedupe calls with different (canonically-distinct) params", async () => {
    const coordinator = createCoordinator()
    const execute = vi.fn(async (params: { id: string }) => `result-${params.id}`)
    const controller = new AbortController()

    await Promise.all([
      coordinator.dedupe(execute, { id: "1" }, controller.signal),
      coordinator.dedupe(execute, { id: "2" }, controller.signal),
    ])

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("keeps a per-function map so two distinct in-flight keys can BOTH be deduped independently", async () => {
    const coordinator = createCoordinator()
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve))
    const execute = vi.fn(async (params: { id: string }) => {
      await gate
      return `result-${params.id}`
    })
    const controller = new AbortController()

    const a1 = coordinator.dedupe(execute, { id: "1" }, controller.signal)
    const b = coordinator.dedupe(execute, { id: "2" }, controller.signal)
    // while BOTH are still in flight, a repeat of the first key must reuse a1's
    // execution -- the second key must not have clobbered the first's entry
    const a2 = coordinator.dedupe(execute, { id: "1" }, controller.signal)

    releaseFirst()
    await Promise.all([a1, b, a2])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(await a2).toBe("result-1")
  })

  it("does not dedupe calls to different function references, even if behaviorally identical", async () => {
    const coordinator = createCoordinator()
    const executeA = vi.fn(async (params: { id: string }) => `result-${params.id}`)
    const executeB = vi.fn(async (params: { id: string }) => `result-${params.id}`)
    const controller = new AbortController()

    await Promise.all([
      coordinator.dedupe(executeA, { id: "1" }, controller.signal),
      coordinator.dedupe(executeB, { id: "1" }, controller.signal),
    ])

    expect(executeA).toHaveBeenCalledTimes(1)
    expect(executeB).toHaveBeenCalledTimes(1)
  })

  it("removes the dedup entry on settle -- a later call with the same params triggers a fresh execution, not a stale reuse", async () => {
    const coordinator = createCoordinator()
    const execute = vi.fn(async (params: { id: string }) => `result-${params.id}`)
    const controller = new AbortController()

    await coordinator.dedupe(execute, { id: "1" }, controller.signal)
    await coordinator.dedupe(execute, { id: "1" }, controller.signal)

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("removes the dedup entry on failure too, not just success", async () => {
    const coordinator = createCoordinator()
    const execute = vi.fn(async () => {
      throw new Error("boom")
    })
    const controller = new AbortController()

    await expect(coordinator.dedupe(execute, { id: "1" }, controller.signal)).rejects.toThrow(
      "boom",
    )
    await expect(coordinator.dedupe(execute, { id: "1" }, controller.signal)).rejects.toThrow(
      "boom",
    )
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("non-canonicalizable params never dedupe -- execute runs every time, never throws, never silently collides", async () => {
    const coordinator = createCoordinator()
    const execute = vi.fn(async () => "result")
    const controller = new AbortController()
    const nonCanonicalizableParams = { cb: () => undefined }

    await Promise.all([
      coordinator.dedupe(execute, nonCanonicalizableParams, controller.signal),
      coordinator.dedupe(execute, nonCanonicalizableParams, controller.signal),
    ])

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("a caller's own aborted signal rejects only their own wait, never the shared execution for other callers", async () => {
    const coordinator = createCoordinator()
    const work = deferred<string>()
    const execute = vi.fn(() => work.promise)

    const controllerA = new AbortController()
    const controllerB = new AbortController()

    const resultA = coordinator.dedupe(execute, { id: "1" }, controllerA.signal)
    const resultB = coordinator.dedupe(execute, { id: "1" }, controllerB.signal)

    controllerA.abort(new Error("A gave up"))
    await expect(resultA).rejects.toThrow("A gave up")

    // B never aborted -- the shared execution continues, and B still gets the real result.
    work.resolve("real-result")
    await expect(resultB).resolves.toBe("real-result")
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("two independent coordinators never share dedup state", async () => {
    const coordinatorA = createCoordinator()
    const coordinatorB = createCoordinator()
    const execute = vi.fn(async () => "result")
    const controller = new AbortController()

    await Promise.all([
      coordinatorA.dedupe(execute, { id: "1" }, controller.signal),
      coordinatorB.dedupe(execute, { id: "1" }, controller.signal),
    ])

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("defaultCoordinator is a usable, real coordinator instance", async () => {
    const execute = vi.fn(async () => "result")
    const controller = new AbortController()
    await expect(
      defaultCoordinator.dedupe(execute, { id: "unique-default-test" }, controller.signal),
    ).resolves.toBe("result")
  })
})

function makeHandlers(): SubscriptionHandlers<string> & { events: string[]; statuses: string[] } {
  const events: string[] = []
  const statuses: string[] = []
  return {
    events,
    statuses,
    onEvent: (event) => events.push(event),
    onStatusChange: (status) => statuses.push(status),
  }
}

describe("coordinator.acquireSubscription -- lifecycle matrix", () => {
  it("first subscriber creates the transport", () => {
    const coordinator = createCoordinator()
    const subscribeFn = vi.fn((handlers: SubscriptionHandlers<string>) => {
      handlers.onStatusChange("connected")
      return vi.fn()
    })
    coordinator.acquireSubscription(subscribeFn, makeHandlers())
    expect(subscribeFn).toHaveBeenCalledTimes(1)
  })

  it("second subscriber (same function identity) reuses the existing transport", () => {
    const coordinator = createCoordinator()
    const subscribeFn = vi.fn((handlers: SubscriptionHandlers<string>) => {
      handlers.onStatusChange("connected")
      return vi.fn()
    })
    coordinator.acquireSubscription(subscribeFn, makeHandlers())
    coordinator.acquireSubscription(subscribeFn, makeHandlers())
    expect(subscribeFn).toHaveBeenCalledTimes(1)
  })

  it("a late joiner immediately learns the current status without waiting for the next transition", () => {
    const coordinator = createCoordinator()
    const subscribeFn = (handlers: SubscriptionHandlers<string>): (() => void) => {
      handlers.onStatusChange("connected")
      return vi.fn()
    }
    coordinator.acquireSubscription(subscribeFn, makeHandlers())
    const late = makeHandlers()
    coordinator.acquireSubscription(subscribeFn, late)
    expect(late.statuses).toEqual(["connected"])
  })

  it("first unsubscribe does not disconnect the shared transport", () => {
    const coordinator = createCoordinator()
    const teardown = vi.fn()
    const subscribeFn = (): (() => void) => teardown
    const releaseA = coordinator.acquireSubscription(subscribeFn, makeHandlers())
    coordinator.acquireSubscription(subscribeFn, makeHandlers())

    releaseA()
    expect(teardown).not.toHaveBeenCalled()
  })

  it("the final unsubscribe disconnects the transport exactly once", () => {
    const coordinator = createCoordinator()
    const teardown = vi.fn()
    const subscribeFn = (): (() => void) => teardown
    const releaseA = coordinator.acquireSubscription(subscribeFn, makeHandlers())
    const releaseB = coordinator.acquireSubscription(subscribeFn, makeHandlers())

    releaseA()
    releaseB()
    expect(teardown).toHaveBeenCalledTimes(1)

    // Releasing again (e.g. a double-release bug elsewhere) is a safe no-op.
    releaseB()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it("different function references never share a transport, even if behaviorally identical", () => {
    const teardownA = vi.fn()
    const teardownB = vi.fn()
    const coordinator = createCoordinator()
    const subscribeFnA = vi.fn(() => teardownA)
    const subscribeFnB = vi.fn(() => teardownB)

    coordinator.acquireSubscription(subscribeFnA, makeHandlers())
    coordinator.acquireSubscription(subscribeFnB, makeHandlers())

    expect(subscribeFnA).toHaveBeenCalledTimes(1)
    expect(subscribeFnB).toHaveBeenCalledTimes(1)
  })

  it("releasing the same subscription twice never double-decrements the ref count", () => {
    const coordinator = createCoordinator()
    const teardown = vi.fn()
    const subscribeFn = (): (() => void) => teardown
    const releaseA = coordinator.acquireSubscription(subscribeFn, makeHandlers())
    coordinator.acquireSubscription(subscribeFn, makeHandlers()) // B keeps the transport alive

    releaseA()
    releaseA() // a stray second call must NOT count as a third holder releasing

    expect(teardown).not.toHaveBeenCalled() // B is still subscribed
  })

  it("releasing after the transport was already fully torn down is a safe no-op, not a crash", () => {
    const coordinator = createCoordinator()
    const teardown = vi.fn()
    const subscribeFn = (): (() => void) => teardown
    const releaseA = coordinator.acquireSubscription(subscribeFn, makeHandlers())
    const releaseB = coordinator.acquireSubscription(subscribeFn, makeHandlers())

    releaseA()
    releaseB() // registry entry deleted here
    expect(teardown).toHaveBeenCalledTimes(1)

    expect(() => {
      releaseA()
    }).not.toThrow()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it("fans out one event to every current consumer exactly once -- no duplicate delivery", () => {
    const coordinator = createCoordinator()
    let emit: ((event: string) => void) | undefined
    const subscribeFn = (handlers: SubscriptionHandlers<string>): (() => void) => {
      emit = handlers.onEvent
      return vi.fn()
    }
    const a = makeHandlers()
    const b = makeHandlers()
    coordinator.acquireSubscription(subscribeFn, a)
    coordinator.acquireSubscription(subscribeFn, b)

    emit?.("event-1")
    emit?.("event-2")

    expect(a.events).toEqual(["event-1", "event-2"])
    expect(b.events).toEqual(["event-1", "event-2"])
  })

  it("status changes fan out to every current consumer", () => {
    const coordinator = createCoordinator()
    let changeStatus: ((status: "connected" | "disconnected") => void) | undefined
    const subscribeFn = (handlers: SubscriptionHandlers<string>): (() => void) => {
      changeStatus = (status) => {
        handlers.onStatusChange(status)
      }
      return vi.fn()
    }
    const a = makeHandlers()
    const b = makeHandlers()
    coordinator.acquireSubscription(subscribeFn, a)
    coordinator.acquireSubscription(subscribeFn, b)

    changeStatus?.("disconnected")

    expect(a.statuses.at(-1)).toBe("disconnected")
    expect(b.statuses.at(-1)).toBe("disconnected")
  })

  it("repeated disconnect/reconnect status transitions all reach every consumer, in order", () => {
    const coordinator = createCoordinator()
    let changeStatus: ((status: string) => void) | undefined
    const subscribeFn = (handlers: SubscriptionHandlers<string>): (() => void) => {
      changeStatus = (status) => {
        handlers.onStatusChange(status as "connected")
      }
      return vi.fn()
    }
    const consumer = makeHandlers()
    coordinator.acquireSubscription(subscribeFn, consumer)

    for (const status of [
      "connected",
      "reconnecting",
      "connected",
      "reconnecting",
      "disconnected",
    ]) {
      changeStatus?.(status)
    }

    expect(consumer.statuses).toEqual([
      "connected",
      "reconnecting",
      "connected",
      "reconnecting",
      "disconnected",
    ])
  })

  it("reconnect after zero subscribers: re-acquiring after full teardown establishes a fresh transport", () => {
    const coordinator = createCoordinator()
    const subscribeFn = vi.fn(() => vi.fn())

    const release = coordinator.acquireSubscription(subscribeFn, makeHandlers())
    release()
    expect(subscribeFn).toHaveBeenCalledTimes(1)

    coordinator.acquireSubscription(subscribeFn, makeHandlers())
    expect(subscribeFn).toHaveBeenCalledTimes(2)
  })

  it("a throwing subscribe callback propagates to the first caller and leaves no phantom registry entry", () => {
    const coordinator = createCoordinator()
    const subscribeFn = vi.fn(() => {
      throw new Error("connection failed")
    })

    expect(() => coordinator.acquireSubscription(subscribeFn, makeHandlers())).toThrow(
      "connection failed",
    )

    // No phantom entry was left behind -- a fresh attempt calls subscribeFn again.
    const workingSubscribeFn = vi.fn(() => vi.fn())
    coordinator.acquireSubscription(workingSubscribeFn, makeHandlers())
    expect(workingSubscribeFn).toHaveBeenCalledTimes(1)
  })

  it("a throwing unsubscribe callback still removes the registry entry (via try/finally), enabling a fresh reconnect", () => {
    const coordinator = createCoordinator()
    const teardown = vi.fn(() => {
      throw new Error("teardown failed")
    })
    const subscribeFn = vi.fn(() => teardown)

    const release = coordinator.acquireSubscription(subscribeFn, makeHandlers())
    expect(() => {
      release()
    }).toThrow("teardown failed")

    coordinator.acquireSubscription(subscribeFn, makeHandlers())
    expect(subscribeFn).toHaveBeenCalledTimes(2)
  })

  it("a consumer unsubscribing from within its own onEvent handler does not crash delivery to other consumers", () => {
    const coordinator = createCoordinator()
    let emit: ((event: string) => void) | undefined
    const subscribeFn = (handlers: SubscriptionHandlers<string>): (() => void) => {
      emit = handlers.onEvent
      return vi.fn()
    }

    const bEvents: string[] = []
    const bHandlers: SubscriptionHandlers<string> = {
      onEvent: (e) => bEvents.push(e),
      onStatusChange: () => undefined,
    }
    const state: { release?: () => void } = {}
    const aHandlers: SubscriptionHandlers<string> = {
      onEvent: () => {
        state.release?.()
      },
      onStatusChange: () => undefined,
    }

    state.release = coordinator.acquireSubscription(subscribeFn, aHandlers)
    coordinator.acquireSubscription(subscribeFn, bHandlers)

    expect(() => emit?.("event-1")).not.toThrow()
    expect(bEvents).toEqual(["event-1"])
  })
})
