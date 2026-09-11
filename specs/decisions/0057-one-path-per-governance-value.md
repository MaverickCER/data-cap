# 0057: One path per governance value -- `CapabilityNode` consolidates to `docs`; `FieldNode` gets a resolved-value-plus-provenance shape

## Status

Accepted, implemented in `src/build/inventory.ts` and every consumer of the six
governance properties (`owner`/`sensitivity`/`purpose`/`legalBasis`/`dataResidency`/
`auditRequired`) on `CapabilityNode`/`FieldNode`: `static-rules.ts`, `docs.ts`,
`flow-graph.ts`, `evidence-projections.ts`, `ownership.ts`, `manifest-snapshot.ts`.

## Context

Both `CapabilityNode` and `FieldNode` (`inventory.ts`) carry a `docs` object (the raw,
author-declared documentation, verbatim) _and_ a parallel set of top-level properties
for the same six names -- `owner`, `sensitivity`, `purpose`, `legalBasis`,
`dataResidency`, `auditRequired` -- each documented as "resolved." Raised directly: a
reviewer should never have to know two different objects exist and guess which one to
trust for "what is this field's sensitivity" -- there should be one path to the full
answer.

Before deciding how to consolidate, every real consumer of these twelve properties
(six on each type) was mapped, since the fix has to fit what's actually load-bearing,
not just what looks cleaner:

**`CapabilityNode`'s six top-level properties are pure duplication.** A capability has
nothing above it to resolve against, so `capability.sensitivity` is always exactly
`capability.docs?.sensitivity` -- confirmed by `inventory.ts`'s own doc comments
("Resolved: `docs.sensitivity`, if declared" -- no further fallback source named).
Every consumer (`static-rules.ts`'s `checkCapabilityOwnership`/
`checkCapabilitySensitivity`/`checkCapabilityAuditRequired`, `docs.ts`'s capability
summary and sensitivity-review sections, `evidence-projections.ts`,
`manifest-snapshot.ts`, `ownership.ts`) reads the bare top-level property and would get
an identical result reading `docs?.X` instead. This is safe, mechanical consolidation
with zero information loss.

**`FieldNode`'s six top-level properties are not duplication -- they resolve real
inheritance** ("the field's own `docs.X`, else the capability's `X`"), and both the
own-declared value (`docs.X`) and the resolved value (bare `X`) have real, distinct,
currently-in-use consumers:

- `static-rules.ts`'s `checkFieldSensitivity`/`checkFieldGovernance` (lines ~64, ~121)
  deliberately read the field's _own_ `docs.sensitivity`, never the resolved value --
  specifically to avoid double-firing a finding already raised at the capability
  level (documented in that file's own comment).
- `static-rules.ts`'s `checkFieldGovernance` (lines ~123, ~131, ~140) reads the
  _resolved_ `purpose`/`legalBasis`/`auditRequired` for the opposite reason: "a
  capability-level declaration legitimately covers every field under it," so the
  presence check has to see the inherited value.
- `docs.ts`, `flow-graph.ts`, `evidence-projections.ts`, `ownership.ts` all read the
  resolved value -- a field's _effective_ sensitivity/owner is what a security/
  ownership/evidence report needs, not merely what it happens to declare locally.

So the fix cannot be "delete one of the two" for `FieldNode` the way it can for
`CapabilityNode` -- both concepts (declared, resolved) are real and both are used
today. **The actual problem is that they live at two differently-shaped, differently-
discoverable locations** (a bare top-level property vs. a nested `docs` object,
documented only in a doc comment a reader has to already know to look for) -- not that
two concepts exist.

**A concrete bug, found during this mapping, confirms the current shape actively
causes mistakes, not just theoretical confusion:** `docs.ts`'s Fields table (~line 128) renders a field's "Sensitivity (declared)" column from `field.docs?.sensitivity`
(own-only) -- so a field that inherits its capability's sensitivity with no override
of its own renders **blank** in that table. The Sensitivity & Protections Review
section, a few dozen lines later in the same file, renders the same idea from
`field.sensitivity` (resolved) and gets it right -- confirmed by this file's own
existing regression test ("includes a field that inherits capability-level sensitivity
... ADR 0050 regression"), which only covers the review section, never the Fields
table. Two renderers in the same file disagree about which of a field's two
sensitivity-shaped properties means "the sensitivity," because the type itself doesn't
say.

## Decision

### `CapabilityNode`: consolidate to `docs`

The six top-level properties (`owner`, `sensitivity`, `purpose`, `legalBasis`,
`dataResidency`, `auditRequired`) are removed from `CapabilityNode`. `docs` (typed
`LooseCapabilityDocs | undefined`, unchanged) becomes the single path. Every consumer
listed above switches from `capability.X` to `capability.docs?.X`.

### `FieldNode`: one path per value, carrying both the resolved value and its provenance

```ts
export interface ResolvedGovernanceValue<T> {
  /** The effective value: the field's own declaration, else the capability's. */
  readonly value: T | undefined
  /** Where `value` came from -- `undefined` when neither declared it. */
  readonly declaredOn: "field" | "capability" | undefined
}

export interface FieldNode {
  // ...
  readonly owner: ResolvedGovernanceValue<string>
  readonly sensitivity: ResolvedGovernanceValue<string>
  readonly purpose: ResolvedGovernanceValue<string>
  readonly legalBasis: ResolvedGovernanceValue<string>
  readonly dataResidency: ResolvedGovernanceValue<string | readonly string[]>
  readonly auditRequired: ResolvedGovernanceValue<boolean>
  readonly docs: FieldDocs | undefined // unchanged -- description/protections/retention/metadata still live only here, since they have no resolution concept to fold in
}
```

One path (`field.sensitivity`) now answers both questions a consumer might have: `.value`
for the effective value (what `docs.ts`/`flow-graph.ts`/`evidence-projections.ts`/
`ownership.ts` already want), `.declaredOn` for provenance (what
`static-rules.ts`'s dedup logic needs -- `declaredOn === "field"` replaces its old
`field.docs?.sensitivity !== undefined` check, and reads slightly more directly:
"was this declared here," not "does the docs object happen to have this key"). This is
the same information the two-location shape already carried, restructured so a reader
finds all of it in one place instead of needing to know a second object exists and
check it too.

`field.docs` keeps its full, unchanged `FieldDocs` shape (the verbatim author
declaration `documentData()` captured) -- `description`/`protections`/`retention`/
`metadata` have no resolution concept and were never part of this problem (confirmed
in the mapping above: no consumer reads a resolved counterpart for any of them). By
convention, a consumer of `FieldNode` should no longer read
`docs?.owner`/`sensitivity`/`purpose`/`legalBasis`/`dataResidency`/`auditRequired`
directly -- `field.X.value`/`field.X.declaredOn` is the one sanctioned path for all
twelve pieces of information those six properties used to split across two places.

### `CapabilityNode` gets no equivalent `ResolvedGovernanceValue` wrapper

Considered and rejected for symmetry's own sake: a capability's own `declaredOn` would
always trivially be `"capability"` or `undefined` (nothing to resolve against), adding
a wrapper object with no real second state to distinguish. Matching `FieldNode`'s
shape here would be uniformity for its own sake, not because capability-level
governance data has the same two-locations problem field-level data does -- it never
did.

### Schema and version

`CAPABILITY_MODEL_SCHEMA_VERSION` bumps from 1 to 2 -- an existing reader of
`CapabilityNode.owner` (etc.) or `FieldNode.sensitivity` (etc., previously a bare
value, now `{value, declaredOn}`) would otherwise silently misread the new shape.
`schemas/capability-model.schema.json` and `schemas/evidence-model.schema.json`
regenerate accordingly.

## Consequences

- `docs.ts`'s Fields table bug (own-only sensitivity, silently blank on inheritance)
  is fixed as a direct consequence of the shape change, not a separate patch --
  `field.sensitivity.value` is what the table reads once the migration lands, so it's
  no longer possible for it to disagree with the Sensitivity & Protections Review
  section about which value "sensitivity" means.
- `static-rules.ts`'s dedup-avoidance logic gets slightly more direct
  (`field.sensitivity.declaredOn === "field"` instead of reaching into `.docs`), and
  its own-vs-resolved distinction is now visible in the type itself, not only in a
  comment explaining why the file reads one specific property and not its neighbor.
- Every consumer of the six `FieldNode` properties (`static-rules.ts`, `docs.ts`,
  `flow-graph.ts`, `evidence-projections.ts`, `ownership.ts`) changes from reading a
  bare value to reading `.value`, a small, mechanical migration at each site, fully
  enumerated by the mapping above -- no call site was missed by inventing a new one
  after the fact.
- `test/build/inventory.test.ts` and every test fixture across the suite that
  constructs a `CapabilityNode`/`FieldNode` by hand updates to the new shape.

## Alternatives considered

- **Leave `FieldNode` as two separate locations, only improve documentation.**
  Rejected -- the `docs.ts` Fields-table bug is direct evidence that documentation
  alone doesn't prevent a maintainer from reaching for the wrong one of two
  identically-purposed-looking properties.
- **`FieldNode` Option A (flat): keep `field.sensitivity` as the bare resolved value,
  add a sibling `field.sensitivitySource`.** Considered, and structurally similar to
  the shape adopted -- rejected specifically because it still leaves two independently
  addressable top-level properties per concept (`sensitivity` and
  `sensitivitySource`), rather than one path (`field.sensitivity`) that contains both
  pieces of the same fact. The one-path framing was the specific thing raised, and the
  `{value, declaredOn}` shape satisfies it more literally.
- **Remove `docs.X` from `FieldDocs` entirely, keep only the resolved shape.**
  Rejected -- `FieldDocs` is the authoring-time input shape a developer's own
  `documentData()` call declares; a field genuinely needs to state its own value
  there, independent of how the inventory later reports the resolved result.
  `FieldNode.docs` continuing to exist, unchanged, is what makes "what did this field's
  own `documentData()` call actually say" answerable at all -- consolidation applies to
  which path a _consumer of `FieldNode`_ uses, not to removing the authoring API.
- **Wrap `CapabilityNode`'s six properties in `ResolvedGovernanceValue` too, for
  uniformity with `FieldNode`.** Rejected -- see "gets no equivalent wrapper" above.
