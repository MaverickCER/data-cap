import { describe, expect, it, vi } from "vitest"
import {
  abortReason,
  defaultBackoff,
  delay,
  isStillDefault,
  withRetry,
} from "../../src/runtime/retry.js"

describe("withRetry", () => {
  it("returns the result immediately when the first attempt succeeds -- no retry", async () => {
    const fn = vi.fn(async () => "ok")
    const controller = new AbortController()
    await expect(withRetry(fn, controller.signal)).resolves.toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("uses the default capped-exponential backoff when delayMs is not provided", async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const fn = vi.fn(async () => {
        calls += 1
        if (calls < 2) throw new Error("not yet")
        return "ok"
      })
      const controller = new AbortController()

      const result = withRetry(fn, controller.signal, { maxAttempts: 1 })
      await vi.advanceTimersByTimeAsync(1000) // default backoff for attempt 1 is 1000ms
      await expect(result).resolves.toBe("ok")
      expect(fn).toHaveBeenCalledTimes(2)
    } finally {
      // Always restored, even when an assertion above throws (e.g. under a
      // mutation that breaks withRetry's exit condition) -- an uncaught
      // failure here would otherwise leave fake timers active for every
      // later test in this worker, turning an unrelated later test's real
      // `setTimeout`-based await into a hang instead of a clean failure.
      vi.useRealTimers()
    }
  })

  it("retries up to maxAttempts, then throws the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("transient")
    })
    const controller = new AbortController()

    await expect(
      withRetry(fn, controller.signal, { maxAttempts: 2, delayMs: () => 0 }),
    ).rejects.toThrow("transient")
    // 1 initial attempt + 2 retries = 3 calls.
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("succeeds on a later attempt after earlier failures", async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error("not yet")
      return "eventually-ok"
    })
    const controller = new AbortController()

    await expect(
      withRetry(fn, controller.signal, { maxAttempts: 5, delayMs: () => 0 }),
    ).resolves.toBe("eventually-ok")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("respects shouldRetry -- stops immediately when the predicate declines", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent")
    })
    const controller = new AbortController()

    await expect(
      withRetry(fn, controller.signal, {
        maxAttempts: 5,
        delayMs: () => 0,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("permanent")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("passes the error and 1-indexed attempt number to shouldRetry", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fail")
    })
    const shouldRetry = vi.fn(() => true)
    const controller = new AbortController()

    await expect(
      withRetry(fn, controller.signal, { maxAttempts: 2, delayMs: () => 0, shouldRetry }),
    ).rejects.toThrow()

    expect(shouldRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1)
    expect(shouldRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2)
  })

  it("never calls fn at all when the signal is already aborted", async () => {
    const fn = vi.fn(async () => "ok")
    const controller = new AbortController()
    controller.abort(new Error("pre-aborted"))

    await expect(withRetry(fn, controller.signal)).rejects.toThrow("pre-aborted")
    expect(fn).not.toHaveBeenCalled()
  })

  it("never retries after the signal aborts mid-retry-delay", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fail")
    })
    const controller = new AbortController()

    const result = withRetry(fn, controller.signal, {
      maxAttempts: 5,
      delayMs: () => 50,
    })
    // Abort during what would be the inter-attempt delay.
    setTimeout(() => {
      controller.abort(new Error("cancelled mid-retry"))
    }, 5)

    await expect(result).rejects.toThrow()
    // Exactly one attempt: the delay resolves early on abort, and the loop's
    // own abort check (inside the catch block) then throws instead of retrying.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("fails fast with a clear error instead of looping forever when maxAttempts is not a sane finite number", async () => {
    const fn = vi.fn(async () => {
      throw new Error("transient")
    })
    const controller = new AbortController()

    // `attempt > maxAttempts` can never fire when maxAttempts is Infinity --
    // a real, if pathological, caller mistake (e.g. a mis-parsed config
    // value) this fail-safe iteration ceiling exists to catch.
    await expect(
      withRetry(fn, controller.signal, { maxAttempts: Number.POSITIVE_INFINITY, delayMs: () => 0 }),
    ).rejects.toThrow("exceeded 100 loop iterations")
    expect(fn).toHaveBeenCalledTimes(101)
  })

  it("never retries a non-Error rejection either -- shouldRetry still governs, and the exact value propagates", async () => {
    const fn = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately testing a non-Error rejection value
      throw "string-error"
    })
    const controller = new AbortController()

    await expect(
      withRetry(fn, controller.signal, {
        maxAttempts: 1,
        delayMs: () => 0,
        shouldRetry: () => false,
      }),
    ).rejects.toBe("string-error")
  })
})

describe("defaultBackoff", () => {
  it("is capped exponential: 1s, 2s, 4s, 8s ... then clamped at 30s", () => {
    expect(defaultBackoff(1)).toBe(1000)
    expect(defaultBackoff(2)).toBe(2000)
    expect(defaultBackoff(3)).toBe(4000)
    expect(defaultBackoff(4)).toBe(8000)
    expect(defaultBackoff(100)).toBe(30_000)
  })
})

describe("abortReason", () => {
  it("returns the signal's own reason when it has one", () => {
    const controller = new AbortController()
    const reason = new Error("explicit")
    controller.abort(reason)
    expect(abortReason(controller.signal)).toBe(reason)
  })

  it("synthesizes a named AbortError ('Aborted') when the signal's reason is genuinely undefined", () => {
    const fakeSignal = { reason: undefined } as unknown as AbortSignal
    expect(abortReason(fakeSignal)).toMatchObject({ name: "AbortError", message: "Aborted" })
  })
})

describe("delay", () => {
  it("resolves after the full duration when the signal never aborts", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      let settled = false
      void delay(100, controller.signal).then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(99)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("resolves immediately when the signal is already aborted", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      controller.abort(new Error("gone"))
      let settled = false
      void delay(100_000, controller.signal).then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("resolves early, clearing its timer, the moment the signal aborts during the wait", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const clearSpy = vi.spyOn(globalThis, "clearTimeout")
      const addSpy = vi.spyOn(controller.signal, "addEventListener")
      let settled = false
      void delay(100_000, controller.signal).then(() => {
        settled = true
      })
      expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function), { once: true })
      controller.abort(new Error("mid-wait"))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
      expect(clearSpy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("isStillDefault", () => {
  it("treats identical primitives as still-default", () => {
    expect(isStillDefault("", "")).toBe(true)
    expect(isStillDefault(0, 0)).toBe(true)
    expect(isStillDefault(false, false)).toBe(true)
    expect(isStillDefault(null, null)).toBe(true)
  })

  it("treats deep-equal objects/arrays as still-default, not just reference-equal ones", () => {
    expect(isStillDefault([], [])).toBe(true)
    expect(isStillDefault({ a: 1 }, { a: 1 })).toBe(true)
  })

  it("treats a changed value as no longer default", () => {
    expect(isStillDefault("changed", "")).toBe(false)
    expect(isStillDefault(1, 0)).toBe(false)
    expect(isStillDefault({ a: 2 }, { a: 1 })).toBe(false)
  })

  it("distinguishes falsy-but-different values (0 vs '', false vs null)", () => {
    expect(isStillDefault(0, "")).toBe(false)
    expect(isStillDefault(false, null)).toBe(false)
  })

  it("treats the exact same non-canonicalizable reference as still-default (Object.is fast path)", () => {
    const fn = (): void => undefined
    // No canonical key exists for a function, so this can only pass via the
    // `Object.is` short-circuit -- not the canonicalize comparison.
    expect(isStillDefault(fn, fn)).toBe(true)
    const sym = Symbol("s")
    expect(isStillDefault(sym, sym)).toBe(true)
  })

  it("treats one canonicalizable and one non-canonicalizable value as not-default", () => {
    expect(isStillDefault((): void => undefined, "")).toBe(false)
    expect(isStillDefault("", (): void => undefined)).toBe(false)
  })

  it("conservatively treats a non-canonicalizable value as not-default (never auto-retried)", () => {
    // Two distinct (non-reference-equal) non-canonicalizable values -- if
    // they were the exact same reference, Object.is's fast path would
    // trivially short-circuit to `true` without ever exercising the
    // canonicalize-based comparison this test targets.
    const fnA = (): void => undefined
    const fnB = (): void => undefined
    expect(isStillDefault(fnA, fnB)).toBe(false)
  })
})
