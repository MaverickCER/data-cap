# 0052: Exact source-position evidence + the five-state field-consumption model

## Status

Accepted, Part 2A implemented (Part 2B -- developer-declared dynamic-access
citations and their lifecycle -- is a separate, additive follow-up, not
required for this ADR's own guarantees to hold). Implemented in
`src/build/source-position.ts` (new), `src/build/dependency-types.ts`/
`dependency-graph.ts`/`dependency-model.ts` (column tracking, field-level
dynamic-access edges), `src/build/parse.ts`/`link.ts`/`inventory.ts`
(declaration positions), `src/build/usage-report.ts` (the five-state
derivation, `FIELD_ACCESS_INDETERMINATE`), `src/build/findings.ts`/
`static-rules.ts`/`exclusive-group.ts`/`finding-model.ts` (`position`/
`indeterminateSites` on findings and their structured location).

## Context

Every fact this package's `build/` pipeline produces should be able to cite
exactly where it comes from -- and "this field looks unused" specifically
needs to distinguish _proven absent_ from _can't tell, dynamic access is in
play_. Two concrete gaps, found by direct inspection before this ADR:

1. **Only line numbers were tracked, never columns**, and three different
   position-shaped shapes were accumulating independently across
   `dependency-graph.ts` (a bare `number`), and nowhere at all in `parse.ts`/
   `finding-model.ts` -- exactly the kind of drift a single canonical type
   prevents if introduced before a second and third shape appear.
2. **Field-level dynamic access was silently dropped, not disclosed.**
   `dependency-graph.ts`'s `readFieldNameAfter()` already returned
   `undefined` for `x.fields[computed]` (a non-string-literal bracket
   access) -- but the two call sites simply produced no edge at all in that
   case, confirmed by the pre-existing test asserting `edges === []`. A
   field this pass genuinely can't name is real, uncertain evidence; folding
   it into silence made every downstream "field X is unconsumed" finding
   quietly overclaim confidence it didn't have. Capability-level dynamic
   access (`x[computed]`) already produced an `"indeterminate"`-resolution
   edge -- the field-level case was the one gap.

## Decision

### One canonical position type, everywhere

```ts
// src/build/source-position.ts
export interface SourcePosition {
  readonly line: number
  readonly column: number
}
export interface SourceLocation extends SourcePosition {
  readonly file: string
}
export function positionOf(sourceFile: ts.SourceFile, node: ts.Node): SourcePosition
```

Both 1-based (matching every editor/IDE convention a human reading a
citation would expect). `positionOf` is the _one_ place a position is ever
computed from a raw AST node -- `dependency-graph.ts` and `parse.ts` both
import it rather than each hand-rolling `getLineAndCharacterOfPosition`
arithmetic, the same "exported for reuse, not duplicated" discipline
`parse.ts`'s own `collectImportBindings` already documents for itself.
`SourcePosition` is used wherever the file is already known from
surrounding structure (`DependencyEdge.position`, alongside its own
`.from`); `SourceLocation` is used wherever it isn't (a finding's
`indeterminateSites`, which can span multiple consuming files).

`DependencyEdge.line: number | undefined` is renamed to
`position: SourcePosition | undefined` -- a real, in-budget breaking change
(pre-1.0, nothing published), not a compatibility shim.

### Field-level dynamic access becomes a real, typed, disclosed edge

`classifyUsage` (`dependency-graph.ts`) now pushes a
`relationship: "reads-field"`, `to.field: undefined`,
`resolution: "indeterminate"` edge when `.fields[computed]` (or
`.getSnapshot().fields[computed]`) can't be resolved to a string-literal
field name -- for both the direct-access and `.getSnapshot()` call shapes.
Capability-level dynamic access (`x[computed]`, already `"indeterminate"`)
is untouched.

### The five-state field-consumption model

Internal to `usage-report.ts`'s `deriveUsageFindings` -- not (yet) promoted
to a standalone exported type, since nothing outside that one function
currently needs to name the intermediate state, only the finding it
produces:

| State                       | Meaning                                                                                                                               | Finding                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| proven                      | a real `reads-field` edge names this field                                                                                            | none                                                                                            |
| unconsumed                  | nothing found, nothing uncertain either                                                                                               | `UNCONSUMED_FIELD` (`warning`) -- message text unchanged from before this ADR                   |
| indeterminate               | a dynamic/computed access exists on this capability (field-level or capability-level) that can't be ruled out as targeting this field | `FIELD_ACCESS_INDETERMINATE` (`info`), carrying `indeterminateSites: readonly SourceLocation[]` |
| declared-dynamic (Part 2B)  | a developer's own citation currently holds                                                                                            | `FIELD_DYNAMIC_ACCESS_DECLARED` (`info`)                                                        |
| stale-declaration (Part 2B) | a citation existed but no longer verifies                                                                                             | `DYNAMIC_ACCESS_CITATION_MISSING`/`STALE` (`warning`)                                           |

**`UNCONSUMED_FIELD` is emitted only for the `"unconsumed"` state, precisely
as defined above** -- never as a catch-all default for any field the
classifier can't otherwise place. A future access pattern
`classifyUsage`/`deriveUsageFindings` doesn't yet fully understand defaults
to `"indeterminate"`, never silently to `"unconsumed"`: an unrecognized
pattern is exactly the kind of situation this evidentiary discipline exists
to protect against papering over (see the negative-guarantees checklist,
below).

Both the capability-level (`x[computed]`) and the new field-level
(`x.fields[computed]`) indeterminate edges count toward the same
`indeterminateSites` list for a field, since neither can name which field
it's about -- either could, for all this pass can tell, be the access that
makes an otherwise-"unconsumed" field actually read.

### Declaration positions, threaded from the earliest authoritative point

`RawCreateDataCall.declarationPosition: SourcePosition` (always populated,
from the call node itself -- `parse.ts`) and
`RawCreateDataCall.fieldPositions: Readonly<Record<string, SourcePosition>>
| undefined` (populated only when `fields` is an inline object literal in
the same file; `undefined`, never guessed at, when it's identifier-resolved
across a file this pass doesn't retain AST access to for its individual
keys). Threaded through `DiscoveredCapability` (`link.ts`) into
`CapabilityNode.declarationPosition` (always present) and
`FieldNode.declarationPosition` (present only when the capability's own
`fieldPositions` was) -- resolved once in `inventory.ts`, consumed
everywhere downstream, the same discipline `owner`/`sensitivity` already
established (ADR 0050).

### `ReportFinding`/`FindingLocation` carry positions through, additively

`ReportFinding` gains `position?: SourcePosition` (populated at each
emission site from the now-available `declarationPosition` -- wired into
`static-rules.ts`, `exclusive-group.ts`, `usage-report.ts`) and
`indeterminateSites?: readonly SourceLocation[]` (populated only for
`FIELD_ACCESS_INDETERMINATE`). `FindingLocation`'s `"capability"`/
`"field"`/`"operation"` variants gain the same optional `position`;
`"consumer"` deliberately doesn't, since it locates a _consuming file_,
which has no single declaration position the way a
capability/field/operation's own declaration does.

`structural-duplication.ts`'s `DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES`
is deliberately **not** wired to `position` in this pass -- out of this
ADR's named scope; nothing prevents adding it later the same way.

## Consequences

- Every `DependencyEdge`, `CapabilityNode`/`FieldNode`, and positional
  `ReportFinding` now carries exact, real `line:column` evidence instead of
  a bare line number or none at all -- the concrete prerequisite
  `examples/enterprise-platform/`'s legal-defense-style evidence report
  (Part 3) needs to cite exactly where every fact it renders comes from.
- The previously-silent `.fields[computed]` gap is now visible: any project
  using this pattern will see new `FIELD_ACCESS_INDETERMINATE` findings
  where it previously saw either an incorrect `UNCONSUMED_FIELD` (if nothing
  else referenced the field) or nothing at all.
- `DependencyEdge.line` → `position` is a breaking rename; `FieldNode`/
  `CapabilityNode` both gained a required `declarationPosition` property --
  both land directly, pre-1.0, per this codebase's own established
  discipline for schema/model changes in this release (ADR 0050/0051).
- No `CAPABILITY_MODEL_SCHEMA_VERSION`/`FINDING_MODEL_SCHEMA_VERSION`/
  `DEPENDENCY_MODEL_SCHEMA_VERSION` bump -- every change here is additive to
  the model shapes' own meaning (a reader ignoring the new fields still
  reads the old facts correctly), matching this codebase's own bump-only-
  on-misinterpretation-risk rule.

## Alternatives considered

- **Keep `DependencyEdge.line` as a bare number and add a parallel
  `column` field.** Rejected -- two independently-optional fields invite
  exactly the kind of shape drift a single `SourcePosition` object prevents;
  a position is one fact, not two.
- **Silently drop `.fields[computed]` as before (status quo).** Rejected --
  the whole point of this ADR is that dynamic access this pass can't
  resolve is evidence of uncertainty, not evidence of absence; dropping it
  is indistinguishable from "definitely never touches this field," which is
  a stronger claim than the AST actually supports.
- **Promote the five-state model to a standalone exported type/constant
  immediately.** Deferred -- nothing outside `usage-report.ts` currently
  needs to name the intermediate state, only the finding codes it produces;
  promoting it prematurely would be exactly the kind of speculative surface
  ADR 0049 already argues against elsewhere in this package.
- **Infer a field's declaration position via a best-effort heuristic when
  `fields` is identifier-resolved** (e.g. searching the imported file for a
  same-named key). Rejected -- this is exactly the kind of guess the
  static-analysis-only invariant (ADR 0002) and this ADR's own negative
  guarantee 3 exist to prevent; an absent position, stated as such, is
  itself correct evidence.
