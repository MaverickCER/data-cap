# 0033: `literal-eval` is extended with an explicit allowlist of side-effect-free constructors

## Status

Accepted. Implemented in `src/build/literal-eval.ts`.

## Context

A `fields` schema legitimately wants to declare a default of a type
`JSON`-literal syntax can't express directly — a `Date`, a `URL`, a
`RegExp`, a `Map`, or a `Set` — and the static-analysis-only constraint
(ADR 0002) means `literal-eval.ts` must recognize these forms without
ever executing arbitrary code to do so.

## Decision

`literal-eval.ts`'s grammar explicitly allow-lists `new Date(...)`, `new
URL(...)`, `new RegExp(...)`, `new Map(...)`, and `new Set(...)` — each
recognized by name, with their own arguments recursively evaluated
through the same safe grammar (so `new Date("2024-01-01")` is fine, but
`new Date(someFunctionCall())` is not, since the argument itself must also
be statically evaluable). It additionally recognizes `fields.nullable(...)`
and `fields.optional(...)` marker calls directly, importing the real
`FIELD_MARKER` symbol from `core/fields.ts` so the recognized form is
never a lookalike guess at what those markers produce.

## Consequences

- A capability's schema can declare a `Date`/`URL`/`RegExp`/`Map`/`Set`
  default and have build tooling correctly discover its shape, without
  that discovery ever requiring code execution.
- The allowlist is a closed, auditable set — extending it to a new
  constructor is a deliberate, reviewable change, not an accidental
  expansion of what "safe to statically evaluate" means.
- Because the marker recognition imports the real `FIELD_MARKER` symbol
  (rather than pattern-matching on the call's syntactic shape alone),
  build tooling's understanding of `fields.nullable`/`fields.optional`
  can never drift out of sync with the runtime's own definition of them.

## Alternatives considered

- **No constructor allowlist — only plain object/array/primitive
  literals.** Rejected — would make `Date`/`URL`/`RegExp`/`Map`/`Set`
  defaults unresolvable by build tooling, degrading every such field to a
  "could not statically resolve" warning for a legitimate, common pattern.
- **A general-purpose "safe constructor" heuristic** (e.g. any constructor
  whose name matches a common pattern, without an explicit list).
  Rejected — an allowlist is the only way to guarantee every recognized
  form is genuinely side-effect-free; a heuristic risks accepting
  something that isn't.
