# 0058: Library Surfaces Do Not Acquire `node:fs` -- the Caller Supplies the Filesystem Capability

## Status

Accepted. Implemented: `src/build/types.ts` (`BuildFileSystem`), threaded through
every `src/build/**` module and every public options object in
`src/build/index.ts`; `src/cli/filesystem.ts` (the concrete adapter), re-exported
as the public `@maverickcer/data-cap/node` entry (`src/node/index.ts`) for a
consumer's own build script; `src/build/package-version.ts` + `src/cli/json.ts`
(version via build-time constant, not a self-read); `src/eslint-plugin/no-node-fs.ts`
and `no-restricted-imports` in `eslint.config.js`; `scripts/verify-no-ambient-fs.mjs`.

Mirrors `@maverickcer/env-cap`'s own ADR 0040 exactly -- the two packages are
independent products, so each carries its own structurally-identical version of
this decision rather than sharing one.

## Context

`repo-contract`'s ADR-0011 removed `child_process`/`process.env` access from
its own published code after socket.dev flagged "Shell access" and
"Environment variable access" against its `dist/`. The fix: `spawn`/`env`
became **required** fields on `RepoContractConfig`, supplied by the consumer
and threaded internally as one capability object; enforced by a script that
greps a real `npm pack` tarball.

The durable principle: **library code should not implicitly acquire powerful
ambient capabilities that callers did not explicitly provide.** socket.dev's
flagging is the concrete trigger and supporting evidence, and a better
socket.dev score plus less consumer security-review burden is the practical
payoff -- but the principle stands on its own even if socket.dev's detection
model changes.

Audit of data-cap:

- The **runtime** surfaces -- `.`, `./runtime`, `./runtime/cache`,
  `./runtime/retry`, `./evidence`, `./helpers` -- already have zero
  `process.env`, `fs`, network, `child_process`, or `os` access. Nothing to
  do; this already matches ADR-0011's target.
- The gap: data-cap also ships `./build` and a CLI `bin`, both in the
  published `dist/`. `src/build/*.ts` imported `node:fs`/`node:fs/promises`
  throughout (discovery, linking, package-schema resolution, citation
  verification, evidence caching, artifact writing). A socket.dev scan flags
  the whole package with "Filesystem access" regardless of which subpath a
  consumer imports.

## Decision

### The invariant

```
Library entrypoints (., ./runtime, ./runtime/*, ./helpers, ./build, ./evidence)
    → MUST NOT acquire node:fs -- the capability is always supplied by the caller

Executable-context entries (bin, ./eslint-plugin, ./node)
    → MAY acquire node:fs -- they are the capability boundary:
      bin constructs the concrete adapter and runs it; ./node ships that
      same adapter as a value for a consumer's own Node build script;
      ./eslint-plugin runs inside ESLint's own Node process
```

"Ambient-fs-free" means specifically: **`./build` does not acquire filesystem
capabilities from Node globals/modules itself.** It still performs real
filesystem operations -- it just never `import`s `node:fs` to do so; the
capability is always handed in.

The CLI is _permitted_ (not "necessarily has to") retain `node:fs` because it
is the executable consumer: it constructs the concrete `BuildFileSystem`
adapter, does its own self-bootstrapping (`process.argv[1]` through a
symlink), and is never imported by a consumer who only depends on `.`/
`./runtime`/`./build`. `repo-contract` ships no `bin` at all, so full
package-level zero-fs parity isn't reachable through injection alone; this is
the one accepted, standard exception (an executable consumer owns the
capability required to execute its filesystem-oriented behavior). The
`./eslint-plugin` entry is exempt for the same reason -- it runs inside
ESLint's Node process, and its bundled `@typescript-eslint/utils` references
`node:fs`.

### The injection interface

`BuildFileSystem` (`src/build/types.ts`) -- modeled structurally on
`node:fs/promises` so a thin adapter is a drop-in value, but with **minimal
structural types** (`BuildDirent`/`BuildStats`) rather than Node's `Dirent`/
`Stats`: the capability boundary shouldn't leak Node's type surface just
because the concrete adapter is Node-backed. Only the six operations
`src/build/**` actually calls are present (`readFile`, `writeFile`, `mkdir`,
`readdir`, `stat`, `realpath`). Every `readFile` is `"utf8"` text -- the
Buffer reads that previously fed the fingerprint/citation hashes now hash the
decoded text instead, which changes recorded hash values but not their
change-detection behaviour.

**Not shared with `@maverickcer/env-cap`.** The two packages are
independent products with no runtime coupling; a shared types package to
dedupe six signatures would add real cross-package coupling for negligible
benefit. env-cap gets its own, structurally-identical interface.

Every public options object in `build/index.ts` carries a **required** `fs:
BuildFileSystem`. Internal positional helpers take it as a parameter, or via
`ImportResolutionContext` where a context object already exists. The one
orchestrator `computeDataArtifacts()` threads its `options.fs` into every
discovery/link/resolution/citation/write call.

**The Node adapter ships as `@maverickcer/data-cap/node`.** `repo-contract`'s
consumers pass an existing npm package (`crossSpawn`, `process.env`); there is
no equivalent off-the-shelf `node:fs/promises` → `BuildFileSystem` value, so
data-cap ships one -- `nodeBuildFileSystem`, the same object the CLI uses --
from a dedicated executable-context entry. `./node` bundles
`node:fs/promises`; the tarball guard exempts its resolved target exactly as
it does `bin` and `./eslint-plugin`. `./build` stays clean: a consumer's build
script does `import { nodeBuildFileSystem } from "@maverickcer/data-cap/node"`
and passes it as `fs`. A non-Node consumer supplies their own
`BuildFileSystem` and never imports `./node`.

### Version self-read (a distinct concern)

`package-version.ts` synchronously walked up from its own directory to read
the package's _own_ `package.json` at import time for `PACKAGE_VERSION` --
self-introspection, no meaningful "consumer" to inject from. `cli/json.ts`
kept its own duplicate. Replaced with a build-time constant: `tsup.config.ts`
reads `package.json` once (build tooling, never shipped) and `define`s
`__PACKAGE_VERSION__`; `PACKAGE_VERSION` is that constant, and `cli/json.ts`
reuses it. vitest's config `define`s the same constant so tests run against
`src/` unchanged. `findPackageJson` (and its unit test) are removed.

**Build-time filesystem access is not the same thing as published runtime
filesystem access** -- `tsup.config.ts` reading `package.json` to compute a
constant never ships in `dist/`, so it adds nothing to the package's own
flagged capabilities.

### Enforcement

- **Source-level** (fast feedback): `no-restricted-imports` in
  `eslint.config.js` forbids `fs`/`node:fs`/`fs/promises`/`node:fs/promises`
  under `src/**` except `src/cli/**`. The published
  `@maverickcer/data-cap/eslint-plugin` also ships `no-node-fs` for a consumer
  to enforce the same discipline on its own code.
- **Tarball-level** (release-blocking backstop): `scripts/verify-no-ambient-fs.mjs`
  runs `npm pack --ignore-scripts`, extracts it, and greps every `.js`/
  `.cjs`/`.mjs` file **inside the extracted package root** for the forbidden
  specifier set, excluding only the resolved `bin`, `./eslint-plugin`, and
  `./node` targets (and their `.map`s) -- derived from `package.json`, not a
  hardcoded glob. Wired into `precommit`/`verify`/`prepublishOnly`.

## Alternatives considered

- **A shared `BuildFileSystem` package across env-cap and data-cap.**
  Rejected -- adds cross-package coupling against this project's
  minimal-dependency stance; two independently-versioned interfaces stay
  simpler.
- **Read/write interface segregation** (`ReadFileSystem`/`WriteFileSystem`
  so a check-only path requires just a reader). A legitimate idea, but adds a
  second interface pair to thread everywhere for a benefit that only bites at
  the check-vs-generate boundary. Revisit if `checkArtifacts` ever needs
  a type-level guarantee it can't write.
- **Splitting the CLI into its own npm package** for literal package-level
  zero-fs parity. A possible future escalation, not undertaken now.
- **Re-engineering module resolution** to avoid `createRequire().resolve()`
  (used in `resolve-package-schema.ts`) on the guess that socket.dev might
  flag it under some "module resolution" category. No confirmed evidence
  that's a real, distinct capability class -- a post-scan check item, not a
  design change. TypeScript's own `ts.sys.readFile` (used by
  `resolve-tsconfig-paths.ts`) is out of scope for the same reason: it's the
  `typescript` package's already-accounted-for capability, not a `node:fs`
  import in data-cap's own source.
- **`Date.now()`/`setTimeout()` ambient reads** in true runtime code
  (`capability.ts` operation-state timestamps, `retry.ts`'s `delay()`). Out
  of scope -- a determinism concern, not a socket-flagged capability.
