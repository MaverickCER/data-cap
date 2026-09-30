// Regenerates docs/DATA.md -- what `data-cap --docs docs/DATA.md` used to
// write for this fixture, before `--docs` was removed from the CLI surface
// (see
// ../../../../specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md).
// `docs/DATA.md` has no real *runtime* consumer -- nothing here reads it
// programmatically -- so generating it is application-level code now, not a
// CLI concern. Calls `generateDataArtifacts()` directly from `data-cap/build`
// (fully exported) -- the same orchestrator the removed `--docs` flag called
// internally.
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generateDataArtifacts } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const result = await generateDataArtifacts({
  fs: nodeBuildFileSystem,
  root,
  include: ["src/**"],
  docs: path.join(root, "docs/DATA.md"),
})

console.log(`[generate-docs] wrote ${path.relative(root, result.documentation?.location ?? "")}.`)
