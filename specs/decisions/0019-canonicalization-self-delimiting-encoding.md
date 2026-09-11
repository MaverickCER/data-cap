# 0019: Canonicalization uses a self-delimiting, type-tagged encoding — never a reserved-separator scheme

## Status

Accepted. Implemented in `src/core/canonicalize.ts`. Covered by
property-based tests (`test/core/canonicalize.test.ts`), not just
example-based ones.

## Context

Both array identity key computation (ADR 0018) and coordinator dedup key
computation (ADR 0028) need to turn an arbitrary runtime value into a
single, deterministic, comparable string — one that never conflates two
distinct values (`1` and `"1"`, `NaN` and any other number) and never lets
one value's own content masquerade as a delimiter and collide with an
unrelated value.

## Decision

Every value canonicalizes to a self-delimiting "atom" — `<tag><byteLen>:
<payload>` — where composite values (arrays, objects) concatenate their
already-self-delimiting children's atoms directly, with no separator
character between them, and therefore nothing that needs escaping. Each
atom carries its own payload length, so two distinct logical values can
never produce an identical canonical string through one value's content
leaking into where a delimiter would otherwise be expected. Type is part
of the tag, not inferred from content, so `1` (number) and `"1"` (string)
always canonicalize differently. A value that can't be safely
canonicalized (a function, a symbol, a cyclic reference, an object
carrying `__proto__`/`constructor`/`prototype` as an own key) returns
`undefined` — never throws, never silently collides.

## Consequences

- The entire class of separator-escaping bugs (a value containing the
  chosen delimiter character corrupting the encoding) doesn't exist in
  this scheme, structurally, rather than being defended against case by
  case.
- Equal inputs always produce equal canonical strings, and distinct
  supported values never collide — verified by property-based tests
  generated over randomized nested shapes, not just hand-picked examples.
- Both array identity keying and coordinator dedup keying share this exact
  primitive, so their collision-avoidance guarantees are proven once,
  centrally, rather than re-implemented (and potentially re-broken)
  independently in two places.

## Alternatives considered

- **A reserved-separator scheme** (e.g. join components with `|`, escape
  literal `|` characters within a component). Rejected — escaping bugs are
  a well-known, recurring source of real-world collision vulnerabilities
  in exactly this kind of scheme; the self-delimiting design avoids the
  whole category rather than trying to get the escaping right.
- **`JSON.stringify` as the canonical form.** Rejected — doesn't
  distinguish `1` from `"1"`'s JSON encoding as cleanly at a glance, has
  no defined behavior for `undefined`/functions/symbols/cycles (throws or
  silently drops keys), and key order isn't canonical without an extra
  sorting pass this design needed anyway.
