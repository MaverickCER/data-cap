# 0007: `DataInfo` is a mandatory half of `DataState` — never optional or separately tree-shakeable

## Status

Accepted. Implemented in `src/core/types.ts` (`DataState<TFields>`),
`src/core/create.ts`.

## Context

An earlier draft of this design treated `info` (execution metadata —
status, error, source, timestamps) as an opt-in, separately
tree-shakeable "metadata feature," on the theory that an application not
interested in loading/error UI shouldn't pay for metadata it never reads.
In review, this was identified as the wrong performance mechanism: an
optional `info` would mean `DataState` sometimes has an `info` key and
sometimes doesn't, forcing every piece of code that touches a `DataState`
— the store, the coordinator, every example, every consumer — to branch
on whether metadata is even present, for a memory/bundle-size saving that
sparsity (ADR 0007's own mechanism, below) already delivers without the
API-shape cost.

## Decision

`DataState<TFields> = { readonly fields: TFields; readonly info:
DataInfo<TFields> }` — both members are always present, always populated
together (see ADR 0008 for the atomicity half of this). There is no
separate `data-cap/info` entry point and no configuration
that removes `info` from a `DataState`. The performance property "don't
pay for metadata on fields nothing has touched yet" is delivered instead
by **structural sparsity**: `info` starts as `{}` and only ever grows
entries for fields something has actually executed against — no eagerly
allocated metadata tree at `createData()` time.

## Consequences

- Every `DataState` has exactly one shape, unconditionally — no code
  anywhere needs to check `if (state.info)` before reading it.
- Sparsity, not removability, is what keeps an untouched capability's
  `info` cheap: `capability.info` is `{}` (a single empty object) until
  something commits against it, regardless of how many fields the
  capability declares.
- Reference-stable reconciliation (ADR 0010) depends on `info` always
  being present and structured the same way `fields` is — an optional
  `info` would complicate exactly the diffing logic that makes array
  identity reconciliation cheap.

## Alternatives considered

- **`info` as an optional property, present only once something executes.**
  Rejected — this is the design this ADR directly supersedes; it forces
  every consumer to branch on presence for a saving sparsity already
  provides without the branching cost.
- **A separate `data-cap/info` entry point, opted into
  explicitly.** Rejected — `info` is not a separable feature; the store,
  atomicity, and no-op-suppression mechanics (ADR 0008, ADR 0042) all
  depend on `fields` and `info` being one inseparable unit from the start.
