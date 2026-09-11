import { describe, expect, it } from "vitest"
import * as dataCap from "../../src/core/index.js"

describe("public barrel exports", () => {
  it("exposes buildData, documentData, fields, and the error hierarchy", () => {
    expect(dataCap.buildData).toBeTypeOf("function")
    expect(dataCap.documentData).toBeTypeOf("function")
    // Called directly (rather than referenced bare) so the method isn't
    // detached from its object -- avoids `@typescript-eslint/unbound-method`
    // while still proving both helpers are reachable through the barrel.
    expect(dataCap.fields.nullable("")).toMatchObject({ inner: "" })
    expect(dataCap.fields.optional("")).toMatchObject({ inner: "" })
    expect(dataCap.DataCapError).toBeTypeOf("function")
    expect(dataCap.InvalidFieldDefaultError).toBeTypeOf("function")
  })

  it("buildData imported from the barrel behaves identically to the direct module import", () => {
    const capability = dataCap.buildData({ fields: { id: "" } })
    expect(capability.fields.id).toBe("")
    expect(capability.info).toEqual({})
  })
})
