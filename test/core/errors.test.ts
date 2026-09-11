import { describe, expect, it } from "vitest"
import { DataCapError, InvalidFieldDefaultError } from "../../src/core/errors.js"

describe("InvalidFieldDefaultError", () => {
  it("builds its message from the dotted path and reason, and stamps name/code/path", () => {
    const error = new InvalidFieldDefaultError(
      ["profile", "avatar"],
      "functions are not valid data",
    )
    expect(error).toBeInstanceOf(DataCapError)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe(
      'Invalid field default at "profile.avatar" -- functions are not valid data',
    )
    expect(error.name).toBe("InvalidFieldDefaultError")
    expect(error.code).toBe("DATA_CAP_INVALID_FIELD_DEFAULT")
    expect(error.path).toEqual(["profile", "avatar"])
  })

  it("renders a single-segment path with no separator", () => {
    expect(new InvalidFieldDefaultError(["email"], "cyclic").message).toBe(
      'Invalid field default at "email" -- cyclic',
    )
  })
})
