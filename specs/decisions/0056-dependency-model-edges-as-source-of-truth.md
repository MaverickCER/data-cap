# 0056: `edges` becomes Dependency Model's only stored fact; `byCapability`/`consumers` become on-demand projections

## Status

Accepted, implemented in `src/build/dependency-model.ts`, `src/build/dependency-projections.ts`
(new), and every consumer of the two removed fields (`flow-graph.ts`, `usage-report.ts`,
`graph-export.ts`, `change-model.ts`, `examples/enterprise-platform/reports/litigation-evidence.ts`).

## Context

`DependencyModel` (ADR 0050) currently stores three fields: `edges` (every proven
`DependencyEdge`, unindexed), `byCapability` (the same edges grouped by the capability
each targets), and `consumers` (the same edges grouped by the file each originates
from -- the inverse). `buildDependencyModel` builds all three eagerly, on every run,
and all three are serialized into `--evidence`/`--json`/`data.evidence.json`.

A review of this shape, prompted by a broader pass over the package's generated-output
readability, raised the concern that storing the same facts three times inside one
canonical, serialized model works against ADR 0050's own stated principle ("facts
belong in a model; judgment belongs in a projection, never inside a model itself") and
against the precedent `inventory-projections.ts` already establishes elsewhere in this
package: `projectGetters`/`projectFields`/etc. are plain, on-demand functions over
`CapabilityInventory`, never fields stored on the model itself.

A first pass at a fix (replace the two grouped fields with index/ID references into
`edges`) was reconsidered before landing, on the grounds that redundancy in an
evidence model can be a deliberate, self-contained-views tradeoff, and shouldn't be
"optimized away" without first establishing (a) that the duplication is a real,
measured cost, and (b) whether the grouped views are meant to be facts a consumer
receives without further computation, or projections computable on demand. Both
questions were investigated directly against this codebase before deciding:

**The duplication is a JSON-serialization cost only, not an in-memory one.**
`buildDependencyModel` pushes the _same_ `DependencyEdge` object reference into
`edges`, the `byCapability`-building map, and the `consumers`-building map -- nothing
is cloned. In memory, the "three copies" are three arrays of pointers to the same
objects, not three copies of the objects themselves. The cost is paid only once JSON
serialization walks the structure (`JSON.stringify` has no way to represent a shared
reference, so it re-emits each edge's full text at every place it appears), i.e.
specifically for `--evidence`/`--json`/`docs/data.evidence.json`.

**That serialization cost is real and measurable.** Across the three committed
flagship examples (`application`, `team-service`, `enterprise-platform`; 11-18 edges
each), `byCapability` + `consumers` together account for 67-69% of the serialized
`DependencyModel`'s raw byte size, and `DependencyModel` itself is 24-34% of the whole
`data.evidence.json` at this small scale -- a share that grows with edge count
(`DependencyModel` scales roughly `O(3 × edge count)`; `CapabilityModel` does not).
Gzip collapses the raw difference dramatically (a single flagship's `DependencyModel`
compresses from ~15KB to ~550 bytes, since the repeated structure is exactly what
gzip is good at), so this is not a meaningful network-transfer cost -- the actual cost
is to a human or LLM opening the raw, uncompressed file directly, which is the
original readability concern this pass traces back to. This measurement is recorded
as supporting evidence for the decision below, not as its gate -- the architectural
direction was already established by the reference-sharing finding and the
`inventory-projections.ts` precedent, independent of the exact byte counts.

**`byCapability` and `consumers` are not symmetric in demonstrated need**, which
matters for what replaces them:

- `byCapability` has real, multiple consumers today: `flow-graph.ts`,
  `usage-report.ts` (two call sites), `graph-export.ts`, `change-model.ts` -- and,
  critically, `examples/enterprise-platform/reports/litigation-evidence.ts:221`
  (`evidence.dependency?.byCapability.flatMap((c) => c.edges)`), imported from
  `@maverickcer/data-cap/build` (the real published entry point, resolved through
  `package.json`'s `"file:../.."` dependency and the built `dist/`), never an internal
  `src/` path -- confirming this is a genuine public-API-consumption example, not a
  test-only shortcut. Removing `byCapability` without a replacement would be a
  confirmed breaking change to a demonstrated use case.
- `consumers` (the file->edges inverse) has **zero** production readers anywhere,
  internal or example -- only its own unit test (`test/build/dependency-model.test.ts`)
  exercises it. It does, however, have a different, weaker-but-real kind of
  justification: ADR 0050's own report-mapping table names it directly (row 16, "Field-
  to-Operation Impact Report"), the same way it names `byCapability` (row 15,
  "Operation-to-Field Impact Report"). Its justification is _recorded intent_, not
  _demonstrated use_ -- a real distinction from `byCapability`'s, stated here rather
  than presenting both as equally proven.

## Decision

### `DependencyModel` shrinks to its own canonical fact

```ts
export interface DependencyModel {
  readonly schemaVersion: typeof DEPENDENCY_MODEL_SCHEMA_VERSION
  readonly edges: readonly DependencyEdge[]
}
```

`edges` is the canonical serialized dependency fact set -- phrased that way, not "the
one serialized fact," so `schemaVersion` and any genuinely new, non-derived fact this
model might gain later aren't implied to be structurally excluded by this ADR.
`byCapability`/`consumers` are removed from the stored, serialized shape entirely.

### Both groupings are kept, as two sibling on-demand projection functions

```ts
// src/build/dependency-projections.ts
export function groupEdgesByCapability(
  capabilities: readonly { readonly file: string; readonly exportName: string }[],
  edges: readonly DependencyEdge[],
): readonly DependencyModelCapabilityEdges[]

export function groupEdgesByConsumer(
  edges: readonly DependencyEdge[],
): readonly DependencyModelConsumer[]
```

Exported from `src/build/index.ts` alongside `inventory-projections.ts`'s existing
single-purpose exports, whose established pattern this matches exactly: one canonical
fact, several named, on-demand views over it, none of them stored redundantly inside
the fact itself. This is not "ship a family of `groupEdgesBy*` for whatever grouping a
developer might conceivably want" -- that would reproduce the same sprawl ADR 0050
collapsed 59 requested reports to avoid. The bar applied here is narrower and concrete:
**ship exactly the groupings this project's own planning already claims to want**, per
ADR 0050's report-mapping table rows 15/16, and no others. A grouping by
`relationship`, by `resolution`, by `field`, or by `operation` is easy to imagine and
is explicitly deferred, matching the same "don't build it until something equally
concrete justifies it" discipline ADR 0049/0052 already established for this package
(most directly: ADR 0052 declining to promote its own five-state consumption model to
a standalone export "since nothing outside `usage-report.ts` currently needs to name
the intermediate state").

`groupEdgesByCapability` takes `capabilities` as well as `edges` -- unlike
`groupEdgesByConsumer`, which needs only `edges` -- because `usage-report.ts`'s
`ABANDONED_CAPABILITY` finding depends on the grouping including every capability in
the inventory _even when it has zero edges_, a fact `edges` alone can never produce
(a capability with no edges at all cannot be discovered by iterating edges). Both
functions still take `edges` directly, never a `DependencyModel` -- neither requires
the model to already exist to compute part of itself, and both remain independently
callable by any consumer, internal or external, exactly the ergonomics
`litigation-evidence.ts` already relies on today.

`buildDependencyModel`'s own internal grouping logic (previously duplicated inline for
`byCapability` and `consumers`) is factored into these two functions directly, so the
model builder becomes a thin wrapper: `{schemaVersion, edges}`. Every current internal
consumer of the removed fields calls the appropriate projection function instead of
reading a stored field; `litigation-evidence.ts` updates its one call site the same
way.

### Positional integer indices are rejected outright

An index/ID-reference design (`byCapability: {capability, edgeIndices: number[]}[]`)
was considered and rejected before this decision, not merely as an alternative to
mention: reordering or removing an entry from `edges` would silently invalidate every
index reference; a standalone `byCapability` entry would no longer be self-describing
without also holding a reference to `edges`; and every consumer -- internal and
external -- would need new dereferencing logic it doesn't need today. Since the actual
cost is JSON-serialization size, and the projection-function design eliminates that
cost at the source (nothing is serialized twice) without introducing any indirection
for any consumer, indices solve a narrower problem at a real ergonomic cost the
projection-function design doesn't pay.

### Schema and version

`DEPENDENCY_MODEL_SCHEMA_VERSION` bumps from 1 to 2 -- an existing reader of
`byCapability`/`consumers` would otherwise silently misinterpret the new shape (both
fields simply absent, not merely renamed), the same bump-only-on-misinterpretation-risk
rule `CAPABILITY_MODEL_SCHEMA_VERSION`/`MANIFEST_SNAPSHOT_SCHEMA_VERSION` already
document. `schemas/dependency-model.schema.json` and `schemas/evidence-model.schema.json`
regenerate accordingly.

## Consequences

- `data.evidence.json` shrinks by roughly the `byCapability`+`consumers` share measured
  above (~2/3 of what `DependencyModel` previously contributed) on every project this
  package runs against, growing more valuable as a project's own edge count grows.
- `src/build/dependency-projections.ts` is a new file and a new pair of public exports
  under `./build` (Experimental tier per `VERSIONING.md` -- shape may still change in a
  minor/patch release without a semver violation, which is part of why shipping both
  functions now, ahead of a second demonstrated consumer of `groupEdgesByConsumer`
  specifically, is a reasonable bet rather than premature).
- Every internal consumer of `DependencyModel.byCapability`/`.consumers`
  (`flow-graph.ts`, `usage-report.ts`, `graph-export.ts`, `change-model.ts`) and the
  one external-style consumer (`litigation-evidence.ts`) is updated to call the
  projection functions directly; none change their own rendered output.
- `test/build/dependency-model.test.ts`'s `byCapability`/`consumers` assertions move to
  a new `test/build/dependency-projections.test.ts`, asserting the same behavior
  against the extracted functions directly.
- A projection correctness test is added: `groupEdgesByCapability`/`groupEdgesByConsumer`
  computed fresh must reconstruct the exact same relationships the old stored fields
  would have -- not merely "goldens still match," which could pass while silently
  dropping a relationship no committed example happens to exercise.

## Alternatives considered

- **Do nothing.** Rejected once the measurement above confirmed the duplication is
  real and growing with project size, and once the `inventory-projections.ts`
  precedent made clear this package already has a non-breaking pattern for exactly
  this situation.
- **Index/ID references (`edgeIndices`/`edgeIds`).** Rejected -- see "Positional
  integer indices are rejected outright" above; a semantic `edgeIds` design specifically
  was also considered and rejected for the same underlying reason: it still requires
  every consumer to dereference, for no benefit the projection-function design doesn't
  already provide without that cost.
- **Keep `byCapability`/`consumers` as stored fields, only document the duplication as
  intentional.** Rejected -- documenting a cost doesn't remove it, and the
  `inventory-projections.ts` precedent shows this package already has a way to avoid
  paying it at all.
- **Cut `groupEdgesByConsumer` entirely, ship only `groupEdgesByCapability`.**
  Considered, given `consumers` has zero demonstrated production readers today.
  Rejected -- ADR 0050's own report-mapping table already named the Field-to-Operation
  Impact Report this grouping serves; cutting it now would mean re-deciding the same
  question ADR 0050 already settled, on no new information. Revisiting it later, if it
  turns out truly unwanted, costs nothing beyond a further Experimental-tier change.
