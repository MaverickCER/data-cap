// Regenerates everything under docs/: the evidence file, every projection of it, and the explorer page.
//
// The evidence is written even though the build would be blocked by the leak in src/app/export.ts: that is the
// point of the example. `data-cap` itself refuses to write artifacts when a finding is an error (atomicity, so a
// partial set is never mistaken for a good one); this script uses `computeDataArtifacts` to inspect the result.
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { computeOutputs } from "./lib/outputs.js"
import { exampleRoot } from "./lib/pipeline.js"

const { files, result } = await computeOutputs()
const docs = path.join(exampleRoot, "docs")
await mkdir(docs, { recursive: true })
for (const [name, content] of Object.entries(files)) await writeFile(path.join(docs, name), content, "utf8")
console.log(`Wrote ${Object.keys(files).length} files to docs/ (${result.errorCount} error finding(s): the example's leak is meant to block a real build).`)
