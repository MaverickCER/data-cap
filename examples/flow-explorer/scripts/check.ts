// The drift check: regenerates everything in memory and fails if any committed file under docs/ differs.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { computeOutputs } from "./lib/outputs.js"
import { exampleRoot } from "./lib/pipeline.js"

const { files } = await computeOutputs()
const stale: string[] = []
for (const [name, expected] of Object.entries(files)) {
  const actual = await readFile(path.join(exampleRoot, "docs", name), "utf8").catch(() => undefined)
  if (actual !== expected) stale.push(name)
}
if (stale.length > 0) {
  console.error(`[flow-explorer check] stale or missing under docs/:\n${stale.map((name) => `  - ${name}`).join("\n")}\nRun \`npm run docs\` to regenerate.`)
  process.exitCode = 1
} else {
  console.log(`[flow-explorer check] all ${Object.keys(files).length} generated files are up to date.`)
}
