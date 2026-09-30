// Regenerates src/generated/data.manifest.ts, docs/DATA.md, docs/OWNERSHIP.md,
// and docs/data.evidence.json -- what a single
// `data-cap --location --docs --ownership --evidence` invocation used to
// write for this example, before the first three flags were removed from
// the CLI surface (see
// specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md).
// This example never requested `--flow`, so this script doesn't call
// `generateFlow()` either. None of manifest/docs/ownership has a real
// *runtime* consumer -- nothing in this app `import`s the generated
// manifest, or reads the Markdown artifacts, the way a real consumer would
// -- so generating them is application-level code now, not a CLI concern.
//
// Calls `generateDataArtifacts()` directly from `data-cap/build` -- the same
// orchestrator the removed CLI flags called internally (it composes
// `generateManifest`/`generateDocumentation`/`generateUsage`, all still
// fully exported and individually callable, over one shared discover ->
// link -> inventory -> scan pass), just invoked directly here instead of
// through argv parsing. Run via `npm run docs` (see package.json), chained
// after a `data-cap --evidence` CLI step -- the one CLI-surviving flag,
// kept as a real, standalone smoke test that it still works on its own.
//
// `evidence` IS included below, even though the CLI step immediately before
// this script already wrote docs/data.evidence.json: that CLI-only run
// never sets `location` (it can't -- the flag is gone), so its own Evidence
// Model's `finding.findings` is missing whatever `MANIFEST_EXPORT_NAME_COLLISION`
// findings the manifest pass would contribute. This run recomputes the
// fuller Evidence Model (every pass requested at once, exactly like the old
// single CLI call did) and overwrites the CLI step's thinner one -- the
// version that ends up committed is the complete one.
// `scripts/generate-docs/check.ts` verifies against this same, fuller
// option set.
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generateDataArtifacts } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const result = await generateDataArtifacts({
  fs: nodeBuildFileSystem,
  root,
  include: ["src/**"],
  location: path.join(root, "src/generated/data.manifest.ts"),
  docs: path.join(root, "docs/DATA.md"),
  ownership: path.join(root, "docs/OWNERSHIP.md"),
  evidence: path.join(root, "docs/data.evidence.json"),
})

console.log(
  `[generate-docs] wrote ${path.relative(root, result.manifest?.location ?? "")} (${String(result.manifest?.snapshot.capabilities.length ?? 0)} active capability(ies)), ${path.relative(root, result.documentation?.location ?? "")}, ${path.relative(root, result.usage.location ?? "")}, and docs/data.evidence.json.`,
)

// Mirrors the removed CLI's own `writeFindings()` -- the same, real
// governance signal (e.g. UNCONSUMED_FIELD) a single
// `data-cap --location --docs --ownership` invocation used to print, now
// surfaced by this script instead.
if (result.findings.length > 0) {
  const bySeverity = (severity: string) => result.findings.filter((f) => f.severity === severity)
  console.log(
    `\n${String(bySeverity("error").length)} error(s), ${String(bySeverity("warning").length)} warning(s), ${String(bySeverity("info").length)} info finding(s):`,
  )
  for (const finding of [...bySeverity("error"), ...bySeverity("warning"), ...bySeverity("info")]) {
    const capability =
      finding.capability !== undefined ? ` [${finding.capability.exportName}]` : ""
    console.log(`  - [${finding.severity}] [${finding.code}]${capability} ${finding.message}`)
  }
}
