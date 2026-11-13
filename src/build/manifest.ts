/**
 * Renders the deterministic manifest `.ts` source text: a projection of
 * the `CapabilityInventory`, re-exporting every *active* capability, never
 * the other way around (nothing else in `build/` treats the manifest file
 * itself as a source of truth). Pure: no filesystem access; the caller
 * decides where (and whether) to write the result.
 */

import path from "node:path"
import { absolutePathFrom } from "./display-path.js"
import { generatedBanner } from "./generated-banner.js"
import type { CapabilityInventory, CapabilityNode } from "./inventory.js"

/** Converts a `.ts`/`.tsx` source file's absolute path into a relative import specifier from `fromDir`, matching this repo's own NodeNext-style convention (relative, forward-slashed, `.js` extension). That is the broadly-compatible form, since a consumer's own bundler/tsc resolves it the same way it resolves every other import in their project. */
function toImportSpecifier(fromDir: string, targetFile: string): string {
  const relative = path.relative(fromDir, targetFile).split(path.sep).join("/")
  const withDotSlash = relative.startsWith(".") ? relative : `./${relative}`
  return withDotSlash.replace(/\.tsx?$/, ".js")
}

function sortedActiveCapabilities(inventory: CapabilityInventory): readonly CapabilityNode[] {
  // No `.slice()` before `.sort()`: `.filter()` already returns a fresh
  // array every call, so sorting it in place never touches anything the
  // caller holds a reference to.
  return inventory.capabilities
    .filter((capability) => capability.active)
    .sort((a, b) => a.file.localeCompare(b.file) || a.exportName.localeCompare(b.exportName))
}

/**
 * Renders the manifest source text for every active capability in
 * `inventory`, importing each from `outputPath`'s own directory. Two
 * capabilities exporting the same identifier name from different files
 * produce a real name collision in the generated output. It is surfaced to
 * the caller as a `ReportFinding` by `generate-manifest.ts`, not silently
 * renamed here. Renaming would make the manifest's export names diverge
 * from the capability's own declared name, which is worse.
 *
 * This is the trickiest consumer of the root-relative
 * `CapabilityNode.file`: an import specifier is relative to the *output
 * file's own directory*, not to `root`, so neither path can be used
 * directly. Both sides are made absolute first (`capability.file` through
 * `absolutePathFrom(root, ...)`), then related to each other. A
 * `--package`-discovered capability outside `root` still works, since
 * `absolutePathFrom` returns its path unchanged.
 *
 * Emitted as `import` plus one `export {...}`, not as `export {...} from`. A
 * re-export creates no local binding, so the `manifest` array literal below
 * would name identifiers missing from the module's scope.
 */
export function renderManifest(
  inventory: CapabilityInventory,
  outputPath: string,
  root: string,
): string {
  const outputDir = path.dirname(outputPath)
  const active = sortedActiveCapabilities(inventory)

  const lines: string[] = [generatedBanner("ts"), ""]
  for (const capability of active) {
    const specifier = toImportSpecifier(outputDir, absolutePathFrom(root, capability.file))
    lines.push(`import { ${capability.exportName} } from "${specifier}"`)
  }
  if (active.length > 0) {
    lines.push("")
    lines.push(`export { ${active.map((c) => c.exportName).join(", ")} }`)
  }
  lines.push("")
  lines.push(`export const manifest = [${active.map((c) => c.exportName).join(", ")}] as const`)
  lines.push("")
  return lines.join("\n")
}

/** Export names that collide across two or more different active capability files: the manifest can't re-export both under the same identifier. */
export function findManifestExportCollisions(
  inventory: CapabilityInventory,
): ReadonlyMap<string, readonly string[]> {
  const byName = new Map<string, Set<string>>()
  for (const capability of sortedActiveCapabilities(inventory)) {
    const files = byName.get(capability.exportName) ?? new Set<string>()
    files.add(capability.file)
    byName.set(capability.exportName, files)
  }
  const collisions = new Map<string, readonly string[]>()
  for (const [name, files] of byName) {
    // `files` was populated while iterating `sortedActiveCapabilities`, so its
    // insertion order is already file-sorted: no re-sort needed.
    if (files.size > 1) collisions.set(name, [...files])
  }
  return collisions
}
