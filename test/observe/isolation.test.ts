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
      // A side-effect import, a dynamic import() or a require() would escape the pattern above.
      expect(source, `${file} has a side-effect import`).not.toMatch(/^\s*import\s+["']/m)
      expect(source, `${file} has a dynamic import()`).not.toMatch(/\bimport\s*\(/)
      expect(source, `${file} has a require()`).not.toMatch(/\brequire\s*\(/)
    })
  }

  /** Negative-guarantee checklist item 27: observe never performs I/O of its own. */
  it("performs no I/O of its own: no fetch, XMLHttpRequest, sendBeacon, WebSocket, timers or storage", () => {
    for (const file of files) {
      const source = readFileSync(path.join(observeDir, file), "utf8")
      // Strip comments, which may name these APIs while explaining why they are absent.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      expect(code, file).not.toMatch(
        /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|setTimeout|setInterval|console\.(log|warn|error|info))\b/,
      )
      // Time is passed in (`clock`), never read from the environment.
      expect(code, `${file} reads Date.now() or performance.now()`).not.toMatch(
        /\b(Date\.now|performance\.now)\s*\(/,
      )
    }
  })

  it("the built bundle reaches no I/O global either", () => {
    const built = path.resolve(here, "../../dist/observe.js")
    const source = readFileSync(built, "utf8")
    expect(source).not.toMatch(
      /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|indexedDB)\s*\(/,
    )
    expect(source).not.toMatch(/\bprocess\.|\bBuffer\.|require\("node:|from\s*"node:/)
  })
})
