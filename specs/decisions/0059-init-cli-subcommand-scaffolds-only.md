# 0059: `data-cap init` is a filesystem-only scaffolder, never a project configurator

## Status

Accepted. Implemented: `src/cli/init.ts` (`runInitCommand`), dispatched from
`src/cli/index.ts`'s `main()` on `init` as the first positional token;
covered by `test/cli/init.test.ts` and `test/cli/main.test.ts`.

## Context

The CLI (`src/cli/index.ts`) was a single flat flag-parser — `--location`,
`--docs`, `--ownership`, `--flow`, `--evidence`, `--check`, `--json` — with
no subcommand concept. A new adopter's first step ("write a capability
file, then generate the manifest/docs/ownership artifacts") was entirely
manual, described only in the README.

`@maverickcer/env-cap` added the same `init` subcommand (its ADR 0042), and
`repo-contract` before it (ADR 0004, 2026-09-09 amendment). data-cap should
offer the same low-friction entry point, constrained by its own
invariants: static analysis only, never execution
([ADR 0002](0002-build-tooling-static-analysis-only.md)); library surfaces
do not acquire ambient capabilities the caller didn't grant
([ADR 0058](0058-library-surfaces-do-not-acquire-node-fs.md)).

## Decision

### Grammar

`init` as the **first positional token** routes to the scaffolder; every
existing flag-based invocation is untouched (no flag is reinterpreted as a
subcommand, `--help` alone still prints the generator help). `data-cap
init` takes no arguments except `--help`.

### `init` scaffolds, it does not configure

`init` writes exactly two new files:

- `<src>/data.ts` — a starter capability (`buildData` + `documentData`, one
  placeholder field group). `src/` if that directory already exists,
  project root otherwise.
- `scripts/generate-data.mjs` — a runnable artifact generator calling
  `generateDataArtifacts()` with the `data-cap/node`
  filesystem adapter (manifest + docs + ownership).

It is **filesystem-only and non-executing**: no subprocess, no
package-manager call, no `package.json` mutation, no artifact
regeneration, no ambient-environment read, no network. It reads the
consumer's `package.json` only to confirm it's a project and to choose
`src/` vs. root. Writes use exclusive-create (`{ flag: "wx" }`) — an
existing file is reported as skipped, never overwritten — with parent
directories created first. Any preflight failure means zero writes.

The starter uses `buildData` (Stable, `.` core) rather than `createData`
(Experimental, `./runtime`): `buildData` is fields-only and needs no fake
`execute` endpoints to be a valid, discoverable capability. The `Next:`
report points at `createData` for the operations layer.

Like env-cap's `init`, and unlike `repo-contract`'s, data-cap's does not
patch a `package.json` script — the CLI already works standalone via `npx
data-cap`, so there is nothing to wire.

### Tier

Experimental (`VERSIONING.md`). The scaffold's exact file set and template
contents may change in a minor/patch release; what it has already written
into a consumer's repo is theirs and unaffected.

## Consequences

- A new adopter runs `npx data-cap init`, gets a discoverable capability
  and a generator, and expands from there.
- `src/cli/init.ts` uses `node:fs` directly — consistent with ADR 0058's
  carve-out (`src/cli/**` is executable-context source); the file is
  bundled into the `bin` target, so `verify-no-ambient-fs`'s tarball scan
  exempts it exactly as it does `src/cli/index.ts`.
- The scaffolded templates are plain string constants. If the public
  `buildData`/`documentData`/`generateDataArtifacts` API changes shape, the
  templates need updating too — a test that type-checks or runs the
  scaffolded output would catch drift and is a reasonable future addition.

## Alternatives considered

- **Lead the scaffold with `createData`.** Rejected — `createData` is
  Experimental and its operations need real `execute` functions; a
  fields-only `buildData` starter is a cleaner, Stable base to expand from.
- **Patch `package.json` to add a `generate:data` script.** Rejected —
  same reasoning as env-cap ADR 0042: the CLI is directly runnable, so the
  script is a five-second addition, and mutating `package.json` widens
  `init`'s blast radius for no real gain.
- **An interactive prompt flow.** Rejected — `init` must be safely runnable
  inside a CI step or a higher-level generator; non-interactive and
  deterministic is the constraint.
