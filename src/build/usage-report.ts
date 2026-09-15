/**
 * Combines C5's ownership matrix with C6's proven `DependencyEdge`s into
 * the "Dependency & Ownership Report" -- and derives the findings only
 * possible once real usage has been scanned (`ABANDONED_CAPABILITY`,
 * `UNCONSUMED_FIELD`, `UNRESOLVED_CONSUMER`, `INDETERMINATE_CONSUMER`).
 * Pure -- takes already-computed edges as input, no filesystem access.
 */

import { displayPath } from "./display-path.js"
import { evidenceDisclaimer, evidenceProjectionNote, generatedBanner } from "./generated-banner.js"
import type { CapabilityInventory } from "./inventory.js"
import { buildOwnershipMatrix } from "./ownership-model.js"
import type { OwnershipMatrixEntry } from "./ownership-model.js"
import type { DependencyEdge } from "./dependency-types.js"
import type { ReportFinding } from "./findings.js"
import type { SourceLocation } from "./source-position.js"

function capabilityKey(ref: { readonly file: string; readonly exportName: string }): string {
  return `${ref.file}#${ref.exportName}`
}

/**
 * Indexes `edges` by the `capabilityKey` of the capability each one targets.
 * A capability with no edges is simply absent from the map -- callers get a
 * genuine miss for it, never an empty array masquerading as "looked up."
 */
function indexEdgesByTargetCapability(
  edges: readonly DependencyEdge[],
): Map<string, DependencyEdge[]> {
  const byCapability = new Map<string, DependencyEdge[]>()
  for (const edge of edges) {
    const key = capabilityKey(edge.to.capability)
    const existing = byCapability.get(key)
    if (existing === undefined) byCapability.set(key, [edge])
    else existing.push(edge)
  }
  return byCapability
}

/**
 * @internal Whether some proven `reads-field` edge on this capability names
 * `topLevelName` as its (top-level) target field. Only `reads-field` edges
 * carry `to.field`; an indeterminate `reads-field` has `to.field === undefined`
 * and never proves a specific field.
 */
export function isFieldProvenRead(
  capabilityEdges: readonly DependencyEdge[],
  topLevelName: string,
): boolean {
  return capabilityEdges.some(
    (edge) => edge.relationship === "reads-field" && edge.to.field?.[0] === topLevelName,
  )
}

/**
 * @internal Every dynamic/computed access on this capability that this pass
 * genuinely cannot attribute to one specific field -- a computed access on the
 * capability itself (`imports` + indeterminate) or on `.fields` directly
 * (`reads-field` + indeterminate + no named field), and only where a source
 * position was captured.
 */
export function collectIndeterminateSites(
  capabilityEdges: readonly DependencyEdge[],
): SourceLocation[] {
  const sites: SourceLocation[] = []
  for (const edge of capabilityEdges) {
    if (edge.resolution !== "indeterminate") continue
    const unattributable =
      edge.relationship === "imports" ||
      (edge.relationship === "reads-field" && edge.to.field === undefined)
    if (!unattributable) continue
    if (edge.position === undefined) continue
    sites.push({ file: edge.from, ...edge.position })
  }
  return sites
}

/**
 * Derives every finding that requires a real usage scan -- as opposed to
 * `static-rules.ts`'s findings, which need only the inventory. An
 * `ABANDONED_CAPABILITY` capability short-circuits its own field/consumer
 * findings: with zero edges, there is nothing further to characterize.
 */
export function deriveUsageFindings(
  inventory: CapabilityInventory,
  edges: readonly DependencyEdge[],
): readonly ReportFinding[] {
  const edgesByCapability = indexEdgesByTargetCapability(edges)

  const findings: ReportFinding[] = []
  for (const capability of inventory.capabilities) {
    const ref = { file: capability.file, exportName: capability.exportName }
    const capabilityEdges = edgesByCapability.get(capabilityKey(ref)) ?? []

    if (capabilityEdges.length === 0) {
      findings.push({
        code: "ABANDONED_CAPABILITY",
        family: "usage",
        severity: "warning",
        message: `"${capability.exportName}" is never imported anywhere in the scanned project.`,
        capability: ref,
      })
      continue
    }

    for (const edge of capabilityEdges) {
      if (edge.resolution === "unresolved-consumer") {
        findings.push({
          code: "UNRESOLVED_CONSUMER",
          family: "usage",
          severity: "info",
          message: `"${edge.from}" appears to import "${capability.exportName}" by name, but the import specifier didn't resolve directly to its declaring file (possibly a barrel re-export) -- not fully traced.`,
          capability: ref,
          source: edge.from,
        })
      } else if (edge.resolution === "indeterminate") {
        findings.push({
          code: "INDETERMINATE_CONSUMER",
          family: "usage",
          severity: "info",
          message: `"${edge.from}" accesses "${capability.exportName}" using a dynamic/computed property -- can't be statically characterized.`,
          capability: ref,
          source: edge.from,
        })
      }
    }

    // Every access this pass genuinely can't attribute to one specific
    // field -- a dynamic/computed access on the capability itself
    // (`x[computed]`) or on `.fields`/`.getSnapshot().fields` directly
    // (`x.fields[computed]`). Either could, for all this pass can tell, be
    // targeting ANY currently-unproven field on this capability -- so an
    // otherwise-"unconsumed" field here is genuinely uncertain, not
    // genuinely unused (see the five-state model in ADR 0052).
    const indeterminateSites = collectIndeterminateSites(capabilityEdges)

    for (const field of capability.fields) {
      if (field.writtenBy.length === 0) continue // nothing claims to write it -- not this rule's concern
      const topLevelName = field.path[0]
      if (topLevelName === undefined) continue // a field with no path segments has nothing to characterize
      if (isFieldProvenRead(capabilityEdges, topLevelName)) continue // "proven" -- no finding

      // A developer's own citation takes precedence over both "indeterminate"
      // and "unconsumed" -- it's a stronger, specific claim than either
      // "can't tell" or "nothing found." This fires on the citation's mere
      // presence; whether it currently holds (the file still exists, hasn't
      // visibly changed) is a *separate*, additional fact checked by
      // `verifyDynamicAccessCitations` against a real filesystem + snapshot,
      // never here -- this function stays pure (ADR 0053).
      const dynamicAccessCitations =
        capability.docs?.evidence?.fields?.[topLevelName]?.dynamicAccess
      if (dynamicAccessCitations !== undefined && dynamicAccessCitations.length > 0) {
        for (const citation of dynamicAccessCitations) {
          findings.push({
            code: "FIELD_DYNAMIC_ACCESS_DECLARED",
            family: "usage",
            severity: "info",
            message: `Per developers, this data point is dynamically accessed at ${citation}.`,
            capability: ref,
            field: field.path,
            ...(field.declarationPosition !== undefined
              ? { position: field.declarationPosition }
              : {}),
          })
        }
        continue
      }

      if (indeterminateSites.length > 0) {
        findings.push({
          code: "FIELD_ACCESS_INDETERMINATE",
          family: "usage",
          severity: "info",
          message: `Field "${field.path.join(".")}" on "${capability.exportName}" appears unused, but there are instances of dynamic/computed access on this capability that can't be statically attributed to a specific field -- it may be one of them.`,
          capability: ref,
          field: field.path,
          ...(field.declarationPosition !== undefined
            ? { position: field.declarationPosition }
            : {}),
          indeterminateSites,
        })
        continue
      }

      findings.push({
        code: "UNCONSUMED_FIELD",
        family: "usage",
        severity: "warning",
        message: `Field "${field.path.join(".")}" on "${capability.exportName}" is written but never statically read in the scanned project.`,
        capability: ref,
        field: field.path,
        ...(field.declarationPosition !== undefined ? { position: field.declarationPosition } : {}),
      })
    }
  }
  return findings
}

/** @internal Exported for direct unit coverage. */
export function renderOwnershipMatrix(entries: readonly OwnershipMatrixEntry[]): string {
  if (entries.length === 0) return "_No capabilities discovered._"
  return entries
    .map((entry) => {
      const lines = [`### ${entry.owner}`, ""] // `entry.owner` is already `UNOWNED` ("(unowned)") for the unowned bucket
      lines.push(
        `Capabilities: ${entry.capabilities.map((c) => `\`${c.exportName}\``).join(", ") || "_none_"}`,
      )
      lines.push(
        `Fields: ${entry.fields.map((f) => `\`${f.capability.exportName}.${f.field.join(".")}\``).join(", ") || "_none_"}`,
      )
      return lines.join("\n")
    })
    .join("\n\n")
}

/**
 * A file can declare more than one capability (e.g. two independent
 * `createData` capabilities in one `main.ts`), so "which capability's own
 * code produced this edge" is ambiguous from the file alone whenever more
 * than one capability shares it -- there's no per-capability source range
 * tracked to disambiguate further. Rather than silently picking one (the
 * bug this replaces: a plain `Map<file, CapabilityNode>` overwrites down to
 * whichever capability happens to be declared last), every co-located
 * capability is listed as a possible source instead of guessed at.
 */
/** @internal Exported for direct unit coverage. */
export function renderCapabilityDependencies(
  inventory: CapabilityInventory,
  edges: readonly DependencyEdge[],
): string {
  const capabilitiesByFile = new Map<string, CapabilityInventory["capabilities"][number][]>()
  for (const capability of inventory.capabilities) {
    const existing = capabilitiesByFile.get(capability.file)
    if (existing === undefined) capabilitiesByFile.set(capability.file, [capability])
    else existing.push(capability)
  }
  const rows = edges.flatMap((edge) => {
    const from = capabilitiesByFile.get(edge.from)
    if (from === undefined) return [] // consumer file declares no capability of its own
    // If the edge's target is itself one of the capabilities declared in
    // this same file, this is indistinguishable from that capability's own
    // self-usage (ordinary usage, already covered by the per-capability
    // consumer table below) -- and even if it technically came from a
    // sibling capability's own code, that can't be proven without per-
    // capability source-range tracking this pass doesn't have. Never
    // guessed at: excluded rather than mislabeled either way.
    const targetIsCoLocated = from.some(
      (c) => c.file === edge.to.capability.file && c.exportName === edge.to.capability.exportName,
    )
    if (targetIsCoLocated) return []
    const fromLabel = from.map((c) => `\`${c.exportName}\``).join(" or ")
    return [`| ${fromLabel} | ${edge.relationship} | \`${edge.to.capability.exportName}\` |`]
  })
  if (rows.length === 0) return "_No capability statically depends on another capability._"
  return ["| From | Relationship | To |", "| --- | --- | --- |", ...rows].join("\n")
}

/** @internal Exported for direct unit coverage. */
export function renderConsumerEdges(
  inventory: CapabilityInventory,
  edges: readonly DependencyEdge[],
  root: string,
): string {
  if (inventory.capabilities.length === 0) return "_No capabilities discovered._"
  const edgesByCapability = indexEdgesByTargetCapability(edges)
  return inventory.capabilities
    .map((capability) => {
      const ownEdges = edgesByCapability.get(capabilityKey(capability)) ?? []
      const lines = [`### \`${capability.exportName}\``, ""]
      if (ownEdges.length === 0) {
        lines.push("_No statically-discovered consumers._")
      } else {
        lines.push("| Consumer | Relationship | Detail | Resolution |", "| --- | --- | --- | --- |")
        for (const edge of ownEdges) {
          const detail = edge.to.field?.join(".") ?? edge.to.operation ?? "—"
          const from = displayPath(root, edge.from)
          const consumer =
            edge.position !== undefined
              ? `${from}:${String(edge.position.line)}:${String(edge.position.column)}`
              : from
          lines.push(`| \`${consumer}\` | ${edge.relationship} | ${detail} | ${edge.resolution} |`)
        }
      }
      return lines.join("\n")
    })
    .join("\n\n")
}

/** @internal Exported for direct unit coverage. */
export function renderFindings(findings: readonly ReportFinding[]): string {
  if (findings.length === 0) return "_No usage findings._"
  const rows = findings.map(
    (f) =>
      `| ${f.severity} | ${f.code} | ${f.capability !== undefined ? `\`${f.capability.exportName}\`` : "—"} | ${f.message} |`,
  )
  return ["| Severity | Code | Capability | Message |", "| --- | --- | --- | --- |", ...rows].join(
    "\n",
  )
}

/**
 * States exactly what "unconsumed"/"indeterminate" conclusions in this
 * report are scoped to -- an "unconsumed" finding is a claim about what was
 * actually searched, never an unbounded guarantee. Rendered only when
 * `scannedPackages` is non-empty: the zero-packages default (application
 * source only) is already the ambient assumption stated everywhere else in
 * this package's own docs, so repeating it on every single report would add
 * noise without adding information (ADR 0053).
 */
function renderScanSurface(scannedPackages: readonly string[]): string | undefined {
  if (scannedPackages.length === 0) return undefined
  return [
    "## Scan surface",
    "",
    `Scanned: application source, ${scannedPackages.join(", ")}`,
    "",
    "Not scanned: all other dependencies.",
  ].join("\n")
}

/**
 * Renders the full "Dependency & Ownership Report." `root` is the discovery
 * root every rendered path displays relative to (see `display-path.ts`).
 * `evidencePath` names this same run's own `--evidence` output, when it
 * requested one, in the banner note.
 */
export function renderUsageReport(
  inventory: CapabilityInventory,
  edges: readonly DependencyEdge[],
  root: string,
  scannedPackages: readonly string[] = [],
  evidencePath?: string,
): string {
  const ownership = buildOwnershipMatrix(inventory)
  const findings = deriveUsageFindings(inventory, edges)
  const scanSurface = renderScanSurface(scannedPackages)

  return [
    generatedBanner("markdown"),
    "",
    `> ${evidenceDisclaimer()}`,
    "",
    `> ${evidenceProjectionNote(evidencePath === undefined ? undefined : displayPath(root, evidencePath))}`,
    "",
    "# Dependency & Ownership Report",
    "",
    ...(scanSurface !== undefined ? [scanSurface, ""] : []),
    "## Ownership matrix",
    "",
    renderOwnershipMatrix(ownership),
    "",
    "## Capability-to-capability dependencies",
    "",
    "_Edges statically proven where one capability's own file imports and uses another._",
    "",
    renderCapabilityDependencies(inventory, edges),
    "",
    "## Consumers per capability",
    "",
    renderConsumerEdges(inventory, edges, root),
    "",
    "## Findings",
    "",
    renderFindings(findings),
    "",
  ].join("\n")
}
