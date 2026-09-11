# 0038: The `eslint-plugin` ships exactly one rule: `stable-operation-reference`

## Status

Accepted. Implemented in `src/eslint-plugin/stable-operation-reference.ts`.

## Context

`coordinator.dedupe`/`acquireSubscription`'s sharing boundary is function
identity (ADR 0026, ADR 0028) — an inline arrow function passed as
`execute`/`subscribe` is a fresh identity every time the surrounding code
runs, silently defeating sharing in a way that's easy to write
accidentally and hard to notice without specifically knowing to look for
it. This is the one mistake class specific enough to this package's own
architecture (identity-based sharing) to warrant a dedicated lint rule,
rather than something a general-purpose rule already catches.

## Decision

The plugin ships exactly one rule. It flags two distinct but related
mistakes inside a `createData()` call's `execute`/`subscribe` values: an
inline function literal (a fresh identity every time), and a reference
that _looks_ stable syntactically (an identifier, not a literal) but
resolves — via real scope analysis, not just AST shape — to a binding
declared inside a function, which is just as fresh an identity every time
that function runs. It matches `createData(...)`/`dataCap.createData(...)`
calls by name alone (not import provenance), the same pragmatic convention
`src/build/parse.ts` already uses, and deliberately does not attempt to
prove stability through a `CallExpression`, a `MemberExpression`, a
conditional, or cross-module aliasing — those are outside what static
analysis can reliably decide, and the runtime coordinator's own behavior
stays correct independent of this rule either way.

## Consequences

- The single most impactful, package-specific mistake (accidentally
  defeating coordinator sharing) has a lint rule pointing at it directly,
  rather than being a silent performance/correctness surprise a developer
  only discovers by noticing dedup isn't happening.
- Keeping the plugin to one rule keeps its own maintenance and testing
  surface small, matching this package's general preference for narrow,
  well-tested primitives over broad, speculative tooling.
- `test/integration/build-tooling/eslint-plugin-usage/` runs this exact rule, through ESLint's
  own Node API, against real fixture code — proving both the
  false-negative-free "stable reference never flagged" case and both
  positive cases (inline literal, recreated-per-call) work as documented.

## Alternatives considered

- **A broader rule set covering other stylistic conventions.** Rejected —
  every other convention this package cares about (ownership boundaries,
  shape correctness) is already enforced at runtime (ADR 0005) or by
  TypeScript's own type system; a lint rule is reserved for the one
  mistake class neither of those catches.
- **Proving stability through deeper static analysis** (cross-module
  aliasing, call-expression results). Rejected — genuinely undecidable in
  the general case without executing code (which ADR 0002 already rules
  out for build tooling, and applies here too), so the rule stays
  deliberately scoped to what it can prove soundly.
