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

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  { name: "observe", dtsPath: "./.dts/observe/index.js" },
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

// A second declaration tree for TypeScript 7 consumers (package.json's `types@>=7` export
// conditions). The build and evidence declarations name compiler-API types from `typescript`; a
// TypeScript 7 root has none (its package ships no compiler-API declarations), so under 7 those
// imports cannot even be read without `skipLibCheck`. This copy points them at the bundled
// `@typescript/typescript6`, which every install carries. It is served to 7 ONLY: a TypeScript 5 or 6
// consumer keeps the primary declarations typed from its own `typescript`, because two copies of
// `SyntaxKind` are distinct enums and such a consumer passes its own nodes into these entry points
// (ADR 0069, "Consequences"). Under 7 there is no second copy to clash with.
const ts7Root = path.join(root, "dist", ".dts7")
rmSync(ts7Root, { recursive: true, force: true })
cpSync(path.join(root, "dist", ".dts"), ts7Root, { recursive: true })
let rewritten = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (entry.name.endsWith(".d.ts")) {
      const text = readFileSync(file, "utf8")
      const next = text.replace(/from "typescript"/g, 'from "@typescript/typescript6"')
      if (next !== text) {
        writeFileSync(file, next, "utf8")
        rewritten += 1
      }
    }
  }
}
walk(ts7Root)
for (const { name, dtsPath } of ENTRIES) {
  const shim = `export * from "${dtsPath.replace("/.dts/", "/.dts7/")}";\n`
  const targetPath = path.join(root, "dist", name)
  writeFileSync(`${targetPath}.ts7.d.ts`, shim, "utf8")
  writeFileSync(`${targetPath}.ts7.d.cts`, shim, "utf8")
}
console.log(
  `[dts-shims] wrote dist/.dts7 for TypeScript 7 consumers (${String(rewritten)} declaration(s) retyped to @typescript/typescript6)`,
)
