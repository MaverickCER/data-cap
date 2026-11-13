import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DataCapError } from "../src/core/errors.js"

/**
 * The GUIDE's error-class table is hand-written. This test fails when a class that extends
 * `DataCapError` is exported from a package entry but missing from that table, or listed with
 * a different `code`.
 */
// Mutation testing runs this file from a `.stryker-tmp/sandbox-<id>/` copy, which git ignores and whose
// sources are instrumented. Documents and sources are read as text from the original tree.
const sandbox = `${path.sep}.stryker-tmp${path.sep}`
const checkout = path.resolve(import.meta.dirname, "..")
const root = checkout.includes(sandbox) ? checkout.slice(0, checkout.indexOf(sandbox)) : checkout
const read = (file: string): string => readFileSync(path.join(root, file), "utf8")

/** Maps each `package.json` export to its source file through the tsup entry that builds it. */
function entrySources(): string[] {
  const exportsField = (JSON.parse(read("package.json")) as { exports: Record<string, unknown> })
    .exports
  const tsupEntries = new Map(
    [...read("tsup.config.ts").matchAll(/entry:\s*\{\s*"?([\w/-]+)"?:\s*"(src\/[^"]+)"/g)].map(
      (match) => [match[1], match[2]] as const,
    ),
  )
  const sources: string[] = []
  for (const target of Object.values(exportsField)) {
    const built = /"default":"\.\/dist\/([\w/-]+)\.js"/.exec(JSON.stringify(target))?.[1]
    if (built === undefined) continue
    const source = tsupEntries.get(built)
    if (source === undefined) throw new Error(`no tsup entry builds dist/${built}.js`)
    sources.push(source)
  }
  return sources
}

/** The `readonly code = "..."` literal of each class in `src/` that extends `DataCapError`. */
function sourceCodes(): Map<string, string> {
  const files = [
    "src/core/errors.ts",
    "src/runtime/errors.ts",
    "src/build/errors.ts",
    "src/flow/flow-model.ts",
  ]
  const codes = new Map<string, string>()
  for (const file of files) {
    for (const match of read(file).matchAll(
      /class (\w+) extends DataCapError \{\s*readonly code = "([A-Z_]+)"/g,
    )) {
      codes.set(match[1] ?? "", match[2] ?? "")
    }
  }
  return codes
}

function guideTableRows(): string[] {
  const guide = read("GUIDE.md")
  const section = guide.slice(guide.indexOf("### Error classes"))
  return section
    .slice(0, section.indexOf("\n### ", 1))
    .split("\n")
    .filter((line) => line.startsWith("| `"))
}

// Every entry is imported once, while the file loads, as other test files import them. Mutation
// testing then treats each module's load-time code as static: imported inside a test, all of it
// would count as covered by this test, which only compares class names with GUIDE.md.
// Imported from the copy under test, so `instanceof` compares against the same `DataCapError`.
const entries = await Promise.all(
  entrySources().map(
    async (source) => (await import(path.join(checkout, source))) as Record<string, unknown>,
  ),
)

describe("GUIDE error-class table", () => {
  it("lists every exported DataCapError subclass with its code", () => {
    const exported = new Set<string>()
    for (const entry of entries) {
      for (const [name, value] of Object.entries(entry)) {
        if (
          typeof value === "function" &&
          value !== DataCapError &&
          value.prototype instanceof DataCapError
        ) {
          exported.add(name)
        }
      }
    }
    const codes = sourceCodes()
    expect(exported.size).toBeGreaterThanOrEqual(4)
    const rows = guideTableRows()
    for (const name of exported) {
      const code = codes.get(name)
      expect(code, `${name} has no "readonly code" literal in the scanned files`).toBeDefined()
      expect(
        rows.some((row) => row.startsWith(`| \`${name}\` (\`${code ?? ""}\`)`)),
        `GUIDE.md "Error classes" has no row for ${name} (${code ?? ""})`,
      ).toBe(true)
    }
  })
})
