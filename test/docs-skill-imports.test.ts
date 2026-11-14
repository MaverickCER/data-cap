import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * `docs/skill.json` `imports` names symbols in its wording, and the agent skill copies that wording
 * whole into its "Import from" table. This test fails when a named symbol is not an export of that
 * entry, or a named rule is not one `data-cap/eslint-plugin` ships.
 */
const root = path.resolve(import.meta.dirname, "..")
const read = (file: string): string => readFileSync(path.join(root, file), "utf8")

/** Maps each `package.json` export specifier to the source file its tsup entry builds. */
function entrySources(): Map<string, string> {
  const exportsField = (JSON.parse(read("package.json")) as { exports: Record<string, unknown> })
    .exports
  const tsupEntries = new Map(
    [...read("tsup.config.ts").matchAll(/entry:\s*\{\s*"?([\w/-]+)"?:\s*"(src\/[^"]+)"/g)].map(
      (match) => [match[1], match[2]] as const,
    ),
  )
  const sources = new Map<string, string>()
  for (const [subpath, target] of Object.entries(exportsField)) {
    const built = /"default":"\.\/dist\/([\w/-]+)\.js"/.exec(JSON.stringify(target))?.[1]
    const source = built === undefined ? undefined : tsupEntries.get(built)
    if (source !== undefined) sources.set(`data-cap${subpath.slice(1)}`, source)
  }
  return sources
}

const imports = (JSON.parse(read("docs/skill.json")) as { imports: Record<string, string> }).imports

describe("docs/skill.json imports", () => {
  it("names only entries the package exports", () => {
    const exported = Object.keys(
      (JSON.parse(read("package.json")) as { exports: Record<string, unknown> }).exports,
    ).map((subpath) => `data-cap${subpath.slice(1)}`)
    expect(Object.keys(imports).filter((specifier) => !exported.includes(specifier))).toEqual([])
  })

  it("names only symbols and rules that entry exports", async () => {
    const sources = entrySources()
    let checked = 0
    const missing: string[] = []
    for (const [specifier, wording] of Object.entries(imports)) {
      const names = [...wording.matchAll(/`([^`]+)`/g)].flatMap((match) => match[1] ?? [])
      const source = sources.get(specifier)
      const entry =
        source === undefined
          ? {}
          : ((await import(path.join(root, source))) as Record<string, unknown>)
      const rules = Object.keys(
        (entry["default"] as { rules?: Record<string, unknown> } | undefined)?.rules ?? {},
      )
      for (const name of names) {
        if (/^[a-z]+(-[a-z]+)+$/.test(name) && rules.length > 0) {
          checked += 1
          if (!rules.includes(name)) missing.push(`${specifier}: rule ${name}`)
        } else if (/^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(name)) {
          checked += 1
          let value: unknown = entry
          for (const part of name.split(".")) {
            value =
              value !== null && (typeof value === "object" || typeof value === "function")
                ? (value as Record<string, unknown>)[part]
                : undefined
          }
          if (value === undefined) missing.push(`${specifier}: ${name}`)
        }
      }
    }
    expect(checked).toBeGreaterThan(15)
    expect(missing, "names in docs/skill.json imports that the entry does not export").toEqual([])
  })
})
