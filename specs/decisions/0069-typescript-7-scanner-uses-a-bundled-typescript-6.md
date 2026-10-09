# 0069: With TypeScript 7 installed, the build-time scanner uses a bundled TypeScript 6

## Status

Accepted. Implemented in `src/build/typescript.ts`. Replaces the "TypeScript major that removes the
classic API is unsupported" rule in `VERSIONING.md`'s Supported toolchain.

## Context

The build-time scanner (`src/build/parse.ts`, `scan-dependencies.ts`, `dependency-graph.ts`, `link.ts`, `literal-eval.ts`,
`source-position.ts`, `resolution/resolve-tsconfig-paths.ts`) is written against TypeScript's classic compiler API
(`createSourceFile`, the `is*` guards, `SyntaxKind`). TypeScript 7.0 is a native rewrite that ships
no programmatic API: its `typescript` entry exports only `version` and `versionMajorMinor`. TypeScript
7.1 will ship a new, different API. 7.0's `typescript/unstable/*` subpaths exist but are explicitly
unstable and are replaced in 7.1, so building on them would mean migrating twice.

`VERSIONING.md` made a TypeScript major without the classic API unsupported for the build step. That left a developer on `typescript@7`
choosing between an `ERESOLVE` at install (the old peer range) and, after widening it, a scanner that
refuses to run until they rework their `package.json`.

Microsoft publishes `@typescript/typescript6`, a ~10 KB package whose only job is to expose
TypeScript 6 (`typescript@^6`, installed under the alias `@typescript/old`) as a normal, stable module.

## Decision

- The optional `typescript` peer is `^5.0.0 || ^6.0.0 || ^7.0.0`.
- `@typescript/typescript6` (`^6.0.2`) is a dependency **and a `bundleDependencies` entry, together with
  its `@typescript/old` payload**: it ships inside this package's tarball, nested under the package's own
  `node_modules/`. It is the first runtime dependency of this package.
- It belongs to the build entry alone. `scripts/verify-compiler-isolation.mjs` walks the static import
  graph of every built entry point and fails the build if the runtime, helpers, evidence, node or ESLint
  plugin entry can reach the bundled compiler, the loader's `node:module`, or `typescript` itself -- and
  fails if the build entry cannot, so the check cannot pass vacuously. A bundler following a client import
  never reaches the compiler's bytes.
- `src/build/typescript.ts` resolves the compiler synchronously, once, **by capability, never by
  version**: the consumer's `typescript` if it exposes `createSourceFile` (TypeScript 5 and 6 -- exactly
  today's behavior), otherwise the bundled TypeScript 6. When neither works (the dependency was
  stripped from an install) it returns what it found so `assertCompilerApi` fails at the scanner entry
  with a readable message, before any generator writes a file.
- Scanner modules import `ts` from that loader and `import type TS from "typescript"` for type
  positions, so the public declarations are unchanged for TypeScript 5 and 6 consumers.
- `scripts/typescript-compat.mjs` (CI job `typescript-compat`) packs the tarball and, for a root
  `typescript` of 5, 6 and 7, runs the scanner from both the ESM and CJS entries and type-checks a
  consumer.

## Consequences

- A developer on TypeScript 7 installs data-cap and runs `./build` with no extra configuration; `tsc`
  stays TypeScript 7.
- Every install of this package now carries ~26 MB unpacked (~5 MB packed) for the bundled compiler. It
  is nested, so a TypeScript 6 consumer does not save it by deduplication. The runtime, helpers, evidence
  and node entry points never load it, and the isolation check keeps it that way.
- Bundling is what keeps the consumer's `tsc` theirs. As an ordinary dependency, `@typescript/old`'s `tsc`
  bin is hoisted and linked into `node_modules/.bin`, so installing this package turned every consumer's
  `npx tsc` into TypeScript 6.0.3 -- TypeScript 5 users moved up a major and TypeScript 7 users lost the
  native compiler. A nested, bundled copy is never linked. `scripts/typescript-compat.mjs` asserts that
  `node_modules/.bin/tsc` is still the root compiler after install.
- Bundled code is invisible to `npm audit`, Dependabot and Socket's per-dependency view -- the reason
  [ADR 0068](0068-eslint-plugin-does-not-vendor-typescript-eslint.md) refuses to vendor
  `@typescript-eslint/utils`. It is accepted here because the bundle is Microsoft's published TypeScript 6
  pinned by `^6.0.2`, is only reachable from the build entry, and exists to be removed once TypeScript 7.1's
  API replaces it. A new TypeScript 6 patch needs a release of this package to reach consumers.
- On TypeScript 7, the scanner parses with TypeScript 6. TypeScript 7.0 is designed to match 6.0's
  behavior, and the scanner fixtures are run under a 7 root in CI.
- The `./build` and `./evidence` declarations still name TypeScript AST types from `typescript`.
  TypeScript 7's package exports none, so a consumer on 7 needs `skipLibCheck` for those two entry
  points (the AST-typed parameters then degrade to `any`). The runtime, helpers and node entry points
  type-check strictly. Typing them from the bundled package instead would break TypeScript 5/6
  consumers who pass their own nodes into these Stable primitives, because two copies of
  `SyntaxKind` are distinct enums.

## Alternatives considered

- **Build on `typescript/unstable/*`.** Rejected: unstable by name, and replaced by a different API
  in 7.1.
- **A plain (hoisted) dependency.** Rejected after it was built and measured: the `tsc` bin collision
  above.
- **Require the consumer to alias `typescript` to `@typescript/typescript6`.** Rejected: it is the
  config the package is meant to spare them -- the alias replaces their `tsc` with `tsc6`, so keeping
  TypeScript 7's `tsc` needs a second alias (`@typescript/native`).
- **Always use the bundled compiler.** Rejected for now: it would make the `typescript` peer
  meaningless and change which parser TypeScript 5/6 consumers' scans run under.
- **An optional peer on `@typescript/typescript6`.** Rejected: a TypeScript 7 consumer running
  `./build` would have to know to install it.
- **Wait for 7.1.** Not rejected -- the 7.1 API replaces the bundled fallback when it is stable, and
  the dependency can then be dropped without a breaking change.
