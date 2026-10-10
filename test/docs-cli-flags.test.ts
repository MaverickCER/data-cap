import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Every long flag the CLI accepts must be documented in the GUIDE. The flags are the keys of the
 * argument tables in `src/cli/index.ts`; a flag added there without a GUIDE entry fails here, so the
 * GUIDE cannot silently fall behind the CLI.
 */
const root = path.resolve(import.meta.dirname, "..")
const cliSource = readFileSync(path.join(root, "src/cli/index.ts"), "utf8")
const guide = readFileSync(path.join(root, "GUIDE.md"), "utf8")

const flags = [...cliSource.matchAll(/^\s+"(--[a-z][a-z0-9-]*)":/gm)].flatMap(
  (match) => match[1] ?? [],
)

describe("CLI flags documented in the GUIDE", () => {
  it("finds the flags in the CLI argument tables", () => {
    expect(flags.length).toBeGreaterThan(8)
    expect(new Set(flags).size).toBe(flags.length)
  })

  it("mentions every flag by its exact name", () => {
    const missing = flags.filter((flag) => !new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(guide))
    expect(missing, "flags in src/cli/index.ts that GUIDE.md never mentions").toEqual([])
  })
})
