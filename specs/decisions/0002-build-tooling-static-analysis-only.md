# 0002: Build tooling is static-analysis-only — never `import()`, `require()`, or `eval()` a discovered file

## Status

Accepted. Implemented in `src/build/parse.ts`, `src/build/literal-eval.ts`,
`src/build/discover.ts`, `src/build/link.ts`. Enforced by
`eslint.config.js`'s `no-eval`/`no-implied-eval`/`no-new-func` rules on
`src/build/**`.

## Context

Discovering and linking `createData`/`documentData` calls across a
project requires reading each candidate file's `fields` shape. The
simplest implementation would `import()` the file and inspect the real,
executed `createData()` return value — but that means build tooling
(running in CI, in an editor extension, in a pre-commit hook) executes
arbitrary application code, including code that talks to a database, makes
a network call, or has side effects on module load. This is the same
constraint env-cap's own build tooling already lives under (its ADR 0002),
and data-cap inherits it directly rather than re-deriving it.

## Decision

Every build-tooling module discovers, parses, and links capability files
using the TypeScript Compiler API (`ts.createSourceFile()`) to build an
AST, and nothing else. `literal-eval.ts` evaluates only a narrow,
explicitly allow-listed grammar of statically-safe expression forms
(object/array literals, string/number/boolean/null literals, `Date`/`URL`/
`RegExp`/`Map`/`Set` constructor calls with literal arguments, and
`fields.nullable`/`fields.optional` marker calls — see ADR 0033). Anything
outside that grammar resolves as "unknown," surfaced as a `ParseWarning`,
never guessed at and never executed to find out.

## Consequences

- Build tooling is safe to run against untrusted or partially-written
  source (an editor's live buffer, a fork's PR branch) without incurring
  side effects.
- A capability whose `fields` value is constructed via a function call,
  spread, or conditional expression is reported as unresolvable rather
  than silently wrong — a real limitation, not a defect, and one that
  pushes capability authors toward declaring `fields` as a plain literal
  (or a simple aliased one), which is also the more readable form.
- `no-eval`/`no-implied-eval`/`no-new-func` are enforced by lint, not just
  documented, so a future contributor can't accidentally reintroduce a
  dynamic-execution path without a CI failure.

## Alternatives considered

- **`import()`ing the file and inspecting the real return value.**
  Rejected — executes arbitrary application code as a side effect of
  running build tooling, the exact hazard this decision exists to avoid.
- **A sandboxed VM (`node:vm`) to execute discovered code safely.**
  Rejected — a sandbox narrows but does not eliminate the risk (network/
  timing side channels, resource exhaustion), and adds meaningful
  implementation complexity for a benefit (supporting fully-dynamic
  `fields` construction) this design intentionally does not aim for.
