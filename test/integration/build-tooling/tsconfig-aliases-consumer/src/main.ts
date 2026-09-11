/**
 * Build-tooling pattern: `linkCapabilityFiles`'s `packages` option
 * allow-lists an installed package by name, letting a `fields` reference
 * that bare-imports from it (`import { productFields } from
 * "shared-schema-package"`) resolve to the schema file that package
 * declares via its own `package.json#dataCap.schema` field -- a real
 * versioning/trust boundary crossing (a different package), unlike
 * `tsconfig-aliases/`'s same-project alias.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { discoverCapabilityFiles, linkCapabilityFiles } from "@maverickcer/data-cap/build"
import { nodeBuildFileSystem } from "@maverickcer/data-cap/node"

const root = path.join(import.meta.dirname, "..")

// Discovery must exclude the "published" package's own directory -- an
// application discovers ITS OWN source, never crawls into a dependency's
// tree looking for capabilities (that's what the explicit `packages`
// allowlist is for).
const files = await discoverCapabilityFiles({ fs: nodeBuildFileSystem, root, exclude: ["shared-schema-package/**"] })
const result = await linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root, packages: ["shared-schema-package"] })

assert.equal(
  result.warnings.length,
  0,
  "the cross-package reference resolved cleanly -- no unresolved-reference warnings",
)
assert.equal(result.capabilities.length, 1)

const [capability] = result.capabilities
assert.ok(capability)
assert.equal(capability.exportName, "productCapability")
assert.deepEqual(
  capability.fieldsShape,
  { sku: "", priceCents: 0 },
  "the fields shape, owned by a DIFFERENT package and reached only through the allowlist, resolved to its real object literal",
)

// Without the allowlist, the same reference is correctly reported unresolvable.
const resultWithoutAllowlist = await linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root })
assert.equal(
  resultWithoutAllowlist.warnings.length,
  1,
  "without an explicit allowlist entry, the cross-package reference is never silently guessed at",
)

const summary = {
  fileCount: files.length,
  capabilityCount: result.capabilities.length,
  warningCount: result.warnings.length,
  exportName: capability.exportName,
  fieldsShape: capability.fieldsShape,
  warningCountWithoutAllowlist: resultWithoutAllowlist.warnings.length,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("tsconfig-aliases-consumer: all assertions passed.")
