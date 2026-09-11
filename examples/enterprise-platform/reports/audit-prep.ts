/**
 * The audit-prep report -- this tier's second generated governance report
 * (`reports/litigation-evidence.ts` is the other). Where the litigation
 * report is field-by-field ("what do we know about `invoices`"), this one
 * is capability-by-capability ("which of our capabilities are actually
 * audit-ready, and where are the real gaps") -- the rollup an auditor
 * reviews before a real audit starts, not during one.
 *
 * Builds on `projectAuditEvidence` (`data-cap/build`'s
 * `reference-projections.ts`), which today gives ownership/finding-count
 * rollups only. This report keeps that rollup and adds the completeness
 * matrix an auditor actually needs: for every capability and every
 * declared-sensitive field, which governance properties (owner, sensitivity,
 * purpose, legal basis, data residency, audit-required, and -- new this
 * session -- endpoint `handling`) are present versus silently absent.
 * **Presence only, never an adequacy or compliance claim** -- a checked box
 * means "declared," never "correct" or "sufficient." See
 * `litigation-evidence.ts`'s own header comment for the same epistemic
 * discipline this file follows, and for the "both reports read one
 * shared, fingerprint-verified `EvidenceModel` instead of each
 * recomputing it" architecture (ADR 0054, `evidence-cache.ts`) this file
 * follows too.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, writeFile } from "node:fs/promises"
import { projectAuditEvidence } from "data-cap/build"
import type { CapabilityNode, FindingLocation, LocatedFinding } from "data-cap/build"
import { getEvidence } from "./evidence-cache.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

interface CapabilityCompleteness {
  readonly capability: string
  readonly owner: boolean
  readonly sensitivity: boolean
  readonly purpose: boolean
  readonly legalBasis: boolean
  readonly dataResidency: boolean
  readonly auditRequired: boolean
}

interface SensitiveFieldCompleteness {
  readonly capability: string
  readonly field: string
  readonly owner: boolean
  readonly purpose: boolean
  readonly legalBasis: boolean
  readonly dataResidency: boolean
  readonly auditRequired: boolean
  readonly protections: boolean
  readonly retention: boolean
  /** Every endpoint belonging to an operation that writes this field, and whether it declares `handling` -- e.g. "2/2" (every endpoint declared) or "1/2" (a real, visible gap). */
  readonly handlingDeclared: string
}

export interface AuditPrepReport {
  readonly disclaimer: string
  readonly generatedAt: string
  readonly capabilityCount: number
  readonly ownedCapabilities: number | undefined
  readonly unownedCapabilities: number | undefined
  readonly findingsBySeverity: Readonly<Record<string, number>> | undefined
  readonly capabilities: readonly CapabilityCompleteness[]
  readonly sensitiveFields: readonly SensitiveFieldCompleteness[]
  readonly findings: readonly LocatedFinding[]
}

function handlingCompletenessFor(capability: CapabilityNode, fieldKey: string): string {
  const field = capability.fields.find((f) => f.path[0] === fieldKey)
  if (field === undefined) return "0/0"
  const operations = [...capability.getters, ...capability.mutators, ...capability.subscriptions]
  const writers = new Set(field.writtenBy.map((w) => `${w.kind}:${w.name}`))
  const endpoints = operations
    .filter((op) => writers.has(`${op.kind}:${op.name}`))
    .flatMap((op) => op.endpoints)
  const declared = endpoints.filter((e) => e.handling !== undefined).length
  return `${String(declared)}/${String(endpoints.length)}`
}

/**
 * The same shared, fingerprint-verified `EvidenceModel`
 * `litigation-evidence.ts` reads (`getEvidence()`, `evidence-cache.ts`) --
 * `evidence.finding` already carries every finding data-cap produces
 * (static, usage, AND flow --
 * SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY/SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING
 * included), since `evidence-cache.ts`'s own `COMPUTE_OPTIONS` requests
 * `location`/`docs`/`ownership`/`flow` together whenever a fresh compute
 * is actually needed -- never a hand-picked subset this report would
 * otherwise have to re-derive with its own second `buildFlowGraph` call.
 */
async function buildReport(): Promise<AuditPrepReport> {
  const evidence = await getEvidence()
  const inventory = evidence.capability

  const rollup = projectAuditEvidence(evidence)

  const capabilities: CapabilityCompleteness[] = inventory.capabilities.map((c) => ({
    capability: c.exportName,
    owner: c.docs?.owner !== undefined,
    sensitivity: c.docs?.sensitivity !== undefined,
    purpose: c.docs?.purpose !== undefined,
    legalBasis: c.docs?.legalBasis !== undefined,
    dataResidency: c.docs?.dataResidency !== undefined,
    auditRequired: c.docs?.auditRequired !== undefined,
  }))

  const sensitiveFields: SensitiveFieldCompleteness[] = []
  for (const capability of inventory.capabilities) {
    for (const field of capability.fields) {
      if (field.sensitivity.value === undefined) continue
      sensitiveFields.push({
        capability: capability.exportName,
        field: field.path[0] ?? "",
        owner: field.owner.value !== undefined,
        purpose: field.purpose.value !== undefined,
        legalBasis: field.legalBasis.value !== undefined,
        dataResidency: field.dataResidency.value !== undefined,
        auditRequired: field.auditRequired.value !== undefined,
        protections: field.docs?.protections !== undefined,
        retention: field.docs?.retention !== undefined,
        handlingDeclared: handlingCompletenessFor(capability, field.path[0] ?? ""),
      })
    }
  }

  return {
    disclaimer: rollup.disclaimer,
    generatedAt: rollup.provenance.generatedAt,
    capabilityCount: rollup.capabilityCount,
    ownedCapabilities: rollup.ownedCapabilities,
    unownedCapabilities: rollup.unownedCapabilities,
    findingsBySeverity: rollup.findingsBySeverity,
    capabilities,
    sensitiveFields,
    findings: evidence.finding?.findings ?? [],
  }
}

function check(value: boolean): string {
  return value ? "x" : " "
}

function describeLocation(location: FindingLocation): string {
  switch (location.kind) {
    case "none":
      return "_none_"
    case "capability":
      return location.capability.exportName
    case "field":
      return `${location.capability.exportName}.${location.field.join(".")}`
    case "operation":
      return `${location.capability.exportName}.${location.operation}`
    case "consumer":
      return `${location.capability.exportName} (consumed by ${location.source})`
  }
}

function renderMarkdown(report: AuditPrepReport): string {
  const lines: string[] = []
  lines.push("# Audit Prep Report")
  lines.push("")
  lines.push(`> ${report.disclaimer}`)
  lines.push("")
  lines.push(
    "> Presence only, never an adequacy claim: a checked column means the property is declared, never that it is correct, sufficient, or independently verified.",
  )
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push("")

  lines.push("## Rollup")
  lines.push("")
  lines.push("| Metric | Value |")
  lines.push("| --- | --- |")
  lines.push(`| Capabilities | ${String(report.capabilityCount)} |`)
  lines.push(`| Owned capabilities | ${report.ownedCapabilities ?? "_unavailable_"} |`)
  lines.push(`| Unowned capabilities | ${report.unownedCapabilities ?? "_unavailable_"} |`)
  for (const [severity, count] of Object.entries(report.findingsBySeverity ?? {})) {
    lines.push(`| Findings (${severity}) | ${String(count)} |`)
  }
  lines.push("")

  lines.push("## Capability governance completeness")
  lines.push("")
  lines.push("| Capability | Owner | Sensitivity | Purpose | Legal basis | Data residency | Audit required |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- |")
  for (const c of report.capabilities) {
    lines.push(
      `| ${c.capability} | [${check(c.owner)}] | [${check(c.sensitivity)}] | [${check(c.purpose)}] | [${check(c.legalBasis)}] | [${check(c.dataResidency)}] | [${check(c.auditRequired)}] |`,
    )
  }
  lines.push("")

  lines.push("## Sensitive-field governance completeness")
  lines.push("")
  lines.push(
    "| Field | Owner | Purpose | Legal basis | Data residency | Audit required | Protections | Retention | Handling declared (of endpoints writing this field) |",
  )
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const f of report.sensitiveFields) {
    lines.push(
      `| ${f.capability}.${f.field} | [${check(f.owner)}] | [${check(f.purpose)}] | [${check(f.legalBasis)}] | [${check(f.dataResidency)}] | [${check(f.auditRequired)}] | [${check(f.protections)}] | [${check(f.retention)}] | ${f.handlingDeclared} |`,
    )
  }
  lines.push("")

  lines.push("## Findings")
  lines.push("")
  if (report.findings.length === 0) {
    lines.push("No findings.")
  } else {
    lines.push("| Severity | Code | Location | Message |")
    lines.push("| --- | --- | --- | --- |")
    for (const finding of report.findings) {
      lines.push(
        `| ${finding.severity} | ${finding.code} | ${describeLocation(finding.location)} | ${finding.message} |`,
      )
    }
  }
  lines.push("")

  return `${lines.join("\n")}\n`
}

function stableJson(report: AuditPrepReport): string {
  return JSON.stringify({ ...report, generatedAt: null }, null, 2)
}
function stableMarkdown(markdown: string): string {
  return markdown.replace(/^Generated: .*$/m, "Generated: <omitted>")
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check")
  const report = await buildReport()
  const jsonPath = path.join(root, "reports", "audit-prep.json")
  const mdPath = path.join(root, "reports", "audit-prep.md")

  if (checkOnly) {
    const [committedJson, committedMd] = await Promise.all([
      readFile(jsonPath, "utf8").catch(() => undefined),
      readFile(mdPath, "utf8").catch(() => undefined),
    ])
    const jsonFresh =
      committedJson !== undefined && stableJson(JSON.parse(committedJson) as AuditPrepReport) === stableJson(report)
    const mdFresh = committedMd !== undefined && stableMarkdown(committedMd) === stableMarkdown(renderMarkdown(report))
    if (!jsonFresh || !mdFresh) {
      process.stderr.write("audit-prep.{json,md} are stale. Run `npm run reports` to regenerate.\n")
      process.exitCode = 1
      return
    }
    process.stdout.write("audit-prep.{json,md} are up to date.\n")
    return
  }

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  await writeFile(mdPath, renderMarkdown(report), "utf8")
  console.log(`Audit-prep report written for ${String(report.capabilityCount)} capability(ies).`)
}

/** Runs the full pipeline and returns the report -- exported so `main-headless.ts` can call it directly, in-process, with no second implementation. */
export async function generateAuditPrepReport(): Promise<AuditPrepReport> {
  return buildReport()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
