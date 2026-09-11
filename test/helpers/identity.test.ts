import { describe, expect, it } from "vitest"
import { computeItemIdentity, reconcileArrayInfo } from "../../src/helpers/identity.js"
import {
  computeItemIdentity as coreComputeItemIdentity,
  reconcileArrayInfo as coreReconcileArrayInfo,
} from "../../src/core/identity.js"

describe("helpers/identity", () => {
  it("re-exports the exact same functions core's own runtime uses, not reimplementations", () => {
    expect(computeItemIdentity).toBe(coreComputeItemIdentity)
    expect(reconcileArrayInfo).toBe(coreReconcileArrayInfo)
  })

  it("still exhibits documented computeItemIdentity behavior through the re-export", () => {
    interface Comment {
      id: string
    }
    const key = computeItemIdentity<Comment>({ id: "42" }, ["id"], [], [])
    expect(typeof key).toBe("string")
  })

  it("still exhibits documented reconcileArrayInfo behavior through the re-export", () => {
    const previous = reconcileArrayInfo<{ id: string }, { touched: boolean }>(
      undefined,
      [{ id: "1" }],
      ["id"],
      "all",
      () => ({ touched: true }),
    )
    const next = reconcileArrayInfo<{ id: string }, { touched: boolean }>(
      previous.info,
      [{ id: "1" }],
      ["id"],
      new Set(),
      () => ({ touched: true }),
    )
    expect(next.info["1"]).toBeUndefined()
    const key = computeItemIdentity<{ id: string }>({ id: "1" }, ["id"], [], [])
    expect(next.info[key]).toBe(previous.info[key])
  })
})
