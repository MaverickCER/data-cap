// Types for this example's GDPR Article 30(1) ROPA (Record of Processing
// Activities) document -- see this directory's own README for the full
// "which of the 7 required items are direct, partial, or newly-added"
// accounting, and why a capability is treated as one "processing activity"
// (same reasoning as ../generate-docs and env-cap's own rotation-log
// generator this directory structurally mirrors).
//
// Field names below are deliberately lettered to match GDPR Art. 30(1)(a)-(g)
// directly -- each property's own doc comment states exactly which item it
// answers, so a reader never has to cross-reference the regulation text to
// know what a column means.

/**
 * Art. 30(1)(a) -- "the name and contact details of the controller." A
 * whole-register fact (one controller per ROPA, not one per capability), and
 * one data-cap has no schema concept for at all: no `documentData()` call
 * declares an organization's own legal identity. Supplied by the generator's
 * caller (see `run.ts`), never derived from any capability's own docs.
 */
export interface ControllerIdentity {
  /** The controller's own legal/organizational name. */
  readonly name: string
  /** How to reach the controller about its processing activities (an email address, a mailing address, a web form -- whatever the organization actually uses). */
  readonly contact: string
  /** The EU/UK representative's contact details, when the controller is required to designate one (Art. 27) and chooses to state it here. Omitted, not "Not documented" -- a representative is conditionally required, not universal, so its absence is not itself a gap the way an unset field-level fact is. */
  readonly representative?: string
  /** The Data Protection Officer's contact details, when one is designated (Art. 37) and the organization chooses to state it here. Same optionality reasoning as `representative`. */
  readonly dpoContact?: string
}

/**
 * One field's own row of Art. 30(1) facts within a `RopaRecord` -- the
 * per-field detail a summary table alone would lose (GDPR requires
 * "categories," plural, and a capability can carry several fields with
 * different data-subject/recipient/retention profiles under one purpose).
 * Every property here is a string precisely because every one of them is
 * required to read `"Not documented"` when the underlying `documentData()`
 * call left it unset -- Art. 30 requires the controller to address each of
 * the 7 items, so `build-model.ts` never omits a key here the way it might
 * omit an optional internal field elsewhere in this codebase.
 */
export interface RopaFieldEntry {
  /** This field's own top-level key. */
  readonly field: string
  /**
   * Art. 30(1)(c), first half -- "the categories of data subjects." Sourced
   * from the field's own `docs.dataSubjectCategory` (a genuinely new schema
   * field -- see this directory's README) -- `"Not documented"` when unset.
   */
  readonly dataSubjectCategory: string
  /**
   * Art. 30(1)(c), second half -- "the categories of... personal data."
   * **Partial mapping**: derived from the field's resolved `sensitivity`
   * classification (`"public"`/`"internal"`/`"confidential"`/`"restricted"`,
   * or a custom value), which was designed as a general data-classification
   * label, not a GDPR personal-data-category taxonomy. A reviewer should not
   * treat this column as a rigorous Art. 30(1)(c) answer on its own -- see
   * the README's "Partial mappings" section. `"Not documented"` when the
   * field declares no `sensitivity` at all (own or inherited).
   */
  readonly personalDataCategory: string
  /**
   * Art. 30(1)(d) -- "the categories of recipients to whom the personal
   * data have been or will be disclosed." Sourced verbatim from the field's
   * own `docs.recipientCategories` -- **always author-declared, never**
   * inferred from data-cap's own dependency graph (a proven in-codebase
   * consumer is a different fact from a declared external recipient; see
   * the README). `["Not documented"]` (not an empty array) when the field
   * declares no recipient categories at all -- Art. 30 requires this item
   * be addressed, so an unset fact still needs a fully-formed row here, not
   * a silently empty list a table renderer could show as a blank cell.
   */
  readonly recipientCategories: readonly string[]
  /**
   * Art. 30(1)(e) -- "where applicable, transfers of personal data to a
   * third country... including... the documentation of suitable
   * safeguards." Resolved from the field's own `docs.transferSafeguard`,
   * falling back to the capability's own `docs.transferSafeguard` (the same
   * field-then-capability override `dataResidency` already uses) --
   * `"Not documented"` when neither declares one.
   */
  readonly transferSafeguard: string
  /**
   * Art. 30(1)(f) -- "where possible, the envisaged time limits for
   * erasure of the different categories of data." Resolved from the
   * field's own `docs.retention`, falling back to the capability's own
   * `docs.retention` -- `"Not documented"` when neither declares one.
   */
  readonly retention: string
  /**
   * Art. 30(1)(g) -- "where possible, a general description of the
   * technical and organisational security measures." **Partial mapping**:
   * resolved from the field's own `docs.protections`, falling back to the
   * capability's own `docs.protections` -- `protections` was designed as a
   * free-text "what safeguard is documented" presence signal (see
   * `src/core/document.ts`), not a structured security-control taxonomy, so
   * this column should be read as "a safeguard was documented," not as a
   * complete Art. 32(1)-style security description. `"Not documented"` when
   * neither declares one.
   */
  readonly securityMeasures: string
}

/**
 * One capability treated as one GDPR "processing activity" -- the row
 * granularity this register uses (see the README's "Why a capability is one
 * record" section for the reasoning, and why this is a documented layout
 * choice, not a GDPR-mandated one).
 */
export interface RopaRecord {
  /** The capability's own exported binding name. */
  readonly capability: string
  /** Root-relative path of the file declaring this capability. */
  readonly file: string
  /**
   * Art. 30(1)(b) -- "the purposes of the processing." Aggregated from
   * every field's own resolved `purpose` (field-level, falling back to the
   * capability's own `purpose`) into a deduplicated, semicolon-joined list
   * -- `"Not documented"` when no field (and no capability-level fallback)
   * declares one at all.
   */
  readonly purposesOfProcessing: string
  /** Every field this capability declares, each with its own full Art. 30(1)(c)-(g) row. */
  readonly fields: readonly RopaFieldEntry[]
}

/** The versioned root of this example's ROPA document model. */
export interface RopaModel {
  readonly schemaVersion: 1
  /** From the source `EvidenceModel.provenance.generatedAt` -- when the evidence this register is built from was generated, not when this document was rendered. */
  readonly generatedAt: string
  /**
   * Art. 30(1)(a). `"Not documented"` when `run.ts` wasn't given a real
   * `ControllerIdentity` -- see this directory's README on why an adopting
   * organization must supply its own before publishing this document
   * externally; data-cap has no way to verify or supply this itself.
   */
  readonly controllerIdentity: ControllerIdentity | "Not documented"
  /** One record per discovered capability (active or not -- see README). */
  readonly records: readonly RopaRecord[]
}
