/**
 * Combines `docs.ts`'s rendering with `static-rules.ts`'s ownership/
 * sensitivity findings into the one result `generate-data-artifacts.ts`
 * (C8) needs. Pure -- no filesystem access.
 */

import { renderDocumentation } from "./docs.js"
import { DEFAULT_EXPIRING_WITHIN_DAYS } from "./expiring-window.js"
import { checkOwnershipAndSensitivity } from "./static-rules.js"
import type { DependencyEdge } from "./dependency-types.js"
import type { CapabilityInventory } from "./inventory.js"
import { buildLifecycleModel } from "./lifecycle-model.js"
import type { ManifestChangeReport } from "./manifest-snapshot.js"
import type { ReportFinding } from "./findings.js"

/** Options for `generateDocumentation`. */
export interface GenerateDocumentationOptions {
  /** The inventory to render documentation from. */
  readonly inventory: CapabilityInventory
  /** Discovery root every rendered path displays relative to. */
  readonly root: string
  /** Output path for the rendered documentation catalog. */
  readonly location: string
  /** Manifest changes since the last report, rendered as a "changes since last report" section when present. */
  readonly changes?: ManifestChangeReport
  /** Proven usage edges, when the caller already ran the usage scan (`--ownership`/`--flow`) -- renders exact `file:line:column` consumption sites per field when supplied. Omit when no usage scan ran; the catalog still renders, just without that column populated. */
  readonly edges?: readonly DependencyEdge[]
  /** This same run's own `--evidence` output path, when requested -- named in the generated banner's Evidence Model note. */
  readonly evidencePath?: string
  /**
   * How many days out counts as "expiring soon" in the rendered Lifecycle
   * section. Defaults to `DEFAULT_EXPIRING_WITHIN_DAYS` (30), matching
   * env-cap's own default.
   */
  readonly expiringWithinDays?: number
  /**
   * The instant `daysRemaining` is measured from. Defaults to the wall clock
   * at call time; `generateDataArtifacts` passes its own single run-wide
   * instant, so the catalog and the published Evidence Model can never
   * report a different "12d remaining" for the same field.
   */
  readonly generatedAt?: Date
}

/** The rendered documentation catalog plus the ownership/sensitivity findings it surfaces. */
export interface GenerateDocumentationResult {
  /** Where this documentation is intended to be written. */
  readonly location: string
  /** The rendered Markdown content. */
  readonly content: string
  /** Ownership/sensitivity findings surfaced while rendering. */
  readonly findings: readonly ReportFinding[]
}

/** Renders the Markdown documentation catalog and runs the ownership/sensitivity static rules (C4). */
export function generateDocumentation(
  options: GenerateDocumentationOptions,
): GenerateDocumentationResult {
  return {
    location: options.location,
    content: renderDocumentation(
      options.inventory,
      options.root,
      options.changes,
      options.edges,
      options.evidencePath,
      // Rebuilt here rather than threaded in as a pre-computed model: this
      // is a pure projection over the same `inventory` already in hand, so
      // the orchestrator's own Lifecycle Model and this one are identical by
      // construction given the same window and instant -- and a standalone
      // caller of `generateDocumentation` gets the section without having to
      // know a second model exists.
      buildLifecycleModel(
        options.inventory,
        options.expiringWithinDays ?? DEFAULT_EXPIRING_WITHIN_DAYS,
        options.generatedAt ?? new Date(),
      ),
    ),
    findings: checkOwnershipAndSensitivity(options.inventory),
  }
}
