# 0034: Optional runtime features ship as separate tsup entries/exports subpaths, not just named exports

## Status

Accepted. Implemented in `tsup.config.ts` (`runtime-cache`, `runtime-retry`
as their own build entries) and `package.json#exports`
(`./runtime/cache`, `./runtime/retry`).

## Context

`runtime/cache` and `runtime/retry` are both genuinely optional — many
applications use the standalone runtime's store/coordinator without either
— and relying on named-export tree-shaking alone (bundling both into one
`./runtime` entry and trusting a consumer's own bundler to shake out the
unused half) makes the "pay only for what you use" guarantee dependent on
how sophisticated that consumer's own bundler happens to be.

## Decision

`runtime/cache.ts` and `runtime/retry.ts` are each their own tsup build
entry, producing their own `dist/runtime/cache.js`/`dist/runtime/retry.js`
files, exposed as their own `package.json#exports` subpaths (`./runtime/
cache`, `./runtime/retry`). Importing one never pulls the other's code in
at all — not because a bundler successfully shook it out, but because it
was never in the same file to begin with. `test/runtime/tree-shaking.test.ts`
pins this structurally (asserting neither dist file's content leaks into
the other), rather than re-proving it via a downstream-bundler round trip
the way `test/helpers/tree-shaking.test.ts` has to for `./helpers`'s four
namespaces sharing one file.

## Consequences

- The "pay only for what you use" guarantee for cache/retry holds
  regardless of a consumer's bundler sophistication (or the total absence
  of one, e.g. a plain `<script type="module">` import).
- Each entry point can independently evolve its own dependency footprint
  (should either ever need one) without affecting the other's size budget
  (ADR-adjacent — see `scripts/check-size.mjs`'s per-entry budgets).
- The regression test for their independence is cheap and direct (file
  content inspection) rather than needing a real bundler invocation, since
  the guarantee is structural rather than something a bundler has to earn.

## Alternatives considered

- **Named exports from one `./runtime` entry, relying on tree-shaking.**
  Rejected — the guarantee becomes conditional on the consumer's own
  tooling, which this package can't verify or control; a consumer using a
  less sophisticated bundler (or none) would pay for both regardless of
  which they actually use.
- **A single combined `./runtime/extras` entry for both cache and retry.**
  Rejected — still couples two genuinely independent, separately-optional
  features together; an application wanting only retry would still pay
  for cache's code.
