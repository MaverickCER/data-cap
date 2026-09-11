# 0032: tsconfig path-alias resolution is ported design-for-design from env-cap ADR 0023

## Status

Accepted. Implemented in `src/build/resolution/resolve-tsconfig-paths.ts`
(and the whole `resolution/` folder, relocated from and duplicated
verbatim out of env-cap — see ADR 0043 for that relocation itself).

## Context

Resolving a bare specifier through a project's own `tsconfig.json`
`paths`/`baseUrl` (longest-prefix matching, `*` wildcard substitution,
multiple fallback targets, `extends`-chain merging, JSONC parsing) is a
genuinely intricate algorithm that TypeScript's own compiler already
implements correctly. env-cap solved exactly this problem already, for
exactly the same category of static-analysis-only build tooling, in its
own ADR 0023.

## Decision

data-cap's alias resolution delegates the actual matching algorithm
entirely to `ts.resolveModuleName()` and `ts.parseJsonConfigFileContent()`
— the same functions `tsc`/`tsserver` themselves use — rather than
reimplementing any part of it. This module's own logic is limited to
loading the config, caching resolutions per run, and enforcing the
`node_modules` safety boundary, exactly mirroring env-cap ADR 0023's own
scope. Alias resolution runs on by default (auto-detecting
`root/tsconfig.json`), ahead of package resolution (ADR 0040's cross-
package mechanism) in `resolveImportSpecifier`'s precedence order, since
it resolves the consuming project's own already-trusted local source.

## Consequences

- Path-alias behavior matches what a developer's own editor/`tsc` already
  shows them — no second, subtly-different alias-resolution
  implementation to keep in sync with TypeScript's own evolving semantics.
- The `resolution/` folder's logic and tests are directly portable between
  env-cap and data-cap (see ADR 0043), since both packages now solve this
  exact problem the same way.
- `test/integration/build-tooling/tsconfig-aliases/` in this package demonstrates the same
  `@schemas/*`-style alias pattern env-cap's own equivalent example does.

## Alternatives considered

- **Reimplementing `paths`/`baseUrl` matching independently.** Rejected —
  duplicates real complexity (`extends`-chain merging, wildcard
  substitution edge cases) TypeScript's compiler already gets right, with
  a high risk of subtle divergence from what `tsc` itself would resolve.
- **Requiring explicit, alias-free relative imports for anything build
  tooling needs to discover.** Rejected — would force projects using path
  aliases (a common, ordinary TypeScript convention) to avoid them
  specifically for capability files, an awkward, surprising constraint.
