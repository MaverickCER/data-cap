// Release-blocking backstop for ADR 0058: the *published tarball* -- what
// socket.dev and a consumer actually see -- must contain no `node:fs`
// reference outside the executable-context entry points.
//
// The source-level ESLint rule (`no-restricted-imports` on `src/**` minus
// `src/cli/**`, plus the published `no-node-fs` plugin rule) is fast
// developer feedback; this is the authoritative check on the real artifact,
// independent of whether every contributor runs lint locally.
//
// Modeled on `repo-contract`'s `scripts/verify-no-ambient-capabilities.mjs`
// (and mirrors env-cap's own `scripts/verify-no-ambient-fs.mjs`).

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Every way a bundled module can pull in Node's filesystem module. */
const FORBIDDEN = [
  "node:fs/promises",
  "node:fs",
  'require("fs/promises")',
  "require('fs/promises')",
  'require("node:fs/promises")',
  "require('node:fs/promises')",
  'require("fs")',
  "require('fs')",
  'require("node:fs")',
  "require('node:fs')",
  'import("node:fs")',
  "import('node:fs')",
  'import("fs")',
  "import('fs')",
  'from "fs"',
  "from 'fs'",
  'from "node:fs"',
  "from 'node:fs'",
]

/** The `import` (ESM) target of one `package.json#exports` entry, however it's shaped. */
function resolveExportTarget(entry) {
  if (typeof entry === "string") return entry
  if (entry && typeof entry === "object") {
    return resolveExportTarget(entry.import ?? entry.default)
  }
  return undefined
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function main() {
  const workDir = mkdtempSync(path.join(tmpdir(), "data-cap-verify-fs-"))
  try {
    // `--ignore-scripts` -- `prepare` runs the full build; we only want the
    // tarball, and the build already ran (this script is a `verify`/
    // `prepublishOnly` step).
    const packOutput = execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", workDir, "--json"],
      { cwd: repoRoot, encoding: "utf8" },
    )
    // `--ignore-scripts` doesn't reliably suppress `prepare` across npm
    // versions (confirmed: npm bundled with Node 18/22 still runs it here,
    // while Node 24's doesn't) -- when it fires, the build's own console
    // output lands on this same stdout stream ahead of npm's JSON. Find the
    // real top-level JSON value by trying every `[`/`{` in turn: a candidate
    // inside the JSON itself (e.g. a nested `files` array) leaves trailing
    // content after it parses, so only the true outermost one consumes the
    // rest of the stream cleanly.
    //
    // `npm pack --json`'s top-level shape itself isn't stable either: most
    // npm versions return an array (`[{...}]`), but the very latest npm
    // (confirmed via release.yml's own `npm install -g npm@latest`, used by
    // changesets/action's publish step) returns an object keyed by package
    // name instead (`{"data-cap": {...}}`) for this exact single-package
    // invocation. Handle both.
    const packEntry = (() => {
      const candidates = [...packOutput.matchAll(/[[{]/g)].map((m) => m.index)
      for (const i of candidates) {
        try {
          const parsed = JSON.parse(packOutput.slice(i))
          const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
          if (entry && typeof entry.filename === "string") return entry
        } catch {
          // fall through to the next candidate
        }
      }
      throw new Error(`no valid npm pack manifest found in npm pack output:\n${packOutput}`)
    })()
    const tarballName = packEntry.filename
    const tarball = path.join(workDir, tarballName)
    execFileSync("tar", ["-xzf", tarball, "-C", workDir])

    // npm always packs into a top-level `package/` directory.
    const packageRoot = path.join(workDir, "package")
    if (!existsSync(packageRoot)) {
      throw new Error(`extracted tarball has no package/ directory (looked in ${workDir})`)
    }

    const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"))

    // Permitted exceptions -- the Node-executable-context entries, not
    // app-importable library surfaces:
    //  1. the resolved `bin` target(s) (the CLI capability boundary),
    //  2. the `./eslint-plugin` export (runs inside ESLint's own Node
    //     process; its bundled `@typescript-eslint/utils` references
    //     `node:fs`), and
    //  3. the `./node` export -- the Node-backed `BuildFileSystem` adapter a
    //     consumer's own build script hands to `./build` (ADR 0058).
    // Derived from package.json, NOT hardcoded globs, so a stray module
    // dropped next to either gets no free pass. Each exclusion also covers
    // that file's own `.map` sourcemap (embeds the original source text).
    const binField = pkg.bin ?? {}
    const exemptEntries = [
      ...(typeof binField === "string" ? [binField] : Object.values(binField)),
      resolveExportTarget(pkg.exports?.["./eslint-plugin"]),
      resolveExportTarget(pkg.exports?.["./node"]),
    ].filter(Boolean)
    const exempt = new Set()
    for (const rel of exemptEntries) {
      const abs = path.resolve(packageRoot, rel)
      exempt.add(abs)
      exempt.add(`${abs}.map`)
      // tsup writes both esm (.js) and cjs (.cjs); package.json points at one.
      exempt.add(abs.replace(/\.js$/, ".cjs"))
      exempt.add(`${abs.replace(/\.js$/, ".cjs")}.map`)
    }

    // Only actual code files -- not sourcemaps, type declarations, JSON, or
    // docs (socket.dev flags executable capabilities, and a `.d.ts`'s
    // `import type "node:fs"` is erased, never a runtime acquisition).
    const CODE_EXT = new Set([".js", ".cjs", ".mjs"])

    const violations = []
    for (const file of walk(packageRoot)) {
      if (exempt.has(file)) continue
      if (!CODE_EXT.has(path.extname(file))) continue
      if (statSync(file).size > 8 * 1024 * 1024) continue // a huge asset -- source bundles are never this big
      const text = readFileSync(file, "utf8")
      const hits = FORBIDDEN.filter((needle) => text.includes(needle))
      if (hits.length > 0) {
        violations.push({ file: path.relative(packageRoot, file), hits })
      }
    }

    if (violations.length > 0) {
      console.error(
        "ADR 0058 violation -- node:fs reachable outside an executable-context entry:\n",
      )
      for (const { file, hits } of violations) {
        console.error(`  ${file}`)
        for (const hit of hits) console.error(`    contains: ${JSON.stringify(hit)}`)
      }
      console.error(
        `\nExempt entries: ${[...exempt].map((p) => path.relative(packageRoot, p)).join(", ")}`,
      )
      process.exit(1)
    }

    console.log(`verify-no-ambient-fs: OK -- no node:fs in library entries of ${tarballName}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

main()
