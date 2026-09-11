/**
 * Renders the Markdown documentation catalog -- a projection of the
 * `CapabilityInventory`, never a source of truth. Pure -- no filesystem
 * access.
 *
 * Every table draws a hard line the codebase's declared-vs-proven
 * invariant requires (AGENTS.md): `source`/`credentials`/`endpoints` are
 * labeled *declared* (author-asserted, never verified against the
 * operation's actual body); `protections`/`retention` are labeled
 * *documented* only -- "documented" is never rendered as "adequate,"
 * "correct," or "enforced." See ADR 0049.
 */

import { displayPath } from "./display-path.js"
import { evidenceDisclaimer, evidenceProjectionNote, generatedBanner } from "./generated-banner.js"
import type { DependencyEdge } from "./dependency-types.js"
import type { CapabilityInventory, CapabilityNode, FieldNode, OperationNode } from "./inventory.js"
import type { LifecycleModel } from "./lifecycle-model.js"
import type { ManifestChangeReport } from "./manifest-snapshot.js"

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function cell(value: string | undefined, whenMissing = "—"): string {
  return value === undefined || value === "" ? whenMissing : escapeCell(value)
}

function heading(capability: CapabilityNode): string {
  return `\`${capability.exportName}\``
}

function anchor(capability: CapabilityNode): string {
  return capability.exportName.toLowerCase()
}

function renderCapabilitySummary(capability: CapabilityNode, root: string): string {
  const lines: string[] = []
  lines.push(`### ${heading(capability)}`)
  lines.push("")
  lines.push(`*${displayPath(root, capability.file)}*`)
  lines.push("")
  const meta = [
    `Owner: ${cell(capability.docs?.owner, "(unowned)")}`,
    `Category: ${cell(capability.docs?.category)}`,
    `Active: ${capability.active ? "yes" : "no"}`,
  ]
  if (capability.exclusiveGroup !== undefined)
    meta.push(`Exclusive group: ${capability.exclusiveGroup}`)
  if (capability.docs?.sensitivity !== undefined)
    meta.push(`Sensitivity (declared): ${capability.docs.sensitivity}`)
  lines.push(meta.join(" · "))
  if (capability.docs?.description !== undefined) {
    lines.push("")
    lines.push(capability.docs.description)
  }
  return lines.join("\n")
}

/** One field's proven `reads-field` sites, grouped by the file they occur in. */
interface ConsumptionSite {
  readonly path: string
  readonly line: number
  readonly column: number
}

/** Every proven `reads-field` site for one field -- empty when none were found or `edges` wasn't supplied (`--docs` requested without `--ownership`/`--flow`, which is what actually runs the usage scan). */
function consumptionSitesFor(
  capability: CapabilityNode,
  field: FieldNode,
  edges: readonly DependencyEdge[] | undefined,
): readonly ConsumptionSite[] {
  if (edges === undefined) return []
  const fieldName = field.path[0]
  const sites: ConsumptionSite[] = []
  for (const edge of edges) {
    if (
      edge.relationship !== "reads-field" ||
      edge.to.capability.file !== capability.file ||
      edge.to.capability.exportName !== capability.exportName ||
      edge.to.field?.[0] !== fieldName ||
      edge.position === undefined
    ) {
      continue
    }
    sites.push({ path: edge.from, line: edge.position.line, column: edge.position.column })
  }
  return sites
}

/**
 * Renders `sites` grouped by (display) path -- a lone site in a file renders
 * its exact `path:line:column`; two or more render `path (N sites)`, since
 * the exact lines are already fully itemized in `OWNERSHIP.md`'s own
 * per-consumer table and repeating them densely here (one raw citation per
 * `<br/>`) makes a frequently-consumed field's cell an unscannable wall of
 * near-identical paths. Groups sort by (display) path for determinism;
 * citations within a group keep their original scan order (only visible
 * indirectly, in which representative citation a single-site group shows).
 */
function renderConsumptionSites(sites: readonly ConsumptionSite[], root: string): string {
  // A non-empty tuple type so `group[0]` is a `ConsumptionSite`, never
  // `ConsumptionSite | undefined` -- every group is seeded with its first site.
  const byPath = new Map<string, [ConsumptionSite, ...ConsumptionSite[]]>()
  for (const site of sites) {
    const key = displayPath(root, site.path)
    const group = byPath.get(key)
    if (group === undefined) byPath.set(key, [site])
    else group.push(site)
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([displayed, group]) =>
      group.length === 1
        ? `${displayed}:${String(group[0].line)}:${String(group[0].column)}`
        : `${displayed} (${String(group.length)} sites)`,
    )
    .join("<br/>")
}

function renderFieldsTable(
  capability: CapabilityNode,
  edges: readonly DependencyEdge[] | undefined,
  root: string,
): string | undefined {
  if (capability.fields.length === 0) return undefined
  const rows = capability.fields.map((field: FieldNode) => {
    const writers = field.writtenBy.map((w) => `\`${w.kind}:${w.name}\``).join(", ")
    const consumedAt = renderConsumptionSites(consumptionSitesFor(capability, field, edges), root)
    // Sensitivity reads the RESOLVED value (own, else inherited from the
    // capability) -- matching the Sensitivity & Protections Review section
    // below, and fixing a prior bug where this table silently rendered
    // blank for a field that inherits its capability's sensitivity with no
    // override of its own (ADR 0057).
    return `| \`${field.path.join(".")}\` | ${cell(field.docs?.description)} | ${cell(field.owner.value, "(unowned)")} | ${cell(field.sensitivity.value)} | ${cell(field.docs?.protections, "not documented")} | ${cell(field.docs?.retention, "not documented")} | ${cell(writers, "(none found)")} | ${cell(consumedAt, edges === undefined ? "(not scanned)" : "(none found)")} |`
  })
  return [
    "#### Fields",
    "",
    "| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function renderOperationsTable(
  operations: readonly OperationNode[],
  title: string,
): string | undefined {
  if (operations.length === 0) return undefined
  const rows = operations.map((op) => {
    const endpoints = op.endpoints
      .map((e) => {
        const url = e.url !== undefined ? ` ${e.url}` : ""
        const handling = e.handling !== undefined ? ` (${e.handling})` : ""
        return `${e.direction}:${e.kind}:${e.name}${url}${handling}`
      })
      .join(", ")
    return `| \`${op.name}\` | ${cell(op.docs?.description)} | ${cell(op.docs?.source)} | ${cell(op.docs?.credentials)} | ${cell(endpoints)} |`
  })
  return [
    `#### ${title}`,
    "",
    "| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function renderCapability(
  capability: CapabilityNode,
  edges: readonly DependencyEdge[] | undefined,
  root: string,
): string {
  const sections = [
    renderCapabilitySummary(capability, root),
    renderFieldsTable(capability, edges, root),
    renderOperationsTable(capability.getters, "Getters"),
    renderOperationsTable(capability.mutators, "Mutators"),
    renderOperationsTable(capability.subscriptions, "Subscriptions"),
  ].filter((section): section is string => section !== undefined)
  return sections.join("\n\n")
}

function renderTableOfContents(inventory: CapabilityInventory): string {
  if (inventory.capabilities.length === 0) return "_No capabilities discovered._"
  return inventory.capabilities
    .map(
      (capability) =>
        `- [${heading(capability)}](#${anchor(capability)})${capability.active ? "" : " _(inactive)_"}`,
    )
    .join("\n")
}

function renderSensitivityReview(inventory: CapabilityInventory): string {
  const rows: string[] = []
  for (const capability of inventory.capabilities) {
    if (capability.docs?.sensitivity !== undefined) {
      rows.push(
        `| \`${capability.exportName}\` | (capability) | ${capability.docs.sensitivity} | ${capability.docs.protections !== undefined ? "Yes" : "No"} |`,
      )
    }
    for (const field of capability.fields) {
      if (field.sensitivity.value === undefined) continue
      rows.push(
        `| \`${capability.exportName}\` | \`${field.path.join(".")}\` | ${field.sensitivity.value} | ${field.docs?.protections !== undefined ? "Yes" : "No"} |`,
      )
    }
  }
  if (rows.length === 0) {
    return "_No capability or field declares a `sensitivity` level._"
  }
  return [
    "| Capability | Field | Sensitivity (declared) | Protections documented? |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function renderChangesSinceLastReport(changes: ManifestChangeReport | undefined): string {
  if (changes === undefined) return "_No previous snapshot to compare against (first report)._"
  const { addedCapabilities, removedCapabilities, updatedCapabilities } = changes
  if (
    addedCapabilities.length === 0 &&
    removedCapabilities.length === 0 &&
    updatedCapabilities.length === 0
  ) {
    return "_No changes since the last report._"
  }
  const lines: string[] = []
  if (addedCapabilities.length > 0) {
    lines.push("**Added:**", ...addedCapabilities.map((c) => `- \`${c}\``), "")
  }
  if (removedCapabilities.length > 0) {
    lines.push("**Removed:**", ...removedCapabilities.map((c) => `- \`${c}\``), "")
  }
  if (updatedCapabilities.length > 0) {
    lines.push(
      "**Updated:**",
      ...updatedCapabilities.map((u) => `- \`${u.capability}\`: ${u.changes.join("; ")}`),
    )
  }
  return lines.join("\n").trim()
}

/**
 * Renders the lifecycle section: what is expiring soon (or already expired),
 * and what is declared deprecated.
 *
 * Every cell is a *declared* fact restated, plus arithmetic on a declared
 * date -- nothing here is verified, nothing expires at runtime, and an
 * already-past `expiresAt` means only "the author said this date, and it has
 * passed." Rendered from the Lifecycle Model rather than re-walking `docs`
 * so the catalog and the published `data.evidence.json` can never report a
 * different "12d remaining" for the same field.
 */
function renderLifecycleReport(lifecycle: LifecycleModel | undefined): string {
  if (lifecycle === undefined) return "_Lifecycle data was not computed for this report._"

  const sections: string[] = []

  if (lifecycle.expiring.length === 0) {
    sections.push("_Nothing declares an `expiresAt` within the configured window._")
  } else {
    const rows = lifecycle.expiring.map((entry) => {
      const subject =
        entry.field === undefined
          ? `\`${entry.exportName}\` (capability)`
          : `\`${entry.exportName}\`.\`${entry.field.join(".")}\``
      const status =
        entry.daysRemaining < 0
          ? `**expired ${String(Math.abs(entry.daysRemaining))}d ago**`
          : `**${String(entry.daysRemaining)}d remaining**`
      return `| ${subject} | ${cell(entry.expiresAt)} | ${status} |`
    })
    sections.push(
      ["| Subject | Expires (declared) | Status |", "| --- | --- | --- |", ...rows].join("\n"),
    )
  }

  const deprecations: string[] = []
  for (const capability of lifecycle.capabilities) {
    if (capability.deprecated === true) {
      deprecations.push(
        `| \`${capability.exportName}\` | (capability) | ${cell(capability.deprecatedReason)} | — | — |`,
      )
    }
    for (const field of capability.fields) {
      if (field.deprecated !== true && field.renamedFrom === undefined) continue
      deprecations.push(
        `| \`${capability.exportName}\` | \`${field.path.join(".")}\` | ${cell(field.deprecatedReason)} | ${cell(field.removeBy)} | ${cell(field.renamedFrom)} |`,
      )
    }
  }
  sections.push("")
  sections.push(
    deprecations.length === 0
      ? "_No capability or field is declared deprecated or renamed._"
      : [
          "| Capability | Field | Reason (declared) | Remove by (declared) | Renamed from |",
          "| --- | --- | --- | --- | --- |",
          ...deprecations,
        ].join("\n"),
  )

  return sections.join("\n")
}

/**
 * Renders the full Markdown documentation catalog. `root` is the discovery
 * root every rendered path displays relative to (see `display-path.ts`).
 * `changes` is optional -- omit it (or pass `undefined`) when there's no
 * previous snapshot to compare against. `edges` is likewise optional: it's
 * only ever available when the caller also ran the (more expensive) usage
 * scan `--ownership`/`--flow` trigger -- `--docs` requested alone renders
 * exactly as before, with the "Consumed at" column showing "(not scanned)"
 * rather than a false "(none found)". `evidencePath` names this same run's
 * own `--evidence` output, when it requested one, in the banner note.
 */
export function renderDocumentation(
  inventory: CapabilityInventory,
  root: string,
  changes?: ManifestChangeReport,
  edges?: readonly DependencyEdge[],
  evidencePath?: string,
  lifecycle?: LifecycleModel,
): string {
  return [
    generatedBanner("markdown"),
    "",
    `> ${evidenceDisclaimer()}`,
    "",
    `> ${evidenceProjectionNote(evidencePath === undefined ? undefined : displayPath(root, evidencePath))}`,
    "",
    "# Data Capability Catalog",
    "",
    "## Changes since last report",
    "",
    renderChangesSinceLastReport(changes),
    "",
    "## Table of contents",
    "",
    renderTableOfContents(inventory),
    "",
    "## Catalog",
    "",
    inventory.capabilities
      .map((capability) => renderCapability(capability, edges, root))
      .join("\n\n"),
    "",
    "## Sensitivity & protections review",
    "",
    renderSensitivityReview(inventory),
    "",
    "## Lifecycle",
    "",
    renderLifecycleReport(lifecycle),
    "",
  ].join("\n")
}
