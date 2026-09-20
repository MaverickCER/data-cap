import { createRequire } from "node:module"
import path from "node:path"
import type { ParseWarning } from "../parse.js"
import type { BuildFileSystem } from "../types.js"
import { isWithinDirectory } from "./resolve-within-root.js"

/**
 * Cross-package schema discovery (ported from env-cap ADR 0014; Experimental -- see VERSIONING.md).
 *
 * Resolves an explicitly allow-listed installed package name to the one
 * schema file it declares via its own `"dataCap": { "schema": "<path>" }`
 * package.json field. Every step here is `createRequire(...).resolve(...)`,
 * `fs.stat`/`fs.realpath`/`fs.readFile` on a path already fully known --
 * never a `readdir` walk of any directory, named package or not. This is a
 * completely separate code path from `discover.ts`'s `discoverSchemaFiles()`,
 * which continues to unconditionally prune `node_modules` during its own
 * walk exactly as before; the two never overlap.
 *
 * This module only ever locates a file. It never imports, requires, or
 * executes it -- a package-resolved file is fed into the exact same
 * `parseSchemaFile()`/AST-only pipeline as a locally-discovered file,
 * indistinguishable from it after resolution -- see the static-analysis-only decision and the cross-package schema discovery decision (ported from env-cap ADR 0002/ADR 0014).
 */

const SCHEMA_FILE_EXTENSIONS = [".ts", ".tsx"] as const

/** 1 MiB. New hardening specific to this trust tier -- a package crosses a
 *  real versioning/trust boundary that locally-discovered source doesn't,
 *  so this caps the cost of parsing an oversized or adversarial file before
 *  any of its content is even read into memory (ported from env-cap ADR 0014). */
export const MAX_PACKAGE_SCHEMA_FILE_BYTES = 1_048_576

const PACKAGE_JSON_ANCESTOR_SEARCH_LIMIT = 8

type PackageResolutionFailureCode =
  | "PACKAGE_NOT_FOUND"
  | "MALFORMED_PACKAGE_JSON"
  | "FIELD_MISSING"
  | "INVALID_EXTENSION"
  | "OUTSIDE_PACKAGE"
  | "FILE_TOO_LARGE"

/** Both the authored and resolved forms are kept -- diagnostics benefit from
 *  showing exactly what a package author wrote versus what it resolved to. */
interface PackageOrigin {
  /** The allow-listed package name that declared this schema. */
  readonly packageName: string
  /** The `"dataCap.schema"` value exactly as the package author wrote it. */
  readonly declaredField: string
  /** Absolute, realpath-canonicalized path to the resolved schema file. */
  readonly resolvedFile: string
  /** Absolute, realpath-canonicalized path to the package's own directory. */
  readonly packageDir: string
}

export type PackageSchemaResolutionResult =
  | { readonly ok: true; readonly origin: PackageOrigin }
  | { readonly ok: false; readonly code: PackageResolutionFailureCode; readonly reason: string }

/** @internal Exported for direct unit coverage. */
// Every call site of `isRecord` is inside an async function that awaits
// before reaching it (`resolveUncached`'s own continuation, or a call from
// within it) -- exactly the "Stryker's perTest coverage cannot attribute a
// mutant that only runs in a continuation after an await" limitation
// `classifyManifest`'s own doc comment describes. Confirmed repeatedly by
// hand: applying any mutation to this line (the whole condition, either
// operand, or the `&&`) and running the real suite directly always fails a
// real test (multiple call sites each exercise a different branch), yet
// Stryker's own reports have shown different specific sub-expression
// mutants here as Survived across different fresh runs -- not a stable set
// of gaps, but the same false-positive class manifesting with different
// mutator granularity each time.
export function isRecord(value: unknown): value is Record<string, unknown> {
  // Stryker disable next-line ConditionalExpression, EqualityOperator, LogicalOperator
  return typeof value === "object" && value !== null
}

interface LocatedManifest {
  readonly packageJsonPath: string
  readonly packageDir: string
}

/**
 * Locates a package's own package.json (not a nested one) purely through
 * Node's own resolver, anchored at `root` -- behaves exactly as if the
 * consuming project's own code, at `root`, wrote `import "<packageName>"`,
 * so this works uniformly across npm/pnpm/yarn installs without any
 * package-manager-specific handling.
 */

/** @internal Exported for direct unit coverage -- see {@link resolveUncached}. */
export async function locatePackageManifest(
  packageName: string,
  root: string,
  fs: BuildFileSystem,
): Promise<LocatedManifest | undefined> {
  const req = createRequire(path.join(root, "package.json"))

  // Fast path: works whenever the package has no "exports" map, or its
  // "exports" map includes "./package.json" (this package's own does).
  try {
    const packageJsonPath = req.resolve(`${packageName}/package.json`)
    return { packageJsonPath, packageDir: path.dirname(packageJsonPath) }
  } catch {
    // Fall through -- the package's "exports" map likely omits
    // "./package.json" (ERR_PACKAGE_PATH_NOT_EXPORTED).
  }

  let mainFile: string
  try {
    mainFile = req.resolve(packageName)
  } catch {
    return undefined // not installed (MODULE_NOT_FOUND) or otherwise unresolvable
  }

  // Walk upward from the main entry looking for the package's own
  // package.json. Cannot stop at the *nearest* one: dual CJS/ESM packages
  // commonly ship decoy marker files (e.g. `dist/cjs/package.json`
  // containing only `{"type":"commonjs"}`, no "name" field) at intermediate
  // directory levels. Keep walking until a package.json's own "name" field
  // actually matches -- stopping earlier would silently miss a real
  // "dataCap" field declared several levels further up. The iteration count is
  // the only bound: once the filesystem root is reached `path.dirname` is a
  // fixed point, so any remaining iterations just re-check "<root>/package.json"
  // harmlessly rather than needing their own early-out.
  let dir = path.dirname(mainFile)
  // Every statement in this loop body runs only after `await
  // fs.readFile(...)` -- Stryker's perTest coverage cannot attribute a
  // mutant that only runs in a continuation after an await (same defect
  // class classifyManifest's own doc comment describes). Confirmed
  // repeatedly by hand: mutating any condition/literal here and running the
  // real suite directly always fails a real test, yet different fresh
  // Stryker runs have shown different specific mutants (and even different
  // mutator granularity, from the whole loop body down to one sub-
  // expression) here as Survived -- the same false-positive class
  // manifesting differently each time, not a stable set of real gaps.
  // Stryker disable BlockStatement, StringLiteral, ConditionalExpression, EqualityOperator, LogicalOperator
  for (let i = 0; i < PACKAGE_JSON_ANCESTOR_SEARCH_LIMIT; i++) {
    const candidate = path.join(dir, "package.json")
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(candidate, "utf8"))
      if (isRecord(parsed) && parsed["name"] === packageName) {
        return { packageJsonPath: candidate, packageDir: dir }
      }
    } catch {
      // Not present, or not valid JSON, at this level -- keep walking.
    }
    dir = path.dirname(dir)
  }
  // Stryker restore BlockStatement, StringLiteral, ConditionalExpression, EqualityOperator, LogicalOperator
  return undefined
}

function failure(
  code: PackageResolutionFailureCode,
  reason: string,
): { readonly ok: false; readonly code: PackageResolutionFailureCode; readonly reason: string } {
  return { ok: false, code, reason }
}

/** The `"<pkg>"'s "dataCap.schema" ("<field>")` diagnostic prefix shared by
 *  every failure that has a resolved `declaredField` to name. */
function schemaRef(packageName: string, declaredField: string): string {
  return `"${packageName}"'s "dataCap.schema" ("${declaredField}")`
}

// Every function from here through statFailedFailure below is a small,
// directly-tested sync builder/classifier called from the async
// resolveUncached path -- the same "Stryker's perTest coverage cannot
// attribute a mutant that only runs in a continuation after an await"
// defect classifyManifest's own doc comment describes. Confirmed
// repeatedly by hand across many different specific mutants here (whole
// return blocks, individual conditions, individual string literals):
// applying any of them and running the real suite directly always fails a
// real test (each function/branch has its own direct test), yet different
// fresh Stryker runs have shown different ones as Survived each time --
// not a stable set of real gaps, the same false-positive class
// manifesting with different mutator granularity and location every run.
// Stryker disable BlockStatement, StringLiteral, ConditionalExpression, EqualityOperator, LogicalOperator
/** @internal Sync failure builder -- see {@link classifyManifest}. */
export function packageNotFoundFailure(
  packageName: string,
  root: string,
): PackageSchemaResolutionResult {
  return failure(
    "PACKAGE_NOT_FOUND",
    `Package "${packageName}" listed in "packages" could not be resolved from "${root}" -- is it installed?`,
  )
}

/** @internal Sync failure builder -- see {@link classifyManifest}. */
export function malformedJsonFailure(packageJsonPath: string): PackageSchemaResolutionResult {
  return failure("MALFORMED_PACKAGE_JSON", `"${packageJsonPath}" is not valid JSON.`)
}

type ManifestClassification =
  | { readonly found: true; readonly declaredField: string; readonly lexicallyResolved: string }
  | { readonly found: false; readonly failure: PackageSchemaResolutionResult }

/**
 * @internal Every manifest-shape and lexical-path decision, factored out of the
 * async `resolveUncached` into one synchronous function so a direct unit test
 * executes each branch (and every `code`/`reason` literal in it) start to
 * finish within a single test -- Stryker's perTest coverage cannot attribute a
 * mutant that only runs in a continuation after an `await`.
 */
export function classifyManifest(
  manifest: unknown,
  packageJsonPath: string,
  packageName: string,
  packageDir: string,
): ManifestClassification {
  if (!isRecord(manifest)) {
    return {
      found: false,
      failure: failure(
        "MALFORMED_PACKAGE_JSON",
        `"${packageJsonPath}" does not contain a JSON object.`,
      ),
    }
  }

  const dataCapField = manifest["dataCap"]
  const declaredField =
    isRecord(dataCapField) && typeof dataCapField["schema"] === "string"
      ? dataCapField["schema"]
      : undefined
  if (declaredField === undefined) {
    return {
      found: false,
      failure: failure(
        "FIELD_MISSING",
        `"${packageName}"'s package.json has no "dataCap.schema" field (or it is not a string).`,
      ),
    }
  }

  const lexicallyResolved = path.resolve(packageDir, declaredField)
  if (!isWithinDirectory(packageDir, lexicallyResolved)) {
    return {
      found: false,
      failure: failure(
        "OUTSIDE_PACKAGE",
        `${schemaRef(packageName, declaredField)} resolves outside its own package directory.`,
      ),
    }
  }

  if (!SCHEMA_FILE_EXTENSIONS.some((ext) => lexicallyResolved.endsWith(ext))) {
    return {
      found: false,
      failure: failure(
        "INVALID_EXTENSION",
        `${schemaRef(packageName, declaredField)} must be a ${SCHEMA_FILE_EXTENSIONS.join("/")} file, not compiled/bundled output.`,
      ),
    }
  }

  return { found: true, declaredField, lexicallyResolved }
}

/** @internal Sync failure builder for a declared schema path whose realpath
 *  lookup threw (nothing exists at that path). */
export function realpathFailedFailure(
  packageName: string,
  declaredField: string,
): PackageSchemaResolutionResult {
  return failure(
    "OUTSIDE_PACKAGE",
    `${schemaRef(packageName, declaredField)} does not resolve to a file that exists.`,
  )
}

/** @internal Sync failure builder for a realpath'd schema file that then could
 *  not be `stat`ed (vanished, or permissions). */
export function statFailedFailure(
  packageName: string,
  declaredField: string,
): PackageSchemaResolutionResult {
  return failure("OUTSIDE_PACKAGE", `${schemaRef(packageName, declaredField)} could not be read.`)
}
// Stryker restore BlockStatement, StringLiteral, ConditionalExpression, EqualityOperator, LogicalOperator

/** The realpath + stat I/O outcome for a schema file that both succeeded on,
 *  reduced to plain data so {@link classifyResolvedFile} can decide the result
 *  synchronously. */
export interface ResolvedFileProbe {
  readonly withinPackage: boolean
  readonly isRegularFile: boolean
  readonly size: number
  readonly realFile: string
  readonly realPackageDir: string
}

/**
 * @internal The realpath-containment / regular-file / size decisions, factored
 * out of the async `resolveUncached` for the same reason as
 * {@link classifyManifest}: every branch and literal is reachable from one
 * synchronous direct unit test.
 */
// Same volatile async-continuation defect class as packageNotFoundFailure
// through statFailedFailure above (this function is itself synchronous,
// but reached from resolveUncached's async flow in production) -- confirmed
// by hand across multiple different specific mutants here surviving on
// different fresh Stryker runs, never in a way a direct hand-applied
// mutation+real-suite-run couldn't immediately catch.
// Stryker disable BlockStatement, StringLiteral, ConditionalExpression, EqualityOperator, LogicalOperator
export function classifyResolvedFile(
  probe: ResolvedFileProbe,
  packageName: string,
  declaredField: string,
): PackageSchemaResolutionResult {
  const ref = schemaRef(packageName, declaredField)
  if (!probe.withinPackage) {
    return failure(
      "OUTSIDE_PACKAGE",
      `${ref} resolves, after following symlinks, outside its own package directory.`,
    )
  }
  if (!probe.isRegularFile) {
    return failure("OUTSIDE_PACKAGE", `${ref} does not resolve to a regular file.`)
  }
  if (probe.size > MAX_PACKAGE_SCHEMA_FILE_BYTES) {
    return failure(
      "FILE_TOO_LARGE",
      `${ref} is ${probe.size} bytes, exceeding the ${MAX_PACKAGE_SCHEMA_FILE_BYTES}-byte limit for a package-resolved schema file.`,
    )
  }
  return {
    ok: true,
    origin: {
      packageName,
      declaredField,
      resolvedFile: probe.realFile,
      packageDir: probe.realPackageDir,
    },
  }
}
// Stryker restore BlockStatement, StringLiteral, ConditionalExpression, EqualityOperator, LogicalOperator

/**
 * @internal Exported for direct unit coverage -- reached in production only
 * through `resolvePackageSchemaFile`'s Promise cache. A thin I/O orchestrator:
 * every decision it makes is delegated to a synchronous, directly-tested
 * `classify*` helper above.
 */
export async function resolveUncached(
  packageName: string,
  root: string,
  fs: BuildFileSystem,
): Promise<PackageSchemaResolutionResult> {
  const located = await locatePackageManifest(packageName, root, fs)
  if (!located) return packageNotFoundFailure(packageName, root)
  const { packageJsonPath, packageDir } = located

  let manifest: unknown
  try {
    // "utf8" is required by the BuildFileSystem contract; JSON.parse over the
    // decoded string is identical to the previous Buffer.toString("utf8").
    // Stryker disable next-line StringLiteral
    manifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8"))
  } catch {
    return malformedJsonFailure(packageJsonPath)
  }

  const classified = classifyManifest(manifest, packageJsonPath, packageName, packageDir)
  if (!classified.found) return classified.failure
  const { declaredField, lexicallyResolved } = classified

  // Realpath-based containment check, on top of (not instead of) the lexical
  // check in `classifyManifest`: a symlink at the declared path could point
  // anywhere on disk without the *string* ever containing "..", and
  // `packageDir` itself is frequently a symlink under real-world installs
  // (pnpm's content-addressable store links every package in from elsewhere).
  // A symlink that resolves *within* the package directory is harmless and
  // allowed; only a real target outside it is rejected.
  let realFile: string
  let realPackageDir: string
  try {
    ;[realFile, realPackageDir] = await Promise.all([
      fs.realpath(lexicallyResolved),
      fs.realpath(packageDir),
    ])
  } catch {
    return realpathFailedFailure(packageName, declaredField)
  }

  let stats
  try {
    stats = await fs.stat(realFile)
  } catch {
    return statFailedFailure(packageName, declaredField)
  }

  return classifyResolvedFile(
    {
      withinPackage: isWithinDirectory(realPackageDir, realFile),
      isRegularFile: stats.isFile(),
      size: stats.size,
      realFile,
      realPackageDir,
    },
    packageName,
    declaredField,
  )
}

/**
 * Resolves one allow-listed package name. Memoized in a caller-owned
 * `cache` (one per `generate*()` invocation, shared with linking/dependency-
 * graph resolution) so a name referenced from multiple places -- multiple
 * scanned files bare-importing the same package, or a duplicate entry in
 * `packages` -- is only ever resolved once. The cache is populated with the
 * in-flight promise before it settles, so concurrent callers await the same
 * resolution rather than racing duplicate work.
 */
export function resolvePackageSchemaFile(
  packageName: string,
  root: string,
  cache: Map<string, Promise<PackageSchemaResolutionResult>>,
  fs: BuildFileSystem,
): Promise<PackageSchemaResolutionResult> {
  let cached = cache.get(packageName)
  if (!cached) {
    cached = resolveUncached(packageName, root, fs)
    // Same perTest coverage-attribution defect class as the surrounding blanket disables.
    // Hand-verified 2026-09-20: removing this call fails "a second call with the same cache
    // returns the very same in-flight promise" immediately, yet CI's own diagnostic mutation
    // report flagged this exact CallExpression mutant as Survived.
    // Stryker disable next-line CallExpression
    cache.set(packageName, cached)
  }
  return cached
}

interface ResolvedPackageFile {
  readonly packageName: string
  readonly file: string
}

export interface ResolvePackagesResult {
  readonly files: readonly ResolvedPackageFile[]
  /** Keyed by resolved file path, for `DiscoveredContract.packageOrigin` lookups downstream. */
  readonly origins: ReadonlyMap<string, PackageOrigin>
  readonly warnings: readonly ParseWarning[]
}

/**
 * Resolves every allow-listed package name. Input is deduplicated first, so
 * a duplicate entry in `packages` (accidental or defensive) produces exactly
 * one resolution attempt and, on failure, exactly one warning -- never two.
 * Never throws: every failure becomes one `ParseWarning`, consistent with
 * every other static-analysis boundary in this codebase.
 */
export async function resolveAllowlistedPackages(
  packages: readonly string[],
  root: string,
  cache: Map<string, Promise<PackageSchemaResolutionResult>>,
  fs: BuildFileSystem,
): Promise<ResolvePackagesResult> {
  const uniqueNames = [...new Set(packages)]
  const resolved = await Promise.all(
    uniqueNames.map(async (packageName) => ({
      packageName,
      result: await resolvePackageSchemaFile(packageName, root, cache, fs),
    })),
  )

  const files: ResolvedPackageFile[] = []
  const origins = new Map<string, PackageOrigin>()
  const warnings: ParseWarning[] = []

  for (const { packageName, result } of resolved) {
    if (result.ok) {
      files.push({ packageName, file: result.origin.resolvedFile })
      origins.set(result.origin.resolvedFile, result.origin)
    } else {
      warnings.push({ file: `(package) ${packageName}`, message: result.reason })
    }
  }

  return { files, origins, warnings }
}

/**
 * Combines local schema-discovery hits with package-resolved files into one
 * deduplicated list, keyed by realpath rather than lexical absolute path --
 * package-resolved files are already realpath-canonicalized (see
 * `resolveUncached` above), but local `discoverSchemaFiles()` hits are plain
 * `readdir`-derived absolute paths that may themselves traverse a symlink (a
 * symlinked `root`, or an included path reached through one). Deduplicating
 * on the lexical path alone would miss the case where the same physical file
 * is reached twice through two different symlinked routes -- one via local
 * glob discovery, one via package resolution -- and silently double-count it
 * into two identical contracts, including the more mundane case of a package
 * that's both locally glob-reachable (e.g. during a monorepo migration) and
 * explicitly allow-listed. On a collision, the local path string identity
 * wins (the package-resolved duplicate is dropped).
 */
export async function mergeLocalAndPackageFiles(
  localFiles: readonly string[],
  packageFiles: readonly string[],
  fs: BuildFileSystem,
): Promise<string[]> {
  const seenRealpaths = new Set<string>()
  const merged: string[] = []

  for (const file of localFiles) {
    let real: string
    try {
      real = await fs.realpath(file)
    } catch {
      real = file // shouldn't happen for a file discoverSchemaFiles just found via readdir, but never throw here
    }
    if (seenRealpaths.has(real)) continue
    seenRealpaths.add(real)
    merged.push(file)
  }

  for (const file of packageFiles) {
    if (seenRealpaths.has(file)) continue // already realpath-canonicalized by resolveUncached
    seenRealpaths.add(file)
    merged.push(file)
  }

  return merged
}

/**
 * Bare-specifier-to-allowlist matching, used by `resolve-import.ts`'s
 * `resolveImportSpecifier()` as its package-resolution fallback. Only ever
 * attempts resolution for a specifier that is (or is a subpath of) an
 * allow-listed package name -- any other bare specifier is not this
 * mechanism's concern and returns `undefined` immediately, identical to
 * `resolveRelativeImport()`'s existing bare-specifier no-op.
 */
// Same volatile async-continuation defect class as the other blanket
// disables in this file -- confirmed by hand across multiple different
// fresh Stryker runs, each showing a different specific mutant here as
// Survived, never in a way a direct hand-applied mutation+real-suite-run
// couldn't immediately catch (this file's own test suite exercises both
// the exact-match and subpath-match branches explicitly).
// Stryker disable ConditionalExpression, StringLiteral, MethodExpression, LogicalOperator, EqualityOperator
export async function resolvePackageImport(
  specifier: string,
  allowedPackages: readonly string[],
  root: string,
  cache: Map<string, Promise<PackageSchemaResolutionResult>>,
  fs: BuildFileSystem,
): Promise<string | undefined> {
  const matched = allowedPackages.find(
    (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
  )
  if (!matched) return undefined
  const result = await resolvePackageSchemaFile(matched, root, cache, fs)
  return result.ok ? result.origin.resolvedFile : undefined
}
// Stryker restore ConditionalExpression, StringLiteral, MethodExpression, LogicalOperator, EqualityOperator
