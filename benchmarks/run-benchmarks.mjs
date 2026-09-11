#!/usr/bin/env node
// Root benchmark orchestrator -- runs both performance examples' own
// `benchmark` script. Deliberately NOT part of `npm run verify`/CI's
// `verify` matrix -- see .github/workflows/benchmarks.yml for how CI runs
// these instead.

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const benchmarksRoot = path.dirname(fileURLToPath(import.meta.url))

const EXAMPLES = ["performance-runtime", "performance-buildtime"]

for (const name of EXAMPLES) {
  const exampleDir = path.join(benchmarksRoot, name)
  if (!existsSync(path.join(exampleDir, "node_modules"))) {
    console.log(
      `[skip] ${name}: node_modules not installed (run npm install in benchmarks/${name} first)`,
    )
    continue
  }

  console.log(`[benchmark] ${name}: running...`)
  execFileSync("npm", ["run", "--silent", "benchmark"], { cwd: exampleDir, stdio: "inherit" })
}
