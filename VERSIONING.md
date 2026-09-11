# Versioning and API stability

`data-cap` follows [Semantic Versioning](https://semver.org/). This document
defines what that promise actually covers, since "semver" alone doesn't say
which surface it applies to. Three tiers exist, following the same policy
`@maverickcer/env-cap` established:

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
- **`./helpers`**: the `processors`/`identity`/`canonicalize`/`shape`
  namespace shapes and every function they export.
- **`./eslint-plugin`**: the `stable-operation-reference` rule's name and
  its two message IDs (`inlineFunctionLiteral`/`recreatedPerCall`) —
  removing the rule, or renaming a message ID a consumer's own
  `eslint.config.js` might reference, is a breaking change.

## Experimental

Explicitly labeled as such, in the README, the relevant option's own JSDoc,
and the ADR that introduces it. An Experimental surface may change shape —
including in a breaking way — in a minor or patch release, without that
being a semver violation. This is not a loophole for casual churn: a feature
ships Experimental because it is genuinely new enough that real-world
feedback is likely to reveal a better shape. Once a feature has been through
at least one real feedback cycle without a need to break it, its ADR's Status
moves from Proposed/Experimental to Accepted, and it becomes Stable.

- **`./build`** (`discoverCapabilityFiles`, `parseCapabilityFile`,
  `linkCapabilityFiles`, `evaluateLiteral`, and everything under
  `resolution/`): ships Experimental from day one, matching `env-cap`'s own
  policy for the equivalent surface it was ported from
  ([ADR 0032](specs/decisions/0032-tsconfig-path-alias-resolution-ported.md),
  [ADR 0043](specs/decisions/0043-env-cap-resolver-relocated-and-duplicated.md)).
  Cross-package schema discovery (`packages` option) specifically is ported
  from `env-cap` ADR 0014, itself Experimental there.
- **`./runtime`'s `createData`** and its returned capability contract
  (bound operation methods, `runGetters`, `getSnapshot`'s `operations`
  namespace, `describe()`): ships Experimental — a batteries-included
  operations layer composed entirely from the Stable `buildData`/
  `createDataStore`/`coordinator` primitives, new enough that real usage
  may still reveal a better shape for the per-operation state model or
  method signatures
  ([ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md)).

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

`data-cap` has not yet reached a `1.0` release, and no version has been
published yet. Per [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)/
semver convention, **minor versions may include breaking changes to the
Stable tier before 1.0** — this document defines _scope_ (what would
eventually be covered), not a promise that it is already fully locked in at
`0.x`. The Experimental and Private tiers behave the same before and after
1.0: Experimental surfaces may change at any version; Private internals
always may.
