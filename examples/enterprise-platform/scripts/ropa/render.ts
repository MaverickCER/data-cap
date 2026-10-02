// The default Markdown renderer for a `RopaModel` -- NOT the only possible
// one. `build-model.ts` is the real seam: an org that wants a different
// shape (a CSV for a DPA submission, a row per personal-data category
// instead of per capability, an HTML page) renders `RopaModel` however it
// likes; this file is just this example's own choice, written out in full so
// a reader can see exactly what a GDPR Art. 30(1) processing-activity
// register can look like end to end.
//
// There is no single official ROPA template GDPR itself prescribes -- Art.
// 30(1) states the 7 required *items* (a)-(g), never a reporting format. The
// two-tier layout below (a summary table, one row per processing activity;
// then a per-activity detail section, one sub-table per field) is styled
// after the EDPB/ICO's own published ROPA guidance and templates, which use
// this same "register + detail" shape -- but the exact columns and their
// order are this generator's own judgment call, not a reproduction of any
// single mandated layout. See this directory's README for the full
// accounting of which of the 7 items are direct, partial, or newly-added.
import type { RopaModel, RopaRecord } from "./types.js"

const DISCLAIMER =
  "This document is a generated illustration of GDPR Article 30(1) record-of-processing-activities " +
  "(ROPA) content, produced from data-cap's own declared governance metadata. It is not legal advice, " +
  "not a compliance certification, and not a substitute for your organization's own Art. 30 review -- " +
  "see this generator's own README (scripts/ropa/README.md) for exactly which of the 7 required items " +
  "below are direct schema fields, which are partial/approximate mappings, and which require your own " +
  "input before this document is published externally."

function joinCell(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "Not documented"
}

function renderControllerSection(model: RopaModel): string[] {
  const lines: string[] = []
  lines.push("## (a) Controller identity")
  lines.push("")
  if (model.controllerIdentity === "Not documented") {
    lines.push(
      "> **Not documented.** No `ControllerIdentity` was supplied to `buildRopaModel()` for this " +
        "run. Art. 30(1)(a) requires the controller's own name and contact details -- data-cap has no " +
        "schema concept for an organization's own identity and cannot supply or verify this. See " +
        "`scripts/ropa/controller-identity.ts`.",
    )
  } else {
    lines.push(`- **Name:** ${model.controllerIdentity.name}`)
    lines.push(`- **Contact:** ${model.controllerIdentity.contact}`)
    if (model.controllerIdentity.representative !== undefined) {
      lines.push(`- **EU/UK representative (Art. 27):** ${model.controllerIdentity.representative}`)
    }
    if (model.controllerIdentity.dpoContact !== undefined) {
      lines.push(`- **Data Protection Officer (Art. 37):** ${model.controllerIdentity.dpoContact}`)
    }
  }
  lines.push("")
  return lines
}

function uniqueField<T extends string>(fields: RopaRecord["fields"], pick: (f: RopaRecord["fields"][number]) => T): readonly string[] {
  return [...new Set(fields.map(pick))].filter((v) => v !== "Not documented")
}

function renderSummaryTable(records: readonly RopaRecord[]): string[] {
  const lines: string[] = []
  lines.push(
    "| Processing activity (capability) | (b) Purpose(s) | (c) Data subject categories | (c) Personal data categories | (d) Recipient categories | (e) Transfer safeguards | (f) Retention | (g) Security measures |",
  )
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const record of records) {
    const dataSubjects = uniqueField(record.fields, (f) => f.dataSubjectCategory)
    const personalData = uniqueField(record.fields, (f) => f.personalDataCategory)
    const recipients = [...new Set(record.fields.flatMap((f) => f.recipientCategories))].filter(
      (v) => v !== "Not documented",
    )
    const safeguards = uniqueField(record.fields, (f) => f.transferSafeguard)
    const retention = uniqueField(record.fields, (f) => f.retention)
    const security = uniqueField(record.fields, (f) => f.securityMeasures)
    lines.push(
      `| \`${record.capability}\` | ${record.purposesOfProcessing} | ${joinCell(dataSubjects)} | ${joinCell(personalData)} | ${joinCell(recipients)} | ${joinCell(safeguards)} | ${joinCell(retention)} | ${joinCell(security)} |`,
    )
  }
  lines.push("")
  return lines
}

function renderRecordDetail(record: RopaRecord): string[] {
  const lines: string[] = []
  lines.push(`### \`${record.capability}\``)
  lines.push("")
  lines.push(`- File: \`${record.file}\``)
  lines.push(`- (b) Purpose(s) of processing: ${record.purposesOfProcessing}`)
  lines.push("")

  if (record.fields.length === 0) {
    lines.push("_This capability declares no fields -- nothing further to report per field._")
    lines.push("")
    return lines
  }

  lines.push(
    "| Field | (c) Data subject category | (c) Personal data category | (d) Recipient categories | (e) Transfer safeguard | (f) Retention | (g) Security measures |",
  )
  lines.push("| --- | --- | --- | --- | --- | --- | --- |")
  for (const field of record.fields) {
    lines.push(
      `| \`${field.field}\` | ${field.dataSubjectCategory} | ${field.personalDataCategory} | ${joinCell(field.recipientCategories)} | ${field.transferSafeguard} | ${field.retention} | ${field.securityMeasures} |`,
    )
  }
  lines.push("")
  return lines
}

/**
 * Renders a `RopaModel` as a Markdown document -- the default shape
 * `run.ts` writes to `docs/ROPA.md`. See this file's own header comment for
 * why this exact layout is a judgment call, not a GDPR-mandated one.
 */
export function renderRopa(model: RopaModel): string {
  const lines: string[] = []

  lines.push("# Record of Processing Activities (GDPR Art. 30(1))")
  lines.push("")
  lines.push(`> ${DISCLAIMER}`)
  lines.push("")
  lines.push(`Generated at: ${model.generatedAt}`)
  lines.push("")

  lines.push(...renderControllerSection(model))

  if (model.records.length === 0) {
    lines.push("No capability was discovered -- nothing to report.")
    lines.push("")
    return lines.join("\n")
  }

  lines.push("## Processing activities -- summary")
  lines.push("")
  lines.push(...renderSummaryTable(model.records))

  lines.push("## Processing activities -- detail")
  lines.push("")
  for (const record of model.records) {
    lines.push(...renderRecordDetail(record))
  }

  return `${lines.join("\n")}\n`
}
