# 0051: `documentData()` metadata widening + purpose/legalBasis/dataResidency/auditRequired

## Status

Accepted. Implemented in `src/core/document.ts` (`CapabilityDocs`/
`FieldDocs`/`OperationDocs`), `src/build/parse.ts` (`readMetadataProp`,
`readDataResidencyProp`, and their wiring into `extractCapabilityDocs`/
`extractFieldDocsMap`/`extractOperationDocsMap`), `src/build/inventory.ts`
(`FieldNode`/`CapabilityNode`'s resolved `purpose`/`legalBasis`/
`dataResidency`/`auditRequired`), and `src/build/static-rules.ts`
(`SENSITIVE_FIELD_MISSING_PURPOSE`, `SENSITIVE_FIELD_MISSING_LEGAL_BASIS`,
`AUDIT_REQUIRED_WITHOUT_OWNER`).

## Context

Producing an evidence report substantial enough to support a legal-defense-
style review (the motivating case: `examples/enterprise-platform/`'s
generated report over a matter/case-tracking service) needs more than
ADR 0049's original vocabulary. Three concrete gaps, surfaced while
designing that report:

1. **`metadata` was `Record<string, string>` at the capability level only,
   and didn't exist at all on `FieldDocs`/`OperationDocs`.** A reviewer
   documenting genuinely arbitrary organization-specific detail (an
   internal classification code, a policy ID, a boolean flag) had nowhere
   to put it below the capability level, and even at the capability level
   was artificially restricted to string values.
2. **No declared "why does this data exist" or "what legal basis applies"
   vocabulary existed at all.** `specs/generated-artifacts.md`'s deferred-
   artifacts table cited exactly this gap as the reason a Privacy Data
   Map/Data Processing Register couldn't be built.
3. **No declared storage-jurisdiction or audit-requirement vocabulary
   existed.** Both come up directly in a legal-defense framing (where is
   this data allowed to live; does accessing it need an audit trail) and
   neither fits inside `sensitivity`/`protections`/`retention`'s existing
   meanings without overloading them.

This ADR also formalizes a boundary that was implicit before but needed to
be explicit once `metadata` became genuinely open-ended at every level: the
line between "a concept data-cap itself understands" (a named field) and
"organization-specific detail data-cap has no opinion about" (`metadata`).

## Decision

### `metadata` widened and unified across all three levels

`CapabilityDocs.metadata`, and new `FieldDocs.metadata`/
`OperationDocs.metadata`, are all `Readonly<Record<string, unknown>>` —
genuinely arbitrary values (nested objects, numbers, booleans, arrays), not
just strings. `FieldDocs`' old open index signature
(`readonly [key: string]: string | boolean | undefined`) is **removed** in
favor of the explicit `metadata` field — a field's extension point is now
exactly one place, not two competing ones. `OperationDocs`' own index
signature (`readonly [key: string]: unknown`) is left in place (pre-dates
this ADR, already permissive); `metadata` is the recommended place for new
extension data on an operation going forward, not a hard replacement.

**The metadata boundary rule, stated explicitly**: a named, first-class
property on `CapabilityDocs`/`FieldDocs`/`OperationDocs` is reserved for a
concept `data-cap` itself understands, projects, or reports on.
Organization-specific detail with no `data-cap`-defined meaning belongs in
`metadata`, never as a new ad hoc property. This is what keeps the
vocabulary bounded instead of accreting one-off keys over time — exactly
the discipline that motivated promoting `purpose`/`legalBasis`/
`dataResidency`/`auditRequired` out of what would otherwise have been
`metadata: { purpose: ... }` convention-only entries.

**No code path anywhere inspects, validates, or branches on a `metadata`
key or value.** It is opaque input, forever — never opaque-until-someone-
adds-a-special-case. A generator may render `metadata`'s presence and raw
contents; it may never interpret them.

### Four new fields, capability + field level, same fallback resolution as `sensitivity`

| Field           | Type                          | Precise meaning                                                                                                                                                         | Epistemic status                                                                                         |
| --------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `purpose`       | `string`                      | The declared reason this data is collected/retained.                                                                                                                    | declared only — never verified against actual usage                                                      |
| `legalBasis`    | `string`                      | The declared legal basis asserted for processing (e.g. `"consent"`, `"contract"`, `"legitimate interest"`).                                                             | declared only — records _that_ a basis was declared, never that `data-cap` determined it's legally valid |
| `dataResidency` | `string \| readonly string[]` | The declared jurisdiction(s) this data is permitted/expected to be **stored** in — a policy constraint, not an observed fact, processing location, or subject location. | declared only                                                                                            |
| `auditRequired` | `boolean`                     | Whether access to this data is documented as requiring an audit trail.                                                                                                  | declared only — same presence-only discipline as `protections`/`retention`                               |

A field's own value overrides the capability's for that field specifically,
identically to how `owner`/`sensitivity` already resolve
(`src/build/inventory.ts`'s `buildFieldNodes`) — `FieldNode`/`CapabilityNode`
both carry the already-resolved value, so every downstream consumer (a
report, a projection) reads one resolved fact per field, never re-derives
the fallback itself.

**`dataResidency`'s meaning is deliberately narrow.** "Residency" could
mean several different, real things: where data is stored, where
processing occurs, where the data subject is located, where the processor
is located, which jurisdictions are permitted, or where data is actually
observed to reside. This field means exactly one of those — the declared
permitted/expected **storage** jurisdiction(s) — and no other. A future
concrete need for one of the other meanings gets its own separately-named
field then, never silently folded into this one.

**The general principle every one of these four fields is an instance of,
stated as its own standalone rule**: `data-cap` records declared governance
facts; it does not determine whether those facts satisfy a law. This matters
enough to state independently of any single field's own doc comment,
because a report built from this vocabulary (see `examples/
enterprise-platform/`) can read as more authoritative than it is if the
boundary isn't stated everywhere it could be misread — a declared
`legalBasis: "consent"` is a record that someone asserted consent as the
basis, never a determination that consent was validly obtained, is current,
or would hold up under review.

### Three new findings, mirroring `SENSITIVE_FIELD_MISSING_PROTECTIONS`'s presence-only discipline

- **`SENSITIVE_FIELD_MISSING_PURPOSE`** / **`SENSITIVE_FIELD_MISSING_LEGAL_BASIS`**
  (`warning`) — a field whose own declared `sensitivity` is set (the same
  trigger `SENSITIVE_FIELD_MISSING_PROTECTIONS` uses, for the same dedup-
  avoidance reason: a capability-level sensitivity gap is already reported
  once, at that level) but whose **resolved** `purpose`/`legalBasis` is
  absent even after the capability-level fallback. A capability-level
  declaration legitimately covers every field under it — this only fires
  when nothing resolves at all.
- **`AUDIT_REQUIRED_WITHOUT_OWNER`** (`warning`) — checked at both levels
  independently, under one shared code (the same one-code-two-levels
  pattern `NONSTANDARD_SENSITIVITY_LEVEL` already uses): a capability or
  field whose **resolved** `auditRequired` is `true` but whose **resolved**
  `owner` is absent — an audit trail with nobody accountable for it is a
  real gap, not a style nitpick.

None of the three ever claims a declared value is _adequate_ — only that
one is _missing_, the same presence-only ceiling every governance finding
in this codebase respects (ADR 0049).

## Consequences

- `FieldDocs`, `CapabilityDocs`, and every hand-built `FieldNode`/
  `CapabilityNode` test fixture across `build/` gained four new resolved
  properties — a real, mechanical (not semantic) update across ~24 test
  files, all additive, no schema-version bump (`CAPABILITY_MODEL_SCHEMA_VERSION`
  stays `1`; per this codebase's own discipline, a version bump is for a
  shape a reader could misinterpret, never a purely additive field).
- `FieldDocs` callers relying on its old open index signature for an
  arbitrary key (e.g. `fieldDocs.someCustomKey`) must move that value into
  `fieldDocs.metadata.someCustomKey` — a real, in-budget breaking change
  (package version `0.1.0`, nothing published yet).
- The Privacy Data Map / Data Processing Register rows in
  `specs/generated-artifacts.md`'s deferred table no longer cite a missing
  metadata dimension as their reason for deferral — the fields now exist;
  what's still deferred is a dedicated renderer, buildable today by a
  consumer projecting `purpose`/`legalBasis` off Capability Model directly.
- `examples/enterprise-platform/`'s legal-defense-style evidence report
  (Part 3 of this session's plan) is the first real consumer of this
  vocabulary end to end.

## Alternatives considered

- **Fold `purpose`/`legalBasis`/`dataResidency`/`auditRequired` into
  `metadata` as a documented convention, instead of promoting them to named
  fields (Option 1).** Rejected as the primary path — these four concepts
  are exactly what a legal-defense-style evidence report needs to resolve,
  check for presence, and render with precise, individually-documented
  semantics; leaving them in `metadata` would mean no `SENSITIVE_FIELD_
MISSING_PURPOSE`-class finding could exist, and no fallback-resolution
  guarantee either. `metadata` remains correct for genuinely
  organization-specific detail `data-cap` has no reason to understand.
- **A fuller compliance vocabulary in this pass** (`dataSubjectRights`,
  `thirdPartyRecipients`, `crossBorderTransfer`, `consentRequired`).
  Rejected for now — goes further than any current consuming use case
  needs; easy to add later behind the same fallback-resolution pattern
  once a concrete report actually needs one.
- **A single, generic `dataResidency` meaning covering storage location,
  processing location, and subject location all at once.** Rejected — see
  "Decision" above; collapsing genuinely distinct claims into one field
  would make every reader of a generated report guess which claim is
  actually being made.
