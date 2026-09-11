# 0043: env-cap's path-alias resolver is relocated into `src/build/resolution/` and duplicated, not extracted to a shared package

## Status

Accepted. Filed in both `env-cap` and `data-cap`. Implemented in env-cap by
relocating `resolve-import.ts`, `resolve-tsconfig-paths.ts`,
`resolve-package-schema.ts`, `resolve-within-root.ts` (and their tests)
into `src/build/resolution/`, with zero change to `@maverickcer/env-cap/
build`'s public export surface, verified via `npm run verify` and a
git-stash export-list diff before/after; implemented in data-cap by
copying that folder verbatim as the seed for `src/build/resolution/`.

## Context

data-cap's build tooling needs exactly the same specifier-resolution
primitives env-cap's already has — relative-import resolution, tsconfig
path-alias resolution (ADR 0032), cross-package schema resolution — and
the underlying logic is already specifier-target-agnostic (it resolves _a
specifier_ to _a file_; it has no opinion about what kind of schema lives
at that file). Two live options existed: extract a shared package both
repos depend on, or duplicate the logic into data-cap directly.

## Decision

The logic is duplicated, not extracted into a shared package. As a
prerequisite, env-cap's own `src/build/resolve-*.ts` files were first
relocated (an internal reorg only — same public exports, same behavior,
same tests just re-pathed) into their own `src/build/resolution/`
subfolder, to make the boundary of what would be copied explicit and
self-contained. That folder was then copied verbatim into `data-cap/src/
build/resolution/` as data-cap's own starting point; data-cap's build
tooling adapts only the call sites (what gets linked), never the
resolution primitives themselves.

## Consequences

- Each package's `resolution/` folder can evolve independently once
  copied — a data-cap-specific fix or optimization never risks an
  unintended behavior change in env-cap, and vice versa.
- Neither package takes on a third, shared-package dependency (with its
  own versioning, release, and compatibility surface) for logic that,
  while duplicated, is small enough (a handful of files) that the
  duplication cost is genuinely lower than a shared package's overhead.
- The relocation-first step means both repos now describe this logic's
  boundary identically (`src/build/resolution/`), so a future contributor
  moving between the two codebases finds it in the same place either way.

## Alternatives considered

- **Extracting a shared internal package** (e.g.
  `@maverickcer/module-resolution`) both repos depend on. Rejected —
  explicitly, by the user's own scoping decision: "the logic is fairly
  straightforward although it is split across many files and this isn't a
  large enough issue for there to be a generic widely used module resolver
  package." A shared package's release/versioning overhead wasn't judged
  worth it for logic this contained.
- **Leaving env-cap's resolver in `src/build/` unrelocated, copying files
  from scattered locations.** Rejected — the relocation makes the
  copied boundary explicit and self-contained for both the copy itself and
  any future re-sync, rather than requiring a contributor to re-derive
  "which files, exactly" every time.
