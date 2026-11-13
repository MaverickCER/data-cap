import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The first-screen copy repeats facts whose source lives elsewhere. These tests fail when a copy
 * and its source disagree: the pitch, the README's output excerpt, the status values and the
 * identifiers the landing page names.
 */
const root = path.resolve(import.meta.dirname, "..")
const read = (file: string): string => readFileSync(path.join(root, file), "utf8")
const readme = read("README.md")

interface Site {
  readonly description: string
  readonly hero: { readonly heading: string; readonly outcome: string }
  readonly demo: { readonly output: string }
}
const site = JSON.parse(read("docs/site.json")) as Site
const description = (JSON.parse(read("package.json")) as { description: string }).description
const skillPurpose = (JSON.parse(read("docs/skill.json")) as { purpose: string }).purpose

/** The README's bold pitch line, without its `**` markers. */
function readmePitch(): string {
  const match = /^\*\*(.+)\*\*$/m.exec(readme)
  if (match?.[1] === undefined) throw new Error("README.md has no bold pitch line")
  return match[1]
}

/** Trimmed, non-blank lines of a fenced block body. */
const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")

/** The `$ npm run docs` block that `npm run verify:readme-example` compares with a fresh run. */
function verifiedRunLines(): string[] {
  const block = /```text\n\$ npm run docs\n([\s\S]*?)\n```/.exec(readme)?.[1]
  if (block === undefined) throw new Error("README.md has no '$ npm run docs' block")
  return lines(block)
}

describe("the pitch", () => {
  const pitch = readmePitch()

  it("is two sentences, and package.json description starts with it", () => {
    expect(pitch.split(/(?<=\.) /)).toHaveLength(2)
    expect(description.startsWith(pitch)).toBe(true)
  })

  it("opens docs/site.json description, and its hero heading and outcome spell it out", () => {
    expect(site.description.startsWith(pitch)).toBe(true)
    expect(`${site.hero.heading} ${site.hero.outcome}`).toBe(pitch)
  })

  it("opens the agent skill's purpose", () => {
    expect(skillPurpose.startsWith(pitch)).toBe(true)
  })
})

describe("output excerpts", () => {
  it("the README excerpt after the try-it line is a run of lines from the verified block", () => {
    const excerpt = /Try it in a TypeScript project[\s\S]*?```text\n([\s\S]*?)\n```/.exec(
      readme,
    )?.[1]
    expect(excerpt).toBeDefined()
    const run = verifiedRunLines()
    const excerptLines = lines(excerpt ?? "")
    expect(excerptLines.length).toBeGreaterThan(1)
    const start = run.indexOf(excerptLines[0] ?? "")
    expect(start).toBeGreaterThan(-1)
    expect(run.slice(start, start + excerptLines.length)).toEqual(excerptLines)
  })

  it("the landing page demo is a run of lines from the verified block", () => {
    const run = verifiedRunLines()
    const demo = lines(site.demo.output)
    expect(run.slice(0, demo.length)).toEqual(demo)
  })
})

describe("status values", () => {
  it("README lists the DataStatus union from src/core/types.ts, in order", () => {
    const union = /export type DataStatus = ([^\n]+)/.exec(read("src/core/types.ts"))?.[1] ?? ""
    const source = [...union.matchAll(/"(\w+)"/g)].map((match) => match[1])
    const listed = /status values \(([^)]+)\)/.exec(readme)?.[1] ?? ""
    expect(source.length).toBeGreaterThan(3)
    expect([...listed.matchAll(/`(\w+)`/g)].map((match) => match[1])).toEqual(source)
  })
})

describe("identifiers on the landing page", () => {
  const declarations = readdirSync(path.join(root, ".repo-contract/api-contract"))
    .map((entry) => path.join(".repo-contract/api-contract", entry, "baseline.d.ts"))
    .map(read)
    .join("\n")
  // Names from other libraries, and option or property keys rather than exports.
  const foreign = new Set(["fetch", "useState"])
  const properties = new Set(["info", "owner", "strictFlow"])

  it("names only declarations the package exports, or real property keys", () => {
    const names = [...JSON.stringify(site).matchAll(/`([A-Za-z]\w*)(?:\(\))?`/g)].map(
      (match) => match[1] ?? "",
    )
    expect(names.length).toBeGreaterThan(10)
    const missing = names.filter((name) => {
      if (foreign.has(name)) return false
      if (properties.has(name)) return !new RegExp(`readonly ${name}\\??:`).test(declarations)
      return !new RegExp(
        `export declare (?:abstract )?(?:function|interface|type|class|const) ${name}\\b`,
      ).test(declarations)
    })
    expect(missing, "code spans in docs/site.json that name no export").toEqual([])
  })
})
