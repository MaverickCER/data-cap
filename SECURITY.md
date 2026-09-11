# Security policy

This document defines the security boundaries and threat model for
`data-cap`: what protections the package intentionally provides, what
responsibilities remain with the application, and why those boundaries
exist.

For implementation details, see the relevant Architecture Decision Records
in [`specs/decisions/`](specs/decisions/), linked throughout this document.

## Reporting a vulnerability

Report suspected security vulnerabilities privately through a
[GitHub security advisory](https://github.com/maverickcer/data-cap/security/advisories/new).

Alternatively, contact the maintainer through the contact information
provided on the npm package page.

Please do not create a public issue for a suspected vulnerability before it
has been reviewed and triaged.

## Runtime security model

`data-cap` is not an authorization, authentication, encryption, or privacy
compliance system. A field existing in a capability's `fields` does not
mean every consumer is authorized to read or write it — access control
remains an application responsibility, enforced above or around the
capability boundary this package defines.

- **No self-redaction.** Unlike `env-cap`'s `EnvContract`, `data-cap`'s
  `fields`/`info` print exactly as plain objects under `console.log`/
  `util.inspect`/`JSON.stringify` — no redaction layer
  ([ADR 0006](specs/decisions/0006-no-self-redaction.md)). `data-cap`
  fields are ordinary application data by default, not secrets; an
  application storing genuinely sensitive data in a field is responsible
  for its own redaction at the point it logs.
- **Ownership enforcement is warn-not-throw at runtime.** An operation
  writing a field it doesn't own has that write silently dropped, with a
  dev-mode warning identifying `{operation, path, reason}` — never the
  offending value itself, so a warning is never a place a secret leaks
  ([ADR 0005](specs/decisions/0005-warn-not-throw-runtime-throw-schema-authoring.md),
  [ADR 0011](specs/decisions/0011-getter-mutator-ownership-rules.md)).
- **No automatic conflict resolution.** `data-cap` never invents a
  last-write-wins, first-write-wins, or merge policy for a same-field write
  conflict — see
  [ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md).
  An application with data-integrity requirements around concurrent writes
  must implement its own resolution policy in its own processor logic.
- **Frozen snapshots, with a stated caveat.** Every published `DataState`
  is deep-frozen via `Object.freeze`
  ([ADR 0044](specs/decisions/0044-snapshots-deep-frozen-amortized.md)).
  `Object.freeze` blocks property reassignment/addition/deletion on the
  frozen object itself, but does **not** block mutation performed through a
  built-in's own methods on internal slots — `Map.prototype.set`,
  `Set.prototype.add`, and `Date.prototype.setFullYear` all still work on a
  frozen `Map`/`Set`/`Date` instance. For those types, immutability of a
  published snapshot is a **discipline-level guarantee** (never mutate a
  value you were handed), not a runtime-enforced one.

## Dual-package hazard

`data-cap/runtime`'s `defaultCoordinator` is a module-level
singleton. If your dependency tree resolves this package through two
different specifiers — one importer getting the ESM build, one
`require()`r getting the CJS build, via a mixed ESM/CJS dependency graph or
a re-exporting intermediate package — Node loads two entirely separate
module instances, each with its own `defaultCoordinator`. No npm package
that ships both ESM and CJS builds can prevent this; it's a property of how
Node's two module systems resolve independently.

`data-cap` treats this as a checked, documented risk class rather than an
unstated unknown
([ADR 0041](specs/decisions/0041-dual-package-hazard-checked-documented.md)):
`test/runtime/dual-package-hazard.test.ts` pins the exact consequence in
CI. That consequence is **graceful degradation, not corruption**: each
module instance's coordinator stays internally correct and consistent —
dedup and subscription sharing simply stop crossing the hazard boundary
between the two instances. If your deployment topology risks triggering
this (a monorepo with mixed module resolution, a bundler configuration
that might resolve this package twice), be aware that dedup/subscription
sharing is not guaranteed across that boundary, even though correctness
within each instance is.

## Build-time security model

`data-cap/build` never imports, `require()`s, or `eval()`s a
discovered capability file
([ADR 0002](specs/decisions/0002-build-tooling-static-analysis-only.md)).
Every discovery/linking operation reads a file's AST via the TypeScript
Compiler API only. `literal-eval.ts`'s recognized expression grammar is an
explicit, closed allowlist (object/array/primitive literals, `Date`/`URL`/
`RegExp`/`Map`/`Set` constructor calls with literal arguments) — anything
outside it is reported as unresolvable, never guessed at, never executed.

Cross-package schema discovery
(`linkCapabilityFiles(files, { packages: [...] })`) only ever resolves a
package name you have explicitly allow-listed, via Node's own module
resolution anchored at your project root — it never scans `node_modules`
for arbitrary schema-looking files, and never resolves a package you
haven't named.

## Application responsibilities

`data-cap` does not determine:

- who is authorized to read or write a given field
- how a value is encrypted at rest or in transit
- how retention or regulatory requirements are enforced
- what counts as sensitive data for your application's own purposes

Those remain the responsibility of the application and its infrastructure.
The capability contract makes data ownership and dependencies explicit
enough for dedicated authorization/security/compliance tooling to reason
about, but is not itself that tooling.

## Supply-chain posture

For a reviewer checking this project's publish/build pipeline rather than
its runtime API: releases are published via npm's OIDC trusted publishing
(`.github/workflows/release.yml`) — there is no long-lived `NPM_TOKEN`
secret in this repository to leak, rotate, or scope; the workflow's
`id-token: write` permission is exchanged for a short-lived publish
credential per run, tied to this exact repository and workflow file, and
that same OIDC flow attaches npm provenance attestations to each published
version. `core`/`runtime`/`helpers` are verified against real Node, Bun, and
Deno engines in CI (`test/cross-runtime/`), not just asserted to be
isomorphic by code inspection. Test coverage is enforced with a
ratchet-up-only policy (currently: 90% branches, 100% functions, 95%
lines/statements — see `vitest.config.ts`; CONTRIBUTING.md's release
process forbids lowering these to accommodate a drop). See
[`CONTRIBUTING.md`](CONTRIBUTING.md)'s "Release process" section for the
full one-time trusted-publisher setup this depends on.

## Supported versions

Pre-`1.0`: security fixes target the latest published `0.x` version only.
There is currently no separate long-term-support branch or extended
security-support policy. See [`VERSIONING.md`](VERSIONING.md) for the
package's general stability posture, and check back here once a `1.0`
release establishes a longer-term backport policy.
