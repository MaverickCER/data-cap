# Versioning and API stability

`data-cap` follows [Semantic Versioning](https://semver.org/). This document
defines what that promise actually covers, since "semver" alone doesn't say
which surface it applies to. Three tiers exist, following the same policy
`@maverickcer/env-cap` established (`data-cap` itself is published unscoped):

## Stable

Covered by semver. A breaking change to any of the following requires a
major version bump (once the package reaches 1.0 — see
[Pre-1.0 status](#pre-10-status) below):

- **Public core APIs** (`.`): `buildData`, `documentData`, `fields.nullable`,
  `fields.optional`, and the exported error classes from the package root.
- **The `DataState`/`DataInfo`/`FieldInfo`/`DataStatus`/`DataError`/
  `SubscriptionInfo`/`DataStore` type shapes** and the invariants documented
  for them in `specs/architecture.md` (mandatory `info`, atomic
  `fields`+`info` commits, sparse-but-present metadata, identity-diffed array
  reconciliation).
- **`./runtime`**: `createDataStore` and its `DataStoreController` contract
  (`getSnapshot`/`subscribe`/`commitAuthoritative`/`addPendingTransition`/
  `removePendingTransition`/`getAuthoritativeState`); `defaultCoordinator`/
  `createCoordinator()` and the `Coordinator` contract (`dedupe`/
  `acquireSubscription`); `composeSignals`/`rejectOnAbort`.
- **`./runtime/cache`**: `createDataCache` and the `DataCache` contract.
- **`./runtime/retry`**: `withRetry`, `isStillDefault`.
- **`./node`** (`nodeBuildFileSystem`): the only sanctioned way to give `./build` a filesystem, and
  required by every generator script `init` scaffolds.
- **`./evidence`** (`defineEvidenceProjection` and the `EvidenceModel` shape it projects over), and the
  persisted evidence artifact.
- **The composite GitHub Action** (`action.yml`): its input and output names and meanings, and the PR
  comment's sections. The major tag it is used through (`uses: MaverickCER/data-cap@v0` while the
  package is 0.x, `@v1` from 1.0.0) moves only within a major version.
- **Supported toolchain**: Node.js `>=22`; the TypeScript versions named in the `typescript` peer range
  (`^5 || ^6 || ^7`). The build-time scanner needs TypeScript's classic compiler API, which TypeScript 7
  does not ship, so it uses the consumer's `typescript` when that has the API and otherwise the bundled
  `@typescript/typescript6` (inside the package, build entry only) -- no configuration, and `tsc` stays TypeScript 7
  ([ADR 0069](specs/decisions/0069-typescript-7-scanner-uses-a-bundled-typescript-6.md)). Under
  TypeScript 7 the `./build` and `./evidence` declarations need `skipLibCheck`; the runtime, helpers
  and node entry points type-check strictly; and `moduleResolution` `node16`/`nodenext`/`bundler` (not the legacy `node10`).
- **`./helpers`**: the `processors`/`identity`/`canonicalize`/`shape`
  namespace shapes and every function they export.
- **`./eslint-plugin`**: every rule's name and message IDs
  (`stable-operation-reference`'s `inlineFunctionLiteral`/`recreatedPerCall`;
  `no-fields-escape`'s message IDs) — removing a rule, or renaming a message
  ID a consumer's own `eslint.config.js` might reference, is a breaking
  change.
- **`./build`** (`discoverCapabilityFiles`, `parseCapabilityFile`,
  `linkCapabilityFiles`, `evaluateLiteral`, and everything under
  `resolution/`, including the `--package`/`--tsconfig` CLI flags and
  cross-package schema discovery (`packages` option)):
  ported from `env-cap`'s equivalent surface
  ([ADR 0032](specs/decisions/0032-tsconfig-path-alias-resolution-ported.md),
  [ADR 0043](specs/decisions/0043-env-cap-resolver-relocated-and-duplicated.md)),
  promoted to Stable per [ADR 0065](specs/decisions/0065-promote-build-createdata-and-cli-flags-to-stable.md)
  after a full feedback cycle with no need to break it.
- **`./runtime`'s `createData`** and its returned capability contract
  (bound operation methods, `runGetters`, `getSnapshot`'s `operations`
  namespace, `describe()`): a batteries-included operations layer composed
  entirely from the `buildData`/`createDataStore`/`coordinator` primitives
  above ([ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)),
  promoted to Stable per [ADR 0065](specs/decisions/0065-promote-build-createdata-and-cli-flags-to-stable.md)
  after a full feedback cycle with no need to break it.

## Experimental

Explicitly labeled as such, in the README, the relevant option's own JSDoc,
and the ADR that introduces it. An Experimental surface may change shape —
including in a breaking way — in a minor or patch release, without that
being a semver violation. This is not a loophole for casual churn: a feature
ships Experimental because it is genuinely new enough that real-world
feedback is likely to reveal a better shape. Once a feature has been through
at least one real feedback cycle without a need to break it, its ADR's Status
moves from Proposed/Experimental to Accepted, and it becomes Stable.

Nothing currently ships Experimental — see [ADR 0065](specs/decisions/0065-promote-build-createdata-and-cli-flags-to-stable.md)
for the most recent promotion. A future feature genuinely new enough to
warrant it will be added here, explicitly, with its own ADR.

## Private

Never covered by semver, may change at any time without notice:

- Internal modules and functions not re-exported from a documented entry
  point.
- The coordinator's internal registry structure, canonicalization's exact
  key format, and array-identity's exact separator/escaping scheme — the
  _behavioral guarantees_ around these (e.g. "non-canonicalizable input never
  throws," "identity collisions never silently merge distinct items") are
  Stable once documented; their literal implementation is not.
- Any behavior not documented in the README, a JSDoc comment on a public
  export, or an ADR.

## Pre-1.0 status

`data-cap` has not yet reached a `1.0` release; published `0.x` versions are
available on npm. Per [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)/
semver convention, **minor versions may include breaking changes to the
Stable tier before 1.0** — this document defines _scope_ (what would
eventually be covered), not a promise that it is already fully locked in at
`0.x`.

How a `0.x` bump is chosen: the shared release tooling from `internal-package-contract` deflates one
level below 1.0.0 -- a breaking change releases a minor, a feature a patch, and the API-contract gate
requires only a minor for a breaking API diff -- so **nothing automated can publish `1.0.0`**. Crossing
to 1.0.0 takes a human-authored `major` changeset, and that release pull request is not auto-merged.
The Experimental and Private tiers behave the same before and after 1.0: Experimental surfaces may
change at any version; Private internals always may.
