# Changelog

## 0.6.0

### Minor Changes

- ef8440c: Adds three new declarable governance fields to `documentData()`'s field-level docs shape (`src/core/document.ts`): `dataSubjectCategory` (field-level only), `recipientCategories` (field-level only, `readonly string[]`, always author-declared -- never inferred from data-cap's own dependency graph), and `transferSafeguard` (field-level and capability-level, overriding the same way `dataResidency` already does). All three follow the same presence-only, declared-never-verified discipline as every other governance field in this vocabulary, and are purely additive -- no existing field's shape or meaning changes.

  These support a new example generator, `examples/enterprise-platform/scripts/ropa/` (peer to `../generate-docs`, following the same `types.ts`/`build-model.ts`/`render.ts`/`print-lines.ts`/`run.ts` architecture as `@maverickcer/env-cap`'s own rotation-log generator), which produces `docs/ROPA.md` -- an illustrative GDPR Article 30(1) Record of Processing Activities document. The generator's own README states exactly which of the 7 required items are direct schema fields, which are partial/approximate mappings (`sensitivity` for personal-data categories, `protections` for security measures), and which require an adopting organization's own real controller identity before external publication -- data-cap cannot verify any of these mappings' accuracy itself.

### Patch Changes

- chore(deps-dev): bump markdown-it (#29)
- chore(benchmarks): refresh results.json
- chore(deps): bump engine.io (#28)
- chore(deps-dev): bump js-yaml (#30)
- c7233e8: Fix the Markdown table cell escaping in the generated documentation (a backslash before a pipe could un-escape the pipe and break the table), remove the npm and Socket-score caches from the CI workflows (CodeQL `actions/cache-poisoning`), git-ignore the local code-scanning exception registry, and re-pin internal-package-contract to its 0.7.0 release.

## 0.5.1

### Patch Changes

- chore(socket): drop the record for the minified-file alert that no longer applies
- 0fe2d1c: Re-pin internal-package-contract to its 0.6.0 release, which scans Socket last and caches the score so the quota is spent once per version.

## 0.5.0

### Minor Changes

- feat(benchmarks): extend coverage to the full public API surface
- c3d7e44: Migrates the benchmark pipeline (history append, PR-comment summary, history page) onto `internal-package-contract`'s new shared benchmark engine (`scripts/benchmark/*.mjs`, called via its reusable `benchmark-pr.yml` workflow), replacing this repo's own now-deleted `benchmarks/append-benchmark-history.mjs` / `benchmarks/render-benchmark-summary.mjs` copies.

  This repo's directory convention (`benchmarks/`, `benchmarks/history/`) is unchanged -- nothing moved or renamed. What did change:

  - `.github/workflows/ci.yml`'s `benchmark-pr` job is now a thin caller of `internal-package-contract`'s reusable `benchmark-pr.yml` (pinned to its merged commit), with the exact same trigger condition, anti-recursion-loop guard, and per-PR concurrency serialization as before -- only the step bodies moved into the shared workflow.
  - Three new npm scripts (`benchmark:history`, `benchmark:summary`, `benchmark:page`) forward to `internal-package-contract`'s copies, matching its README's documented consumer wiring.
  - Committed benchmark history (`benchmarks/history/{runtime,buildtime}.json`) moves to schema v2: each tier measurement now also carries its full `inputs` object and a derived `unitsPerSecond` figure, alongside the existing `medianMs`. Older v1 entries stay valid as-is; nothing is migrated or rewritten.
  - The `deploy` job now renders a static benchmark-history page (`docs/benchmarks/index.html` -- small-multiples charts per benchmark group, each annotated with its currently-inferred algorithmic complexity class) fresh on every deploy, the same treatment `docs/api/` already gets. Never committed.

  No change to what's measured, this package's public API, or the PR-comment's own methodology/budgets -- `benchmarks/run-benchmarks.mjs`, each example's own `scripts/run-benchmark.mjs`, and `benchmark-fixtures/budgets.mjs` are untouched.

- 52d8933: Restricts the CLI to `--evidence` -- the only output with a verified real consumer or a versioned reporting contract (ADR 0050). `--location`, `--docs`, `--ownership`, and `--flow` are removed from the CLI surface: none of the manifest, documentation catalog, dependency & ownership report, or Data Flow Diagram has ever had a verified runtime consumer in this repo's own examples.

  The underlying generator functions are **unchanged and remain fully exported** from `data-cap/build`: `generateManifest`, `generateDocumentation`, `generateUsage`, `generateFlow`, and the higher-level `generateDataArtifacts`/`checkArtifacts` orchestrators that compose them (including their own `location`/`docs`/`ownership`/`flow` options). A project that wants any of the four removed artifacts now calls these directly from its own build script -- see `examples/*/scripts/generate-docs/{run.ts,check.ts,README.md}` for a worked pattern used by all four of this repo's own examples, and [ADR 0066](specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md) for the full reasoning.

  `--expiring-within-days` stays a CLI flag (unlike the equivalent change env-cap made): it feeds the Evidence Model's Lifecycle Model unconditionally, independent of `--docs`. `--strict-docs`/`--strict-ownership`/`--strict-flow` also stay -- the findings they escalate are computed unconditionally alongside `--evidence` (F1/F2), even though `--strict-flow` is now a CLI-level no-op with `--flow` gone (it remains meaningful for a direct `generateDataArtifacts({ flow, strictFlow: true })` library call).

  This is a breaking change to the CLI's flag set (minor, per this repo's pre-1.0 semver convention -- see `VERSIONING.md`): any script invoking `data-cap --location/--docs/--ownership/--flow ...` now fails with `Unknown argument: ...` instead of generating output. Migrate by calling the equivalent `data-cap/build` function directly, following the pattern in any of this repo's own `examples/*/scripts/generate-docs/` directories.

- cc0db67: Removes the `examples/nextjs-app` NIST-Privacy-Framework-informed alignment report generator (`scripts/nist-privacy-framework/`, `npm run docs:privacy`, and the generated `docs/ISO-IEC-27701-2025.md`). The generated document's title claimed alignment with ISO/IEC 27701:2025 — a copyrighted, purchasable standard — while its actual content was derived entirely from the openly published NIST Privacy Framework. That mismatch between the title and the real source is a real mislabeling/copyright-exposure risk, not a design preference, so the generator and its output are deleted outright with no replacement in this change. `npm run build` for the example no longer chains `docs:privacy`; the unused `tsx` devDependency is also removed.
- 6cc8acd: The usage scan and change-detection/citation-verification no longer silently skip when only `--evidence` is requested.

  Previously, the Dependency Model (`evidence.dependency`) was only populated when `--ownership` or `--flow` was also passed, and the Change Model (`evidence.change`) plus dynamic-access citation freshness-verification were only computed when `--location` was also passed. A caller that only ever requests `--evidence` -- the expected pattern once the CLI's flag surface narrows down to just `--evidence` -- got a materially thinner Evidence Model as a result: no proven consumption edges, no blast-radius/change-since-last-run facts, and no citation staleness findings.

  Both now run unconditionally alongside `--evidence`:

  - The usage scan (proven consumption positions, dependency edges, ownership/abandonment findings) always runs. `--ownership` now only controls whether the rendered Dependency & Ownership report is additionally written to disk.
  - Change-detection (a real manifest diff against the persisted `.data-cap-manifest-snapshot.json` sidecar) and dynamic-access citation freshness-verification now run whenever `--location` OR `--evidence` is requested, not only `--location`. The manifest snapshot sidecar's own read/write now follows the same broadened gate; only `manifest.ts`'s own file write stays exclusively gated on `--location`.

  `ReportResult.usage` is now always present (no longer `| undefined`). `--check`'s own staleness comparison now also masks `EvidenceModel.change` the same way it already masks `provenance.generatedAt`, since a manifest diff is inherently not reproducible by a second computation.

### Patch Changes

- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore: commit the first-ever api-contract baseline
- fix(size): recalibrate the runtime budget to unminified output
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- fix: stop git line-ending normalization from corrupting the api-contract baseline hash
- chore: clear stale CodeRabbit exception placeholders
- chore(benchmarks): refresh results.json
- ci: run benchmarks before contract/lint, in one workflow, to stop the re-approval loop
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json from main@1cb3c4e [skip ci] (#18)
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- fix: real CI for bot-authored branches; benchmark results land in the PR itself (#19)
- chore(benchmarks): refresh results.json
- chore(benchmarks): refresh results.json
- 2e46cef: Stop minifying the published build, move the benchmarks onto internal-package-contract's shared benchmark kit (documented suites, cost-first `BENCHMARKS.md`, `benchmarks/README.md`), and record the shipped URLs and Socket alerts as fully written exceptions.

## 0.4.0

### Minor Changes

- 683cb91: Wires `internal-package-contract`'s governance in for real (CI now runs the
  full contract as a blocking gate, mutation testing ratcheted to zero
  survived/no-coverage/timeout), adds a NIST Privacy Framework-informed
  ISO/IEC 27701 alignment report, and adds a Next.js example demonstrating
  user/admin data ownership.
- d0af46e: Adds a new ESLint rule, `data-cap/no-fields-escape` (ADR 0063/0064): the
  lint-time mirror of the usage-scanner widening in this same release (ADR
  0060). Flags a capability's `.fields`/`getSnapshot()` escaping whole via a
  spread/rest, a bare function-call argument, a named JSX prop, or an export
  -- the same shapes the scanner now reports as `indeterminate` instead of a
  false `UNCONSUMED_FIELD`, caught earlier at lint time instead of at report
  time. Ships with an `allow` glob option for legitimate whole-object
  forwarding (e.g. an internal debug panel), matching `no-raw-external-io`'s
  existing escape hatch.
- d0af46e: Promotes every remaining Experimental-tier surface to Stable (ADR 0065):
  `./build`'s `discoverCapabilityFiles`/`parseCapabilityFile`/
  `linkCapabilityFiles`/`evaluateLiteral`/`resolution/*` (including the
  `--package`/`--tsconfig` CLI flags and cross-package schema discovery), and
  `./runtime`'s `createData`. No behavior change -- this is a compatibility
  commitment change only. The Experimental tier remains defined in
  `VERSIONING.md` for future genuinely-new surfaces; nothing currently ships
  under it.
- d0af46e: Fixes a real false-negative in the usage scanner (ADR 0060): a capability's
  `.fields` object (or the capability itself) handed whole to a function
  argument, a spread, a `return`, or a React component's props — a JSX-prop-
  drilled or context-provided value, not a direct `x.fields.<name>` read — now
  correctly widens every not-otherwise-proven field on that capability to
  `indeterminate`, with a real cited source position, instead of silently
  reporting `UNCONSUMED_FIELD` ("no consumer found") when a real, unattributable
  consumer was sitting right there. Mirrors a fix `@maverickcer/env-cap` already
  shipped for its own equivalent scanner (its ADR 0039).

  **Breaking, pre-1.0 (any Stable API may change in a minor per VERSIONING.md):**
  three finding codes are renamed for parity with env-cap's equivalent codes
  (ADR 0062) — `DYNAMIC_ACCESS_CITATION_MISSING` → `MISSING_DYNAMIC_ACCESS_CITATION`,
  `DYNAMIC_ACCESS_CITATION_STALE` → `STALE_DYNAMIC_ACCESS_CITATION`,
  `EXCLUSIVE_GROUP_CONFLICT` → `EXCLUSIVE_GROUP_VIOLATION`. Anything matching
  on the old exact strings (a `--json`/SARIF consumer, a stored evidence
  snapshot) needs updating.

### Patch Changes

- d0af46e: Documents a post-1.0 security backport policy in `SECURITY.md`/`ADOPTION.md`
  (ADR 0061), mirroring `@maverickcer/env-cap`'s equivalent policy (its ADR
  0015). No code or behavior change.

## 0.3.1

### Patch Changes

- 82837a7: `overrides` now aliases `puppeteer` -> `puppeteer-core` wherever `pa11y` resolves it -- zero bundled browser, zero Chromium-download postinstall script. A Socket.dev "Install scripts" finding directly hurts this package's own supply-chain score, so this had to go regardless of `pa11y`/`puppeteer` staying real, hard dependencies (no extra install step for anyone).

  Also pins `tar` to `^7.5.22` (a critical hardlink/symlink-traversal CVE, non-breaking fix).

## 0.3.0

### Minor Changes

- Bump to unblock publishing -- 0.2.0 was committed via an earlier "Version Packages" PR whose publish step failed (npm OIDC trusted publishing wasn't registered yet), so a retry needs a fresh version number. No functional change beyond the previous release.

## 0.2.0

### Minor Changes

- f32c8d7: Initial public release of `data-cap`.

  Executable, analyzable data contracts — capabilities declare the fields
  they own and the getters/mutators/subscriptions that acquire, mutate, or
  observe them, independent of databases, transports, frameworks, and
  state-management libraries.

  - **`.` (core)**: `buildData`, `documentData`, `fields.nullable`/
    `fields.optional`, the `DataState`/`DataInfo`/`FieldInfo` type system.
    Fields are synchronously readable from the moment `buildData()` returns;
    `info` is a mandatory (never optional or separately tree-shakeable) half
    of every snapshot, committed and published atomically alongside `fields`.
    `documentData()`'s governance vocabulary gained `purpose`/`legalBasis`/
    `dataResidency`/`auditRequired` (capability + field level, same fallback
    resolution as `sensitivity`) and a unified, genuinely arbitrary-shaped
    `metadata: Record<string, unknown>` at every level (capability, field, and
    operation) — see
    [ADR 0051](specs/decisions/0051-documentdata-metadata-and-governance-fields.md).
    `FieldDocs`' old open index signature is removed in favor of the explicit
    `metadata` field.
  - **`./runtime`**: `createDataStore` (a `useSyncExternalStore`-compatible
    standalone store, with authoritative/optimistic state separation and no
    automatic rollback or invented conflict resolution) and
    `defaultCoordinator`/`createCoordinator()` (function-identity-scoped
    execution dedup and ref-counted subscription-transport sharing) — the
    Stable-tier primitives for applications that want full manual control
    over execution, retry, and caching policy (see
    `test/integration/runtime-core/basic-standalone/`).
  - **`./runtime`'s `createData`** (Experimental): the batteries-included
    counterpart, composed entirely from the primitives above — declare
    `fields` plus `getters`/`mutators`/`subscriptions` together and get bound
    operation methods, automatic dedup, per-operation status (including a
    reactive `operations` namespace keyed by canonicalized params, so two
    differently-parameterized concurrent calls to the same operation stay
    independently observable), optimistic mutation lifecycle (`optimistic()`
    always computed against current authoritative state, never a stale
    projection), and concurrent `runGetters` execution that never rejects
    itself. See `examples/application/` and
    [ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md).
  - **`./runtime/cache`** and **`./runtime/retry`**: optional, separately
    tree-shaken bounded caching and abort-aware retry — the latter composes
    directly with a `createData`-generated operation method too.
  - **`./helpers`**: `processors`/`identity`/`canonicalize`/`shape` — optional
    convenience utilities, entirely separate from the core runtime.
  - **`./build`** (Experimental): static-analysis-only discovery and linking
    of `buildData`/`createData`/`documentData` calls across a project,
    including `tsconfig.json` path-alias and cross-package schema
    resolution, plus (for a `createData` call) its static getter/mutator/
    subscription operation catalog — never imports, `require()`s, or
    `eval()`s a discovered file or an operation's own function body. Seven
    canonical, versioned, JSON-serializable fact models (Capability,
    Dependency, Ownership, Finding, Change, Runtime Contract, Evidence) are
    the real API surface here — every one of the many report types a
    consumer might want (inventory, ownership, dependency graphs, SARIF
    findings, change-impact/blast-radius, classification/privacy/retention/
    audit/compliance evidence, OpenAPI-compatible schema artifacts) is
    derivable from these models rather than shipped as a separate,
    independently-computed renderer. A first wave of reference projections
    ships alongside them, built through `defineEvidenceProjection()` with no
    privileged internal path. Every `DependencyEdge` and positional
    `ReportFinding` now cites an exact `SourcePosition` (`{line, column}`,
    1-based) instead of a bare line number, and a field access this pass
    can't statically name (`x.fields[computed]`) is disclosed as
    `FIELD_ACCESS_INDETERMINATE` rather than silently producing no evidence
    at all — see
    [ADR 0052](specs/decisions/0052-exact-source-position-evidence.md). A
    developer can now declare `documentData()`'s `evidence.fields[key].
dynamicAccess` citations for genuinely dynamic field access, re-verified
    every run against a persisted content hash (`FIELD_DYNAMIC_ACCESS_
DECLARED`, `DYNAMIC_ACCESS_CITATION_MISSING`/`STALE`), and
    `--package`-scanned dependencies now have their own directory walked as
    potential consumer source, not just resolved as one schema file, with the
    scanned/not-scanned boundary stated directly in the rendered report — see
    [ADR 0053](specs/decisions/0053-developer-declared-dynamic-access-citations.md).
    See
    [ADR 0050](specs/decisions/0050-fact-model-architecture.md) and
    [`specs/generated-artifacts.md`](specs/generated-artifacts.md)'s
    "Canonical fact models" section for the full report → model mapping.
  - **`./eslint-plugin`**: `stable-operation-reference`, flagging an inline
    or recreated-per-call `execute`/`processor`/`subscribe`/`optimistic`
    reference that would silently defeat the coordinator's identity-based
    sharing — matches both hand-wired code and `createData(...)` schemas.

  No first-party TanStack Query, Socket.IO, or React adapter ships — full,
  end-to-end-tested reference patterns live in `examples/` instead: three
  audience-shaped flagships (`application/`, `team-service/`,
  `enterprise-platform/`), backed by 16 further real, independently-installed
  regression fixtures in `test/integration/` covering every individual
  mechanism.

  See [`specs/architecture.md`](specs/architecture.md) and the 53
  Architecture Decision Records in [`specs/decisions/`](specs/decisions/) for
  the full design rationale.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches 1.0. Before 1.0, minor versions may include breaking changes
— see [`VERSIONING.md`](VERSIONING.md).

Entries below this point are generated by [Changesets](https://github.com/changesets/changesets)
(`npx changeset` at PR time, `changeset version` at release time) — see
[`CONTRIBUTING.md`](CONTRIBUTING.md#making-a-change) for the workflow.

## [Unreleased]

- Runtime: `buildData()` / `documentData()` -- capability-owned, synchronous
  field contracts. `fields`/`info` are always present and always
  synchronously readable, with no throw-until-ready gate; `documentData()`
  attaches documentation/governance metadata to the same capability graph
  without introducing any runtime behavior.
- Runtime: `createData()` (`data-cap/runtime`, Experimental
  tier) -- the batteries-included operations layer. A schema declaring
  `getters`/`mutators`/`subscriptions` gets dedup, per-operation status,
  optimistic mutation lifecycle, and concurrent `runGetters` execution for
  free, composed entirely from the Stable `buildData`/`createDataStore`/
  `coordinator` primitives. See
  [ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md).
- Runtime: array identity reconciliation (`fields.nullable`/`fields.optional`
  markers), amortized deep-frozen snapshots, and no-op commit suppression --
  see `PERFORMANCE.md`.
- Build: `discoverCapabilityFiles()` / `parseCapabilityFile()` /
  `linkCapabilityFiles()` / `evaluateLiteral()` -- static AST discovery and
  linking of `buildData`/`createData`/`documentData` calls across a
  project, never importing or executing a discovered file. See
  [ADR 0002](specs/decisions/0002-build-tooling-static-analysis-only.md).
- Build: `buildInventory()` -- the one authoritative `CapabilityInventory`
  model (capabilities, fields, operations, resolved owner/sensitivity
  inheritance) every report generator reads from, so "what counts as a
  conflict" is defined once. See
  [ADR 0049](specs/decisions/0049-capability-metadata-vocabulary.md).
- Build: `generateManifest()` -- a deterministic, generated `.ts` manifest
  re-exporting every active capability, with a persisted snapshot for
  "changes since last report" diffing run-over-run.
- Build: `generateDocumentation()` -- a Markdown catalog of every
  capability/field/operation, including a sensitivity & protections review.
  Every declared fact (owner, sensitivity, protections, retention,
  credentials, endpoints) is explicitly labeled as author-declared, never
  presented as statically verified.
- Build: `generateUsage()` -- the Dependency & Ownership Report: an
  owner-to-{capabilities, fields} matrix plus a real, AST-proven consumer
  graph (`ABANDONED_CAPABILITY`/`UNCONSUMED_FIELD`/`UNRESOLVED_CONSUMER`/
  `INDETERMINATE_CONSUMER` findings) -- ambiguous cases are never guessed
  at.
- Build: `generateFlow()` -- a Data Flow Diagram (Mermaid, using OWASP's
  data-flow-diagram vocabulary: external entities, data stores, processes,
  a trust boundary) and a severity-grouped Security Data-Flow Review,
  headlined by `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` -- a field whose
  declared sensitivity is confidential/restricted/non-standard and whose
  declared endpoint crosses an external-service/api/queue boundary. Every
  rendered artifact carries an explicit evidence disclaimer: it can support
  a security/privacy/compliance review, it does not itself establish one.
  See [`specs/generated-artifacts.md`](specs/generated-artifacts.md) for
  what's generated and what's explicitly deferred, with reasons.
- Build: `generateDataArtifacts()` / `checkArtifacts()` -- the orchestrator.
  Every requested artifact and finding is computed before anything is
  written; a blocking finding throws `DataProjectGenerationError` instead of
  writing a partial artifact set. `checkArtifacts()` reuses the same compute
  path to diff against disk without writing, for a CI freshness gate.
  `--strict`/`--strict-docs`/`--strict-ownership`/`--strict-flow` escalate
  that pass's `warning` findings to `error` (never `info`).
- Build: **Experimental** cross-package schema discovery (`packages`
  option) and TypeScript path-alias resolution (`tsconfig` option) --
  resolving a `fields` reference through a bare import from an installed
  package's own `package.json#dataCap.schema` field, or through a
  `tsconfig.json` path alias, so a capability reached only that way isn't
  misreported as abandoned or unresolved.
- CLI: `npx data-cap` -- flag-driven artifact generation
  (`--location`/`--docs`/`--ownership`/`--flow`, `--include`/`--exclude`
  globs, `--package`/`--tsconfig`), `--check` (drift-only, exits 1 if
  stale), `--json` (a versioned, machine-readable `ReportResult` envelope),
  and `--strict*` severity escalation.
- CLI: a published JSON Schema for `--json` output
  (`schemas/data-cap-report.schema.json`, also exported as
  `data-cap/schema`), generated directly from
  `src/cli/json.ts`'s types so the two can't silently drift apart.
- GitHub Action: a first-party, dependency-free composite Action
  (`action.yml`) runs the CLI with `--json` and turns the result into
  inline PR annotations, a sticky summary comment, and -- when `--flow` is
  requested -- the Data Flow Diagram embedded directly in the job summary
  (GitHub renders fenced `mermaid` blocks natively).
- Docs: a full TypeDoc API reference (`npm run docs:api`) across all five
  entry points, with strict validation (every exported symbol documented,
  every cross-reference resolved).
- Docs: `benchmarks/history/{runtime,buildtime}.json` -- a committed,
  same-runner (GitHub-hosted `ubuntu-latest`) time series of micro-benchmark
  and build-time results, appended on every push to `main`. PR benchmark
  comments diff against the most recent entry, flagging (never blocking) a
  regression past each benchmark's own threshold -- 10% for `cold-start`,
  15% for most others, wider for the near-zero-cost `commitAuthoritative-leaf`
  check (see `benchmarks/benchmark-fixtures/budgets.mjs` and
  `PERFORMANCE.md`).
- ESLint: `data-cap/eslint-plugin`'s `stable-operation-reference`
  rule requires `createData()`'s `execute`/`subscribe` to reference a
  stable, module-level function rather than an inline literal or a binding
  recreated on every call, so the runtime coordinator's identity-based
  dedup/sharing actually applies.
