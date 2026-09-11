#!/usr/bin/env node
// Writes thin re-export shims for the .d.ts/.d.cts files tsup no longer
// generates for the bundled entry points. tsup's own dts pipeline
// (rollup-plugin-dts) hardcodes declarationMap: false and can't produce
// declaration maps -- see tsup.config.ts's `dts: false` comment and
// tsconfig.build.json. Real per-file declarations (with working maps) are
// emitted separately by `tsc -p tsconfig.build.json` into dist/.dts/,
// mirroring src/'s structure; this script just points each package.json
// #exports entry-point filename at the right file inside that tree.
//
// New entries (runtime, build, helpers, ...) get appended here as their
// phases land -- see specs/architecture.md for the full planned surface.

import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const ENTRIES = [
  { name: "index", dtsPath: "./.dts/core/index.js" },
  { name: "runtime/index", dtsPath: "../.dts/runtime/index.js" },
  { name: "runtime/cache", dtsPath: "../.dts/runtime/cache.js" },
  { name: "runtime/retry", dtsPath: "../.dts/runtime/retry.js" },
  { name: "build", dtsPath: "./.dts/build/index.js" },
  { name: "node", dtsPath: "./.dts/node/index.js" },
  { name: "evidence", dtsPath: "./.dts/evidence/index.js" },
  { name: "helpers", dtsPath: "./.dts/helpers/index.js" },
  { name: "eslint-plugin/index", dtsPath: "../.dts/eslint-plugin/index.js" },
]

for (const { name, dtsPath } of ENTRIES) {
  const shim = `export * from "${dtsPath}";\n`
  const targetPath = path.join(root, "dist", name)
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(`${targetPath}.d.ts`, shim, "utf8")
  writeFileSync(`${targetPath}.d.cts`, shim, "utf8")
  console.log(`[dts-shims] wrote dist/${name}.d.ts and dist/${name}.d.cts -> ${dtsPath}`)
}
