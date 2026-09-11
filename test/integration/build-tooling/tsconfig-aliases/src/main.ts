/**
 * Build-tooling pattern: `discoverCapabilityFiles`/`linkCapabilityFiles`
 * statically resolve a `buildData()`/`documentData()` call's `fields`
 * reference across files -- including through a `tsconfig.json` path
 * alias, exactly the way `tsc` itself would resolve `@schemas/user.js`.
 * Nothing here ever imports, requires, or evaluates `user-capability.ts`
 * -- only its AST is read.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { discoverCapabilityFiles, linkCapabilityFiles } from "@maverickcer/data-cap/build"
import { nodeBuildFileSystem } from "@maverickcer/data-cap/node"

const root = path.join(import.meta.dirname, "..")

const files = await discoverCapabilityFiles({ fs: nodeBuildFileSystem, root })
const result = await linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root })

assert.equal(
  result.warnings.length,
  0,
  "the alias resolved cleanly -- no unresolved-reference warnings",
)
assert.equal(
  result.capabilities.length,
  1,
  "exactly one exported buildData() capability was discovered",
)

const [capability] = result.capabilities
assert.ok(capability)
assert.equal(capability.exportName, "userCapability")
assert.deepEqual(
  capability.fieldsShape,
  { name: "", email: "" },
  "the fields shape, reached only through the @schemas/* alias, resolved to the real object literal",
)
assert.ok(
  capability.documentedBy,
  "the documentData() call, sharing the same aliased userFields identifier, correlated correctly",
)

const summary = {
  fileCount: files.length,
  capabilityCount: result.capabilities.length,
  warningCount: result.warnings.length,
  exportName: capability.exportName,
  fieldsShape: capability.fieldsShape,
  documented: capability.documentedBy !== undefined,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("tsconfig-aliases: all assertions passed.")
