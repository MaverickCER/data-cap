import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import type TS from "typescript"
import { pickCompiler, ts } from "../../src/build/typescript.js"
import { assertCompilerApi } from "../../src/build/compiler-api.js"

const classic = { version: "6.0.3", createSourceFile: () => "classic" }
const bundled = { version: "6.0.2", createSourceFile: () => "bundled" }
const typescript7 = { version: "7.0.2", versionMajorMinor: "7.0" }

function loader(modules: Record<string, unknown>): {
  load: (id: string) => unknown
  ids: string[]
} {
  const ids: string[] = []
  return {
    ids,
    load(id) {
      ids.push(id)
      if (!(id in modules)) {
        throw Object.assign(new Error(`Cannot find module '${id}'`), { code: "MODULE_NOT_FOUND" })
      }
      return modules[id]
    },
  }
}

describe("pickCompiler", () => {
  it("uses the consumer's typescript when it exposes the classic API, without touching the bundled one", () => {
    const { load, ids } = loader({ typescript: classic, "@typescript/typescript6": bundled })
    expect(pickCompiler(load)).toBe(classic)
    expect(ids).toEqual(["typescript"])
  })

  it("falls back to the bundled TypeScript 6 when the consumer's typescript has no classic API (TypeScript 7)", () => {
    const { load, ids } = loader({ typescript: typescript7, "@typescript/typescript6": bundled })
    expect(pickCompiler(load)).toBe(bundled)
    expect(ids).toEqual(["typescript", "@typescript/typescript6"])
  })

  it("falls back to the bundled TypeScript 6 when the consumer has no typescript installed", () => {
    const { load } = loader({ "@typescript/typescript6": bundled })
    expect(pickCompiler(load)).toBe(bundled)
  })

  it("hands back the consumer's module when neither has the API, so assertCompilerApi can explain", () => {
    const { load } = loader({ typescript: typescript7, "@typescript/typescript6": typescript7 })
    const picked = pickCompiler(load)
    expect(picked).toBe(typescript7)
    expect(() => {
      assertCompilerApi(picked)
    }).toThrow(/typescript 7\.0\.2 does not expose it/)
  })

  it("hands back an empty module when nothing can be loaded at all", () => {
    const { load } = loader({})
    const picked = pickCompiler(load)
    expect(picked).toEqual({})
    expect(() => {
      assertCompilerApi(picked)
    }).toThrow(/bundled @typescript\/typescript6 could not be loaded/)
  })

  it("treats ERR_MODULE_NOT_FOUND (an ESM-style miss) as not installed too", () => {
    const load = (id: string): unknown => {
      if (id === "typescript") {
        throw Object.assign(new Error("not here"), { code: "ERR_MODULE_NOT_FOUND" })
      }
      return bundled
    }
    expect(pickCompiler(load)).toBe(bundled)
  })

  it("rethrows a load failure that is not 'not installed' instead of masking it with the fallback", () => {
    const broken = new Error("Unexpected token in typescript.js")
    const load = (id: string): unknown => {
      if (id === "typescript") throw broken
      return bundled
    }
    expect(() => pickCompiler(load)).toThrow(broken)
  })

  it("rethrows a failure that carries a different error code", () => {
    const denied = Object.assign(new Error("denied"), { code: "EACCES" })
    expect(() =>
      pickCompiler(() => {
        throw denied
      }),
    ).toThrow(denied)
  })

  it("rethrows a thrown null as-is rather than failing while inspecting it", () => {
    const thrown: unknown = null
    let caught: unknown = "nothing was thrown"
    try {
      pickCompiler(() => {
        throw thrown
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeNull()
  })

  it("does not mistake a null or non-object module for a compiler", () => {
    const { load } = loader({ typescript: null, "@typescript/typescript6": bundled })
    expect(pickCompiler(load)).toBe(bundled)
  })

  it("rejects a createSourceFile that is not a function", () => {
    const { load } = loader({
      typescript: { createSourceFile: "nope" },
      "@typescript/typescript6": bundled,
    })
    expect(pickCompiler(load)).toBe(bundled)
  })
})

describe("the resolved compiler", () => {
  it("exposes the classic API the scanner needs", () => {
    expect(typeof ts.createSourceFile).toBe("function")
  })

  it("ships a loadable bundled @typescript/typescript6 with the classic API (the TypeScript 7 fallback)", () => {
    const real = createRequire(import.meta.url)("@typescript/typescript6") as typeof TS
    expect(real.version).toMatch(/^6\./)
    expect(typeof real.createSourceFile).toBe("function")
  })
})
