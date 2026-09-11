/**
 * Scans every discovered project file as a potential consumer of every
 * target capability -- the one pass in `build/` that legitimately reads
 * files beyond what `discover.ts`/`link.ts` already covered, since a
 * consumer can be any `.ts`/`.tsx` file in the project, not just ones that
 * themselves call `buildData`/`createData`. Reuses the exact same
 * specifier-resolution machinery `link.ts` uses (`resolveImportSpecifier`),
 * so a `fields` reference and a consumer's import are resolved identically.
 */

import ts from "typescript"
import { collectImportBindings } from "./parse.js"
import type { ImportBinding, ParseWarning } from "./parse.js"
import { scanFileForUsage } from "./dependency-graph.js"
import type { ImportBindingMatch, ScanTarget } from "./dependency-graph.js"
import type { DependencyEdge } from "./dependency-types.js"
import { discoverCapabilityFiles } from "./discover.js"
import { displayPath } from "./display-path.js"
import { isGeneratedFile } from "./generated-banner.js"
import { resolveAllowlistedPackages } from "./resolution/resolve-package-schema.js"
import type { PackageSchemaResolutionResult } from "./resolution/resolve-package-schema.js"
import {
  createAliasResolutionCache,
  loadTsconfigPaths,
} from "./resolution/resolve-tsconfig-paths.js"
import { resolveImportSpecifier } from "./resolution/resolve-import.js"
import type { ImportResolutionContext } from "./resolution/resolve-import.js"
import type { BuildFileSystem } from "./types.js"

/** Options for `scanDependencies`. */
export interface ScanDependenciesOptions {
  /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
  readonly fs: BuildFileSystem
  /** Directory import specifiers resolve against. */
  readonly root: string
  /** Explicit `tsconfig.json` path override, or `false` to disable alias resolution -- same meaning as `LinkOptions.tsconfig`. */
  readonly tsconfig?: string | false
  /** Explicit cross-package schema discovery allowlist -- see `resolve-package-schema.ts`. */
  readonly packages?: readonly string[]
}

/** Every proven consumer edge the scan found, plus any resolution warnings. */
export interface ScanDependenciesResult {
  /** Every proven consumer relationship found. */
  readonly edges: readonly DependencyEdge[]
  /** Resolution warnings encountered during the scan, never blocking. */
  readonly warnings: readonly ParseWarning[]
  /** Allow-listed package names whose own directory was actually walked and scanned as potential consumer source -- the honest "what was actually searched" boundary a "field is unconsumed" conclusion is scoped to (ADR 0053). A package listed in `options.packages` but not resolvable (see `warnings`) is never silently counted as scanned. */
  readonly scannedPackages: readonly string[]
}

/**
 * Rewrites one freshly-scanned edge's two absolute paths into the
 * root-relative form every canonical model publishes (OUT-01). Applied once,
 * here, at the boundary where the scan hands its result back -- not inside
 * `dependency-graph.ts`, which stays a pure absolute-in/absolute-out AST
 * pass with no notion of a discovery root.
 *
 * `to.capability.file` is converted with the same `displayPath` the
 * inventory used, so an edge's target key (`file#exportName`) still matches
 * `CapabilityNode.file` exactly -- every grouping in
 * `dependency-projections.ts`/`usage-report.ts`/`change-model.ts` depends on
 * that identity holding.
 */
function toRootRelativeEdge(root: string, edge: DependencyEdge): DependencyEdge {
  return {
    ...edge,
    from: displayPath(root, edge.from),
    to: {
      ...edge.to,
      capability: {
        file: displayPath(root, edge.to.capability.file),
        exportName: edge.to.capability.exportName,
      },
    },
  }
}

function targetKey(file: string, exportName: string): string {
  return `${file}#${exportName}`
}

function collectFileImports(sourceFile: ts.SourceFile): readonly ImportBinding[] {
  const imports: ImportBinding[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) collectImportBindings(statement, imports)
  }
  return imports
}

/**
 * Resolves one file's import bindings against the known `targets`.
 * A binding whose specifier resolves directly to a target's own
 * declaring file is a confident `"resolved"` match. A binding whose
 * specifier doesn't resolve there, but whose imported name uniquely
 * matches exactly one target elsewhere (a plausible re-export/barrel
 * indirection this module doesn't trace through), becomes a lower-
 * confidence `"unresolved-consumer"` match rather than being silently
 * dropped. An imported name shared by more than one target is too
 * ambiguous to guess at all, and is dropped.
 */
async function matchFileImports(
  file: string,
  imports: readonly ImportBinding[],
  targets: readonly ScanTarget[],
  targetsByName: ReadonlyMap<string, readonly ScanTarget[]>,
  context: ImportResolutionContext,
): Promise<readonly ImportBindingMatch[]> {
  const matches: ImportBindingMatch[] = []
  for (const binding of imports) {
    if (binding.importedName === "default") continue // default imports aren't traced -- unresolvable without deeper analysis

    const resolvedFile = await resolveImportSpecifier(file, binding.moduleSpecifier, context)
    // `.find` on the (small) target list rather than a keyed lookup so an
    // unresolvable specifier (`resolvedFile === undefined`) simply matches no
    // target -- no synthetic key, no guard. A namespace import (`importedName`
    // is `"*"`) likewise matches nothing here, so it needs no special-casing.
    const resolvedTarget = targets.find(
      (candidate) =>
        candidate.file === resolvedFile && candidate.exportName === binding.importedName,
    )
    if (resolvedTarget !== undefined) {
      matches.push({ localName: binding.localName, target: resolvedTarget, resolution: "resolved" })
      continue
    }

    const plausible = targetsByName.get(binding.importedName)
    const onlyCandidate = plausible?.length === 1 ? plausible[0] : undefined
    if (onlyCandidate !== undefined) {
      matches.push({
        localName: binding.localName,
        target: onlyCandidate,
        resolution: "unresolved-consumer",
      })
    }
  }
  return matches
}

/**
 * Resolves `packages` to each package's own directory (reusing
 * `resolve-package-schema.ts`'s existing package-manifest resolution --
 * never a second, separate resolution mechanism), then walks each directory
 * exactly the way `discoverCapabilityFiles` walks the local `root`, so an
 * allow-listed package's own source tree is scanned as potential *consumer*
 * source, not just resolved as one schema-declaring file. A package that
 * fails to resolve contributes nothing and is never counted as scanned --
 * its existing `resolveAllowlistedPackages` warning already explains why.
 */
async function discoverPackageScanFiles(
  packageNames: readonly string[],
  root: string,
  fs: BuildFileSystem,
): Promise<{
  readonly files: readonly string[]
  readonly scannedPackages: readonly string[]
  readonly warnings: readonly ParseWarning[]
}> {
  const cache = new Map<string, Promise<PackageSchemaResolutionResult>>()
  const { origins, warnings } = await resolveAllowlistedPackages(packageNames, root, cache, fs)

  const packageDirsByName = new Map(
    [...origins.values()].map((origin) => [origin.packageName, origin.packageDir]),
  )
  const fileLists = await Promise.all(
    [...packageDirsByName.values()].map((packageDir) =>
      discoverCapabilityFiles({ fs, root: packageDir }),
    ),
  )

  return {
    files: fileLists.flat(),
    scannedPackages: [...packageDirsByName.keys()],
    warnings,
  }
}

/**
 * Scans `files` for usage of every capability in `targets`, producing the
 * proven `DependencyEdge`s (and any resolution warnings) the ownership/
 * usage report renders. Never mutates or writes anything.
 */
export async function scanDependencies(
  files: readonly string[],
  targets: readonly ScanTarget[],
  options: ScanDependenciesOptions,
): Promise<ScanDependenciesResult> {
  const { resolution: tsconfigPaths, warning: tsconfigWarning } = await loadTsconfigPaths(
    options.root,
    options.tsconfig,
    options.fs,
  )
  const packages = options.packages ?? []
  const context: ImportResolutionContext = {
    fs: options.fs,
    root: options.root,
    packages,
    cache: new Map(),
    tsconfigPaths,
    aliasCache: createAliasResolutionCache(),
  }
  const warnings: ParseWarning[] = tsconfigWarning !== undefined ? [tsconfigWarning] : []

  const packageScan = await discoverPackageScanFiles(packages, options.root, options.fs)
  warnings.push(...packageScan.warnings)
  const alreadyScanned = new Set(files)
  const allFiles = [...files, ...packageScan.files.filter((f) => !alreadyScanned.has(f))]

  const targetsByName = new Map<string, ScanTarget[]>()
  for (const target of targets) {
    const existing = targetsByName.get(target.exportName) ?? []
    existing.push(target)
    targetsByName.set(target.exportName, existing)
  }

  const edges: DependencyEdge[] = []
  for (const file of allFiles) {
    let sourceText: string
    try {
      sourceText = await options.fs.readFile(file, "utf8")
    } catch {
      continue // unreadable file (permissions, race with deletion, ...) -- skip silently, matching discover.ts's own posture
    }
    // data-cap's own generated output is never independent evidence of
    // consumption. The generated manifest imports every active capability by
    // construction, so counting it as a consumer would let a capability
    // "prove" it is used purely because this tool re-exported it -- a report
    // bootstrapping evidence from itself, and enough to silently suppress
    // every `ABANDONED_CAPABILITY` finding the moment `--location` points
    // anywhere inside the discovery `include`. Skipped by the same banner
    // `check-artifacts.ts` uses to recognize its own files, so a
    // hand-written file is never affected.
    if (isGeneratedFile(sourceText)) continue
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const imports = collectFileImports(sourceFile)
    const matches = await matchFileImports(file, imports, targets, targetsByName, context)

    // A capability's own declaring file never has an `import` statement for
    // its own local export -- there's nothing for `matchFileImports` to find
    // -- so a same-file read (`export const userData = createData(...)` then
    // later `userData.getSnapshot()...` in the same file) would otherwise be
    // invisible to `scanFileForUsage` entirely. Kept as a separate list, not
    // merged into `matches`: unlike a real import, an unused self-declared
    // capability must never get a synthesized "imports" edge below (a file
    // doesn't import its own local declaration).
    const matchedLocalNames = new Set(matches.map((m) => m.localName))
    const selfMatches: ImportBindingMatch[] = targets
      .filter((target) => target.file === file && !matchedLocalNames.has(target.exportName))
      .map((target) => ({ localName: target.exportName, target, resolution: "resolved" }))

    const allMatches = [...matches, ...selfMatches]
    // Pure fast-path: with no matches, `scanFileForUsage` walks the AST to find
    // nothing and the imports-synthesis loop below iterates an empty `matches`,
    // so skipping is unobservable in the output -- only in the time spent. Two
    // restructurings (an internal guard in `scanFileForUsage`; deferring the
    // walk) just relocate an identical equivalent mutant, so this one line is
    // disabled rather than chased.
    // Stryker disable next-line ConditionalExpression
    if (allMatches.length === 0) continue

    const fileEdges = scanFileForUsage(sourceFile, file, allMatches)
    const targetsWithEdges = new Set(
      fileEdges.map((edge) => targetKey(edge.to.capability.file, edge.to.capability.exportName)),
    )
    for (const match of matches) {
      const key = targetKey(match.target.file, match.target.exportName)
      if (targetsWithEdges.has(key)) continue
      edges.push({
        relationship: "imports",
        from: file,
        to: { capability: { file: match.target.file, exportName: match.target.exportName } },
        resolution: match.resolution,
        position: undefined,
      })
    }
    edges.push(...fileEdges)
  }

  return {
    edges: edges.map((edge) => toRootRelativeEdge(options.root, edge)),
    warnings,
    scannedPackages: packageScan.scannedPackages,
  }
}
