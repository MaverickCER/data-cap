# Versioning and API stability

`data-cap` follows [Semantic Versioning](https://semver.org/). This page says which surface that covers, entry point by entry point, and which check notices a change. Read it before you pin a version or choose a changeset bump.

## Entry points and their tiers

Generated from `package.json` `exports` and `docs/surface.json`, so the table cannot omit an entry point:

<!-- ipc:begin entry-points -->

| Export                   | Source                 | Environment           | Tier         | Purpose                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------- | --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-cap`               | `src/core/`            | isomorphic, zero deps | Stable       | `buildData`, `documentData`, `fields.nullable` and `fields.optional`, the `DataState`, `DataInfo` and `FieldInfo` types, and the error classes.                                                                                                         |
| `data-cap/runtime`       | `src/runtime/`         | isomorphic, zero deps | Stable       | `createData`, `createDataStore`, `defaultCoordinator` and `createCoordinator`, `composeSignals` and `rejectOnAbort`.                                                                                                                                    |
| `data-cap/runtime/cache` | `src/runtime/cache.ts` | isomorphic            | Stable       | `createDataCache`. Optional, and a separate entry, and `test/runtime/tree-shaking.test.ts` checks that the built `./runtime` does not include it.                                                                                                       |
| `data-cap/runtime/retry` | `src/runtime/retry.ts` | isomorphic            | Stable       | `withRetry` and `isStillDefault`. Optional, and a separate entry, and `test/runtime/tree-shaking.test.ts` checks that the built `./runtime` does not include it.                                                                                        |
| `data-cap/helpers`       | `src/helpers/`         | isomorphic            | Stable       | The `processors`, `identity`, `canonicalize` and `shape` namespaces.                                                                                                                                                                                    |
| `data-cap/build`         | `src/build/`           | Node-only             | Stable       | Discovery and linking, the inventory and the other fact models, the report generators, and `generateDataArtifacts` and `checkArtifacts`. The flow pass (`flowEvidence`, `flowSinks`, `flowSummaries`, `scanFlow`) and its projections are Experimental. |
| `data-cap/node`          | `src/node/`            | Node-only, dev/CI     | Stable       | `nodeBuildFileSystem`: the `BuildFileSystem` a Node build script hands to `./build`.                                                                                                                                                                    |
| `data-cap/evidence`      | `src/evidence/`        | isomorphic, zero deps | Stable       | `defineEvidenceProjection` (Stable), imported as a type-only reader of the Evidence Model. The flow queries, views, standards adapters and `evaluateEvidenceRules` are Experimental.                                                                    |
| `data-cap/observe`       | `src/observe/`         | isomorphic, zero deps | Experimental | `observeBoundary`, `observeValue`, `observeSink`, `instrumentBoundary`, `observeResponse` and `createMemorySink`. They record field names, never values, into a sink you supply.                                                                        |
| `data-cap/eslint-plugin` | `src/eslint-plugin/`   | Node-only (ESLint)    | Stable       | The `stable-operation-reference`, `no-raw-external-io`, `no-fields-escape` and `no-node-fs` rules.                                                                                                                                                      |
| `data-cap/schema`        | `schemas/`             | static JSON           | Stable       | The JSON Schema for `data-cap --json` output, and the model schemas under `./schema/*`.                                                                                                                                                                 |

<!-- ipc:end entry-points -->

## Stable

Covered by semver. From 1.0, a breaking change to any of these needs a major version (see [Pre-1.0 status](#pre-10-status)):

- **`.` (core):** `buildData`, `documentData`, `fields.nullable`, `fields.optional`, and the exported error classes with their `code` values.
- **The state types:** `DataState`, `DataInfo`, `FieldInfo`, `DataStatus`, `DataError`, `SubscriptionInfo` and `DataStore`. Their documented invariants are Stable too: `info` is mandatory, `fields` and `info` commit together, metadata is sparse but present, and arrays reconcile by identity.
- **`./runtime`:** `createDataStore` and the `DataStoreController` contract (`getSnapshot`, `subscribe`, `commitAuthoritative`, `addPendingTransition`, `removePendingTransition`, `getAuthoritativeState`); `defaultCoordinator`, `createCoordinator()` and the `Coordinator` contract; `composeSignals` and `rejectOnAbort`. Also `createData` and its returned capability: the bound operation methods, `runGetters`, `getSnapshot().operations` and `describe()` ([ADR 0065](specs/decisions/0065-promote-build-createdata-and-cli-flags-to-stable.md)).
- **`./runtime/cache`:** `createDataCache` and the `DataCache` contract.
- **`./runtime/retry`:** `withRetry` and `isStillDefault`.
- **`./helpers`:** the `processors`, `identity`, `canonicalize` and `shape` namespaces and every function in them.
- **`./build`:** discovery and linking (`discoverCapabilityFiles`, `parseCapabilityFile`, `linkCapabilityFiles`, `evaluateLiteral`), path-alias and cross-package resolution, the fact models, the generators and the orchestrator. The data-flow options are Experimental (below).
- **`./node`:** `nodeBuildFileSystem`, the sanctioned way to give `./build` a filesystem. Every generator `init` scaffolds uses it.
- **`./evidence`:** `defineEvidenceProjection`, the `EvidenceModel` shape it reads, and the persisted evidence file's version 2 fields.
- **The CLI:** every flag except the Experimental ones below, and the exit codes.
- **`./eslint-plugin`:** every rule name and message id. Removing a rule or renaming a message id is breaking.
- **The GitHub Action** (`action.yml`): input and output names and meanings, and the summary comment's sections. The major tag (`@v0` while the package is 0.x, `@v1` from 1.0.0) moves only within its major.

**Supported toolchain:** Node.js 22 or later, and the TypeScript versions in the `typescript` peer range (`^5 || ^6 || ^7`).

- The build-time scanner needs TypeScript's classic compiler API, which TypeScript 7 does not ship. It uses your `typescript` when that has the API, and otherwise the bundled `@typescript/typescript6` ([ADR 0069](specs/decisions/0069-typescript-7-scanner-uses-a-bundled-typescript-6.md)). Your `tsc` stays TypeScript 7.
- Every entry point but `./eslint-plugin` type-checks with full library checking under TypeScript 5, 6 and 7. Under 7, the `types@>=7` export condition serves declarations whose compiler types come from the bundled TypeScript 6.
- `moduleResolution` must be `node16`, `nodenext` or `bundler`; `node10` is not supported.
- CI's `typescript-compat` job tests these under `nodenext`. It runs the flow scan under 5, 6 and 7 and requires identical evidence. It runs on the flow-explorer example's source, with the latest 5, 6 and 7 releases; the 5.0 floor is not tested. That job does not block a merge.

## Experimental

The data-flow surface. It may change shape, including in a breaking way, in a minor or patch release. It is labelled Experimental here, in the README and in the Guide; the TSDoc does not carry the label. A surface becomes Stable after a real feedback cycle without a breaking change; its ADR then moves to Accepted. The ADRs that introduced it are [0070](specs/decisions/0070-flow-evidence-is-part-of-the-single-evidence-model.md), [0071](specs/decisions/0071-epistemic-status-on-every-flow-fact.md), [0072](specs/decisions/0072-runtime-observation-is-a-separate-subpath.md), [0073](specs/decisions/0073-flow-views-standards-adapters-and-rules.md), [0074](specs/decisions/0074-flow-scan-non-goals-and-irreducible-limits.md) and [0075](specs/decisions/0075-redundant-transformations.md).

- The `flow`, `policy`, `observation` and `claims` sub-models of the Evidence Model (schema version 3), and their JSON Schemas.
- `flowPolicy` in `documentData()`.
- The `--flow-evidence`, `--observations` and `--rules` flags, and the `flowEvidence`, `flowSinks`, `flowSummaries` and `observations` options, with `FlowSummary`.
- All of `./observe`.
- The flow queries, views and adapters in `./evidence`: `traceFlow`, `traceFlowBetween`, `filterFlow`, `diffFlow`, `observedFlow`, `flowNodeId`, `flowEdgeId`, `buildFlowGraphView`, `renderFlowText`, `renderFlowDot`, `renderFlowMermaid`, `buildProvDocument`, `buildOscalAssessmentResults`, `observationsToOtlp`, `observationsFromOtlp`, `buildCycloneDxBom`, `renderFlowCycloneDx`, `analyzeLeastData`, `leastDataFindings`, `analyzeRedundantTransforms` and `redundantTransformFindings`. In short: every export of `./evidence` except `defineEvidenceProjection`, its own types and the `EvidenceModel` types.
- `evaluateEvidenceRules`, `parseEvidenceRules` and every rule they accept, and the optional `edgeTags` of the Flow Model.
- `ReportFinding.evidence`, `buildSarifLog`'s `flow` option, and the finding codes `FLOW_POLICY_VIOLATED`, `FLOW_POLICY_INDETERMINATE`, `FLOW_ANALYSIS_INCOMPLETE` and `LEAST_DATA_*`.

The rest of the Evidence Model stays Stable. The new sub-models are optional, so a reader of version 2 reads version 3 unchanged. What the flow pass can and cannot follow is in the [Guide](GUIDE.md#what-it-follows-and-what-it-says-when-it-cannot).

## Private

Never covered by semver; may change in any release:

- Modules and functions not re-exported from an entry point.
- The coordinator's internal registry, canonicalization's exact key format, and array identity's separator and escaping. The documented behaviour around them is Stable; for example, non-canonicalizable input never throws.
- Behaviour not documented in the README, a TSDoc comment on a public export, or an ADR.

## How a change is checked

- **`ApiContract`** (in the `contract` job) diffs each entry point's declarations against a committed baseline. A breaking diff without a changeset of the right bump fails. It compares declarations, not behaviour.
- **`SurfaceContract`** does the same for the CLI help and the Action's inputs and outputs.
- **Behaviour** is held by the tests, and by review against this page.

## Pre-1.0 status

`data-cap` is below 1.0. **Before 1.0, a minor release may include a breaking change to the Stable tier.** This page defines the scope semver will cover; it does not say the scope is frozen at `0.x`.

How a `0.x` bump is chosen: changesets generated from commits are deflated one level below 1.0: a breaking commit releases a minor, a feature a patch. A hand-written `major` changeset is not deflated and publishes 1.0.0. A person merges every version pull request ([RELEASING.md](RELEASING.md)). The Experimental and Private tiers behave the same before and after 1.0.
