/**
 * The cheap content fingerprint that lets a caller prove "nothing relevant to
 * evidence generation has changed" without a full `computeDataArtifacts()`
 * recompute -- computed from each file's UTF-8 text with zero TypeScript
 * Compiler API involvement.
 *
 * Split out of `evidence-cache.ts` so the fingerprint primitives sit below both
 * `evidence-cache.ts` (which also drives a full recompute) and
 * `generate-data-artifacts.ts` (which writes the sidecar after a real run),
 * instead of the two importing each other. `evidence-cache.ts` re-exports these
 * for existing importers.
 *
 * Deliberately not an mtime check: a checkout, a rebase, or a `touch` all bump a
 * timestamp with no real edit, and content is the only thing that actually
 * invalidates a cached evidence artifact.
 */

import { createHash } from "node:crypto"
import path from "node:path"
import { DEFAULT_INCLUDE, discoverCapabilityFiles } from "./discover.js"
import { PACKAGE_VERSION } from "./package-version.js"
import {
  mergeLocalAndPackageFiles,
  resolveAllowlistedPackages,
} from "./resolution/resolve-package-schema.js"
import type { PackageSchemaResolutionResult } from "./resolution/resolve-package-schema.js"
import type { BuildFileSystem } from "./types.js"

/** Options for {@link computeSourceFingerprint}. */
export interface ComputeSourceFingerprintOptions {
  /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
  readonly fs: BuildFileSystem
  /** Directory discovery resolves against -- same meaning as `GenerateDataArtifactsOptions.root`. */
  readonly root: string
  /** Discovery globs. Defaults to `DEFAULT_INCLUDE`, matching `discoverCapabilityFiles`. */
  readonly include?: readonly string[]
  /** Discovery exclusion globs. */
  readonly exclude?: readonly string[]
  /** Allow-listed package names whose own resolved schema files also feed the fingerprint. */
  readonly packages?: readonly string[]
}

/**
 * SHA-256 over `data-cap`'s own installed version plus the path and raw bytes of
 * every file a real run would discover -- no parsing, no linking, no AST. Still
 * pays for the glob walk itself (a fingerprint has to know which files matter),
 * but nothing after it.
 *
 * Paths are deduplicated and sorted before hashing, so the result never depends
 * on filesystem enumeration order. The tool version is folded in because an
 * engine upgrade can change what the same source produces. Each file's own path
 * is hashed alongside its content so that renaming a file, or moving identical
 * content between two paths, changes the fingerprint.
 */
export async function computeSourceFingerprint(
  options: ComputeSourceFingerprintOptions,
): Promise<string> {
  // `packages = []`: an unresolvable allow-listed package name contributes zero
  // files (`resolveAllowlistedPackages` drops it), so `[]` and any non-empty
  // default are behaviourally identical here -- the default-vs-explicit-`[]`
  // equivalence is asserted by a test, but the mutant on this literal cannot be.
  // Stryker disable next-line ArrayDeclaration
  const { fs, root, include = DEFAULT_INCLUDE, exclude, packages = [] } = options

  const localFiles = await discoverCapabilityFiles({
    fs,
    root,
    include,
    // discoverCapabilityFiles itself does `options.exclude ?? []` --
    // passing `exclude: undefined` explicitly (what always-spreading here
    // would do) is behaviorally identical to omitting the key. Hand-verified:
    // forcing this guard to `true` and running the real suite passes
    // unchanged.
    // Stryker disable next-line ConditionalExpression
    ...(exclude !== undefined ? { exclude } : {}),
  })
  const packageCache = new Map<string, Promise<PackageSchemaResolutionResult>>()
  const { files: packageFiles } = await resolveAllowlistedPackages(packages, root, packageCache, fs)
  const allFiles = [
    ...new Set(
      await mergeLocalAndPackageFiles(
        localFiles,
        packageFiles.map((f) => f.file),
        fs,
      ),
    ),
  ].sort()

  const hash = createHash("sha256")
  hash.update(PACKAGE_VERSION)
  for (const file of allFiles) {
    // Root-relative, so the same source tree fingerprints identically on two
    // machines (and in CI). An absolute path here would make the cache
    // machine-specific for no benefit.
    hash.update(path.relative(root, file).split(path.sep).join("/"))
    hash.update("\0")
    try {
      // "utf8" -> "" is equivalent: the adapter then returns a Buffer, and
      // `hash.update()` over that Buffer hashes the exact same bytes.
      // Stryker disable next-line StringLiteral
      hash.update(await fs.readFile(file, "utf8"))
    } catch {
      // Found by the glob walk but unreadable by the time we hash it (deleted
      // mid-run, a race with another process). Folded in as a distinct marker
      // so the fingerprint still changes.
      hash.update("(unreadable)")
    }
    hash.update("\0")
  }
  return hash.digest("hex")
}

/** The sidecar path paired with an evidence artifact -- `<evidence-path>.fingerprint`. */
export function fingerprintPathFor(evidencePath: string): string {
  return `${evidencePath}.fingerprint`
}

/**
 * Writes `fingerprint`'s paired sidecar for `evidencePath`. Call immediately
 * after writing the evidence artifact itself, so the two files always describe
 * the same moment in the source tree's history.
 */
export async function writeEvidenceFingerprint(
  evidencePath: string,
  fingerprint: string,
  fs: BuildFileSystem,
): Promise<void> {
  await fs.mkdir(path.dirname(evidencePath), { recursive: true })
  // The payload is always a sha256 hex digest plus a newline -- pure ASCII,
  // so "utf8" here is a required argument of the BuildFileSystem contract but
  // behaviourally the only possible encoding.
  // Stryker disable next-line StringLiteral
  await fs.writeFile(fingerprintPathFor(evidencePath), `${fingerprint}\n`, "utf8")
}
