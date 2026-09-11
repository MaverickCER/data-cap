# 0012: An individually-invalid processed field resets to its own schema default; the walk descends to the smallest invalid leaf

## Status

Accepted. Implemented in `src/core/ownership.ts` (`resolveOperationPatch`),
`src/core/schema.ts` (`checkValueAgainstSchema`, `resolveFieldDefaults`).

## Context

A processor's returned patch can be individually wrong at any depth — a
nested `user.profile` object that doesn't match its declared shape, while
`user.preferences` right next to it is perfectly valid. Resetting the
_entire_ patch (or the entire top-level field) because one nested leaf is
malformed would discard real, valid sibling data for no reason; silently
keeping the malformed value would let bad data into `fields`.

## Decision

`resolveOperationPatch`'s `walk()` always recurses into plain-object
schema children itself (never delegating nested-object handling to a
separate, less-granular shape checker), so a leaf value that fails its
shape check resets to _that leaf's own_ schema default — via
`resolveFieldDefaults`, the exact same defaulting logic `createData()`
uses for the initial snapshot — while every sibling leaf and every
ancestor branch structure survive untouched. `{ user: { profile:
<malformed>, preferences: <valid> } }` resets only `profile`; `preferences`
and the `user` branch itself remain intact.

## Consequences

- A malformed field never corrupts `fields` with a wrong-shaped value, and
  never costs an application the rest of an otherwise-good operation's
  result.
- The reset value is exactly what a fresh `createData()` would have
  produced for that leaf — never a placeholder value invented ad hoc, and
  never silently `undefined` unless the field's own schema says so.
- This is a per-field-value concern, categorically separate from a thrown
  processor (ADR 0013) — a thrown processor never reaches this walk at
  all, since the whole operation has already failed by that point.

## Alternatives considered

- **Reset the entire top-level field (or the whole patch) on any nested
  invalidity.** Rejected — discards valid sibling data (like
  `preferences` in the example above) for no benefit over the
  finer-grained reset.
- **Silently drop the invalid leaf instead of resetting it to a default.**
  Rejected — leaves `fields` in a structurally incomplete state (a branch
  missing a key the schema declares), instead of the well-defined,
  always-present default state every other field maintains.
