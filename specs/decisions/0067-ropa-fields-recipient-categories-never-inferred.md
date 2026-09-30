# 0067: GDPR Art. 30(1) ROPA fields -- `recipientCategories` is always declared, never inferred from the dependency graph

## Status

Accepted. Implemented in `src/core/document.ts` (`FieldDocs.dataSubjectCategory`/
`FieldDocs.recipientCategories`/`FieldDocs.transferSafeguard`/
`CapabilityDocs.transferSafeguard`), `src/build/parse.ts`
(`readStringArrayProp`, and its wiring plus `readStringProp` calls into
`extractFieldDocsMap`/`extractCapabilityDocs`), and consumed by
`examples/enterprise-platform/scripts/ropa/build-model.ts`.

## Context

ADR 0051's own "Alternatives considered" explicitly named a fuller
compliance vocabulary (`dataSubjectRights`, `thirdPartyRecipients`,
`crossBorderTransfer`, `consentRequired`) and deferred it: "goes further
than any current consuming use case needs; easy to add later behind the same
fallback-resolution pattern once a concrete report actually needs one." A
concrete consumer now exists -- `examples/enterprise-platform/scripts/ropa/`,
a GDPR Article 30(1) Record of Processing Activities (ROPA) generator, styled
after `@maverickcer/env-cap`'s own already-merged NIST rotation-log
generator.

Auditing Art. 30(1)'s seven required items (a)-(g) against data-cap's
existing schema (`src/core/document.ts`) found:

- **(a) controller identity, (c) categories of data subjects, (d) categories
  of recipients, (e) transfer safeguards** -- no existing field at all.
- **(b) purposes of processing, (f) erasure/retention time limits** --
  already direct fields (`purpose`, `retention`), both already declarable at
  field and capability level with field-wins-over-capability resolution.
- **(c) categories of personal data, (g) security measures** -- partially
  covered by `sensitivity`/`protections` respectively, but neither was
  designed as a rigorous mapping to the regulation's own language (see the
  generator's own README for the full, honest accounting of this
  approximation).

(a) is a whole-register fact about the controller's own organizational
identity -- not a per-field or per-capability concept at all, and out of
scope for `documentData()`'s schema; the generator's own `run.ts` takes it as
a caller-supplied parameter instead (see that directory's README).

Of the four genuinely missing items, (d) -- categories of recipients --
raised a design question none of the other three did: data-cap already
computes a _proven_ consumer relationship for other purposes (the Dependency
Model's `DependencyEdge`s, `src/build/dependency-graph.ts`). Could
`recipientCategories` be derived from that graph instead of requiring a
fresh, separate declaration?

**No.** A proven in-codebase consumer (a component, a server route, another
capability) is a categorically different fact from a GDPR "recipient" (Art.
4(9): "a natural or legal person, public authority, agency or another body,
to which the personal data are disclosed" -- explicitly _excluding_ other
controllers/processors acting under the same controller's own authority in
many readings, and never meaning "a function in this codebase that happens
to read this field"). A payment processor, a tax authority, or a third-party
analytics vendor is a recipient in the Art. 30(1)(d) sense; `BillingPanel.tsx`
reading `billingData.invoices` to render a UI is not, and data-cap's own
dependency graph cannot tell the two apart -- it proves _that_ something
reads a field, never _what legal category of external party_, if any, that
something represents. Auto-deriving `recipientCategories` from
`DependencyEdge`s would therefore either wildly over-report (every internal
consumer becomes a "recipient") or require exactly the same kind of
regulatory judgment call a human declaration already makes -- with the added
downside of looking automatically verified when it isn't (violating
AGENTS.md invariant 12: a report must never present a declared fact as a
proven one).

## Decision

### Three new `FieldDocs` properties; one also promoted to `CapabilityDocs`

| Field                 | Level              | Type                | Capability-level counterpart? |
| --------------------- | ------------------ | ------------------- | ----------------------------- |
| `dataSubjectCategory` | field only         | `string`            | No -- see below               |
| `recipientCategories` | field only         | `readonly string[]` | No -- see below               |
| `transferSafeguard`   | field + capability | `string`            | Yes, mirrors `dataResidency`  |

**`transferSafeguard`** is deliberately paired with the pre-existing
`dataResidency` field, at both levels, with the identical field-overrides-
capability declaration surface -- `dataResidency` already states _where_
data is permitted to be stored; `transferSafeguard` states _what protects a
transfer out of_ that jurisdiction, the same conceptual pairing Art.
30(1)(e) itself draws ("transfers... including... the documentation of
suitable safeguards").

**`dataSubjectCategory`/`recipientCategories` are field-level only, with no
capability-level counterpart at all** -- a deliberate, narrower choice than
`transferSafeguard`'s. Which data subjects a field concerns, and which
recipient categories a field's data is disclosed to, are facts about that
specific field's own data; unlike `purpose` (where "this whole capability
exists to do X" is a coherent, common real-world statement) or
`transferSafeguard` (where "this whole capability's data moves under SCCs"
is equally coherent), a capability-wide "these are the data subjects" or
"these are the recipients" statement would either be redundant with the
per-field facts or paper over real per-field differences (`billingData`'s
`invoices` field discloses to a payment processor and a tax authority;
nothing else in that same capability need share that disclosure). A future
concrete need for a capability-level default can add one later, following
`transferSafeguard`'s own precedent -- not preemptively added here without a
consuming use case.

### No `FieldNode`/`CapabilityInventory` resolution -- `docs`-only, following ADR 0057's precedent

None of the three new properties gets a `ResolvedGovernanceValue<T>` on
`FieldNode` (`src/build/inventory.ts`). This mirrors ADR 0057's own decision
for `retention`/`protections`: "have no resolution concept... never part of
this problem... no consumer reads a resolved counterpart for any of them."
The same reasoning applies here -- no consumer inside `data-cap` itself needs
a pre-resolved `field.recipientCategories.value`; only the ROPA generator
does, and it resolves `transferSafeguard`'s field-then-capability fallback
itself (`resolveFieldThenCapability()` in `build-model.ts`), the identical
pattern `litigation-evidence.ts` already uses for `retention`/`protections`
today. Adding inventory-level resolution for three fields with exactly one
real consumer, before a second consumer exists, would be speculative
generality this codebase's own established discipline (ADR 0051's
"Alternatives considered," ADR 0057's own scoping) argues against.
`CAPABILITY_MODEL_SCHEMA_VERSION` is therefore unaffected (still `3`) --
purely additive, optional `docs` properties, the same "no version bump for
an additive field" discipline ADR 0051/ADR 0057 both already establish.

### `recipientCategories` is always author-declared, never inferred

Stated as its own standalone rule, matching ADR 0051's "the general
principle... stated as its own standalone rule" convention: **data-cap never
derives a GDPR recipient category from its own dependency graph, or from any
other statically-proven fact.** `recipientCategories` is extracted by
`src/build/parse.ts`'s new `readStringArrayProp()` exactly the way every
other declared-only field is -- a literal array-of-strings on a
`documentData()` call, or nothing at all. See "Context" above for why.

### `readStringArrayProp` -- a plain all-string-array reader, distinct from `readDataResidencyProp`

`dataResidency` accepts _either_ a lone string or a string array (a field
often has exactly one residency jurisdiction, and requiring `["us"]` for
that common case would be needless ceremony). `recipientCategories` accepts
_only_ an array -- even a single-recipient field is phrased
`recipientCategories: ["payment processor"]`, never a bare string -- because
Art. 30(1)(d) itself asks for "categories," and a lone-string affordance
here would invite exactly the kind of representation ambiguity (is
`"payment processor"` one recipient or a comma-separated list someone typed
by hand?) that a real array type avoids from the start. `readStringArrayProp`
is therefore a new, separate extraction function, not a widening of
`readDataResidencyProp`'s existing string-or-array acceptance.

## Consequences

- `FieldDocs`/`CapabilityDocs` gain three (respectively, one) new optional
  properties -- purely additive, no schema-version bump anywhere
  (`CAPABILITY_MODEL_SCHEMA_VERSION` stays `3`; `schemas/*.schema.json`
  regenerate to include the new properties, verified by the existing
  `test/build/*-json-schema.test.ts` freshness checks).
- `examples/enterprise-platform/scripts/ropa/` is the first real consumer,
  following the exact `types.ts`/`build-model.ts`/`render.ts`/
  `print-lines.ts`/`run.ts` architecture `@maverickcer/env-cap`'s rotation-log
  generator already established as this ecosystem's shared pattern for a
  peer-to-`generate-docs` compliance-document generator.
- The Privacy Data Map / Data Processing Register line in
  `specs/generated-artifacts.md`'s deferred-artifacts table (if any remains
  after ADR 0051) can now additionally cite `recipientCategories`/
  `dataSubjectCategory`/`transferSafeguard` as available, not just
  `purpose`/`legalBasis`/`dataResidency`.
- A future consumer that wants a capability-level `dataSubjectCategory`/
  `recipientCategories` default, or inventory-level resolution for any of
  the three new fields, is a new, separately-justified decision -- not
  something this ADR forecloses, only something it declines to add
  speculatively.

## Alternatives considered

- **Derive `recipientCategories` from `DependencyEdge`s (the Dependency
  Model's proven consumer relationships).** Rejected -- see Context: a
  proven in-codebase consumer and a GDPR recipient are different kinds of
  fact, and conflating them would misrepresent both (AGENTS.md invariant
  12).
- **Give `dataSubjectCategory`/`recipientCategories` the same
  capability-level counterpart `transferSafeguard`/`dataResidency` have.**
  Rejected for this pass -- see Decision above; no real use case yet needs a
  capability-wide default for either, and both remain addable later without
  breaking anything declared under this ADR.
- **Resolve all three new properties at the `FieldNode` level, matching
  `sensitivity`/`purpose`/`legalBasis`/`dataResidency`/`auditRequired`'s own
  `ResolvedGovernanceValue` treatment.** Rejected -- see Decision above;
  follows ADR 0057's own precedent and scoping discipline instead
  (`retention`/`protections` also stay `docs`-only, resolved only by the one
  real consumer that needs it).
- **Let `recipientCategories` accept a lone string, mirroring
  `dataResidency`.** Rejected -- see Decision above; Art. 30(1)(d)'s own
  "categories" phrasing and the ambiguity a lone string would invite argue
  for an array-only field.
