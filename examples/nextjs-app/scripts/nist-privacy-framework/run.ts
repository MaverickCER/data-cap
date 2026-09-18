// Regenerates docs/ISO-IEC-27701-2025.md from this example's own, freshly-
// generated docs/data.evidence.json -- see gather-evidence.ts and
// render-markdown.ts for the reasoning. Run via `npm run docs:privacy` (see
// package.json), which chains `npm run docs` first so the evidence file
// this script reads is always current, never stale.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gatherCategoryEvidence } from "./gather-evidence.js"
import { renderAlignmentMarkdown } from "./render-markdown.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const entries = gatherCategoryEvidence(root)
const markdown = renderAlignmentMarkdown({ entries, generatedAt: new Date().toISOString() })

const outputPath = path.join(root, "docs/ISO-IEC-27701-2025.md")
mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(outputPath, markdown)

const found = entries.filter((e) => e.status === "evidence-found").length
console.log(
  `[nist-privacy-framework] wrote docs/ISO-IEC-27701-2025.md (${String(found)}/${String(entries.length)} Categories evidence-backed)`,
)
