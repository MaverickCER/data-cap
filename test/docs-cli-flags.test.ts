import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { helpText } from "../src/cli/index.js"

/**
 * The GUIDE's CLI flag table and exit-code table restate `--help`. These tests fail when the two
 * drift apart:
 *
 * - every long flag in the argument tables of `src/cli/index.ts` is in the GUIDE;
 * - each default the GUIDE states matches the `(default: ...)` in `helpText()`;
 * - each meaning opens with that flag's `helpText()` description;
 * - the exit codes the GUIDE lists are the ones the CLI and the Action's wrapper set.
 */
// Mutation testing runs this file from a `.stryker-tmp/sandbox-<id>/` copy, which git ignores and whose
// sources are instrumented. Documents and sources are read from the original tree.
const sandbox = `${path.sep}.stryker-tmp${path.sep}`
const checkout = path.resolve(import.meta.dirname, "..")
const root = checkout.includes(sandbox) ? checkout.slice(0, checkout.indexOf(sandbox)) : checkout
const read = (file: string): string => readFileSync(path.join(root, file), "utf8")
const cliSource = read("src/cli/index.ts")
const guide = read("GUIDE.md")

const flags = [...cliSource.matchAll(/^\s+"(--[a-z][a-z0-9-]*)":/gm)].flatMap(
  (match) => match[1] ?? [],
)

/** Lowercase, without code spans, quotes, a trailing period or repeated spaces. */
const normalize = (text: string): string =>
  text.replace(/[`"]/g, "").replace(/\s+/g, " ").trim().replace(/\.$/, "").toLowerCase()

/** Each flag's `helpText()` description, its continuation lines joined. */
function helpDescriptions(): Map<string, string> {
  const descriptions = new Map<string, string>()
  let current: string | undefined
  for (const line of helpText().split("\n")) {
    const flag = /^ {2}(--[a-z][a-z0-9-]*)(?:, -[a-z])?(?: <[^>]+>)? +(\S.*)$/.exec(line)
    if (flag !== null) {
      current = flag[1] ?? ""
      descriptions.set(current, flag[2] ?? "")
    } else if (current !== undefined && /^ {30}\S/.test(line)) {
      descriptions.set(current, `${descriptions.get(current) ?? ""} ${line.trim()}`)
    } else {
      current = undefined
    }
  }
  return descriptions
}

/** Each flag's GUIDE meaning, from the `| Flag | Meaning |` table. */
function guideMeanings(): Map<string, string> {
  const meanings = new Map<string, string>()
  for (const [, flag = "", meaning = ""] of guide.matchAll(
    /^\| `(--[a-z][a-z0-9-]*)[^|]*\| (.+?) +\|$/gm,
  )) {
    meanings.set(flag, meaning)
  }
  return meanings
}

describe("CLI flags documented in the GUIDE", () => {
  it("finds the flags in the CLI argument tables", () => {
    expect(flags.length).toBeGreaterThan(8)
    expect(new Set(flags).size).toBe(flags.length)
  })

  it("mentions every flag by its exact name", () => {
    const missing = flags.filter((flag) => !new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(guide))
    expect(missing, "flags in src/cli/index.ts that GUIDE.md never mentions").toEqual([])
  })

  it("states each default the help text states, and no other", () => {
    // The GUIDE spells a help-text default in plain words. A default changed on either side, or
    // added on one side only, no longer pairs up and fails.
    const guideWordsFor: Readonly<Record<string, string>> = {
      cwd: "the current directory",
      "every .ts/.tsx file": "every `.ts` and `.tsx` file",
      "tsconfig.json at root": "the one at the root",
    }
    const helpDefaults = new Map<string, string>()
    for (const [flag, description] of helpDescriptions()) {
      const value = /\bdefault: ([^)]+)\)$/.exec(description)?.[1]
      if (value !== undefined) helpDefaults.set(flag, guideWordsFor[value] ?? value)
    }
    const guideDefaults = new Map<string, string>()
    for (const [, flag = "", value = ""] of guide.matchAll(
      /^\| `(--[a-z][a-z0-9-]*)[^`]*` +\|.*\bDefault: (.+?)\. +\|$/gm,
    )) {
      guideDefaults.set(flag, value)
    }
    expect(helpDefaults.size).toBeGreaterThan(3)
    expect(guideDefaults).toEqual(helpDefaults)
  })

  it("opens each meaning with that flag's help description, read without its parentheses", () => {
    // A help description splits into clauses at "; ". The GUIDE meaning's first sentences are
    // those clauses, in order. What follows them ("Repeatable.", "Experimental.") is the GUIDE's own.
    const help = helpDescriptions()
    const meanings = guideMeanings()
    expect(help.size).toBe(flags.length)
    expect([...meanings.keys()].sort()).toEqual([...help.keys()].sort())
    for (const [flag, description] of help) {
      const clauses = description
        .replace(/ \([^()]*\)/g, "")
        .split("; ")
        .map(normalize)
      const sentences = (meanings.get(flag) ?? "").split(/(?<=\.) +(?=[A-Z`"])/).map(normalize)
      expect(sentences.slice(0, clauses.length), `GUIDE meaning of ${flag}`).toEqual(clauses)
    }
  })
})

describe("CLI exit codes documented in the GUIDE", () => {
  it("lists exactly the codes the CLI and the Action's wrapper set", () => {
    // `process.exitCode = 1` or `= cond ? 0 : 1` in the CLI, `return 1` in `runInitCommand`, and
    // `exit-code=2` in the Action's wrapper.
    const set = new Set<string>()
    const patterns: readonly (readonly [string, RegExp])[] = [
      ["src/cli/index.ts", /process\.exitCode = (?:(\d)|[^\n]*\? (\d) : (\d))$/gm],
      ["src/cli/init.ts", /^ {4}return (\d)$/gm],
      ["scripts/github-action/run-cli.sh", /exit-code=(\d)"/g],
    ]
    for (const [file, pattern] of patterns) {
      for (const match of read(file).matchAll(pattern)) {
        // An unmatched alternative's group is undefined at runtime, whatever its static type.
        for (const code of match.slice(1) as (string | undefined)[]) {
          if (code !== undefined) set.add(code)
        }
      }
    }
    const listed = new Set(
      [...guide.matchAll(/^ {3}\| `(\d)` +\|/gm)].flatMap((match) => match[1] ?? []),
    )
    expect(set.size).toBeGreaterThanOrEqual(2)
    expect([...listed].sort()).toEqual([...set].sort())
  })
})
