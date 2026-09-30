# 0066: The CLI surface is restricted to flags with a verified real consumer

## Status

Accepted. Removes `--location`, `--docs`, `--ownership`, and `--flow` from
`src/cli/index.ts` (`ParsedArgs`, `valueFlags`, `helpText()`, the "at least
one of ..." guard -- now just "`--evidence` is required" -- and every
CLI-only rendering path that only existed to format their output:
`writeManifestChanges()`, `formatFieldChanges()`, and the corresponding
`if (result.manifest)`/`if (result.documentation)`/
`if (options.ownership)`/`if (result.flow)` branches in
`writeGenerationSummary()`/`writeCheckSummary()`). `--expiring-within-days`
is **not** removed, unlike the equivalent env-cap decision this one follows
(ADR 0046 there) -- see Context for why data-cap's structure differs.
Covered by `test/cli/index.test.ts` and `test/cli/main.test.ts`.

`generateManifest`/`generateDocumentation`/`generateUsage`/`generateFlow`
(`src/build/generate-manifest.ts`, `generate-documentation.ts`,
`generate-usage.ts`, `generate-flow.ts`), and the higher-level orchestrators
`generateDataArtifacts`/`checkArtifacts` that compose them, are **not**
changed by this decision and remain fully exported from `data-cap/build`,
Stable per ADR 0065. `GenerateDataArtifactsOptions.location`/`.docs`/
`.ownership`/`.flow` are unaffected -- a direct library caller (e.g.
`examples/enterprise-platform/reports/evidence-cache.ts`, unaffected by this
change; see Context) can still request any of them. Nothing about the
library surface shrank -- only what the packaged CLI binary can trigger by
itself.

## Context

data-cap's CLI (`src/cli/index.ts`) grew a flag for every artifact the
library could produce, on the assumption that "the library can generate it"
and "the CLI should have a flag for it" were the same decision. They
aren't. Auditing the CLI's actual flag set against what each flag's output
is _for_ -- re-verified directly for this change by grepping every
`examples/*` project for an `import` of its own generated
`data.manifest.ts`, not assumed from a prior session -- found:

- **A flag whose output something else in a real project actually reads.**
  None. Unlike env-cap (whose `--location` writes a manifest application
  code `import`s and passes to `validateEnv()`), **no example in this repo
  imports `src/generated/data.manifest.ts` at runtime** -- this is itself
  notable and worth stating plainly: data-cap's own generated manifest has
  never had a verified runtime consumer, in any example, at any point
  audited for this change. `--evidence` writes the persisted `EvidenceModel`
  artifact that is itself this package's reporting contract (ADR 0050,
  ADR 0054: "always computed, always real" -- Finding Model, evidence
  projections, and CI drift-guards all key off this one file). `--json`/
  `--check` are inherent to the tool's own contract, not outputs of a
  particular pass.
- **Flags whose output nothing in a real project reads at runtime, or
  checks programmatically, at all.** `--location` (the manifest), `--docs`
  (the rich Markdown catalog), `--ownership` (the dependency & ownership
  report), and `--flow` (the Data Flow Diagram + Security Data-Flow Review)
  are purely human-facing documentation. Auditing every example in this
  repo (`examples/application`, `examples/team-service`,
  `examples/enterprise-platform`, `examples/nextjs-app`) found no `import`
  of any of the four, and no test asserting on their content except as
  committed, golden, human-readable output (`test/examples/*.test.ts`'s
  `checkDocsFresh()`).

Unlike env-cap's equivalent audit, **`--expiring-within-days` is not a
structural dependent of `--docs`** here: `computeDataArtifacts()` calls
`buildLifecycleModel(inventory, expiringWithinDays, generatedAt)`
unconditionally, on every run, and threads the result into
`EvidenceModel.lifecycle` regardless of which flags were passed (F1's own
"the underlying facts already compute unconditionally" boundary, extended
by this repo's Lifecycle Model existing at all -- env-cap has no equivalent
sub-model coupled to its own `--expiring-within-days`). `--expiring-within-days`
therefore remains fully meaningful with only `--evidence` requested, and
stays a CLI flag.

`--strict-flow` is a closer call: with `--flow` gone, the CLI can never again
populate `flowFindings` for `--strict-flow` to escalate, since flow findings
only ever exist when `options.flow` is set. Unlike `--docs`/`--ownership`'s
own escalation flags (`--strict-docs`/`--strict-ownership`, which remain
fully meaningful -- the static and usage passes they escalate run
unconditionally per F1/F2, independent of whether `--docs`/`--ownership`
ever request a written artifact), `--strict-flow` becomes a real no-op for
every CLI invocation. It is kept anyway, rather than removed alongside
`--flow`: this decision's own scope is the four flags with no verified
runtime consumer, not every flag whose _effect_ narrows as a structural
consequence, and `--strict-flow` remains fully meaningful for a direct
`generateDataArtifacts({ flow, strictFlow: true, ... })` library caller
(see GUIDE.md's "Programmatic orchestration" example). `--help`'s own text
notes the CLI-level no-op directly rather than leaving it undocumented.

A secondary, mechanical reason forced the same conclusion from the CLI side,
same as env-cap's ADR 0046: once `--location`/`--docs`/`--ownership`/`--flow`
are removed from `ParsedArgs`, `resolveOptions()` can never again set
`location`/`docs`/`ownership`/`flow` from a real CLI invocation, which makes
`result.manifest`/`result.documentation`/`result.flow` permanently
`undefined`, and `options.ownership` permanently absent, on every real
`main()` call. Under this repo's zero-tolerance Mutation gate
(`npm run contract`), the CLI's own `writeManifestChanges()`/
`formatFieldChanges()` functions and the `if (result.manifest)`/
`if (result.documentation)`/`if (options.ownership)`/`if (result.flow)` call
sites in `writeGenerationSummary()`/`writeCheckSummary()` would then be
permanently unreachable dead code -- no real CLI-level test could construct
a state where the removed flag's summary-printing branch is taken. Rather
than leave dead branches a mutation-testing gate would rightly flag, they
were removed along with the flags that used to reach them.

`src/build/generate-data-artifacts.ts` (`computeDataArtifacts`/
`generateDataArtifacts`/`checkArtifacts`) itself needed **no functional
change**: its `location`/`docs`/`ownership`/`flow`/`evidence` options, and
the write branches gated on them, remain necessary for a direct library
caller. Confirmed concretely, not assumed: `examples/enterprise-platform/reports/evidence-cache.ts`'s
`COMPUTE_OPTIONS` passes all four to `computeDataArtifacts()` directly (never
through the CLI) purely to populate the composed `EvidenceModel`'s own
`MANIFEST_EXPORT_NAME_COLLISION`/`SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY`
finding kinds that `reports/litigation-evidence.ts`/`reports/audit-prep.ts`
read -- an existing, passing assertion in
`test/examples/enterprise-platform-reports.test.ts` (`evidence.computed`
equal to `{dependency: true, ownership: true, finding: true, change: true}`)
already locks this in. Removing those options from the orchestrator's own
type, or gutting the write branches, would have silently thinned that
example's Evidence Model -- a real regression this decision does not make.

## Decision

The `data-cap` CLI's flag set is restricted to `--evidence` -- the one
output with a verified reporting contract (ADR 0050) -- plus the flags that
scope/configure it (`--root`, `--include`, `--exclude`, `--package`,
`--tsconfig`/`--no-tsconfig`, `--expiring-within-days`, `--strict`/
`--strict-docs`/`--strict-ownership`/`--strict-flow`, `--json`, `--check`,
`--help`).

Flags with no verified runtime consumer -- `--location`, `--docs`,
`--ownership`, `--flow` -- move to application-level code: a project that
wants `src/generated/data.manifest.ts`/`docs/DATA.md`/`docs/OWNERSHIP.md`/
`docs/flow/` now calls `generateDataArtifacts()` (or the lower-level
`generateManifest`/`generateDocumentation`/`generateUsage`/`generateFlow`,
or `checkArtifacts()` for a `--check`-equivalent drift guard) directly from
`data-cap/build` in its own build script, exactly as it would for any other
custom reporting need this package doesn't build in (ADR 0010's precedent,
already applied here for the same class of surface). Every flagship example
this repo ships now carries a `scripts/generate-docs/{run.ts,check.ts,README.md}`
set doing exactly this (`examples/application`, `examples/team-service`,
`examples/enterprise-platform`, `examples/nextjs-app`); `nextjs-app`'s omits
`flow` (it never requested `--flow`), matching what each example's own
`docs`/`check` scripts previously passed. Each `run.ts`/`check.ts` pair
requests `evidence` too, alongside `location`/`docs`/`ownership`/`flow` --
not to duplicate the CLI's own `--evidence` step (each `docs` script still
runs a standalone `data-cap --evidence` CLI invocation first, a real,
minimal exercise of the one flag the CLI still has), but because the CLI-only
run can never set `location`/`flow`, so its own Evidence Model is missing
the manifest/flow-specific finding kinds those two passes contribute. The
script's own richer `generateDataArtifacts()` call -- every pass requested
at once, exactly like the pre-ADR-0066 single CLI invocation did --
recomputes and overwrites the CLI step's thinner evidence artifact with the
complete one, and `check.ts` verifies freshness against that same, fuller
option set (not a second, conflicting `data-cap --check --evidence`, which
would recompute the thinner CLI-only model and always report the richer
committed file stale).

`examples/enterprise-platform/reports/evidence-cache.ts` needed no
functional change (see Context) -- only a clarifying comment explaining why
its `location`/`docs`/`ownership`/`flow` options remain necessary even
though it never writes those artifacts to disk itself.

## Consequences

- **Breaking, but pre-1.0 minor per this repo's convention
  ([VERSIONING.md](../../VERSIONING.md#pre-10-status)).** Any script
  invoking `data-cap --location ...`/`--docs ...`/`--ownership ...`/
  `--flow ...` now fails with `Unknown argument: --location` (etc.) instead
  of generating output. The fix is mechanical: call the equivalent
  `data-cap/build` function directly from a small script, following the
  pattern in any of this repo's own `examples/*/scripts/generate-docs/`
  directories.
- `generateDataArtifacts()`/`checkArtifacts()`'s own `location`/`docs`/
  `ownership`/`flow` options (`GenerateDataArtifactsOptions`) are completely
  unaffected -- they remain a fully supported part of that Stable, exported
  orchestrator's public contract for any caller that supplies them directly
  (not through the CLI). The CLI itself simply never populates them anymore.
- **A real, separately-tracked regression, not silently glossed over:** the
  first-party GitHub Action (`scripts/github-action/report.mjs`) reads
  `result.manifest`/`result.flow` from `--json` for its manifest-written
  summary line and its rendered Data Flow Diagram. Since the CLI can no
  longer populate either field, those two report sections are silently
  empty for any consumer of the Action. Flagged in `action.yml`'s own `args`
  description and GUIDE.md's GitHub Action section; migrating `report.mjs`
  to read `result.evidence` instead is intentionally not bundled into this
  change (same scope boundary env-cap's ADR 0046 drew for its own
  equivalent gap).
- `docs/DATA.md`'s/`docs/OWNERSHIP.md`'s/the Data Flow Diagram set's
  generated byline (`generatedBanner()` in `src/build/generated-banner.ts`)
  makes no CLI-flag claim to begin with (unlike env-cap's hardcoded
  `_Produced by \`env-cap --docs\`._`), so no renderer needed correction
  here.
- `scripts/update-example-goldens.mjs` (the human-invoked golden-refresh
  script) no longer passes hardcoded CLI args for the three flagship
  examples plus the `runtime-core/server-database-integration` fixture --
  it runs each project's own `npm run docs` script instead, which now
  itself composes the CLI's surviving `--evidence` step with the
  project-local `generate-docs` script. The one fixture that previously
  used `--docs` alone now has its own tiny `scripts/generate-docs.ts`
  calling `generateDataArtifacts({ docs: ... })` directly.

## Alternatives considered

- **Keep `--location`/`--docs`/`--ownership`/`--flow` in the CLI regardless
  of runtime consumption, since "more flags" costs nothing on its own.**
  Rejected -- it costs exactly what this ADR's Context section describes:
  dead, mutation-flagged branches in the CLI's own rendering code once
  nothing can reach them, and a CLI surface that no longer reflects a
  verified reason to exist for each flag.
- **Remove `--strict-flow` alongside `--flow`, since it becomes a CLI-level
  no-op.** Considered and rejected for this pass -- `--strict-flow` remains
  a real, meaningful `GenerateDataArtifactsOptions` field for a direct
  library caller requesting `flow` (unlike `--location`/`--docs`/
  `--ownership`/`--flow` themselves, which had no verified consumer _at
  all_, CLI or otherwise), and this decision's scope is flags with no
  verified consumer, not every flag whose effect narrows as a structural
  side effect of another removal. `--help`'s own text documents the CLI-side
  no-op instead of hiding it.
- **Have each example's `generate-docs/run.ts` skip requesting `evidence`,
  to avoid a second, redundant discover+scan pass on top of the CLI's own
  `--evidence` step.** Tried first, and reverted after it produced a real,
  material regression: the CLI-only evidence artifact silently dropped the
  manifest/flow-specific finding kinds the pre-ADR-0066 single invocation
  always included (confirmed directly -- `examples/application/docs/data.evidence.json`
  lost its two committed `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` findings
  under this approach). The extra discover+scan pass costs real CPU time on
  a per-`npm run docs` basis, judged an acceptable trade for a persisted,
  committed governance artifact never silently thinning.
- **Cite ADR 0053/ADR 0054 (this repo's own change-detection/evidence-cache
  precedents) as sufficient precedent, without also citing env-cap's ADR 0046.** Rejected -- ADR 0053/0054 explain _why_ the Evidence Model is
  computed the way it is, not _why_ the CLI's flag surface should be
  narrowed to match verified consumers; env-cap's ADR 0046 is the direct
  precedent for that specific reasoning pattern, applied to a materially
  different starting point here (data-cap's manifest has _no_ verified
  consumer anywhere, where env-cap's does).
