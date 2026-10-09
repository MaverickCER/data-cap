# data-cap

[![CI](https://img.shields.io/github/actions/workflow/status/maverickcer/data-cap/ci.yml?branch=main&label=CI)](https://github.com/maverickcer/data-cap/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/data-cap)](https://www.npmjs.com/package/data-cap)
[![Socket Badge](https://badge.socket.dev/npm/package/data-cap/latest)](https://socket.dev/npm/package/data-cap)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Coverage](https://img.shields.io/endpoint?url=https://maverickcer.github.io/data-cap/coverage-badge.json)](vitest.config.ts)
[![Bundle size](https://img.shields.io/endpoint?url=https://maverickcer.github.io/data-cap/size-badge.json)](scripts/check-size.mjs)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6)](#quick-start)

**Your application's data should have an owner.**

`data-cap` treats application data as a capability-owned contract: its fields, the operations that acquire or change them, and the code that depends on them.

Existing tools help with fetching, caching, and managing data.

**`data-cap` answers why the data exists, who owns it, and where it is used.**

You keep everything you have. `data-cap` does not replace TanStack Query, Redux, Zustand, Apollo, or plain `fetch` + `useState`. It gives those tools a stable contract around the data they already manage.

## See it run

Define a capability around the data your application owns:

```ts
import { createData } from "data-cap/runtime"

const user = createData({
  fields: {
    profile: UserProfileSchema,
    preferences: UserPreferencesSchema,
  },

  getters: {
    load: {
      execute: (_params, signal) => fetchUser(signal),
      processor: (profile) => ({ profile }),
      writes: { profile: true },
    },
  },

  mutators: {
    updatePreferences: {
      execute: (preferences, signal) => updateUserPreferences(preferences, signal),
      processor: (_result, preferences) => ({ preferences }),
      writes: { preferences: true },
    },
  },
})
```

Then inspect the application as a whole. The declaration above is deliberately minimal; the output
below comes from a different, larger program --
[`examples/application`](examples/application), whose `taskData` capability declares the two fields
named in the warnings. Generate everything with one script, `node scripts/generate-data.mjs`
(`npx data-cap init` scaffolds it). `data-cap`'s CLI surface is
deliberately narrow (ADR 0066) -- `--evidence` is the only flag it still
exposes, since it's the one output with a real, versioned contract (ADR
0050). The manifest, documentation catalog, dependency & ownership report,
and data flow diagram have no runtime consumer, so a project that wants them
requests them from application code instead, via `generateDataArtifacts()`'s
`location`/`docs`/`ownership`/`flow` options (see
[`examples/application/scripts/generate-docs`](examples/application/scripts/generate-docs)):

```text
$ npm run docs

Wrote evidence model: docs/data.evidence.json
[generate-docs] wrote src/generated/data.manifest.ts (1 active capability(ies)), docs/DATA.md, docs/OWNERSHIP.md, 4 flow file(s), and docs/data.evidence.json.

0 error(s), 2 warning(s), 0 info finding(s):
  - [warning] [SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY] [taskData] Field "tasks" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.
  - [warning] [SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY] [taskData] Field "selectedTask" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.
```

This is real output from [`examples/application`](examples/application)'s own `npm run docs` (a `data-cap --evidence` CLI step chained with the `generate-docs` script above), not a mockup — including the two warnings. Nobody had declared `tasks`/`selectedTask` as crossing an external boundary on purpose; the tool found it because the field's own declared `sensitivity` and its getter's own declared network endpoint disagreed, not because anyone remembered to ask.

The generated artifacts make the contract visible to developers, reviewers, and automated contributors.

## Why it exists

Application data tends to outlive the code that first introduced it.

A field gets added to an API response. A second component starts depending on it. A mutation changes it. A cache begins supplying it. Eventually nobody can easily answer:

- Why does this data exist?
- Who owns it?
- What can change it?
- Where is it used?

Existing data tools answer different questions. Fetching libraries retrieve data. Caches manage freshness and reuse. State libraries manage application state.

`data-cap` adds the missing ownership layer.

## Quick start

Install the package:

```bash
npm install data-cap
```

Optionally, scaffold a starter capability and generation script instead of writing them by hand:

```bash
npx data-cap init
```

This writes `src/data.ts` (a starter `buildData` + `documentData` capability) and
`scripts/generate-data.mjs` (a ready-to-run manifest/docs generator) into the current project —
filesystem-only, no package manager invocation, no `package.json` mutation. See `data-cap init --help`
for what it writes and why.

Or define a capability around data your application owns directly:

```ts
import { createData } from "data-cap/runtime"

const account = createData({
  fields: {
    balance: 0,
    status: "active" as "active" | "suspended",
  },

  getters: {
    load: {
      execute: (_params, signal) => getAccount(signal),
      writes: { balance: true, status: true },
    },
  },

  mutators: {
    suspend: {
      execute: (_params, signal) => suspendAccount(signal),
      writes: { status: true },
      processor: () => ({ status: "suspended" as const }),
    },
  },
})
```

Use the capability from your application without coupling its ownership to a particular transport, database, framework, or state library.

For the full API and integration patterns, see the [Guide](GUIDE.md).

## What declared metadata can express

**Ownership and governance data isn't documentation bolted onto a capability — it's what the build-time analysis actually queries:**

```ts
documentData(
  { fields: userFields },
  {
    fields: {
      email: {
        description: "The user's primary email address.",
        owner: "identity-team",
        sensitivity: "restricted",
        purpose: "Account recovery and transactional notifications.",
        retention: "Deleted with the account.",
      },
    },
  },
)
```

That is the kind of declaration the Dependency & Ownership report ([`examples/application`](examples/application) writes one to `docs/OWNERSHIP.md`) is generated from — not a separate governance system, the same `documentData` call your fields already need to correlate with the capability. (The `email` declaration above is an illustration; it does not appear in the example's output.) The same build pass cross-references every declared field against actual reads and writes in your source, so `owner`/`sensitivity`/`retention` stay attached to what the code actually does, not a document someone forgot to update. The [Guide](GUIDE.md#documented-example) has the full field-governance vocabulary.

## Why not just use your existing data library?

| Tool            | Primary question                                                 |
| --------------- | ---------------------------------------------------------------- |
| `fetch`         | How do I retrieve this?                                          |
| TanStack Query  | How do I fetch and cache this?                                   |
| Redux / Zustand | How do I manage this state?                                      |
| Apollo          | How do I manage GraphQL data?                                    |
| **`data-cap`**  | **Why does this data exist, who owns it, and where is it used?** |

These concerns can coexist.

For example, TanStack Query can remain responsible for fetching and caching while `data-cap` defines the application's ownership contract around the resulting data.

## From one capability to a whole application

A capability can be inspected independently or as part of the application.

The build tooling can generate a manifest, documentation catalog, dependency and ownership report, and other artifacts that make data relationships visible across the repository.

See the [`examples/`](examples/) directory for complete applications and the [migration guides](specs/migrations/).

## You probably don't need it when

`data-cap` is probably unnecessary if your application is small enough that data ownership, dependencies, and usage are already obvious.

It becomes useful when data crosses component, feature, team, or system boundaries and those relationships become difficult to see.

## Works with automated contributors

Generated manifests and ownership documentation give automated contributors repository-local context about application data.

That makes data changes easier to inspect, review, and govern without relying entirely on tribal knowledge.

## Status

`data-cap` is pre-1.0.

The core runtime, build tooling, CLI, ESLint integration, manifest generation, documentation generation, and ownership analysis are implemented, tested, and Stable -- see [`VERSIONING.md`](VERSIONING.md) for the exact surface semver covers.

## Learn more

- [Adoption guide](ADOPTION.md) - Decision-maker summary covering security posture, bundle size, and versioning/LTS considerations
- [Guide](GUIDE.md) - Concepts, usage, integration patterns, and the [ESLint plugin](GUIDE.md#eslint-plugin) that catches an inline `execute`/`processor`/`subscribe` function silently breaking the coordinator's dedup/subscription sharing
- [Architecture](specs/architecture.md) - Runtime and build architecture
- [Migrations](specs/migrations/) - Adoption from common data-management patterns
- [API documentation](https://maverickcer.github.io/data-cap/api/) - Generated API reference
- [Examples](examples/) - Complete working examples
- [Architecture decisions](specs/decisions/) - Design rationale
- [Security](SECURITY.md) - Security policy
- [Contributing](CONTRIBUTING.md) - Development and contribution workflow
- [Releasing](RELEASING.md) - Release process
- [Versioning](VERSIONING.md) - Versioning policy

## If this is useful

If `data-cap` helps make your application's data easier to understand and maintain, consider giving the project a star or sharing it with someone working on application architecture.

## Part of the MaverickCER toolkit

`@maverickcer/env-cap` governs configuration and `data-cap` governs application data: siblings that apply the same capability-ownership model. `repo-contract` and `internal-package-contract` are how they are verified. See [the toolkit overview and glossary](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## Requirements

Node.js `>=22`. TypeScript 5, 6 or 7 is only required for build-time manifest generation (a bundled TypeScript 6 parses the sources when yours is 7, bundled inside the package and used only by the build entry; it adds about 26 MB to the install); the runtime works in plain JavaScript. TypeScript consumers need `moduleResolution` set to `node16`, `nodenext` or `bundler` to resolve the subpath exports (`data-cap/build`, `data-cap/helpers`, ...); the legacy `node10` resolver is not supported. `data-cap/eslint-plugin` also needs `@typescript-eslint/utils` installed (an optional peer).

## License

MIT -- see [LICENSE](LICENSE).
