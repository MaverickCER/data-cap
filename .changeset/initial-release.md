---
"@maverickcer/data-cap": minor
---

Initial public release of `@maverickcer/data-cap`.

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
