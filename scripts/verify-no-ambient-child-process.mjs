// Release-blocking backstop, sibling to verify-no-ambient-fs.mjs: the
// *published tarball* -- what socket.dev and a consumer actually see -- must
// contain no `node:child_process` reference anywhere at all.
//
// Simpler than the fs check: node:fs has legitimate exempt entries (the CLI
// and other executable-context entry points) because a Node-executable
// context genuinely needs filesystem access. There is no equivalent
// exemption here -- data-cap has no legitimate reason to spawn a process
// anywhere, including its own CLI, so a hit in ANY packed file is a
// violation.
//
// The source-level ESLint rule (`no-restricted-imports` on all of `src/**`,
// no exemption) is fast developer feedback; this is the authoritative check
// on the real artifact, independent of whether every contributor runs lint
// locally.

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Every way a bundled module can pull in Node's child_process module. */
const FORBIDDEN = [
  "node:child_process",
  'require("child_process")',
  "require('child_process')",
  'require("node:child_process")',
  "require('node:child_process')",
  'import("node:child_process")',
  "import('node:child_process')",
  'import("child_process")',
  "import('child_process')",
  'from "child_process"',
  "from 'child_process'",
  'from "node:child_process"',
  "from 'node:child_process'",
]

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
  const workDir = mkdtempSync(path.join(tmpdir(), "data-cap-verify-child-process-"))
  try {
    const packOutput = execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", workDir, "--json"],
      { cwd: repoRoot, encoding: "utf8" },
    )
    // Same JSON-shape/leading-noise handling as verify-no-ambient-fs.mjs --
    // see that script's own comment for why this can't be a plain JSON.parse.
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

    const packageRoot = path.join(workDir, "package")
    if (!existsSync(packageRoot)) {
      throw new Error(`extracted tarball has no package/ directory (looked in ${workDir})`)
    }

    // Only actual code files -- not sourcemaps, type declarations, JSON, or
    // docs (a `.d.ts`'s `import type "node:child_process"` is erased, never a
    // runtime acquisition).
    const CODE_EXT = new Set([".js", ".cjs", ".mjs"])

    const violations = []
    for (const file of walk(packageRoot)) {
      if (!CODE_EXT.has(path.extname(file))) continue
      if (statSync(file).size > 8 * 1024 * 1024) continue // a huge asset -- source bundles are never this big
      const text = readFileSync(file, "utf8")
      const hits = FORBIDDEN.filter((needle) => text.includes(needle))
      if (hits.length > 0) {
        violations.push({ file: path.relative(packageRoot, file), hits })
      }
    }

    if (violations.length > 0) {
      console.error("node:child_process reachable in the published tarball:\n")
      for (const { file, hits } of violations) {
        console.error(`  ${file}`)
        for (const hit of hits) console.error(`    contains: ${JSON.stringify(hit)}`)
      }
      console.error(
        "\ndata-cap never spawns a process itself -- no exemption applies here, unlike node:fs.",
      )
      process.exit(1)
    }

    console.log(`verify-no-ambient-child-process: OK -- no node:child_process in ${tarballName}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

main()
