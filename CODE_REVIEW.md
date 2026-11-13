# Reviewing changes to data-cap

You are reviewing a pull request and must decide whether it is safe to merge. The required checks enforce formatting, lint, types, coverage, mutation testing and the public-surface baselines. What follows is what they cannot judge.

## 1. Review standard

A change is ready to merge when all of these hold:

- The required checks, `contract` and `lint`, are green.
- The jobs that do not block a merge are green too, or the reviewer has read why not. They are `cross-runtime` (Bun and Deno), `examples`, `integration-fixtures`, `typescript-5`, `typescript-compat`, `package-managers` and `benchmark-pr`. A failed `benchmark-pr` skips the required jobs, so check it by hand.
- Every invariant in §2 that the change touches still holds, checked against the code, not the description.
- Any public-surface change (§3) is intentional, explained in the pull request, and carries the right changeset bump.
- Any generated file in the diff (§4) has been read as output.
- The change does not weaken a capability or analysis boundary (§5).

When a change cannot meet this in one pull request, split it.

## 2. Package invariants

[`AGENTS.md`](AGENTS.md) lists the non-negotiable invariants, and the ADRs pin them. Confirm the change does not erode one, even indirectly. The ones most often at risk:

- **Build tooling is static-analysis-only** ([ADR 0002](specs/decisions/0002-build-tooling-static-analysis-only.md)). `src/build/` parses files through the TypeScript Compiler API. It never imports, requires or evaluates them, including operation bodies. Lint bans `eval` and `new Function`; nothing but review stops a computed `import()`. `evaluateLiteral` accepts a closed list ([ADR 0033](specs/decisions/0033-literal-eval-explicit-constructor-allowlist.md)). There is no runtime capability registry; reject a change that adds one ([ADR 0055](specs/decisions/0055-remove-unused-capability-registry.md)).
- **`DataInfo` is mandatory and commits with `fields`** ([ADR 0007](specs/decisions/0007-datainfo-mandatory-not-optional.md), [ADR 0008](specs/decisions/0008-fields-info-atomic-commit.md)). Reject anything that makes `info` optional, lazy, separately tree-shaken or committed apart from `fields`. The one atomic primitive is `core/patch.ts`'s `commitState`.
- **Fields are the real data shape, readable at once, checked by presence** ([ADR 0004](specs/decisions/0004-fields-always-synchronously-readable.md)). No `.value` wrappers, proxies or dot-path strings, and no throw-until-ready gate. Presence checks use `Object.hasOwn`, never `in` or truthiness. No lint rule enforces this; review does.
- **No automatic rollback, no conflict policy** ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md)). A failed optimistic mutation reverts only because its pending transition was removed.
- **Sharing is by function identity** ([ADR 0028](specs/decisions/0028-coordinator-dedup-key-identity-plus-params.md)). Confirm no new path lets an inline arrow reach the coordinator.
- **`FIELD_MARKER` uses `Symbol.for`** ([ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)). Core and runtime are bundled separately; `test/runtime/cross-bundle-field-marker.test.ts` pins it.
- **Reports keep declared and proven facts apart** ([ADR 0049](specs/decisions/0049-capability-metadata-vocabulary.md)). An ambiguous case becomes `indeterminate`, never a guessed `error`. `test/build/negative-guarantees.test.ts` checks finding messages; nothing scans the rendered Markdown reports, so read new report wording.
- **Every published path is root-relative** (`test/build/docs.test.ts`). A generated artifact never contains a machine-specific absolute path.
- **No raw value in an error or warning.** Capabilities do not self-redact ([ADR 0006](specs/decisions/0006-no-self-redaction.md)), but messages still never carry a value (tested for one string value on the `createData` path).

Moving one of these boundaries needs its own ADR first.

## 3. Public API and stability

[`VERSIONING.md`](VERSIONING.md) holds the tier of every entry point in a table generated from `package.json` `exports`. Before approving:

- Find each changed export's tier there. A breaking change to a Stable surface needs a changeset and an explicit decision in the pull request. `ApiContract` fails a breaking declaration diff without the right bump; it does not see behaviour changes.
- An Experimental change may ship in a minor or patch, but deliberately.
- A new key in `package.json#exports` is a public-surface decision. The generated table shows it.
- The JSON Schemas under `schemas/` are generated from the types (`npm run schema`). A schema diff without a type change is a red flag.

## 4. Generated files

The repository commits `schemas/*.json`, each example's generated `docs/`, `docs/api-report/`, the agent skill and the landing page. When one appears in a diff:

- Read it as output. A schema or report diff is the observable change.
- Confirm a generator wrote it. A file marked as generated changes only through its generator.
- An example's output change needs its cause in the same pull request.
- `docs/api-report/` must match a fresh `npm run docs:api:report`; the `lint` job fails otherwise. That diff is the public API diff.

## 5. Security and analysis boundaries

- `src/build/` runs against untrusted repository content. Anything that could execute that content, or read outside the discovery roots, is a vulnerability.
- The `AmbientCapabilities` check fails when any shipped file reaches `child_process`, or a file outside the CLI, `./node` and `./eslint-plugin` reaches `fs` ([ADR 0058](specs/decisions/0058-library-surfaces-do-not-acquire-node-fs.md)).
- The dual-package hazard is pinned by `test/runtime/dual-package-hazard.test.ts` ([ADR 0041](specs/decisions/0041-dual-package-hazard-checked-documented.md)). A change to how core and runtime bundle must keep that test's consequence true, or change the test and SECURITY.md on purpose.
- No adapter, integration or React package ([ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md)).
- A new dependency, runtime or dev, needs a reason in the pull request. The isomorphic entries allow none.

## 6. AI-authored changes

Same scrutiny as any change. The common failure modes are specific:

- **Invariant drift:** a fallback that runs an operation body during analysis, a lazily optional `info`, a truthiness check for presence, or an invented rollback. Check every new `catch`, fallback and default against §2.
- **Plausible API additions:** a new export or `createData` option that widens the Stable surface without a decision. Check it against VERSIONING.md.
- **State or async in `core/`:** `src/core/` stays synchronous and stateless; execution belongs in `runtime/`.
- **A declared fact shown as proven** in a new report field.
- **Parallel copies:** `helpers/identity.ts` and `helpers/canonicalize.ts` stay re-exports of core's.
- **Tests that assert the bug,** or that only kill a mutant. Confirm the expected value independently.

[`AGENTS.md`](AGENTS.md), [`PROMPT.md`](PROMPT.md) and [`skills/data-cap/SKILL.md`](skills/data-cap/SKILL.md) are what an assistant should have worked from.

## 7. Verification a reviewer asks for

- `npm run verify` green locally or in CI.
- Coverage at or above the floors in `vitest.config.ts`. Floors are raised in review and never lowered to fit a drop.
- Mutation testing: `contract` fails unless every mutant is killed or recorded as equivalent. New logic needs tests that assert behaviour.
- A public type change has a positive `expectTypeOf` test and, where an invalid construct exists, a `// @ts-expect-error` test ([ADR 0045](specs/decisions/0045-type-level-tests-pair-positive-negative.md)).
- A change to `core/patch.ts` or `core/ownership.ts` keeps their property-based tests meaningful ([ADR 0046](specs/decisions/0046-property-based-tests-extend-to-patch-ownership.md)).
- `npm run size` if an isomorphic entry changed.
- `npm run docs:api:report` regenerated and committed if a public export changed.

## 8. Approval checklist

- [ ] `contract` and `lint` green; the non-blocking jobs green or explained
- [ ] Every touched invariant in §2 re-checked against the code
- [ ] No raw value in any thrown error or warning
- [ ] `info` still mandatory and atomic with `fields`; no truthiness for presence
- [ ] No automatic rollback or conflict policy introduced
- [ ] Public-surface changes intentional, with the right changeset bump
- [ ] `package.json#exports` unchanged, or the new entry is deliberate
- [ ] Generated files in the diff read as output
- [ ] `docs/api-report/` regenerated if a public export changed
- [ ] No new runtime dependency; any new dev dependency justified
- [ ] Coverage floors not lowered; no unrecorded surviving mutant
- [ ] Positive and negative type tests for a public type change
- [ ] An ADR added if a structural boundary moved
