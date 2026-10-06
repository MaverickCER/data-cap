# 0068: The ESLint plugin does not vendor `@typescript-eslint/*`

## Status

Accepted.

## Context

`./eslint-plugin` used to inline `@typescript-eslint/{utils,types,visitor-keys,scope-manager}` and
`eslint-visitor-keys` into its bundle (about 413 KB per format). A consumer's `npm audit`, Dependabot
and Socket then could not see those packages (an advisory never reaches users), their versions were
frozen at build time, and the vendored text was most of what supply-chain scanners flagged in the
published tarball. `./eslint-plugin` is a public subpath, so changing it after 1.0.0 would be breaking.

## Decision

Keep the subpath. Declare `@typescript-eslint/utils` as an optional peer (`^8.0.0`), mark it external
in the bundle, and take `AST_NODE_TYPES`, `TSESTree` and the scope types from it instead of from
`@typescript-eslint/types` and `scope-manager` (its own dependencies). Anyone linting TypeScript with
ESLint already has it through `typescript-eslint`.

## Consequences

A project that uses `./eslint-plugin` must have `@typescript-eslint/utils` installed. Mirrors
env-cap's ADR 0048.
