import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  projectClassificationEvidence,
  projectComplianceEvidence,
  projectPrivacyEvidence,
  projectRetentionEvidence,
} from "data-cap/build"
import type { EvidenceModel } from "data-cap/build"
import type { CategoryEvidence } from "./types.js"

/**
 * @param functionId - The NIST Function id.
 * @param categoryId - The NIST Category id.
 * @param summary - What the evidence shows.
 * @returns An `"evidence-found"` `CategoryEvidence` entry.
 */
function found(functionId: string, categoryId: string, summary: string): CategoryEvidence {
  return { functionId, categoryId, status: "evidence-found", summary }
}

/**
 * @param functionId - The NIST Function id.
 * @param categoryId - The NIST Category id.
 * @param why - Why this app's evidence has nothing to say about this Category.
 * @returns A `"no-evidence"` `CategoryEvidence` entry.
 */
function none(functionId: string, categoryId: string, why: string): CategoryEvidence {
  return { functionId, categoryId, status: "no-evidence", summary: why }
}

/**
 * Loads this example's own generated `docs/data.evidence.json` (`npm run
 * docs` writes it -- see this generator's own `run.ts` for the ordering
 * guarantee) and runs it through data-cap's five published reference
 * evidence projections (`data-cap/build`) to assemble one `CategoryEvidence`
 * entry per NIST Privacy Framework Category. Every projection call is the
 * same published API a consuming application would use -- no private
 * `src/` import, matching this example's own "published API only" rule
 * (see this example's own README).
 * @param root - This example's own root directory.
 * @returns Every Category this generator evaluated, evidence-found or not.
 */
export function gatherCategoryEvidence(root: string): readonly CategoryEvidence[] {
  const evidencePath = path.join(root, "docs/data.evidence.json")
  if (!existsSync(evidencePath)) {
    throw new Error(
      `${evidencePath} does not exist -- run \`npm run docs\` first (this generator's own run.ts already does, in order, before reading it).`,
    )
  }
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as EvidenceModel

  const classification = projectClassificationEvidence(evidence)
  const privacy = projectPrivacyEvidence(evidence)
  const retention = projectRetentionEvidence(evidence)
  const compliance = projectComplianceEvidence(evidence)

  const entries: CategoryEvidence[] = []

  // -- Identify-P --
  entries.push(
    classification.entries.length > 0
      ? found(
          "IDENTIFY-P",
          "ID.IM-P",
          `data-cap's own Classification Evidence projection found ${String(classification.entries.length)} capability/field entry(ies) with a declared \`sensitivity\` -- a real inventory of what data this application processes and how sensitive each piece is, sourced from the same \`documentData()\` declarations \`docs/DATA.md\` renders.`,
        )
      : none(
          "IDENTIFY-P",
          "ID.IM-P",
          "No capability or field in this app declares a `sensitivity` yet.",
        ),
    none(
      "IDENTIFY-P",
      "ID.BE-P",
      "Out of scope: an organization's mission/business-environment context is not a fact data-cap's field-level evidence establishes.",
    ),
    none(
      "IDENTIFY-P",
      "ID.RA-P",
      "Out of scope: a formal privacy risk assessment (likelihood/impact analysis) is not something this generator's evidence sources compute -- data-cap documents declared facts, it does not assess risk.",
    ),
    none(
      "IDENTIFY-P",
      "ID.DE-P",
      "Out of scope: this app has no third-party data processing ecosystem (no external service providers/partners) for ecosystem-risk evidence to describe.",
    ),
  )

  // -- Govern-P --
  entries.push(
    compliance.entries.length > 0
      ? found(
          "GOVERN-P",
          "GV.PO-P",
          `data-cap's own Compliance Evidence projection found ${String(compliance.entries.length)} capability(ies) with declared regulatory/governance \`metadata\` -- an organizational privacy-governance artifact, not merely code comments.`,
        )
      : none(
          "GOVERN-P",
          "GV.PO-P",
          "No capability in this app declares a governance `metadata` bag yet.",
        ),
    none(
      "GOVERN-P",
      "GV.RM-P",
      "Out of scope: an organization's own risk tolerance determination is not a fact a single application's data declarations establish.",
    ),
    none(
      "GOVERN-P",
      "GV.AT-P",
      "Out of scope: workforce privacy training records are not something this application's own evidence can speak to.",
    ),
    none(
      "GOVERN-P",
      "GV.MT-P",
      "Out of scope: ongoing privacy-posture review cadence is an organizational process, not evidence this generator's data sources compute.",
    ),
  )

  // -- Control-P --
  entries.push(
    none(
      "CONTROL-P",
      "CT.PO-P",
      "Retention evidence (below, under CT.DM-P) documents this app's own data processing policy, but no dedicated authorization-workflow policy artifact (e.g. consent revocation processes) exists to evidence this Category specifically.",
    ),
    retention.entries.length > 0
      ? found(
          "CONTROL-P",
          "CT.DM-P",
          `data-cap's own Retention Evidence projection found ${String(retention.entries.length)} capability/field entry(ies) with a declared \`retention\` policy (e.g. "${retention.entries[0]?.retention ?? ""}") -- a real, declared data-lifecycle control (NIST CT.DM-P5: "Data are destroyed according to policy"), presence only, never an enforcement claim.`,
        )
      : none(
          "CONTROL-P",
          "CT.DM-P",
          "No capability or field in this app declares a `retention` policy yet.",
        ),
    none(
      "CONTROL-P",
      "CT.DP-P",
      "Out of scope: this app performs no disassociated/de-identified processing (no tokenization, no privacy-preserving cryptography) for this Category to evidence.",
    ),
  )

  // -- Communicate-P --
  entries.push(
    found(
      "COMMUNICATE-P",
      "CM.PO-P",
      "This app's own `docs/DATA.md` and `docs/OWNERSHIP.md` (regenerated by `npm run docs` on every run, from the same declared metadata this report itself reads) are a real, committed transparency artifact documenting this application's own data processing purposes and practices.",
    ),
    found(
      "COMMUNICATE-P",
      "CM.AW-P",
      "The same `docs/DATA.md`/`docs/OWNERSHIP.md` artifacts give a reviewer reliable, generated (not hand-maintained, so not silently stale) knowledge of this app's data processing practices and associated declared sensitivities.",
    ),
  )

  // -- Protect-P --
  entries.push(
    privacy.entries.filter((e) => e.protectionsDocumented).length > 0
      ? found(
          "PROTECT-P",
          "PR.PO-P",
          `data-cap's own Privacy Evidence projection found ${String(privacy.entries.filter((e) => e.protectionsDocumented).length)} of ${String(privacy.entries.length)} sensitivity-declaring entry(ies) also declare \`protections\` -- a real, declared data-protection policy statement, presence only, never an adequacy claim.`,
        )
      : none(
          "PROTECT-P",
          "PR.PO-P",
          "No sensitivity-declaring capability or field in this app also declares `protections` yet.",
        ),
    none(
      "PROTECT-P",
      "PR.AC-P",
      "This app's own server-side route handlers (src/app/api/todos/route.ts) enforce real per-user ownership and admin-only cross-user access (see this example's own README) -- but that enforcement is verified by this example's own manual test sweep, not by an automated fact this generator's evidence sources compute, so it is not counted as evidence-found here.",
    ),
    none(
      "PROTECT-P",
      "PR.DS-P",
      "Out of scope: at-rest/in-transit encryption facts are not something data-cap's field-level declarations compute (this app's own storage is in-memory, by design -- see its README).",
    ),
    none(
      "PROTECT-P",
      "PR.MA-P",
      "Out of scope: system maintenance/repair logging is not evidence a data-ownership contract establishes.",
    ),
    none(
      "PROTECT-P",
      "PR.PT-P",
      "Out of scope: technical security-solution configuration (network protection, resilience mechanisms) is not evidence data-cap's declared field metadata establishes.",
    ),
  )

  return entries
}
