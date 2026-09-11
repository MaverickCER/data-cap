# 0054: `EvidenceModel` becomes the orchestrator's own backbone, via a new `--evidence` artifact

## Status

Accepted, implemented in `src/build/generate-data-artifacts.ts` (`computeDataArtifacts`
now composes the full canonical model stack every run), `src/cli/index.ts`
(new `--evidence <path>` flag), and `examples/{application,team-service,
enterprise-platform}` (all three now commit `docs/data.evidence.json`;
`enterprise-platform/reports/{litigation-evidence,audit-prep}.ts` rewritten
to call `computeDataArtifacts()` directly instead of re-implementing its
pipeline).

## Context

ADR 0050 introduced `EvidenceModel` as "the composition of the other six
canonical models into one provenance-stamped artifact... every reference
projection reads this, never a second, independently-assembled source." That
claim was true for the reference projections in `evidence-projections.ts`,
but false for the CLI itself: `computeDataArtifacts` (the function both
`generateDataArtifacts` and `checkArtifacts` share, and the one the `data-cap`
CLI is a thin wrapper around) built a `CapabilityInventory` and threaded it
manually into `generateManifest`/`generateUsage`/`generateDocumentation`/
`generateFlow` independently. `buildDependencyModel`, `buildOwnershipModel`,
`buildFindingModel`, `buildChangeModel`, and `buildEvidenceModel` itself were
never called anywhere in `src/build/generate-data-artifacts.ts` or
`src/cli/*.ts` -- fully built, fully tested, JSON-schema-published
(`schemas/evidence-model.schema.json` etc.), but orphaned from the actual
product surface. The only place `buildEvidenceModel` was ever called at all
was inside `examples/enterprise-platform/reports/*.ts`, which re-implemented
the entire discover -> link -> inventory -> scan -> findings -> models
pipeline by hand (~40 duplicated lines per file) just to obtain an
`EvidenceModel` `computeDataArtifacts` could have handed it directly.

Raised directly by a user reviewing the generated docs: "I almost want to
create DATA.md and OWNERSHIP using the evidence function to show that
everything comes from a single source of truth," and "I am still not seeing
how this package ... can hold its own through an audit or legal issue." Both
concerns trace to the same root cause -- `EvidenceModel` existed but wasn't
actually the thing anything in the shipped product was built from.

A related, narrower ask from the same conversation -- letting the tool assert
strong confidence that an unconsumed field is truly dead code, based on "AST
found nothing and no `dynamicAccess` citation exists" -- was separately
raised and explicitly declined ("keep current wording, no new mechanism").
That request conflicts with `AGENTS.md`'s non-negotiable invariants 11/12
("static analysis... must never infer a relationship from insufficient
evidence"; "a report must never present a declared fact as a proven one").
This ADR does not touch that boundary -- the five-state consumption model
(ADR 0052) is unchanged.

## Decision

### `computeDataArtifacts` composes the full model stack every run

At the point `allFindings` is already assembled (after every finding-
producing generator has run -- static, manifest, citation, usage, flow),
`computeDataArtifacts` now builds:

```ts
const dependencyModel =
  usage !== undefined ? buildDependencyModel(inventory, usage.edges) : undefined
const ownershipModel = buildOwnershipModel(inventory) // always -- cheap, no filesystem
const findingModel = buildFindingModel(allFindings) // always -- the complete finding set
const changeModel =
  manifest !== undefined ? buildChangeModel(manifest.changes, dependencyModel) : undefined
const evidence = buildEvidenceModel({
  capability: inventory,
  dependency: dependencyModel,
  ownership: ownershipModel,
  finding: findingModel,
  change: changeModel,
})
```

Every one of these is a pure projection over data already computed above --
never a second scan or parse -- so composing them costs nothing beyond
object construction. `ReportResult.evidence: EvidenceModel` is **always
present**, unlike `manifest?`/`documentation?`/`usage?`/`flow?` (each
genuinely absent when its own flag wasn't passed): "every run produces real,
composed evidence, whether or not you asked for a file" is a true, stronger
claim once composing it is free. `--evidence <path>` (new CLI flag, mirrors
`--docs`/`--ownership`/`--flow`) only controls whether it's additionally
written to disk as `docs/data.evidence.json`-style JSON; `--check`/
`--strict*` support comes free through the existing generic `writes`/
`checkArtifacts` diffing, no per-artifact special-casing needed.

### No `provenance` is stamped by the orchestrator itself

`buildEvidenceModel` is called with **no** `provenance` argument (not even
`{generatedAt: new Date().toISOString()}`, which the first implementation
attempt used). This is ADR 0050's own principle taken seriously: "provenance
is caller-supplied, never ambient-detected." A wall-clock timestamp baked
into diffed, committed content would mean `--evidence`/`--check` could never
report clean two runs in a row against the same source -- confirmed by a
real failing test during implementation (`--evidence` participates in
`--check`'s staleness detection... expected 0 stale, got 1, because
`generatedAt` differed by milliseconds between the write and the check). A
caller with a legitimate provenance fact (a CI script that knows its own
commit SHA) can attach it after `computeDataArtifacts` returns; the
orchestrator has none to offer and no business guessing one.

### The example projects' own reports become thin renderers, not a second pipeline

`examples/enterprise-platform/reports/litigation-evidence.ts` and
`audit-prep.ts` now call `computeDataArtifacts()` once (with the same
`location`/`docs`/`ownership`/`flow` paths their `npm run docs` script
already uses) and render `result.evidence`/`result.findings` into their own
report-specific Markdown/JSON, instead of independently re-running
discovery/linking/scanning/static-rules/model-building. `computeDataArtifacts`
never writes anything itself, so calling it for the return value alone is
side-effect-free and needs no prior `npm run docs` step. This is the concrete
thing that makes "one source of truth" a provable fact about the code (one
shared function call) rather than "the same sequence of calls, kept in sync
by hand" -- confirmed by regenerating both reports after the rewrite and
diffing byte-for-byte (modulo `generatedAt`) against their pre-rewrite
output: identical.

`litigation-evidence.ts`'s own `buildLitigationEvidenceProjection` also lost
a redundant lookup map (`capabilitiesByRef`, built by hand-running
`discoverCapabilityFiles`/`buildInventory` a second time) once it was clear
`evidence.capability.capabilities` already IS the same `CapabilityNode[]`
the loop needed -- a simplification the refactor surfaced, not a planned
goal.

## Consequences

- `--json` output (`serializeSuccess`) now includes the full composed
  `EvidenceModel` on every run, for free -- no consumer previously had a
  first-class way to get one without hand-assembling the pipeline.
- `ReportResult`'s shape gained a required field; no `JSON_SCHEMA_VERSION`
  bump (additive, same discipline as every other model change this session)
  -- `schemas/data-cap-report.schema.json` regenerated to include it.
- All three flagship examples commit a new `docs/data.evidence.json`;
  `scripts/update-example-goldens.mjs`'s `DEFAULT_FLAGSHIP_REPORT_ARGS` gained
  `--evidence docs/data.evidence.json`.
- The "guarantee truly unused" ask from the same conversation remains
  explicitly out of scope -- ADR 0052's five-state model and `AGENTS.md`
  invariants 11/12 are unchanged.

## Alternatives considered

- **Stuff the fuller evidence into `manifest.snapshot.json` instead of a new
  artifact.** Rejected -- the manifest snapshot's job is narrowly "diff
  capability shape run-over-run" (ADR: `manifest-snapshot.ts`'s own header
  comment); mixing in full per-field position-level evidence would conflate
  two different lifecycles (an internal diffing sidecar vs. an audit-grade
  evidentiary export) and bloat a file every manifest-generating run already
  reads/writes.
- **Stamp `generatedAt`/a commit SHA automatically from the orchestrator.**
  Rejected -- see "Decision" above; breaks `--check`'s own diffability and
  violates ADR 0050's caller-supplied-provenance principle. No `--commit-sha`
  CLI flag was added either, for the same reason nothing else in this pass
  invented a capability beyond what was actually needed -- a real future
  need can add one without disturbing this decision.
- **Have the example reports read the committed `docs/data.evidence.json`
  file instead of calling `computeDataArtifacts()` again.** Rejected at the
  time -- would couple `npm run reports` to having run `npm run docs` first
  (a fragile cross-script ordering dependency) for a weaker version of the
  same guarantee. **Revisited the same day**, once double computation
  turned out to cost real CI time: the objection was "no way to tell a
  stale cached file from a fresh one," not "reading a file is inherently
  wrong" -- `examples/enterprise-platform/reports/evidence-cache.ts` closes
  exactly that gap with a cheap source fingerprint (raw file hashes, no
  parsing) checked before the cache is trusted, falling back to a real
  `computeDataArtifacts()` call (logged, never silent) on any mismatch. See
  that file's own header comment for the full reasoning.
