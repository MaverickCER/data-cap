import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The docs repeat the size budgets from `ci/size-budgets.mjs` and the coverage floors from
 * `vitest.config.ts` so a reader need not open either file. These tests fail when a copy and its
 * source disagree, so a budget or floor cannot change without its prose.
 */
const root = path.resolve(import.meta.dirname, "..")
const read = (file: string): string => readFileSync(path.join(root, file), "utf8")

interface Budget {
  readonly label: string
  readonly maxGzipBytes: number
}
// A computed specifier keeps TypeScript from resolving the untyped .mjs module.
const budgetsUrl = pathToFileURL(path.join(root, "ci/size-budgets.mjs")).href
const budgets = ((await import(budgetsUrl)) as { default: readonly Budget[] }).default
const kb = new Map(budgets.map((budget) => [budget.label, budget.maxGzipBytes / 1024]))

/** The value captured by `pattern` in `file`, as a number; throws when the sentence is gone. */
function numberIn(file: string, pattern: RegExp): number {
  const match = pattern.exec(read(file))
  if (match?.[1] === undefined) throw new Error(`${file} no longer matches ${String(pattern)}`)
  return Number(match[1])
}

describe("size budgets in the docs match ci/size-budgets.mjs", () => {
  it("PERFORMANCE.md lists every budget with its value", () => {
    const rowLabel = (label: string): string =>
      label === "core" ? "`.` (core)" : label === "cli" ? "CLI (`bin`)" : `\`./${label}\``
    const table = new Map(
      [...read("PERFORMANCE.md").matchAll(/^\| (.+?) +\| ([\d.]+) KB +\|/gm)].map((row) => [
        row[1],
        Number(row[2]),
      ]),
    )
    const expected = new Map([...kb].map(([label, value]) => [rowLabel(label), value]))
    expect(table).toEqual(expected)
  })

  it("the prose budgets in ADOPTION.md and GUIDE.md match", () => {
    expect(numberIn("ADOPTION.md", /Core is budgeted at ([\d.]+) KB/)).toBe(kb.get("core"))
    expect(numberIn("ADOPTION.md", /`\.\/runtime` at ([\d.]+) KB/)).toBe(kb.get("runtime"))
    expect(numberIn("GUIDE.md", /under a ([\d.]+) KB gzip budget/)).toBe(kb.get("helpers"))
    expect(numberIn("GUIDE.md", /has a ([\d.]+) KB gzip budget, and `\.\/build`/)).toBe(
      kb.get("evidence"),
    )
  })

  it("the ceiling named in README.md and ADOPTION.md is the build, plugin and CLI budget", () => {
    const ceilings = new Set(["build", "eslint-plugin", "cli"].map((label) => kb.get(label)))
    expect(ceilings.size).toBe(1)
    for (const file of ["README.md", "ADOPTION.md"]) {
      expect(numberIn(file, /have a ([\d.]+) KB ceiling/)).toBe([...ceilings][0])
    }
  })
})

describe("coverage floors in the docs match vitest.config.ts", () => {
  const config = read("vitest.config.ts")
  const floor = (metric: string): number =>
    numberIn("vitest.config.ts", new RegExp(`^\\s+${metric}: (\\d+),$`, "m"))

  it("reads the four thresholds", () => {
    expect(config).toContain("thresholds: {")
    expect(floor("lines")).toBe(floor("statements"))
  })

  it.each(["README.md", "SECURITY.md"])("%s states the same floors", (file) => {
    const match = /(\d+)% branches, (\d+)% functions, and (\d+)% lines and statements/.exec(
      read(file),
    )
    expect(match?.slice(1).map(Number)).toEqual([
      floor("branches"),
      floor("functions"),
      floor("lines"),
    ])
  })
})
