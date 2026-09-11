/**
 * Orchestrates C6: scans `files` for usage of every capability in
 * `inventory` (`scan-dependencies.ts` -- the one pass in this phase that
 * legitimately touches the filesystem beyond discovery/linking), then
 * renders the result through `usage-report.ts`. Unlike `generate-manifest.ts`/
 * `generate-documentation.ts`, this is not a pure function of the inventory
 * alone -- it needs the project's full file list to scan as potential
 * consumers.
 */

import { absolutePathFrom } from "./display-path.js"
import { scanDependencies } from "./scan-dependencies.js"
import type { ScanDependenciesOptions } from "./scan-dependencies.js"
import type { ScanTarget } from "./dependency-graph.js"
import { deriveUsageFindings, renderUsageReport } from "./usage-report.js"
import type { CapabilityInventory } from "./inventory.js"
import type { DependencyEdge } from "./dependency-types.js"
import type { ReportFinding } from "./findings.js"
import type { ParseWarning } from "./parse.js"

/** Options for `generateUsage`. */
export interface GenerateUsageOptions {
  /** The inventory to scan usage for. */
  readonly inventory: CapabilityInventory
  /** Output path for the rendered Dependency & Ownership report, or `undefined` when the caller only wants the scan's `edges`/`findings` (a `--flow`-without-`--ownership` run) and will not write the report. Echoed straight back as `result.location`. */
  readonly location: string | undefined
  /** Every project file to scan as a potential consumer -- typically the same file list `discoverCapabilityFiles` produced, since a consumer need not itself declare a capability. */
  readonly files: readonly string[]
  /** Passed through to `scanDependencies` -- root/tsconfig/packages for import-specifier resolution. `scan.root` also doubles as the discovery root every rendered path in the report displays relative to. */
  readonly scan: ScanDependenciesOptions
  /** This same run's own `--evidence` output path, when requested -- named in the generated banner's Evidence Model note. */
  readonly evidencePath?: string
}

/** The rendered Dependency & Ownership report plus the proven `DependencyEdge`s and findings it's built from. */
export interface GenerateUsageResult {
  /** Where this report is intended to be written, or `undefined` when the caller requested only the scan results -- see `GenerateUsageOptions.location`. */
  readonly location: string | undefined
  /** The rendered Markdown content. */
  readonly content: string
  /** Every proven consumer relationship the scan found. */
  readonly edges: readonly DependencyEdge[]
  /** Ownership/usage findings derived from `edges` (e.g. `ABANDONED_CAPABILITY`). */
  readonly findings: readonly ReportFinding[]
  /** Parse/resolution warnings from the scan, never blocking. */
  readonly warnings: readonly ParseWarning[]
}

/**
 * `CapabilityNode.file` is root-relative (OUT-01), but a `ScanTarget` is
 * matched against real, absolute paths -- both the resolved import specifiers
 * `resolveImportSpecifier` produces and the absolute file list being walked --
 * so each target's `file` is re-derived here with `absolutePathFrom`. The
 * edges the scan produces are relativized again on the way out (see
 * `scan-dependencies.ts`), so this absolute form never escapes the scan.
 */
function buildScanTargets(inventory: CapabilityInventory, root: string): readonly ScanTarget[] {
  return inventory.capabilities.map((capability) => ({
    file: absolutePathFrom(root, capability.file),
    exportName: capability.exportName,
    getterNames: capability.getters.map((op) => op.name),
    mutatorNames: capability.mutators.map((op) => op.name),
    subscriptionNames: capability.subscriptions.map((op) => op.name),
  }))
}

/** Scans `options.files` for usage of every capability in `options.inventory`, then renders the Dependency & Ownership report (C5+C6). */
export async function generateUsage(options: GenerateUsageOptions): Promise<GenerateUsageResult> {
  const targets = buildScanTargets(options.inventory, options.scan.root)
  const { edges, warnings, scannedPackages } = await scanDependencies(
    options.files,
    targets,
    options.scan,
  )
  return {
    location: options.location,
    content: renderUsageReport(
      options.inventory,
      edges,
      options.scan.root,
      scannedPackages,
      options.evidencePath,
    ),
    edges,
    findings: deriveUsageFindings(options.inventory, edges),
    warnings,
  }
}
