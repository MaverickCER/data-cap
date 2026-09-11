/**
 * The litigation-evidence report -- one of this tier's two generated
 * governance reports (`reports/audit-prep.ts` is the other). Every
 * declared/proven fact below comes from data-cap's own canonical models
 * (Capability, Dependency, Finding, Evidence -- ADR 0050), never hand-typed
 * here. **This demonstrates evidence production, never a compliance
 * claim** -- see the disclaimer this report opens with, and
 * `specs/generated-artifacts.md`'s "Declared vs. proven" section for the
 * exact epistemic rules every line below follows.
 *
 * Scoped to the same concrete scenario `main-headless.ts` runs for real:
 * a client disputes an invoice (`billingData.disputeInvoice`), and this
 * report proves what billing (and identity) data existed and how it was
 * handled -- not just for `invoices`, but for every declared-sensitive
 * field across the platform, since a real dispute review needs to account
 * for who touched the data, not only what the data was.
 *
 * Structural constraint on this generator, not just a style goal: every
 * assertion below traces to exactly one of five sources -- a
 * `documentData()` declaration, a proven (AST-derived) usage site, a
 * declared endpoint `handling` state, a developer's own `dynamicAccess`
 * citation, or an explicitly disclosed uncertainty (an `indeterminate`
 * candidate-site list, or the stated scanned/not-scanned boundary). No
 * free-floating summary prose that doesn't reduce to one of these five --
 * regenerating this report from the same inputs always produces the same
 * output (verified for real by `main-headless.ts`'s own determinism check).
 *
 * This report and `audit-prep.ts` are both thin renderers over one shared
 * source: `getEvidence()` (`reports/evidence-cache.ts`), which serves the
 * exact same composed model `npm run docs`'s own `--evidence` flag writes
 * to `docs/data.evidence.json` -- cached and fingerprint-verified, so
 * neither report re-runs discovery/linking/scanning on every invocation
 * the way an earlier version of this file did (ADR 0054; see
 * `evidence-cache.ts`'s own header comment for why that's safe). "Every
 * report comes from the same source of truth" is a provable fact about
 * this code, not a claim in this comment.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, writeFile } from "node:fs/promises"
import { defineEvidenceProjection, evidenceDisclaimer } from "data-cap/build"
import { getEvidence } from "./evidence-cache.js"
import type {
  CapabilityNode,
  DependencyEdge,
  EvidenceModel,
  EvidenceProjection,
  LocatedFinding,
  OperationNode,
  SourceLocation,
  SourcePosition,
} from "data-cap/build"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * One field-writing operation's own declared endpoint handling -- the
 * "what stage, what handling" half of a field's lifecycle. `direction`
 * distinguishes data arriving (a getter/subscription's own `input`
 * endpoint) from data leaving (a mutator's own `output` endpoint); the same
 * field can legitimately show `"encrypted"` on one and `"plaintext"` on
 * another; that asymmetry is exactly what this section exists to surface,
 * not paper over.
 */
interface HandlingStage {
  readonly operation: string
  readonly direction: "input" | "output"
  readonly endpointName: string
  readonly url: string | undefined
  readonly handling: string | undefined
}

/** One field's fully-sourced evidence entry -- every property here traces to exactly one of this file's own header comment's five permitted sources. */
interface FieldEvidenceEntry {
  readonly capability: string
  readonly field: string
  readonly declared: {
    readonly owner: string | undefined
    readonly sensitivity: string | undefined
    readonly purpose: string | undefined
    readonly legalBasis: string | undefined
    readonly dataResidency: string | readonly string[] | undefined
    readonly auditRequired: boolean | undefined
    readonly protections: string | undefined
    readonly retention: string | undefined
  }
  readonly declarationSite: SourcePosition | undefined
  readonly consumptionStatus:
    | "proven"
    | "unconsumed"
    | "indeterminate"
    | "declared-dynamic"
    | "stale-declaration"
  readonly provenAccessSites: readonly SourceLocation[]
  readonly indeterminateSites: readonly SourceLocation[]
  readonly dynamicAccessCitations: readonly string[]
  readonly citationIntegrityFindings: readonly { readonly code: string; readonly message: string }[]
  /** Every operation that writes this field, and what that operation's own declared endpoint(s) say about handling at that boundary crossing -- the DB-to-endpoint leg is this platform's own backend/database concern (`src/server/`), outside anything data-cap observes; this is the endpoint-to-consumer leg data-cap can actually make a declared claim about. */
  readonly handlingByOperation: readonly HandlingStage[]
}

export interface LitigationEvidenceReport {
  readonly disclaimer: string
  readonly generatedAt: string
  readonly scanSurface: { readonly scanned: readonly string[]; readonly notScanned: string }
  readonly fields: readonly FieldEvidenceEntry[]
}

function accessSitesFor(
  edges: readonly DependencyEdge[],
  capabilityFile: string,
  exportName: string,
  fieldKey: string,
): readonly SourceLocation[] {
  return edges
    .filter(
      (edge): edge is DependencyEdge & { position: SourcePosition } =>
        edge.to.capability.file === capabilityFile &&
        edge.to.capability.exportName === exportName &&
        edge.relationship === "reads-field" &&
        edge.to.field?.[0] === fieldKey &&
        edge.position !== undefined,
    )
    .map((edge) => ({ file: edge.from, ...edge.position }))
}

function operationsByKey(capability: CapabilityNode): Map<string, OperationNode> {
  const map = new Map<string, OperationNode>()
  for (const op of [...capability.getters, ...capability.mutators, ...capability.subscriptions]) {
    map.set(`${op.kind}:${op.name}`, op)
  }
  return map
}

function handlingStagesFor(capability: CapabilityNode, field: CapabilityNode["fields"][number]): readonly HandlingStage[] {
  const byKey = operationsByKey(capability)
  const stages: HandlingStage[] = []
  for (const writer of field.writtenBy) {
    const operation = byKey.get(`${writer.kind}:${writer.name}`)
    if (operation === undefined) continue
    for (const endpoint of operation.endpoints) {
      stages.push({
        operation: `${writer.kind}:${writer.name}`,
        direction: endpoint.direction,
        endpointName: endpoint.name,
        url: endpoint.url,
        handling: endpoint.handling,
      })
    }
  }
  return stages
}

const CITATION_INTEGRITY_CODES: ReadonlySet<string> = new Set([
  "DYNAMIC_ACCESS_CITATION_MISSING",
  "DYNAMIC_ACCESS_CITATION_STALE",
])

/**
 * `defineEvidenceProjection` itself only ever hands its wrapped function the
 * `EvidenceModel` (ADR 0050 -- provenance/extra context is caller-supplied,
 * never ambient). This report needs one more thing a bare `EvidenceModel`
 * doesn't index for convenient per-field lookup (`findingsByField`, grouped
 * once by the caller from `evidence.finding.findings`), so that's closed
 * over by this factory rather than smuggled onto the wrapped function's own
 * signature. Everything else this report needs -- a capability's own
 * `getters`/`mutators`/`subscriptions`/`fields`, complete with `endpoints` --
 * is already sitting on `evidence.capability.capabilities` itself; no
 * separate lookup map is needed the way an earlier version of this file
 * built one.
 */
function buildLitigationEvidenceProjection(
  findingsByField: ReadonlyMap<string, readonly LocatedFinding[]>,
  scanSurface: LitigationEvidenceReport["scanSurface"],
): EvidenceProjection<{
  disclaimer: string
  generatedAt: string
  scanSurface: LitigationEvidenceReport["scanSurface"]
  fields: readonly FieldEvidenceEntry[]
}> {
  return defineEvidenceProjection({
    // Each output field gets its own projector, so `.project()` can report
    // that `fields` was derived from the Capability/Finding/Dependency
    // Models while `generatedAt` came from provenance alone -- per-field
    // evidence a reviewer can actually check, not one undifferentiated
    // "this report read everything."
    disclaimer: () => evidenceDisclaimer(),
    generatedAt: (evidence: EvidenceModel) => evidence.provenance.generatedAt,
    scanSurface: () => scanSurface,
    fields: (evidence: EvidenceModel): readonly FieldEvidenceEntry[] => {
      const fields: FieldEvidenceEntry[] = []

      for (const capability of evidence.capability.capabilities) {
        for (const field of capability.fields) {
          if (field.sensitivity.value === undefined) continue // this report is scoped to declared-sensitive data only
          const fieldKey = field.path[0]
          if (fieldKey === undefined) continue

          const key = `${capability.file}#${capability.exportName}#${fieldKey}`
          const own = findingsByField.get(key) ?? []
          const citationsForField = own.filter((f) => CITATION_INTEGRITY_CODES.has(f.code))

          const dynamicDeclared = own.some((f) => f.code === "FIELD_DYNAMIC_ACCESS_DECLARED")
          const indeterminateFinding = own.find((f) => f.code === "FIELD_ACCESS_INDETERMINATE")
          const unconsumed = own.some((f) => f.code === "UNCONSUMED_FIELD")
          const hasStaleCitation = citationsForField.length > 0

          const status: FieldEvidenceEntry["consumptionStatus"] = hasStaleCitation
            ? "stale-declaration"
            : dynamicDeclared
              ? "declared-dynamic"
              : indeterminateFinding !== undefined
                ? "indeterminate"
                : unconsumed
                  ? "unconsumed"
                  : "proven"

          fields.push({
            capability: capability.exportName,
            field: fieldKey,
            declared: {
              owner: field.owner.value,
              sensitivity: field.sensitivity.value,
              purpose: field.purpose.value,
              legalBasis: field.legalBasis.value,
              dataResidency: field.dataResidency.value,
              auditRequired: field.auditRequired.value,
              protections: field.docs?.protections,
              retention: field.docs?.retention,
            },
            declarationSite: field.declarationPosition,
            consumptionStatus: status,
            provenAccessSites: accessSitesFor(
              evidence.dependency?.edges ?? [],
              capability.file,
              capability.exportName,
              fieldKey,
            ),
            indeterminateSites:
              indeterminateFinding?.location.kind === "field"
                ? (indeterminateFinding.location.indeterminateSites ?? [])
                : [],
            dynamicAccessCitations: capability.docs?.evidence?.fields?.[fieldKey]?.dynamicAccess ?? [],
            citationIntegrityFindings: citationsForField.map((f) => ({
              code: f.code,
              message: f.message,
            })),
            handlingByOperation: handlingStagesFor(capability, field),
          })
        }
      }

      return fields
    },
  })
}

function renderMarkdown(report: LitigationEvidenceReport): string {
  const lines: string[] = []
  lines.push("# Litigation Evidence Report")
  lines.push("")
  lines.push(`> ${report.disclaimer}`)
  lines.push("")
  lines.push(
    "> This report is illustrative only. It is not legal advice and does not itself establish compliance with any law or regulation -- it demonstrates the mechanism data-cap provides for producing source-cited evidence, nothing more.",
  )
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push("")
  lines.push(`Scanned: ${report.scanSurface.scanned.join(", ")}`)
  lines.push(`Not scanned: ${report.scanSurface.notScanned}`)
  lines.push("")

  for (const entry of report.fields) {
    lines.push(`## ${entry.capability}.${entry.field}`)
    lines.push("")
    lines.push("| Declared fact | Value |")
    lines.push("| --- | --- |")
    lines.push(`| Owner | ${entry.declared.owner ?? "_not declared_"} |`)
    lines.push(`| Classification (sensitivity) | ${entry.declared.sensitivity ?? "_not declared_"} |`)
    lines.push(`| Purpose | ${entry.declared.purpose ?? "_not declared_"} |`)
    lines.push(
      `| Legal basis (declared, not a legal determination) | ${entry.declared.legalBasis ?? "_not declared_"} |`,
    )
    lines.push(
      `| Data residency (permitted storage jurisdiction, declared) | ${
        Array.isArray(entry.declared.dataResidency)
          ? entry.declared.dataResidency.join(", ")
          : (entry.declared.dataResidency ?? "_not declared_")
      } |`,
    )
    lines.push(`| Audit required | ${entry.declared.auditRequired === true ? "yes" : "no/not declared"} |`)
    lines.push(`| Protections (documented, not an adequacy claim) | ${entry.declared.protections ?? "_not documented_"} |`)
    lines.push(`| Retention policy (documented) | ${entry.declared.retention ?? "_not documented_"} |`)
    lines.push("")
    lines.push(
      `**Declaration site (proven):** ${entry.declarationSite === undefined ? "_not statically resolvable (identifier-resolved fields)_" : `\`${entry.declarationSite.line}:${entry.declarationSite.column}\``}`,
    )
    lines.push("")
    lines.push(`**Consumption status:** \`${entry.consumptionStatus}\``)
    lines.push("")

    if (entry.handlingByOperation.length > 0) {
      lines.push(
        "**Field lifecycle -- declared handling at each endpoint this field crosses (declared, never independently verified):**",
      )
      lines.push("")
      lines.push("| Operation | Direction | Endpoint | URL | Handling |")
      lines.push("| --- | --- | --- | --- | --- |")
      for (const stage of entry.handlingByOperation) {
        lines.push(
          `| ${stage.operation} | ${stage.direction} | ${stage.endpointName} | ${stage.url ?? "_not declared_"} | ${stage.handling ?? "_not declared_"} |`,
        )
      }
      lines.push("")
    }

    if (entry.provenAccessSites.length > 0) {
      lines.push("**Proven access sites (AST-derived):**")
      for (const site of entry.provenAccessSites) {
        lines.push(`- \`${site.file}:${site.line}:${site.column}\``)
      }
      lines.push("")
    }
    if (entry.indeterminateSites.length > 0) {
      lines.push(
        "**Candidate dynamic-access sites (proven to exist, but not statically attributable to this specific field):**",
      )
      for (const site of entry.indeterminateSites) {
        lines.push(`- \`${site.file}:${site.line}:${site.column}\``)
      }
      lines.push("")
    }
    if (entry.dynamicAccessCitations.length > 0) {
      lines.push(
        "**Developer-asserted dynamic access (declared; currently supported by its own citation/integrity check, never proof the described access was independently verified):**",
      )
      for (const citation of entry.dynamicAccessCitations) {
        lines.push(`- \`${citation}\``)
      }
      lines.push("")
    }
    if (entry.citationIntegrityFindings.length > 0) {
      lines.push("**Citation integrity findings (proven, this run):**")
      for (const finding of entry.citationIntegrityFindings) {
        lines.push(`- \`${finding.code}\`: ${finding.message}`)
      }
      lines.push("")
    }
  }

  return `${lines.join("\n")}\n`
}

/**
 * Reads the shared, fingerprint-verified `EvidenceModel` (`evidence-
 * cache.ts`) instead of computing one itself -- the fast path on every
 * `npm run reports` where `docs/data.evidence.json` is already fresh, with
 * a real `computeDataArtifacts()` fallback (logged, never silent) when
 * it isn't.
 */
export async function generateLitigationEvidenceReport(): Promise<LitigationEvidenceReport> {
  const evidence = await getEvidence()

  // Findings are indexed off their structured `location`, the single path a
  // `LocatedFinding` exposes for "where does this point" -- the flat
  // `capability`/`field` duplicates this used to read were removed with
  // OUT-02, and only a `"field"` location can key a per-field lookup at all.
  const findingsByField = new Map<string, LocatedFinding[]>()
  for (const finding of evidence.finding?.findings ?? []) {
    if (finding.location.kind !== "field") continue
    const fieldKey = finding.location.field[0]
    if (fieldKey === undefined) continue
    const key = `${finding.location.capability.file}#${finding.location.capability.exportName}#${fieldKey}`
    const existing = findingsByField.get(key) ?? []
    existing.push(finding)
    findingsByField.set(key, existing)
  }

  const projectLitigationEvidence = buildLitigationEvidenceProjection(findingsByField, {
    scanned: ["application source (src/**)"],
    notScanned: "all other dependencies (no --package allow-list configured for this example)",
  })
  return projectLitigationEvidence(evidence)
}

/** Strips the one wall-clock provenance stamp (`generatedAt` in JSON, the `Generated: ` line in Markdown) so two renders a moment apart compare equal whenever every *derived* fact agrees -- the same discipline `main-headless.ts`'s own determinism check applies. */
function stableJson(report: LitigationEvidenceReport): string {
  return JSON.stringify({ ...report, generatedAt: null }, null, 2)
}
function stableMarkdown(markdown: string): string {
  return markdown.replace(/^Generated: .*$/m, "Generated: <omitted>")
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check")
  const report = await generateLitigationEvidenceReport()
  const jsonPath = path.join(root, "reports", "litigation-evidence.json")
  const mdPath = path.join(root, "reports", "litigation-evidence.md")

  if (check) {
    const [committedJson, committedMd] = await Promise.all([
      readFile(jsonPath, "utf8").catch(() => undefined),
      readFile(mdPath, "utf8").catch(() => undefined),
    ])
    const jsonFresh =
      committedJson !== undefined &&
      stableJson(JSON.parse(committedJson) as LitigationEvidenceReport) === stableJson(report)
    const mdFresh = committedMd !== undefined && stableMarkdown(committedMd) === stableMarkdown(renderMarkdown(report))
    if (!jsonFresh || !mdFresh) {
      process.stderr.write("litigation-evidence.{json,md} are stale. Run `npm run reports` to regenerate.\n")
      process.exitCode = 1
      return
    }
    process.stdout.write("litigation-evidence.{json,md} are up to date.\n")
    return
  }

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  await writeFile(mdPath, renderMarkdown(report), "utf8")
  console.log(`Litigation evidence report written for ${report.fields.length} sensitive field(s).`)
}

// Only runs the CLI entry when invoked directly (`npm run reports`) -- not
// when `main-headless.ts` imports `generateLitigationEvidenceReport` itself.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
