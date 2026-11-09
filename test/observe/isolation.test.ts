import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = path.dirname(fileURLToPath(import.meta.url))
const observeDir = path.resolve(here, "../../src/observe")

/** ADR 0072: the observe entry never reaches the compiler, node:fs, or any build module at runtime. */
describe("src/observe import isolation (ADR 0072)", () => {
  const files = readdirSync(observeDir).filter((name) => name.endsWith(".ts"))

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} imports only types from outside observe/, and no node: or typescript modules`, () => {
      const source = readFileSync(path.join(observeDir, file), "utf8")
      const imports = [
        ...source.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^"']*from\s+["']([^"']+)["']/gm),
      ]
      for (const match of imports) {
        const isTypeOnly = match[1] !== undefined
        const specifier = match[2]!
        expect(specifier.startsWith("node:"), `${file} imports ${specifier}`).toBe(false)
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^typescript$|^@typescript\//)
        if (!specifier.startsWith("./")) {
          expect(isTypeOnly, `${file} has a runtime import of ${specifier}`).toBe(true)
        }
      }
    })
  }
})
