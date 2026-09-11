# 0045: Type-level tests always pair `expectTypeOf` positive assertions with explicit `// @ts-expect-error` negative assertions

## Status

Accepted. Implemented across `test/core/{fields,types,create,document,
identity}.test.ts` and equivalents.

## Context

A type-level guarantee this design depends on (a function can't be a field
default, a getter's processor can't return a field outside its declared
ownership, `data.fields`/`data.info` are `readonly`) is only actually
proven by a test that shows the _invalid_ construct genuinely fails to
type-check — a positive test alone (showing the valid construct type-
checks correctly) says nothing about whether the type system would
actually reject the mistake it's supposedly there to prevent. A type
definition can drift to silently stop rejecting something it once did,
with no runtime test able to notice, since the whole point is a compile-
time-only guarantee.

## Decision

Every core module with public type surface gets both `expectTypeOf`-based
positive assertions (mirroring env-cap's own `test/runtime/types.test.ts`
convention) _and_ explicit `// @ts-expect-error` compile-time negative
tests proving specific known-invalid constructs genuinely fail to
type-check: a function as a field default; a cyclic-shaped type as a field
default; dot-notation string access into `fields`/`info`; a getter
processor returning a field outside its declared ownership; excess/
unlisted properties in a processor's returned patch; direct assignment
into `data.fields.*`/`data.info.*` (both `readonly`); a plain object where
`fields.nullable`/`fields.optional` was declared without going through the
helper. Both kinds of test live inline in the same `*.test.ts` file as the
module they pin — no separate `tsd`-based type-test tree.

## Consequences

- A type-system regression (a change that accidentally makes an invalid
  construct type-check) is caught the same way a runtime regression is —
  by a test failing — rather than silently shipping unnoticed until a
  consumer hits it.
- Because negative tests live alongside their positive counterparts in the
  same file, a reader auditing one module's type guarantees sees both
  halves ("this works," "this specifically doesn't") in one place.
- `npm run typecheck` itself is what proves both directions: `// @ts-
expect-error` on a line that _doesn't_ actually error is itself a type
  error under `"expectError"` semantics, so a silently-fixed "bug" (the
  invalid construct starts type-checking) fails the build, not just the
  intended-passing test.

## Alternatives considered

- **Positive `expectTypeOf` assertions only.** Rejected — proves the valid
  case works, says nothing about whether the invalid case is actually
  rejected; a type definition could regress to accept everything and every
  positive test would still pass.
- **A separate `tsd`-based type-test package/tree.** Rejected — adds a
  second, differently-configured test toolchain for type-level assertions
  when `expectTypeOf` (already a `vitest` capability) plus inline `// @ts-
expect-error` covers both directions within the existing test suite.
