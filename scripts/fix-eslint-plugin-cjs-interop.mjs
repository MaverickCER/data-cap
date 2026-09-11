#!/usr/bin/env node
// Patches dist/eslint-plugin/index.cjs so `require("data-cap/eslint-plugin")`
// resolves directly to the plugin object, matching the ESM entry point's
// `import dataCapPlugin from "..."` ergonomics.
//
// Without this, a plain CommonJS `require()` returns esbuild's raw CJS
// output for a module with both a default and a named export --
// `{ default: plugin, stableOperationReference }` -- silently breaking every
// `eslint.config.cjs` consumer. tsup's own `cjsInterop` build option can't
// fix this: it only rewrites `module.exports` for a chunk with exactly one
// export named "default", and this entry point deliberately has two (see
// src/eslint-plugin/index.ts's module doc comment). Same fix env-cap's own
// build applies for the identical situation.

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = path.join(root, "dist/eslint-plugin/index.cjs")

const original = readFileSync(target, "utf8")
const marker = "exports.stableOperationReference = stableOperationReference;"
if (!original.includes(marker)) {
  console.error(
    `[eslint-plugin-cjs-interop] expected marker not found in ${target} -- ` +
      "the bundled output shape changed; update this script to match.",
  )
  process.exitCode = 1
} else {
  const patched = original.replace(
    marker,
    `${marker}\nmodule.exports = Object.assign(exports.default, exports);`,
  )
  writeFileSync(target, patched, "utf8")
  console.log(`[eslint-plugin-cjs-interop] patched ${path.relative(root, target)}`)
}
