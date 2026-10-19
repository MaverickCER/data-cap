import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import type TS from "typescript"

describe("the bundled compiler", () => {
  it("ships a loadable @typescript/typescript6 with the classic API (the TypeScript 7 fallback)", () => {
    const real = createRequire(import.meta.url)("@typescript/typescript6") as typeof TS
    expect(real.version).toMatch(/^6\./)
    expect(typeof real.createSourceFile).toBe("function")
  })
})
