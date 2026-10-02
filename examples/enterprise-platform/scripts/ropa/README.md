# GDPR Article 30(1) ROPA generator

Generates `docs/ROPA.md` -- a GDPR **Article 30(1)** Record of Processing Activities (ROPA)
document, built from data-cap's own schema-level governance fields. Peer to
[`../generate-docs`](../generate-docs) -- same directory-per-generator convention that
example established (C9), just for a different document, and structured exactly like
`env-cap`'s own already-merged NIST rotation-log generator
(`examples/application/scripts/rotation-log/` in that package).

## Which of the 7 required items this maps, and how

GDPR Art. 30(1) requires a controller's record to address seven items, (a) through (g). Here is
exactly how each one is sourced -- **read this before publishing `docs/ROPA.md` outside this
repository**, since two of the seven are approximations, not rigorous answers.

| Item | What Art. 30(1) requires | How this generator sources it | Status |
| --- | --- | --- | --- |
| (a) | Controller's name and contact details | Caller-supplied `ControllerIdentity` (see [`controller-identity.ts`](controller-identity.ts)) | **New -- caller-supplied, not derivable from any schema** |
| (b) | Purposes of the processing | `FieldDocs.purpose`/`CapabilityDocs.purpose` (pre-existing) | **Direct** |
| (c), data subjects | Categories of data subjects | `FieldDocs.dataSubjectCategory` (new) | **New schema field, direct** |
| (c), personal data | Categories of personal data | `FieldNode.sensitivity` (pre-existing classification) | **Partial mapping -- see below** |
| (d) | Categories of recipients | `FieldDocs.recipientCategories` (new) | **New schema field, direct -- never inferred** |
| (e) | Third-country transfers and safeguards | `FieldDocs.transferSafeguard`/`CapabilityDocs.transferSafeguard` (new) | **New schema field, direct** |
| (f) | Envisaged erasure/retention time limits | `FieldDocs.retention`/`CapabilityDocs.retention` (pre-existing) | **Direct** |
| (g) | Technical/organisational security measures | `FieldDocs.protections`/`CapabilityDocs.protections` (pre-existing) | **Partial mapping -- see below** |

### The two partial mappings, stated honestly

**`sensitivity` -> "categories of personal data" (c).** `sensitivity` is a general
data-classification label (`"public"`/`"internal"`/`"confidential"`/`"restricted"`, or a
custom value -- see `src/core/document.ts`), designed for access-control and handling
decisions, not as a GDPR personal-data-category taxonomy (which distinguishes things like
"contact details," "financial data," "special category data" under Art. 9). A field
classified `"restricted"` might be special-category health data or it might be an internal
admin credential -- `sensitivity` alone cannot tell you which. **Do not treat the "(c) Personal
data categories" column in `docs/ROPA.md` as a complete or accurate answer to Art. 30(1)(c)
without reviewing each field's actual data against your own organization's data-category
taxonomy.**

**`protections` -> "security measures" (g).** `protections` is a free-text, presence-only
field ("was a safeguard documented," never "is it adequate" -- see `src/core/document.ts`'s own
doc comment). It was designed as a lightweight documentation signal, not a structured
description of technical/organisational measures in the sense Art. 32(1)/Art. 30(1)(g)
intends (encryption standards, access-control mechanisms, pseudonymisation, resilience
measures, testing regimes, etc.). **Review the "(g) Security measures" column against your
organization's actual Art. 32 security program before relying on it.**

data-cap cannot verify either mapping's accuracy -- both are declared, author-supplied text,
never independently checked against reality (the same declared-vs-proven discipline every
other governance field in this package follows; see `AGENTS.md`'s invariant 12).

### Controller identity (a)

[`controller-identity.ts`](controller-identity.ts) holds this fictional example platform's own
made-up `ControllerIdentity` -- **placeholder values, not real ones.** There is no existing
project-metadata surface in data-cap (checked: no `package.json` convention, no prior
project-level config file), so the simplest honest surface for this is a small, project-owned
config file `run.ts` imports and passes to `buildRopaModel()`, exactly the same shape a real
adopting organization would use for its own real values. **An adopting organization must
replace every field in `controller-identity.ts` with its own real controller name and contact
details before publishing `docs/ROPA.md` externally** -- data-cap has no way to supply or
verify this itself, and `render.ts` renders `"Not documented"` with an explicit warning when no
`ControllerIdentity` is supplied at all (see `build-model.test.ts` for both cases exercised).

## Why a capability is one record

GDPR's own EDPB/ICO guidance treats a "processing activity" as the row granularity for a ROPA.
In data-cap's own model, a `buildData`/`createData` capability -- a coherent unit of fields plus
the operations that acquire/mutate/observe them, independently owned and documented (see
`AGENTS.md`) -- is the closest existing concept to "one processing activity." Each capability
becomes one `RopaRecord`, with every field's own Art. 30(1)(c)-(g) facts as a per-field detail
table underneath (mirroring rotation-log's own summary-table-plus-entries layout) -- this is a
documented layout choice this generator makes, not a GDPR-mandated grouping; see `render.ts`'s
own header comment for the full reasoning and the EDPB/ICO-style two-tier format it follows.

## Architecture

- [`types.ts`](types.ts) -- `RopaRecord`/`RopaFieldEntry`/`RopaModel`/`ControllerIdentity`, this
  document's own JSON shape, with every property's own doc comment naming exactly which Art.
  30(1) letter it answers.
- [`build-model.ts`](build-model.ts) -- the real seam: a pure function,
  `(EvidenceModel, ControllerIdentity | undefined) -> RopaModel`. Any field declared as part of
  this shape but left undeclared on a given capability/field is `"Not documented"` in the output,
  never omitted -- Art. 30 requires every item be addressed, so a silent gap would misrepresent
  compliance. An org that wants the computed values directly (to feed its own privacy-ops
  dashboard, a different renderer, a DPA submission tool) calls `buildRopaModel()` on any
  `EvidenceModel` it already has, without touching `render.ts` at all.
- [`render.ts`](render.ts) -- the default Markdown renderer, an EDPB/ICO-style register (summary
  table + per-activity detail). There is no single official ROPA template GDPR prescribes -- see
  that file's own header comment.
- [`print-lines.ts`](print-lines.ts) -- `printJsonLines()`, a shared line-by-line JSON printer
  `run.ts` uses to demonstrate the `build-model.ts` escape hatch on the console, not just document
  it.
- [`controller-identity.ts`](controller-identity.ts) -- this example's own placeholder Art.
  30(1)(a) fact (see above).
- [`run.ts`](run.ts) -- wires it together: reads `docs/data.evidence.json` via
  `../../reports/evidence-cache.ts`'s `getEvidence()`, builds the model, writes `docs/ROPA.md`,
  and prints the raw model via `printJsonLines()`.

## Running it

```bash
npm run ropa      # generate docs/ROPA.md alone
npm run reports    # generates litigation-evidence + audit-prep + ROPA together
```

`npm run reports` runs `npm run docs` first via each report's own reliance on
`docs/data.evidence.json`'s freshness -- see `reports/evidence-cache.ts`'s own header comment.
This generator has no `--check` freshness mode (unlike `../generate-docs/check.ts` or
`reports/litigation-evidence.ts --check`) -- it mirrors env-cap's rotation-log generator, which
doesn't have one either; regenerate and review the diff instead.
