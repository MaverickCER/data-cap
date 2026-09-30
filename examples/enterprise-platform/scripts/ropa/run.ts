// Regenerates docs/ROPA.md -- a GDPR Article 30(1) Record of Processing
// Activities document, built from data-cap's own schema-level governance
// fields: the pre-existing `purpose`/`legalBasis`/`dataResidency`/
// `retention`/`sensitivity`/`protections` this example's capabilities
// already declare, plus the newer `dataSubjectCategory`/
// `recipientCategories`/`transferSafeguard` fields this generator was
// added alongside. Peer to ../generate-docs (C9's own generator, same
// directory-per-generator convention this repo already established) --
// see this directory's own README for the full architecture
// (types.ts/build-model.ts/render.ts/print-lines.ts/run.ts), mirroring
// env-cap's own already-merged rotation-log generator
// (examples/application/scripts/rotation-log/ in that package).
//
// Reads the already-generated `docs/data.evidence.json` via this example's
// own shared `reports/evidence-cache.ts` (`getEvidence()`) -- the same
// fingerprint-cached read `litigation-evidence.ts`/`audit-prep.ts` already
// use, rather than a second, independent cache implementation. The
// Capability Model it carries already has every field's resolved
// `sensitivity`/`purpose`/`legalBasis`/`dataResidency`/`auditRequired` plus
// the raw `docs` object every other field (`retention`/`protections`/
// `transferSafeguard`/`dataSubjectCategory`/`recipientCategories`) is read
// from -- nothing this generator needs requires a fresh discovery pass.
//
// Run via `npm run ropa` (also chained into `npm run reports`, alongside
// the litigation-evidence and audit-prep reports -- see package.json).
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getEvidence } from "../../reports/evidence-cache.js"
import { buildRopaModel } from "./build-model.js"
import { CONTROLLER_IDENTITY } from "./controller-identity.js"
import { printJsonLines } from "./print-lines.js"
import { renderRopa } from "./render.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const evidence = await getEvidence()

const model = buildRopaModel(evidence, CONTROLLER_IDENTITY)

const outputPath = path.resolve(root, "docs/ROPA.md")
await fs.writeFile(outputPath, renderRopa(model), "utf8")

console.log(
  `[ropa] wrote docs/ROPA.md (${String(model.records.length)} processing activity(ies)).`,
)

// The `build-model.ts` escape hatch this generator's README promises: an org
// that wants the raw computed values -- not this file's own Markdown
// rendering -- gets them straight from `buildRopaModel()`, and here's
// exactly what that looks like on the console.
console.log("\n[ropa] raw model (via printJsonLines):")
printJsonLines(model, console.log)
