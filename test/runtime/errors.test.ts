import { describe, expect, it } from "vitest"
import { DataCapError } from "../../src/core/errors.js"
import { UnknownGetterError } from "../../src/runtime/errors.js"

describe("UnknownGetterError", () => {
  it("extends DataCapError with a stable code", () => {
    const error = new UnknownGetterError("getUser")
    expect(error).toBeInstanceOf(DataCapError)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe("DATA_CAP_UNKNOWN_GETTER")
    expect(error.name).toBe("UnknownGetterError")
    expect(error.getterName).toBe("getUser")
    expect(error.message).toBe('runGetters: no getter named "getUser" is declared')
  })
})
