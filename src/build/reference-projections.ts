/**
 * Evidence-family reference projections (ADR 0050): Data Classification/
 * Privacy/Retention/Audit/Compliance Evidence. Each composes sensitivity
 * (Capability Model) with ownership, findings, and provenance -- genuinely
 * cross-model, so each is an ordinary `defineEvidenceProjection()` call,
 * not a plain function (unlike the single-model filters in
 * `inventory-projections.ts`). Every projection carries the same
 * `evidenceDisclaimer()` text every other governance-adjacent artifact in
 * this codebase already opens with: presence of declared metadata is
 * evidence for a review, never a compliance claim.
 *
 * Each is declared as a per-output-field projector schema, not one
 * monolithic function (NAM-07): `disclaimer` and `entries` are independent
 * facts, and giving each its own projector is what lets `.project()` report
 * that `entries` was derived from `capability.capabilities.*` while
 * `disclaimer` was derived from nothing at all. A single combined function
 * could only ever say "this report read the Capability Model," which is
 * true of every report here and therefore says nothing.
 */

import { defineEvidenceProjection } from "../evidence/index.js"
import type { EvidenceModel } from "./evidence-model.js"
import { evidenceDisclaimer } from "./generated-banner.js"
import type { EvidenceProvenance } from "./evidence-model.js"
import type { CapabilityNode } from "./inventory.js"
import { UNOWNED } from "./ownership-model.js"

// Projectors are named function declarations, not object-literal arrows, so
// each has its own body a covering test can be attributed to.
/** The shared "presence of declared metadata is evidence, not a compliance claim" note. */
function disclaimer(): string {
  return evidenceDisclaimer()
}

/** One capability or field's declared sensitivity. */
export interface ClassificationEntry {
  readonly capability: { readonly file: string; readonly exportName: string }
  readonly field: readonly string[] | undefined
  readonly sensitivity: string
}

/**
 * Every capability and field that declares a `sensitivity`, as a base
 * {@link ClassificationEntry} plus whether its `protections` are documented.
 * Shared by the Classification and Privacy projections -- both walk the exact
 * same capability/field set, they only differ in which of these two facts they
 * surface. Reads go through the projector's tracking proxy exactly as before.
 */
function* declaredSensitivities(
  capabilities: readonly CapabilityNode[],
): Generator<{ readonly entry: ClassificationEntry; readonly protectionsDocumented: boolean }> {
  for (const capability of capabilities) {
    const capabilityRef = { file: capability.file, exportName: capability.exportName }
    if (capability.docs?.sensitivity !== undefined) {
      yield {
        entry: {
          capability: capabilityRef,
          field: undefined,
          sensitivity: capability.docs.sensitivity,
        },
        protectionsDocumented: capability.docs.protections !== undefined,
      }
    }
    for (const field of capability.fields) {
      if (field.sensitivity.value === undefined) continue
      yield {
        entry: {
          capability: capabilityRef,
          field: field.path,
          sensitivity: field.sensitivity.value,
        },
        protectionsDocumented: field.docs?.protections !== undefined,
      }
    }
  }
}

function classificationEntries(evidence: EvidenceModel): readonly ClassificationEntry[] {
  return Array.from(declaredSensitivities(evidence.capability.capabilities), (x) => x.entry)
}

/** Data Classification Evidence: every capability/field with a declared `sensitivity`. */
export const projectClassificationEvidence = defineEvidenceProjection<{
  disclaimer: string
  entries: readonly ClassificationEntry[]
}>(
  // Stryker disable next-line ObjectLiteral: covered by tests (verified: `{}` here fails them), but Stryker perTest reports a false Survived for this schema object because it is evaluated once at module load -- `ignoreStatic` does not ignore a static mutant that has test coverage.
  { disclaimer, entries: classificationEntries },
)

/** One capability or field's declared privacy-relevant facts. */
export interface PrivacyEntry {
  readonly capability: { readonly file: string; readonly exportName: string }
  readonly field: readonly string[] | undefined
  readonly sensitivity: string
  readonly protectionsDocumented: boolean
}

function privacyEntries(evidence: EvidenceModel): readonly PrivacyEntry[] {
  return Array.from(declaredSensitivities(evidence.capability.capabilities), (x) => ({
    ...x.entry,
    protectionsDocumented: x.protectionsDocumented,
  }))
}

/** Data Privacy Evidence: sensitivity plus whether protections are documented (presence only, never an adequacy claim). */
export const projectPrivacyEvidence = defineEvidenceProjection<{
  disclaimer: string
  entries: readonly PrivacyEntry[]
}>(
  // Stryker disable next-line ObjectLiteral: covered by tests (verified: `{}` here fails them), but Stryker perTest reports a false Survived for this schema object because it is evaluated once at module load -- `ignoreStatic` does not ignore a static mutant that has test coverage.
  { disclaimer, entries: privacyEntries },
)

/** One capability or field's declared retention policy. */
export interface RetentionEntry {
  readonly capability: { readonly file: string; readonly exportName: string }
  readonly field: readonly string[] | undefined
  readonly retention: string
}

function retentionEntries(evidence: EvidenceModel): readonly RetentionEntry[] {
  const entries: RetentionEntry[] = []
  for (const capability of evidence.capability.capabilities) {
    const capabilityRef = { file: capability.file, exportName: capability.exportName }
    if (capability.docs?.retention !== undefined) {
      entries.push({
        capability: capabilityRef,
        field: undefined,
        retention: capability.docs.retention,
      })
    }
    for (const field of capability.fields) {
      if (field.docs?.retention === undefined) continue
      entries.push({
        capability: capabilityRef,
        field: field.path,
        retention: field.docs.retention,
      })
    }
  }
  return entries
}

/** Data Retention Evidence: every capability/field with a declared `retention` policy (presence only, never an enforcement claim). */
export const projectRetentionEvidence = defineEvidenceProjection<{
  disclaimer: string
  entries: readonly RetentionEntry[]
}>(
  // Stryker disable next-line ObjectLiteral: covered by tests (verified: `{}` here fails them), but Stryker perTest reports a false Survived for this schema object because it is evaluated once at module load -- `ignoreStatic` does not ignore a static mutant that has test coverage.
  { disclaimer, entries: retentionEntries },
)

/** One capability's declared regulatory-classification metadata bag (ADR 0049's/0051's open `metadata` convention). */
export interface ComplianceEntry {
  readonly capability: { readonly file: string; readonly exportName: string }
  readonly metadata: Readonly<Record<string, unknown>>
}

function complianceEntries(evidence: EvidenceModel): readonly ComplianceEntry[] {
  const entries: ComplianceEntry[] = []
  for (const capability of evidence.capability.capabilities) {
    if (capability.docs?.metadata === undefined) continue
    entries.push({
      capability: { file: capability.file, exportName: capability.exportName },
      metadata: capability.docs.metadata,
    })
  }
  return entries
}

/** Data Compliance Evidence: every capability's declared `metadata` bag, unvalidated -- `data-cap` asserts no regime applies. */
export const projectComplianceEvidence = defineEvidenceProjection<{
  disclaimer: string
  entries: readonly ComplianceEntry[]
}>(
  // Stryker disable next-line ObjectLiteral: covered by tests (verified: `{}` here fails them), but Stryker perTest reports a false Survived for this schema object because it is evaluated once at module load -- `ignoreStatic` does not ignore a static mutant that has test coverage.
  { disclaimer, entries: complianceEntries },
)

/**
 * Data Audit Evidence / Data Assurance Report / Data Governance Report
 * (reframed): a rollup of ownership and finding counts plus provenance --
 * never a governance verdict or a risk score, only the counted facts a
 * consumer's own policy can be evaluated against.
 *
 * The clearest case for the per-field schema: `ownedCapabilities` is derived
 * from Ownership Model alone, `findingsBySeverity` from Finding Model alone,
 * and `provenance` from neither. `.project()` reports exactly that, per
 * output field.
 */
function auditProvenance(evidence: EvidenceModel): EvidenceProvenance {
  return evidence.provenance
}
function auditCapabilityCount(evidence: EvidenceModel): number {
  return evidence.capability.capabilities.length
}
function auditOwnedCapabilities(evidence: EvidenceModel): number | undefined {
  return evidence.ownership?.entries
    .filter((e) => e.owner !== UNOWNED)
    .flatMap((e) => e.capabilities).length
}
function auditUnownedCapabilities(evidence: EvidenceModel): number | undefined {
  return evidence.ownership?.entries.find((e) => e.owner === UNOWNED)?.capabilities.length
}
function auditFindingsBySeverity(evidence: EvidenceModel): Record<string, number> | undefined {
  return evidence.finding?.findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1
    return counts
  }, {})
}

export const projectAuditEvidence = defineEvidenceProjection<{
  disclaimer: string
  provenance: EvidenceProvenance
  capabilityCount: number
  ownedCapabilities: number | undefined
  unownedCapabilities: number | undefined
  findingsBySeverity: Record<string, number> | undefined
}>(
  // Stryker disable next-line ObjectLiteral: covered by tests (verified: `{}` here fails them), but Stryker perTest reports a false Survived for this schema object because it is evaluated once at module load -- `ignoreStatic` does not ignore a static mutant that has test coverage.
  {
    disclaimer,
    provenance: auditProvenance,
    capabilityCount: auditCapabilityCount,
    ownedCapabilities: auditOwnedCapabilities,
    unownedCapabilities: auditUnownedCapabilities,
    findingsBySeverity: auditFindingsBySeverity,
  },
)
