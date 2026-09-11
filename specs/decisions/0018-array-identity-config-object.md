# 0018: Array identity is a config object mirroring `fields`, never a dot-notation string or a callback

## Status

Accepted. Implemented in `src/core/types.ts` (`IdentityConfig<T>`,
`IdentityKeys<Item>`).

## Context

Declaring which field(s) identify an array item needs an API that's both
statically checkable (a typo in a field name should be a compile error,
not a silent runtime miss) and structurally close to how `fields` itself
is declared, so identity configuration reads as part of the same schema
rather than a bolted-on, differently-shaped concept.

## Decision

`IdentityConfig<T>` mirrors the `fields` shape itself: an array's identity
is declared as `IdentityKeys<Item>` (`readonly (keyof Item & string)[]` —
`["id"]`, or `["postId", "commentId"]` for a composite key), and nested
identity configuration follows the same object shape `fields` has,
recursively. It is never a dot-notation path string, and never a callback
function — deliberately, and deliberately not React's "key" terminology,
since this is a data-oriented identity concept, not a rendering one.

## Consequences

- `keyof Item & string` means an identity key that doesn't exist on the
  item type is a compile-time TypeScript error, not a silent runtime
  no-op.
- A composite identity (multiple fields together forming one identity) is
  expressed the same way a single-field identity is — an array of key
  names — with no special-cased API shape for the multi-key case.
- Because identity configuration structurally mirrors `fields`, a reader
  already familiar with a capability's `fields` declaration can read its
  identity configuration with no new mental model.

## Alternatives considered

- **A dot-notation string path** (`identity: "id"` or `"post.id"`).
  Rejected — loses compile-time checking against the actual item shape,
  and composite keys would need an ad hoc multi-path syntax.
- **A callback function** (`identity: (item) => item.id`). Rejected —
  opaque to static analysis (the build tooling in ADR 0002 can't safely
  execute a callback to learn what it does), and a callback can't be
  compared for "did the caller declare an identity at all" the way a
  plain array of key names can (ADR 0020 depends on that distinction).
