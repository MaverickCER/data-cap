#!/usr/bin/env node
// Drift check for the committed Markdown API report (`docs/api-report/`, the
// `typedoc --options typedoc.markdown.json` output). Regenerates the report
// into a temp directory and compares the WHOLE tree -- added, removed, and
// changed files all count as drift -- so a change to the public API surface
// can't land without the report (and the PR diff a reviewer reads) being
// updated too. See CODE_REVIEW.md §4.
//
// The rendered HTML reference (`docs/api/`) is generated fresh in CI's Pages
// deploy job and is not committed, so it has no equivalent check here.
//
// Dependency-free (Node builtins only) -- dev/CI tooling, never shipped.

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const committed = path.join(root, "docs/api-report")

/** Every file under `dir`, as paths relative to `dir`, sorted. */
function listFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(dir, full))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

function fail(message, hint) {
  process.stderr.write(`\nAPI report drift: ${message}\n`)
  process.stderr.write(`Run \`npm run docs:api:report\` and commit docs/api-report/.\n`)
  if (hint) process.stderr.write(`${hint}\n`)
  process.exitCode = 1
}

const fresh = mkdtempSync(path.join(tmpdir(), "data-cap-api-report-"))
try {
  execFileSync("npx", ["typedoc", "--options", "typedoc.markdown.json", "--out", fresh], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  })

  const committedFiles = listFiles(committed)
  const freshFiles = listFiles(fresh)

  const added = freshFiles.filter((f) => !committedFiles.includes(f))
  const removed = committedFiles.filter((f) => !freshFiles.includes(f))
  const changed = freshFiles
    .filter((f) => committedFiles.includes(f))
    .filter(
      (f) =>
        readFileSync(path.join(fresh, f), "utf8") !== readFileSync(path.join(committed, f), "utf8"),
    )

  if (committedFiles.length === 0) {
    fail("docs/api-report/ is not committed yet")
  } else if (added.length || removed.length || changed.length) {
    const detail = [
      added.length ? `  new:     ${added.join(", ")}` : "",
      removed.length ? `  removed: ${removed.join(", ")}` : "",
      changed.length ? `  changed: ${changed.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
    fail("the committed report is out of date", detail)
  } else {
    process.stdout.write(`API report is current (${committedFiles.length} file(s)).\n`)
  }
} finally {
  rmSync(fresh, { recursive: true, force: true })
}
