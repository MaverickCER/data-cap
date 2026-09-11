# 0039: The `./helpers` subpath ships `processors`/`identity`/`canonicalize`/`shape`, type-only importing core

## Status

Accepted. Implemented in `src/helpers/{processors,identity,canonicalize,
shape,index}.ts`.

## Context

An earlier framing (carried over from env-cap's own `helpers.validators`
concept) considered a "validators" namespace — but data-cap has no
per-field validator vocabulary at all (ADR-adjacent to ADR 0003/0005: a
field's own runtime type, plus `resolveOperationPatch`'s shape check, are
the only validation this package performs; there's no developer-defined
business-rule validator system to expose convenience helpers for). Naming
a namespace "validators" would misleadingly imply that vocabulary exists.

## Decision

`./helpers` ships four namespaces, each a thin, optional convenience layer
over something core/runtime already does internally: `processors`
(coercion helpers like `toNumber`/`toBoolean` for use inside a hand-
written `processor(raw, ctx)` function — never throwing, since a
processor's returned patch already runs through ownership/shape checking
downstream); `identity` (`computeItemIdentity`/`reconcileArrayInfo`, the
exact primitives the standalone runtime would use internally, exposed for
application code building its own array-info wiring); `canonicalize` (the
same primitive `identity` and the coordinator's dedup key both use
internally); and `shape` (structural — never business-rule — type guards
like `isPlainObject`/`isDate`, explicitly not a validator system). None of
`createData`/the runtime import this module — it's genuinely optional
convenience, provable by its complete absence from every other entry
point's dependency graph.

## Consequences

- The naming itself ("processors"/"identity"/"canonicalize"/"shape," never
  "validators") stays honest about what vocabulary this package actually
  has, avoiding a false expectation carried over from env-cap's different
  design.
- Every helper here is separately tree-shakeable within the one `./helpers`
  entry (verified directly by `test/helpers/tree-shaking.test.ts`), so an
  application using only `processors` never pays for `shape`'s code.
- Because `identity`/`canonicalize` are the _exact_ functions the runtime
  would use internally (re-exported, not reimplemented), an application
  building custom array-info wiring gets the same reference-stable
  reconciliation guarantee (ADR 0010) the standalone runtime itself relies on.

## Alternatives considered

- **A `validators` namespace, mirroring env-cap.** Rejected — data-cap
  deliberately has no per-field validator concept; shipping a namespace
  named for one would misrepresent the package's own architecture.
- **Folding these helpers into core/runtime's own public barrel instead of
  a separate subpath.** Rejected — these are optional conveniences, not
  load-bearing for `createData`/the standalone runtime to function; a
  separate subpath keeps that optionality structurally provable (ADR
  0034's same reasoning) rather than merely documented.
