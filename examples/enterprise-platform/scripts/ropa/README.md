# GDPR Article 30(1) ROPA illustration

Generates `docs/ROPA.md`, an illustration of a GDPR **Article 30(1)** Record of Processing
Activities (ROPA), built from data-cap's own schema-level governance fields. It can support a
privacy review. It is not a complete record, and it does not show that any processing meets the
regulation.

It is a peer to [`../generate-docs`](../generate-docs). It follows the same
directory-per-generator convention that example established, only for a different document.
It is structured exactly like `env-cap`'s own already-merged NIST rotation-log generator
(`examples/application/scripts/rotation-log/` in that package).

## Which of the 7 required items this maps, and how

GDPR Art. 30(1) requires a controller's record to address seven items, (a) through (g). The table
shows exactly how each one is sourced. Three of the seven are approximations, not rigorous answers.
**Read this before publishing `docs/ROPA.md` outside this repository.**

| Item | What Art. 30(1) requires | How this generator sources it | Status |
| --- | --- | --- | --- |
| (a) | Controller's name and contact details | Caller-supplied `ControllerIdentity` (see [`controller-identity.ts`](controller-identity.ts)) | **New: caller-supplied, not derivable from any schema** |
| (b) | Purposes of the processing | `FieldDocs.purpose`/`CapabilityDocs.purpose` (pre-existing) | **Direct** |
| (c), data subjects | Categories of data subjects | `FieldDocs.dataSubjectCategory` (new) | **New schema field, direct** |
| (c), personal data | Categories of personal data | `FieldNode.sensitivity` (pre-existing classification) | **Partial mapping (see below)** |
| (d) | Categories of recipients | `FieldDocs.recipientCategories` (new) | **New schema field, direct, never inferred** |
| (e) | Third-country transfers, the destination, and safeguards | `FieldDocs.transferSafeguard`/`CapabilityDocs.transferSafeguard` (new) | **Partial mapping (see below)** |
| (f) | Envisaged erasure/retention time limits | `FieldDocs.retention`/`CapabilityDocs.retention` (pre-existing) | **Direct** |
| (g) | Technical/organisational security measures | `FieldDocs.protections`/`CapabilityDocs.protections` (pre-existing) | **Partial mapping (see below)** |

### The three partial mappings, stated honestly

**`sensitivity` -> "categories of personal data" (c).** `sensitivity` is a general
data-classification label. Its values are `"public"`/`"internal"`/`"confidential"`/`"restricted"`,
or a custom value (see `src/core/document.ts`). It was designed for access-control and handling
decisions. It is not a GDPR personal-data-category taxonomy, which distinguishes things like
"contact details," "financial data," "special category data" under Art. 9. A field classified
`"restricted"` might be special-category health data, or it might be an internal admin credential.
`sensitivity` alone cannot tell you which.

**Do not treat the "(c) Personal data categories"
column in `docs/ROPA.md` as a complete or accurate answer to Art. 30(1)(c). First review each
field's actual data against your own organization's data-category taxonomy.**

**`protections` -> "security measures" (g).** `protections` is a free-text, presence-only field:
"was a safeguard documented," never "is it adequate" (see `src/core/document.ts`'s own doc
comment). It was designed as a lightweight documentation signal. It is not a structured
description of technical/organisational measures in the sense Art. 32(1)/Art. 30(1)(g) intends.
Those measures include encryption standards, access-control mechanisms, pseudonymisation,
resilience measures, testing regimes, etc.

**Review the "(g) Security measures" column against
your organization's actual Art. 32 security program before relying on it.**

**`transferSafeguard` -> "transfers to a third country" (e).** Art. 30(1)(e) asks for the
transfer itself, "including the identification of that third country or international
organisation". For transfers under the second subparagraph of Art. 49(1), it also asks for the
documentation of suitable safeguards. `transferSafeguard` records only the safeguard. No field
records the destination country or organisation: `dataResidency` says where data is stored, not
where it is sent. So the "(e) Transfer safeguards" column does not identify where data goes.

**Until a destination is modeled, write it into the safeguard text yourself (for example
`"United States, EU Standard Contractual Clauses"`). Then review the column against your
organization's transfer register.**

data-cap cannot verify the accuracy of any of these mappings. All of them are declared,
author-supplied text, never independently checked against reality. This is the same
declared-vs-proven discipline every other governance field in this package follows (see
`AGENTS.md`'s invariant 12).

### Controller identity (a)

[`controller-identity.ts`](controller-identity.ts) holds this fictional example platform's own
made-up `ControllerIdentity`: **placeholder values, not real ones.**

There is no existing project-metadata surface in data-cap. We checked: there is no `package.json`
convention and no prior project-level config file. So the simplest honest surface for this is a
small, project-owned config file that `run.ts` imports and passes to `buildRopaModel()`. A real
adopting organization would use exactly the same shape for its own real values.

**An adopting organization must replace every field in `controller-identity.ts` with its own real
controller name and contact details before publishing `docs/ROPA.md` externally**. `data-cap` has no
way to supply or verify this itself. When no `ControllerIdentity` is supplied at all, `render.ts`
renders `"Not documented"` with an explicit warning (see `build-model.test.ts` for both cases
exercised).

## Why a capability is one record

GDPR's own EDPB/ICO guidance treats a "processing activity" as the row granularity for a ROPA. In
data-cap's own model, a `buildData`/`createData` capability is the closest existing concept to "one
processing activity". A capability is a coherent unit of fields plus the operations that
acquire/mutate/observe them, independently owned and documented (see `AGENTS.md`).

Each capability becomes one `RopaRecord`. Every field's own Art. 30(1)(c)-(g) facts sit underneath
as a per-field detail table, mirroring rotation-log's own summary-table-plus-entries layout. This is
a documented layout choice this generator makes, not a GDPR-mandated grouping. See `render.ts`'s own
header comment for the full reasoning and the EDPB/ICO-style two-tier format it follows.

## Architecture

- [`types.ts`](types.ts): `RopaRecord`/`RopaFieldEntry`/`RopaModel`/`ControllerIdentity`, this
  document's own JSON shape. Every property's own doc comment names exactly which Art. 30(1) letter
  it answers.
- [`build-model.ts`](build-model.ts): the real seam, a pure function,
  `(EvidenceModel, ControllerIdentity | undefined) -> RopaModel`.
  - Any field declared as part of this shape but left undeclared on a given capability/field is
    `"Not documented"` in the output, never omitted. Art. 30 requires every item be addressed, so a
    silent gap would hide a missing answer.
  - An org may want the computed values directly: to feed its own privacy-ops dashboard, a different
    renderer, or a DPA submission tool. It calls `buildRopaModel()` on any `EvidenceModel` it
    already has, without touching `render.ts` at all.
- [`render.ts`](render.ts): the default Markdown renderer, an EDPB/ICO-style register (summary
  table + per-activity detail). There is no single official ROPA template GDPR prescribes; see that
  file's own header comment.
- [`print-lines.ts`](print-lines.ts): `printJsonLines()`, a shared line-by-line JSON printer.
  `run.ts` uses it to demonstrate the `build-model.ts` escape hatch on the console, not only
  document it.
- [`controller-identity.ts`](controller-identity.ts): this example's own placeholder Art. 30(1)(a)
  fact (see above).
- [`run.ts`](run.ts) wires it together. It reads `docs/data.evidence.json` via
  `../../reports/evidence-cache.ts`'s `getEvidence()`, builds the model, writes `docs/ROPA.md`, and
  prints the raw model via `printJsonLines()`.

## Running it

```bash
npm run ropa      # generate docs/ROPA.md alone
npm run reports    # generates data-handling-record + audit-prep + ROPA together
```

`npm run reports` runs `npm run docs` first via each report's own reliance on
`docs/data.evidence.json`'s freshness; see `reports/evidence-cache.ts`'s own header comment.

This generator has no `--check` freshness mode, unlike `../generate-docs/check.ts` or
`reports/data-handling-record.ts --check`. It mirrors env-cap's rotation-log generator, which
doesn't have one either. Regenerate and review the diff instead.
