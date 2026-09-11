# 0011: Getters declare explicit field ownership; mutators default to full-tree ownership bounded to the declared schema

## Status

Accepted. Implemented in `src/core/types.ts` (`FieldOwnership<T>`),
`src/core/ownership.ts`.

## Context

A getter and a mutator have different natural defaults for "which fields
can this operation write." A getter is typically narrow and specific (a
`getUser` getter writes the `user` field, not the whole capability), so
requiring an explicit ownership declaration keeps that scope visible and
enforced. A mutator is often broad by nature (an `updateUser` mutator may
legitimately touch several related fields at once), and requiring an
exhaustive ownership list for every mutator would be repetitive
boilerplate for the common case, with a typo in that list being just as
easy a mistake as omitting the declaration entirely.

## Decision

A getter's `fields` ownership declaration is required and explicit —
`FieldOwnership<InferFields<TFields>>`, where `true` at any node claims
that whole subtree. A mutator's `fields` declaration is optional; omitting
it defaults to full-capability-tree ownership, but that default is always
_bounded to the capability's own declared schema_ — a mutator can never
introduce a field the schema doesn't declare, typo or not. A write to an
unowned or undeclared key is dropped (never applied), with a dev-mode
warning identifying `{operation, path, reason}` — never the value itself
(see ADR 0005).

## Consequences

- A getter's declared ownership doubles as living documentation of exactly
  what it can affect — readable directly from its `createData()` config.
- A mutator author doesn't pay a declaration tax for the common "this
  mutator can touch anything the schema allows" case, while still getting
  the same typo-safety a getter's explicit list provides (a typo'd key is
  dropped and warned about, never silently created).
- `resolveOperationPatch` (ADR 0012) walks the _smallest_ declared or
  inferred ownership boundary at every level, so a nested partial-ownership
  declaration is honored exactly as precisely as a top-level `true` would be.

## Alternatives considered

- **Explicit ownership required for both getters and mutators.** Rejected
  — makes the common, broad mutator case needlessly verbose without a
  corresponding safety benefit the schema-bounded default doesn't already
  provide.
- **Implicit full ownership for both, with no declaration at all.**
  Rejected for getters specifically — a getter's fields are typically
  narrow, and losing that visible boundary would make it harder to reason
  about which operation is responsible for which piece of state.
