// Reuses ../../scripts/check-size.mjs's own gzip-measurement approach, as
// context metadata only -- NOT a benchmark in its own right. Bundle size is
// already a hard-gated budget (see PERFORMANCE.md, enforced at
// prepublishOnly); this just records what that gate measured for the build
// these results ran against, so a reader can tell "was this build's bundle
// unusually large."

import { existsSync, readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import path from "node:path"

const ENTRIES = [
  { label: "core", file: "dist/index.js" },
  { label: "runtime", file: "dist/runtime/index.js" },
  { label: "helpers", file: "dist/helpers.js" },
]

export function collectPackageSize(repoRoot) {
  const result = {}
  for (const { label, file } of ENTRIES) {
    const filePath = path.join(repoRoot, file)
    const exists = existsSync(filePath)
    result[`${label}BundleBytes`] = exists ? readFileSync(filePath).length : null
    result[`${label}BundleGzipBytes`] = exists ? gzipSync(readFileSync(filePath)).length : null
  }
  return result
}
