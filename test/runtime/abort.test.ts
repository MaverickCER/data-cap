import { afterEach, describe, expect, it, vi } from "vitest"
import { composeSignals, rejectOnAbort } from "../../src/runtime/abort.js"

describe("composeSignals", () => {
  it("aborts as soon as any input signal aborts", () => {
    const a = new AbortController()
    const b = new AbortController()
    const composed = composeSignals([a.signal, b.signal])
    expect(composed.aborted).toBe(false)

    b.abort(new Error("b gave up"))
    expect(composed.aborted).toBe(true)
  })

  it("is already aborted if any input is already aborted at composition time", () => {
    const a = new AbortController()
    a.abort(new Error("already gone"))
    const composed = composeSignals([a.signal, new AbortController().signal])
    expect(composed.aborted).toBe(true)
  })

  it("delegates to the native AbortSignal.any() when it is available", () => {
    const spy = vi.spyOn(AbortSignal, "any")
    try {
      const a = new AbortController()
      const b = new AbortController()
      const composed = composeSignals([a.signal, b.signal])
      expect(spy).toHaveBeenCalledOnce()
      expect(spy).toHaveBeenCalledWith([a.signal, b.signal])
      b.abort(new Error("b"))
      expect(composed.aborted).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  describe("without native AbortSignal.any (manual fallback path)", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- stored only to restore it in afterEach, never called detached from AbortSignal
    const originalAny = AbortSignal.any

    afterEach(() => {
      AbortSignal.any = originalAny
    })

    it("still aborts as soon as any input signal aborts", () => {
      // @ts-expect-error -- deliberately removing the native implementation to exercise the manual fallback
      AbortSignal.any = undefined

      const a = new AbortController()
      const b = new AbortController()
      const composed = composeSignals([a.signal, b.signal])
      expect(composed.aborted).toBe(false)

      a.abort(new Error("a gave up"))
      expect(composed.aborted).toBe(true)
    })

    it("is already aborted if any input is already aborted at composition time", () => {
      // @ts-expect-error -- deliberately removing the native implementation to exercise the manual fallback
      AbortSignal.any = undefined

      const a = new AbortController()
      a.abort(new Error("already gone"))
      const composed = composeSignals([a.signal, new AbortController().signal])
      expect(composed.aborted).toBe(true)
    })
  })
})

describe("rejectOnAbort", () => {
  it("resolves normally when the signal never aborts", async () => {
    const controller = new AbortController()
    await expect(rejectOnAbort(Promise.resolve("ok"), controller.signal)).resolves.toBe("ok")
  })

  it("rejects immediately if the signal is already aborted before the call", async () => {
    const controller = new AbortController()
    controller.abort(new Error("pre-aborted"))
    await expect(rejectOnAbort(Promise.resolve("ok"), controller.signal)).rejects.toThrow(
      "pre-aborted",
    )
  })

  it("still produces a sensible AbortError when the signal aborts with no explicit reason", async () => {
    // Node's own AbortController.abort() (no args) already populates
    // `signal.reason` with its own DOMException -- abortReason()'s
    // `?? new DOMException(...)` fallback only exists for a signal.reason
    // that's genuinely undefined, which isn't reachable through Node's
    // public AbortController API, only defensively guarded against.
    const controller = new AbortController()
    controller.abort()
    await expect(rejectOnAbort(Promise.resolve("ok"), controller.signal)).rejects.toThrow(
      /aborted/i,
    )
  })

  it("rejects if the signal aborts while the promise is still pending", async () => {
    const controller = new AbortController()
    const neverSettles = new Promise<string>(() => undefined)
    const result = rejectOnAbort(neverSettles, controller.signal)
    controller.abort(new Error("aborted while pending"))
    await expect(result).rejects.toThrow("aborted while pending")
  })

  it("synthesizes a named AbortError when the aborted signal's reason is genuinely undefined", async () => {
    // Not reachable through Node's own AbortController (which always populates
    // `reason`), so a hand-rolled signal exercises the `?? new DOMException`
    // fallback and its exact ("Aborted", "AbortError") arguments.
    const fakeSignal = {
      aborted: true,
      reason: undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as AbortSignal
    await expect(rejectOnAbort(Promise.resolve("ok"), fakeSignal)).rejects.toMatchObject({
      name: "AbortError",
      message: "Aborted",
    })
  })

  it("registers its abort listener as a one-shot ({ once: true })", () => {
    const controller = new AbortController()
    const addSpy = vi.spyOn(controller.signal, "addEventListener")
    void rejectOnAbort(new Promise<string>(() => undefined), controller.signal)
    expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function), { once: true })
  })

  it("removes its abort listener once the promise resolves", async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener")
    await rejectOnAbort(Promise.resolve("ok"), controller.signal)
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function))
  })

  it("removes its abort listener once the promise rejects", async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener")
    await expect(
      rejectOnAbort(Promise.reject(new Error("boom")), controller.signal),
    ).rejects.toThrow("boom")
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function))
  })

  it("propagates the promise's own rejection verbatim, even a non-Error value", async () => {
    const controller = new AbortController()
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately testing a non-Error rejection value
    const rejected = Promise.reject("string-rejection")
    await expect(rejectOnAbort(rejected, controller.signal)).rejects.toBe("string-rejection")
  })

  it("resolves with the promise's value when it settles before any abort", async () => {
    const controller = new AbortController()
    vi.useFakeTimers()
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve("slow-ok")
      }, 10)
    })
    const result = rejectOnAbort(slow, controller.signal)
    await vi.advanceTimersByTimeAsync(10)
    await expect(result).resolves.toBe("slow-ok")
    vi.useRealTimers()
  })
})
