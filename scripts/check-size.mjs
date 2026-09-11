#!/usr/bin/env node
// Lightweight, dependency-free bundle size budget check (Node builtins only --
// this is dev/CI tooling, not something that ships or runs at runtime).
//
// Guards the package's core promise: the isomorphic, consumer-facing entry
// points (core, runtime, runtime/cache, runtime/retry, helpers) stay tiny.
// Build tooling (`dist/build.js`), the eslint plugin
// (`dist/eslint-plugin/index.js`), and the CLI (`dist/cli/index.js`) are
// Node-only and dev-time-only by design, so they aren't meaningfully
// budgeted here (999KB is effectively "don't silently balloon," not a real
// constraint) -- they just need to stay isolated from the runtime/helpers
// bundles, which the tree-shaking tests already cover.

import { readFileSync, existsSync } from "node:fs"
import { gzipSync } from "node:zlib"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

const BUDGETS = [
  { label: "core", file: "dist/index.js", maxGzipBytes: 2 * 1024 },
  // Raised from 4KB alongside ADR 0048's `createData` (the batteries-
  // included operations layer: getter/mutator/subscription execution,
  // dedup identity, optimistic lifecycle, runGetters, bounded per-operation
  // state) -- a deliberate, measured increase for genuinely new primary-API
  // functionality in this same entry point, not unexamined growth. Kept as
  // one entry rather than a separate tree-shaken sub-path (unlike
  // `runtime/cache`/`runtime/retry`, which are optional add-ons most
  // capabilities never touch) because `createData` is meant to be the
  // first thing most consumers reach for, not an edge-case extra.
  { label: "runtime", file: "dist/runtime/index.js", maxGzipBytes: 6 * 1024 },
  { label: "runtime/cache", file: "dist/runtime/cache.js", maxGzipBytes: 1 * 1024 },
  { label: "runtime/retry", file: "dist/runtime/retry.js", maxGzipBytes: 2 * 1024 },
  { label: "helpers", file: "dist/helpers.js", maxGzipBytes: 3 * 1024 },
  { label: "build", file: "dist/build.js", maxGzipBytes: 999 * 1024 },
  { label: "eslint-plugin", file: "dist/eslint-plugin/index.js", maxGzipBytes: 999 * 1024 },
  { label: "cli", file: "dist/cli/index.js", maxGzipBytes: 999 * 1024 },
]

let failed = false

for (const { label, file, maxGzipBytes } of BUDGETS) {
  const filePath = path.join(root, file)
  if (!existsSync(filePath)) {
    console.error(`[size] ${file} does not exist -- run \`npm run build\` first.`)
    failed = true
    continue
  }
  const raw = readFileSync(filePath)
  const gzipBytes = gzipSync(raw).length
  const status = gzipBytes <= maxGzipBytes ? "OK" : "OVER BUDGET"
  console.log(
    `[size] ${label.padEnd(14)} ${file.padEnd(28)} gzip=${gzipBytes}B (budget ${maxGzipBytes}B) ${status}`,
  )
  if (gzipBytes > maxGzipBytes) failed = true
}

if (failed) {
  console.error("\n[size] One or more entry points exceeded their gzip budget.")
  process.exitCode = 1
} else {
  console.log("\n[size] All budgets met.")
}

const jsonFlagIndex = process.argv.indexOf("--json")
if (jsonFlagIndex !== -1) {
  const outPath = process.argv[jsonFlagIndex + 1]
  if (!outPath) {
    console.error("[size] --json requires a file path.")
    process.exitCode = 1
  } else {
    const { writeFileSync, mkdirSync } = await import("node:fs")
    const payload = {
      generatedAt: new Date().toISOString(),
      entries: BUDGETS.map(({ label, file, maxGzipBytes }) => {
        const filePath = path.join(root, file)
        if (!existsSync(filePath)) return { label, file, gzipBytes: null, maxGzipBytes }
        return { label, file, gzipBytes: gzipSync(readFileSync(filePath)).length, maxGzipBytes }
      }),
    }
    mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
    writeFileSync(path.resolve(outPath), JSON.stringify(payload, null, 2), "utf8")
  }
}
