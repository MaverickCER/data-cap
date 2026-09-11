# Reviewing changes to data-cap

The reviewer-side companion to [`CONTRIBUTING.md`](CONTRIBUTING.md). It
answers one question: **what makes a change to this package safe to merge?**
It is not a second contributor guide and not a style checklist — CI already
enforces formatting, lint, types, coverage, and mutation score. This
document covers the judgement calls CI can't make.

## 1. Review standard

A change is ready to merge when all of the following hold:

- CI is green — `npm run verify` (typecheck, lint, format, build, schema
  generation, coverage thresholds, `npm run size`, `verify:no-ambient-fs`,
  the API-report drift check) plus the Bun/Deno cross-runtime conformance
  suite.
- Every invariant in §2 that the change touches is still true, and the
  reviewer has checked the specific code, not just trusted the description.
- Any public-surface change (§3) is intentional, justified in the PR, and
  carries the right changeset bump type.
- Any generated artifact in the diff (§4) has been reviewed as output, not
  skimmed.
- The change doesn't weaken a capability or analysis boundary (§5).

When a change can't meet this bar in one PR, split it.

## 2. Package invariants

Enumerated in [`AGENTS.md`](AGENTS.md) ("Non-negotiable invariants", 13 of
them) and pinned by ADRs. A reviewer confirms the change doesn't erode one,
even indirectly. The ones most often at risk in a change:

- **Build tooling is static-analysis-only**
  ([ADR 0002](specs/decisions/0002-build-tooling-static-analysis-only.md),
  AGENTS invariant 6). `src/build/` parses discovered files as AST via the
  TypeScript Compiler API — never `import()`/`require()`/`eval`, including
  `execute`/`processor`/`subscribe`/`optimistic` bodies (opaque by design).
  `evaluateLiteral`'s grammar is a closed allowlist
  ([ADR 0033](specs/decisions/0033-literal-eval-explicit-constructor-allowlist.md)).
  There is **no runtime capability registry**
  ([ADR 0055](specs/decisions/0055-remove-unused-capability-registry.md)) —
  reject any change that reintroduces one or assumes one exists.
- **`DataInfo` is mandatory and commits atomically with `fields`**
  ([ADR 0007](specs/decisions/0007-datainfo-mandatory-not-optional.md),
  [ADR 0008](specs/decisions/0008-fields-info-atomic-commit.md), AGENTS
  invariant 3). Reject anything that makes `info` optional,
  lazily-only-on-demand, separately tree-shakeable, or committed in a
  separate call/tick from `fields`. The single atomic primitive is
  `core/patch.ts`'s `commitState`.
- **Fields are the real data shape, synchronously readable, presence not
  truthiness** (AGENTS invariants 1, 2, 4). No `.value` wrappers, proxies,
  or dot-path strings; no throw-until-ready gate (a deliberate divergence
  from env-cap — [ADR 0004](specs/decisions/0004-fields-always-synchronously-readable.md)).
  Ownership/presence checks use `Object.hasOwn`, never `in` or a falsy
  check.
- **No automatic rollback, no invented conflict policy**
  ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md),
  AGENTS invariant 9). A failed optimistic mutation reverts only because its
  pending transition was removed — no separate "restore prior value" path,
  no first/last-write-wins or merge.
- **Sharing is scoped to function identity, never behavioral equality**
  ([ADR 0028](specs/decisions/0028-coordinator-dedup-key-identity-plus-params.md),
  AGENTS invariant 8). The `stable-operation-reference` lint rule guards
  this — confirm a change doesn't create a code path where an inline arrow
  reaches the coordinator.
- **`FIELD_MARKER` uses `Symbol.for`, never a bare `Symbol()`**
  ([ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md),
  AGENTS invariant 10). `core` and `runtime` are independently bundled — a
  bare symbol breaks marker recognition across the `createData`/`buildData`
  boundary. `test/runtime/cross-bundle-field-marker.test.ts` pins it.
- **Reports state "declared" vs. "proven", never blended** (AGENTS
  invariants 11, 12,
  [ADR 0049](specs/decisions/0049-capability-metadata-vocabulary.md)).
  Author-written metadata (`source`, `credentials`, `retention`, lifecycle
  vocabulary) is never verified against runtime behavior; an
  AST-derived fact (`writes`, a `DependencyEdge`) is. An ambiguous case
  becomes an `indeterminate` finding, never a guessed `error`.
- **Every published path is root-relative** (AGENTS invariant 13,
  [ADR 0057](specs/decisions/0057-one-path-per-governance-value.md)).
  A generated artifact must never contain a machine-specific absolute path.
- **Capabilities do not self-redact** (AGENTS invariant 7) — but a raw
  value still must never appear in a thrown error or warning message
  ([ADR 0006](specs/decisions/0006-no-self-redaction.md) explains the
  reasoning; the error-message rule is separate and still holds).

If a change genuinely needs to move one of these boundaries, it needs its
own ADR first, not a reviewer waving it through.

## 3. Public API / stability review

[`VERSIONING.md`](VERSIONING.md) defines three tiers. Before approving:

- **Stable**: `.` core APIs (`buildData`, `documentData`, `fields.*`, error
  types); the `DataState`/`DataInfo`/`FieldInfo`/`DataStore`/`Coordinator`
  type shapes and their documented invariants; `./runtime`'s
  `createDataStore`/`defaultCoordinator`/`createCoordinator`/`composeSignals`/
  `rejectOnAbort`; `./runtime/cache`; `./runtime/retry`; `./helpers`
  namespace shapes; the `stable-operation-reference` rule's name and message
  IDs. A breaking change here needs a `major` changeset and an explicit
  decision in the PR.
- **Experimental**: everything under `./build`, and `./runtime`'s
  `createData` + its returned capability contract (`runGetters`,
  `getSnapshot().operations`, `describe()`). May change shape in a
  `minor`/`patch` — but deliberately, and the ADR's Status line should
  match reality.
- **Private**: the coordinator's internal registry structure,
  canonicalization's exact key format, array-identity's separator/escaping,
  anything not re-exported from a documented entry point.
- The published JSON Schema (`schemas/*.json`, `./schema` export) is
  generated from the types (`npm run schema`) — a schema diff without a
  types change is a red flag.

Check `package.json#exports` in the diff — the allowed set is exactly `.`,
`./runtime`, `./runtime/cache`, `./runtime/retry`, `./helpers`, `./build`,
`./node`, `./evidence`, `./eslint-plugin`, `./schema`, `./schema/*`,
`./package.json`. A new entry is a public-surface decision.

## 4. Generated-artifact review

data-cap commits `schemas/*.json`, example `expected/` golden trees, and
`docs/api-report/`. When any appear in a diff:

- **Review the artifact as output.** A golden or schema diff is the
  observable behavior change — read it. "Regenerated goldens" is not a
  substitute for looking.
- Confirm it was regenerated by the tool, not hand-edited — a file marked
  `AUTO-GENERATED` changes only via its generator.
- An example's `expected/` change must have its causing source change in the
  same PR, explaining the delta.
- `docs/api-report/` must match a fresh `npm run docs:api:report` — CI's
  `docs:api:report:check` fails otherwise. That diff _is_ the public API
  surface diff; read it.

## 5. Security and analysis-boundary review

- The static-analysis guarantee (§2, ADR 0002) is a boundary: `src/build/`
  runs against untrusted repo content. Anything that could execute that
  content, or read/traverse outside the declared discovery roots, is a
  vulnerability, not a bug.
- `verify:no-ambient-fs` enforces that library surfaces acquire no ambient
  filesystem capability; `src/build` receives its filesystem explicitly
  ([ADR 0058](specs/decisions/0058-library-surfaces-do-not-acquire-node-fs.md)).
  A library surface reaching for `node:fs` directly breaks this.
- The **dual-package hazard** (`defaultCoordinator` is a module singleton)
  is a checked, documented risk class
  ([ADR 0041](specs/decisions/0041-dual-package-hazard-checked-documented.md),
  `test/runtime/dual-package-hazard.test.ts`). A change that alters how
  `core`/`runtime` bundle, or how `FIELD_MARKER` / the coordinator singleton
  resolve, must keep that test's documented consequence (graceful
  degradation) true — or update the test _and_ SECURITY.md deliberately.
- No first-party integration/adapter/React package
  ([ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md)) —
  those patterns live in `examples/` only.
- New dependency (runtime _or_ dev): scrutinize. The isomorphic tiers allow
  zero runtime deps; a dev dependency needs a real justification in the PR.

## 6. AI-authored change review

Same scrutiny as any PR — but the common failure modes are specific and
checkable against documented invariants:

- **Silent invariant drift.** An assistant adds a fallback that executes an
  `execute`/`processor` body during static analysis (violates ADR 0002),
  makes `info` lazily-optional "to save allocations" (violates ADR 0007),
  adds a truthiness check where presence is meant (violates AGENTS invariant
  4), or invents a rollback path for a failed optimistic mutation (violates
  ADR 0023). Check every new `catch`, fallback, conditional, and default
  against §2.
- **Plausible-looking API additions.** A new export or `createData` option
  that expands the Stable surface without a decision. Cross-check
  `package.json#exports` and the option's tier against
  [`VERSIONING.md`](VERSIONING.md) and [`AGENTS.md`](AGENTS.md)'s Public API
  map.
- **`core/` gaining state or async.** `buildData`/`documentData` and
  everything in `src/core/` must stay synchronous and stateless — an
  assistant moving execution logic there instead of `runtime/` is a common
  slip ([`AGENTS.md`](AGENTS.md) "Avoid").
- **A report presenting a declared fact as proven.** Any new rendered field
  in a generated report must be labeled "declared" or "proven", never
  blended (AGENTS invariants 11–12).
- **Parallel re-implementations.** `helpers/identity.ts` /
  `helpers/canonicalize.ts` must stay literal re-exports of `core`'s, never
  a second copy.
- **Tests that assert the bug**, or added only to kill a mutant while
  asserting nothing meaningful. Confirm the _expected_ value independently.

[`AGENTS.md`](AGENTS.md), [`PROMPT.md`](PROMPT.md), and
[`skills/data-cap/SKILL.md`](skills/data-cap/SKILL.md) are the invariant set
an assistant was (or should have been) working against.

## 7. Required verification

- `npm run verify` green locally or in CI.
- `npm run test:coverage` — coverage is ratchet-up-only; a threshold is
  raised when coverage improves, never lowered to accommodate a drop.
- Mutation score (Stryker) must not regress. New logic needs tests that
  actually kill mutants by asserting behavior.
- Type-level tests: a public-surface type change needs both a positive
  `expectTypeOf` test and, where an invalid construct exists, a
  `// @ts-expect-error` negative test
  ([ADR 0045](specs/decisions/0045-type-level-tests-pair-positive-negative.md)).
- Property-based tests: a change to `core/patch.ts` or `core/ownership.ts`
  must keep the property-based coverage in their `test/core/*.test.ts`
  meaningful ([ADR 0046](specs/decisions/0046-property-based-tests-extend-to-patch-ownership.md)).
- `npm run size` if an isomorphic entry point changed.
- `npm run docs:api:report` regenerated + committed if any public export
  changed.
- `test/runtime/cross-bundle-field-marker.test.ts` re-run against a fresh
  build if anything `FIELD_MARKER` depends on changed.

## 8. Approval checklist

- [ ] CI green (`verify` + cross-runtime conformance)
- [ ] Every touched invariant in §2 re-checked against the actual code
- [ ] No raw value in any thrown error or warning message
- [ ] `info` still mandatory + atomic with `fields`; no truthiness-for-presence
- [ ] No automatic rollback / conflict policy introduced
- [ ] Public-surface changes intentional + correct changeset bump
- [ ] `package.json#exports` unchanged, or the new entry is deliberate
- [ ] Generated artifacts in the diff reviewed as output, not skimmed
- [ ] `docs/api-report/` regenerated + committed if any public export changed
- [ ] No new runtime dependency; any new dev dependency justified
- [ ] Coverage not lowered; mutation score not regressed
- [ ] Positive + negative type tests for a public-surface type change
- [ ] An ADR added if a structural boundary moved
