# Changelog

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
  regression over 10%.
- ESLint: `data-cap/eslint-plugin`'s `stable-operation-reference`
  rule requires `createData()`'s `execute`/`subscribe` to reference a
  stable, module-level function rather than an inline literal or a binding
  recreated on every call, so the runtime coordinator's identity-based
  dedup/sharing actually applies.
