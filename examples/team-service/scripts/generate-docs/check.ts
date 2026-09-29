// The `--check` counterpart to run.ts (see its own header comment and this
// directory's README for why this exists as application code rather than a
// CLI flag): verifies src/generated/data.manifest.ts, docs/DATA.md,
// docs/OWNERSHIP.md, docs/flow/, and docs/data.evidence.json are exactly
// what a fresh run.ts would produce, without writing anything, via
// `data-cap/build`'s exported `checkArtifacts()` -- the same function the
// removed `data-cap --check --location --docs --ownership --flow`
// combination called internally, with `evidence` included for the same
// reason run.ts includes it (see run.ts's own header comment): the
// committed docs/data.evidence.json is the FULLER Evidence Model every
// requested pass contributes to, not the thinner one a standalone
// `data-cap --check --evidence` alone would recompute -- so this is the one
// place that artifact's freshness is verified, not the CLI's own `--check`.
import path from "node:path"
import { fileURLToPath } from "node:url"
import { checkArtifacts } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const { stale } = await checkArtifacts({
  fs: nodeBuildFileSystem,
  root,
  include: ["src/**"],
  location: path.join(root, "src/generated/data.manifest.ts"),
  docs: path.join(root, "docs/DATA.md"),
  ownership: path.join(root, "docs/OWNERSHIP.md"),
  flow: path.join(root, "docs/flow"),
  evidence: path.join(root, "docs/data.evidence.json"),
})

if (stale.length > 0) {
  console.error(
    `[generate-docs check] stale or missing:\n${stale.map((p) => `  - ${path.relative(root, p)}`).join("\n")}\nRun \`npm run docs\` to regenerate.`,
  )
  process.exitCode = 1
} else {
  console.log(
    "[generate-docs check] manifest/docs/ownership/flow/evidence artifacts are up to date.",
  )
}
