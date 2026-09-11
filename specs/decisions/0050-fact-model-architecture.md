# 0050: Seven canonical fact models, not fifty-nine reports

## Status

Accepted. This ADR establishes the architecture and shared conventions that
the phases following this record apply incrementally, one additive change at
a time. It documents no code of its own.

## Context

A readiness review of 59 requested report types for `data-cap` (Capability
Inventory Report, Field Ownership Report, Data Flow Report, SARIF Security
Findings Report, Concurrency and Deduplication Report, and so on — the full
list is in the mapping table below) found the same root cause `env-cap`'s own
[ADR 0024](https://github.com/maverickcer/env-cap/blob/main/specs/decisions/0024-fact-model-architecture.md)
diagnosed for its own, differently-shaped report catalog: most requested
reports are different renderings of a small, repeated set of underlying
facts, not 59 independent analyses.

`data-cap` starts this review from a materially better position than
`env-cap` did before its own equivalent exercise. `inventory.ts`'s
`CapabilityInventory` is already the one model every generator reads from,
and already resolves a field's `owner` centrally (its own, falling back to
the capability's). `findings.ts`'s `ReportFinding` already unifies every
static-rule and usage-scan finding behind one shape (`code`/`severity`/
`message` plus optional locators) — `data-cap` never had `env-cap`'s
pre-ADR-0026 problem of four independently-shaped finding families quietly
disagreeing with each other. `ownership.ts`'s `buildOwnershipMatrix` already
itemizes unowned capabilities and fields as real array entries, not a bare
count. `manifest-snapshot.ts`'s `ManifestSnapshot`/`ManifestChangeReport` is
already a versioned, persisted, diffable change-report mechanism. None of
these needed a fix-the-bug-and-build-the-model step the size `env-cap`'s own
Ownership Model phase required.

Two real gaps do exist, both narrow and scoped by this review:

1. **Field sensitivity is resolved inconsistently.** `flow-graph.ts` resolves
   a field's effective sensitivity as `field.docs?.sensitivity ??
capability.sensitivity`; `docs.ts`'s "Sensitivity & protections review"
   table checks only the field's own declared value, silently omitting a
   field that inherits its capability's sensitivity from that table even
   though the data-flow diagram and the `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY`
   finding already treat it as sensitive.
2. **No static presence fact for `processor`/`optimistic`.** The runtime's
   `describe()` (`runtime/capability.ts`) already computes `hasProcessor`/
   `hasOptimistic` per operation, live, but `build/parse.ts` extracts no
   static equivalent — blocking any static Processor Contract Report or
   Optimistic Mutation Report. The check itself doesn't strain
   [ADR 0002](0002-build-tooling-static-analysis-only.md)'s static-analysis-only
   invariant any more than the existing `writes` extraction does: it is a
   presence-only check (does this operation's object literal have a
   `processor`/`optimistic` key at all), never an evaluation of the
   function's body.

## Decision

**Seven canonical, versioned, JSON-serializable fact models become the real
API surface: Capability, Dependency, Ownership, Finding, Change, Runtime
Contract, Evidence.** Every report is a projection over one or more of these
models, built through a single public projection function
(`defineEvidenceProjection()`), never a second, independently computed
source of truth. Facts belong in a model; judgment belongs in a projection,
never inside a model itself — this is why Validator Contract Report,
Executive Data Architecture Report, and a per-operation Cacheability Report
are cut on principle, not deferred (see the mapping table).

`data-cap`'s seven are deliberately not a 1:1 copy of `env-cap`'s seven.
**Runtime Contract Model replaces Lifecycle Model.** `env-cap`'s Lifecycle
Model is built around secret-rotation `expiresAt`, which
[ADR 0049](0049-capability-metadata-vocabulary.md) already explicitly
rejected as inapplicable to ordinary application data — there is no
credential-rotation concept for a `user.email` field. Runtime Contract Model
is a genuinely new concept `env-cap` has no equivalent of, because `env-cap`
has no runtime package at all: it is a versioned, hand-maintained description
of `data-cap`'s own documented execution guarantees (getter stale-discard,
mutator completion-order, subscription transport sharing, coordinator dedup
identity, atomic `fields`+`info` commit, cache/retry contract shapes), each
fact cross-referenced to the ADR that governs it.

**Runtime Contract Model is versioned to the `data-cap` package's own
version, not regenerated per consumer project's discover → link → inventory
run.** Every other model is a projection of one specific consumer's
capability files; this one describes `data-cap` itself and is identical for
every consumer running the same package version. This is a deliberate,
singular deviation from the "every model is per-project" shape the other six
share — a caller composing Evidence Model must treat this one input as
package-scoped, not project-scoped: in particular, Change Model's diffing
stays scoped to the six project-varying models only, since there is no
"previous run" for Runtime Contract Model to diff against the way there is
for the other six.

Two of the seven need no new wrapper file, only a `schemaVersion` field added
in place, because their underlying type was already designed to be the
canonical public model: `CapabilityInventory` (`inventory.ts`) _becomes_
Capability Model; `OwnershipMatrixEntry[]` (`ownership.ts`) is wrapped in a
one-field `OwnershipModel` envelope around the untouched existing
`buildOwnershipMatrix`. Building parallel wrapper types for these two would
duplicate an already-correct, already-public shape rather than close a real
gap.

Conventions every model-adding phase follows, so they don't get re-decided
per phase — ported from `env-cap` ADR 0024, adjusted where `data-cap`'s
starting position differs:

- **New model types are additive wrappers, never in-place rewrites**, except
  where a type was already exported as the intended public model
  (`CapabilityInventory`, `OwnershipMatrixEntry[]`) — there, adding a
  `schemaVersion` field is itself the additive change. Every other existing
  exported type (`ReportFinding`, `DependencyEdge`, `ManifestChangeReport`,
  and so on) stays exactly as it is; each canonical model is a new file that
  maps or aggregates the existing pieces into a versioned shape.
- **`schemaVersion` discipline, one constant per model.** Bumped only when a
  reader could misinterpret the new shape — the same rule
  `MANIFEST_SNAPSHOT_SCHEMA_VERSION`(`manifest-snapshot.ts`) and
  `JSON_SCHEMA_VERSION` (`cli/json.ts`) already document. A purely additive
  field never requires a bump.
- **Provenance is caller-supplied, never ambient-detected.** Evidence
  Model's optional `{commitSha, generatedAt}` argument — `data-cap` never
  shells out to `git` itself, and an omitted callback means omitted fields,
  never a guess.
- **The published JSON Schema generator generalizes to one target per
  model**, rather than staying hardcoded to the single `--json` envelope
  type it covers today. Each model phase adds one entry to that generator's
  `TARGETS` list and one freshness+correctness test pair, instead of
  inventing its own schema-publishing mechanism. `package.json`'s existing
  `"./schema"` export stays byte-identical; a new `"./schema/*"` wildcard
  export covers every future target automatically.
- **Reference projections over a single model are ordinary exported
  functions, not required to route through `defineEvidenceProjection()`.**
  This is a deliberate, narrow relaxation of `env-cap` ADR 0024's literal
  wording: `defineEvidenceProjection()` earns its keep composing more than
  one model or stamping provenance; a Getter Report filtering Capability
  Model alone gains nothing from full Evidence composition and would only
  pay an unnecessary dependency cost. Every projection that _does_ need more
  than one model, or provenance, has no privileged internal path — it is an
  ordinary `defineEvidenceProjection()` call, the same public API a
  consumer would use.
- **Evidence Model composition ships inside the existing `./build` entry
  point, not a new `./evidence` entry**, for this initial build-out. A new
  tsup entry point carries a checked gzip budget (`scripts/check-size.mjs`);
  Evidence Model isn't meaningfully separable from `./build`'s own
  dependency graph, and no concrete need for independent tree-shaking has
  emerged yet. Revisited only if a real bundle-size constraint does.

Sequencing: the two extraction gaps above land first, since Capability Model
wraps them. Capability Model ships together with the JSON Schema generator's
generalization, mirroring `env-cap`'s own precedent (its Contract Model
commit did both at once). Dependency, Ownership, Finding Model have no shape
dependency on each other and may ship in any order once Capability Model
exists. Change Model depends on Dependency Model for blast-radius. Runtime
Contract Model has no dependency on any of the above and may ship at any
point. Evidence Model ships last, since it is the composition of the other
six — built before they're real would just produce an artifact full of
holes.

## Report → model mapping

| #   | Requested report                     | Model                     | Notes                                                                                                                                                                                                                             |
| --- | ------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Capability Inventory Report          | Capability                | direct read                                                                                                                                                                                                                       |
| 2   | Data Contract Report                 | Capability                | direct read                                                                                                                                                                                                                       |
| 3   | Field Inventory Report               | Capability                | `capabilities[].fields`                                                                                                                                                                                                           |
| 4   | Field Ownership Report               | Ownership                 |                                                                                                                                                                                                                                   |
| 5   | Field Mutability Report              | Capability                | `fields[].writtenBy`                                                                                                                                                                                                              |
| 6   | Operation Inventory Report           | Capability                | `capabilities[].{getters,mutators,subscriptions}`                                                                                                                                                                                 |
| 7   | Operation Contract Report            | Capability                |                                                                                                                                                                                                                                   |
| 8   | Getter Report                        | Capability                | `kind`-filtered view, not a separate artifact                                                                                                                                                                                     |
| 9   | Mutator Report                       | Capability                | `kind`-filtered view                                                                                                                                                                                                              |
| 10  | Subscription Report                  | Capability                | `kind`-filtered view                                                                                                                                                                                                              |
| 11  | Data Flow Report                     | Dependency + Capability   | declared endpoints (Capability) × proven consumers (Dependency); `generate-flow.ts` is existing prior art                                                                                                                         |
| 12  | Data Dependency Report               | Dependency                |                                                                                                                                                                                                                                   |
| 13  | Data Ownership Graph                 | Ownership                 | graph-export projection                                                                                                                                                                                                           |
| 14  | Capability Dependency Graph          | Dependency                | graph-export projection                                                                                                                                                                                                           |
| 15  | Operation-to-Field Impact Report     | Dependency                | `byCapability` index                                                                                                                                                                                                              |
| 16  | Field-to-Operation Impact Report     | Dependency                | `consumers` inverse index                                                                                                                                                                                                         |
| 17  | Data Change Impact Report            | Change                    |                                                                                                                                                                                                                                   |
| 18  | Capability Change Impact Report      | Change                    |                                                                                                                                                                                                                                   |
| 19  | Optimistic Mutation Report           | Capability                | needs `hasOptimistic` (this ADR's gap #2)                                                                                                                                                                                         |
| 20  | Concurrency and Deduplication Report | Runtime Contract          | policy fact, ADR 0028                                                                                                                                                                                                             |
| 21  | Subscription Sharing Report          | Runtime Contract          | policy fact, ADR 0026                                                                                                                                                                                                             |
| 22  | Processor Contract Report            | Capability                | needs `hasProcessor` (this ADR's gap #2)                                                                                                                                                                                          |
| 23  | Validator Contract Report            | **cut**                   | `data-cap` has no per-field validator vocabulary (ADR 0039, `helpers/shape.ts`) — nothing to project                                                                                                                              |
| 24  | Data Lifecycle Report                | Change + Runtime Contract | capability active/inactive history → Change; `DataStatus` state machine → Runtime Contract                                                                                                                                        |
| 25  | Data State Model Report              | Runtime Contract          | generated schema over `core/types.ts`                                                                                                                                                                                             |
| 26  | Authoritative State Report           | Runtime Contract          | policy fact, ADR 0021                                                                                                                                                                                                             |
| 27  | Projected State Report               | Runtime Contract          | policy fact, ADR 0021                                                                                                                                                                                                             |
| 28  | Data Error Contract Report           | Runtime Contract          | `DataError` shape                                                                                                                                                                                                                 |
| 29  | Data Freshness Report                | Runtime Contract          | `FieldInfo.fetchedAt`/`updatedAt`/`stale` semantics                                                                                                                                                                               |
| 30  | Cacheability Report                  | **cut** (per-operation)   | `cache.ts` wiring is opaque inside `execute`'s body — no declared vocabulary exists to answer "is this getter cached." The generic "how does the cache module work" question is still answered by Runtime Contract Model (row 31) |
| 31  | Data Cache Contract Report           | Runtime Contract          | `DataCacheOptions`/`DataCache` shape, generic                                                                                                                                                                                     |
| 32  | Retry Contract Report                | Runtime Contract          | `RetryOptions` shape, generic                                                                                                                                                                                                     |
| 33  | Data Integrity Report                | Runtime Contract          | policy statement, never a verification claim                                                                                                                                                                                      |
| 34  | Data Consistency Report              | Runtime Contract          | atomic `fields`+`info` commit, ADR 0008                                                                                                                                                                                           |
| 35  | Data Exposure Report                 | Dependency + Capability   | sensitivity × endpoints × proven consumers                                                                                                                                                                                        |
| 36  | Data Security Findings Report        | Finding                   |                                                                                                                                                                                                                                   |
| 37  | Data Classification Evidence         | Evidence                  |                                                                                                                                                                                                                                   |
| 38  | Data Privacy Evidence                | Evidence                  |                                                                                                                                                                                                                                   |
| 39  | Data Retention Evidence              | Evidence                  |                                                                                                                                                                                                                                   |
| 40  | Data Audit Evidence                  | Evidence                  |                                                                                                                                                                                                                                   |
| 41  | Data Architecture Report             | Evidence                  |                                                                                                                                                                                                                                   |
| 42  | Capability Architecture Report       | Evidence                  |                                                                                                                                                                                                                                   |
| 43  | Data Dependency Graph                | Dependency                | same projection as row 14, different filter grain                                                                                                                                                                                 |
| 44  | Machine-Readable Capability Manifest | Capability                | already built (`generateManifest`/`manifest-snapshot`), now schema-published                                                                                                                                                      |
| 45  | Machine-Readable Data Contract       | Capability                | per-capability JSON slice, same schema                                                                                                                                                                                            |
| 46  | Machine-Readable Assurance Evidence  | Evidence                  | the composed JSON itself                                                                                                                                                                                                          |
| 47  | JSON Schema Artifacts                | _infra_                   | the `TARGETS`-list generalization itself, cross-cutting rather than one model                                                                                                                                                     |
| 48  | SARIF Security Findings Report       | Finding                   | adapter projection, not a new fact source                                                                                                                                                                                         |
| 49  | OpenAPI-Compatible Schema Artifacts  | Capability                | operations projection                                                                                                                                                                                                             |
| 50  | Capability Documentation             | Capability                | already built (`generateDocumentation`)                                                                                                                                                                                           |
| 51  | Data Contract Documentation          | Capability                | already built, per-capability slice                                                                                                                                                                                               |
| 52  | Architecture Decision Evidence       | Evidence                  | citation layer over `specs/decisions/*.md`, mainly via Runtime Contract's `governingAdr`                                                                                                                                          |
| 53  | Data Drift Report                    | Change                    | already built (`diffManifestSnapshots`), now versioned                                                                                                                                                                            |
| 54  | Data Contract Compatibility Report   | Finding                   | `EXCLUSIVE_GROUP_CONFLICT`/`DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES`                                                                                                                                                            |
| 55  | Data Migration Impact Report         | Change                    | blast radius, needs Dependency Model's consumer index                                                                                                                                                                             |
| 56  | Data Governance Report               | Evidence                  | reframed: evidence rollup, never a governance verdict                                                                                                                                                                             |
| 57  | Data Compliance Evidence Report      | Evidence                  | same `evidenceDisclaimer()` posture already used project-wide                                                                                                                                                                     |
| 58  | Data Assurance Report                | Evidence                  |                                                                                                                                                                                                                                   |
| 59  | Executive Data Architecture Report   | **cut**                   | a single headline/grade is an opinion `data-cap` has no basis to assert — the same reasoning `env-cap` ADR 0024 gives for cutting its own Executive Assurance Report                                                              |

## Consequences

- The package's public surface grows by seven new Experimental-tier types
  (two of them additive fields on already-public types, not new files) and
  zero new public entry points in this initial build-out.
- `docs.ts`'s sensitivity-review table gains rows it previously silently
  omitted, as part of Capability Model landing — a real, scoped bug fix
  bundled with the model, not hidden inside it. `static-rules.ts`'s
  per-field sensitivity finding stays keyed to the field's own declared
  value, unchanged — switching it to the resolved value would duplicate the
  capability-level `SENSITIVE_CAPABILITY_MISSING_PROTECTIONS` finding for
  every field on a sensitive capability, which is new noise, not a fix.
- `usage-report.ts`'s and `flow-graph.ts`'s independent ad hoc
  edge-filtering gets replaced by one shared consumer index, as part of
  Dependency Model landing — the same "a fact gets computed once" discipline
  `env-cap` ADR 0024 names as its whole point.
- Runtime Contract Model is the one model, of the seven, versioned to the
  package rather than the consumer project — documented explicitly so a
  future Evidence Model consumer doesn't assume uniform per-project
  provenance across all seven inputs.
- Three requested reports are cut outright (Validator Contract Report,
  per-operation Cacheability Report, Executive Data Architecture Report);
  none are silently dropped — each has a row in the mapping table above and
  an entry in `specs/generated-artifacts.md`'s "Explicitly deferred, with
  reasons" table.
- This is sized closer to `data-cap`'s original build-out than to a
  consistency pass, but starts from six of the seven models already having
  real code to extend rather than four independently-shaped predecessors to
  merge — the `env-cap` equivalent of this review had a materially larger
  gap to close. It lands as a sequence of independently-mergeable,
  independently-`npm run verify`-clean phases, each with its own changeset.

## Alternatives considered

- **Ship the 59 requested reports as independent renderers, one at a time.**
  Rejected — the same reasoning `env-cap` ADR 0024 already gives, now at
  roughly double the scale relative to the number of underlying facts that
  actually exist.
- **Copy `env-cap`'s seven models verbatim, including Lifecycle Model.**
  Rejected — ADR 0049 already rejected the `expiresAt` concept Lifecycle
  Model is built around for ordinary application data; forcing it in would
  misrepresent what the model means.
- **Build Capability Model and Ownership Model as new wrapper files,
  matching `env-cap`'s file-per-model structure exactly.** Rejected for
  these two specifically — their underlying types are already public and
  already designed to be the canonical model; a wrapper file would
  duplicate an existing, correct type instead of closing a real gap.
- **Route every reference projection through `defineEvidenceProjection()`
  uniformly, matching `env-cap` ADR 0024's literal wording.** Rejected for
  single-model filters — forcing full Evidence composition onto a Getter
  Report gains nothing and adds a dependency (all seven models available) a
  one-model filter doesn't need.
- **Land this as one large release once everything is ready.** Rejected —
  a single merge of this size would be effectively unreviewable and would
  leave the package in a broken intermediate state for the duration of the
  work. Additive, independently verifiable phases were chosen specifically
  to avoid that, the same reasoning `env-cap` ADR 0024 gives.
