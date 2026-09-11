import { describe, expect, it } from "vitest"
import * as runtime from "../../src/runtime/index.js"

describe("runtime public barrel exports", () => {
  it("exposes createDataStore, coordinator factory/singleton, and abort utilities", () => {
    expect(runtime.createDataStore).toBeTypeOf("function")
    expect(runtime.createCoordinator).toBeTypeOf("function")
    expect(runtime.defaultCoordinator).toBeDefined()
    expect(runtime.composeSignals).toBeTypeOf("function")
    expect(runtime.rejectOnAbort).toBeTypeOf("function")
  })

  it("createDataStore imported from the barrel behaves identically to the direct module import", () => {
    const store = runtime.createDataStore({ fields: { id: "" }, info: {} })
    expect(store.getSnapshot().fields.id).toBe("")
  })
})
