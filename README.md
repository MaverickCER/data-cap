# data-cap

[![CI](https://img.shields.io/github/actions/workflow/status/maverickcer/data-cap/ci.yml?branch=main&label=CI)](https://github.com/maverickcer/data-cap/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/data-cap)](https://www.npmjs.com/package/data-cap)
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
const user = createData({
  fields: {
    profile: UserProfileSchema,
    preferences: UserPreferencesSchema,
  },

  getters: {
    load: async () => fetchUser(),
  },

  mutators: {
    updatePreferences: async (preferences) => {
      await updateUserPreferences(preferences)
    },
  },
})
```

Then inspect the application as a whole:

```text
$ npx data-cap --root . --include "src/**"

Discovered 1 active capability(ies).

Manifest changes since last execution:

  No changes.

Wrote docs: docs/DATA.md
Wrote dependency & ownership report: docs/OWNERSHIP.md
```

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

Define a capability around data your application owns:

```ts
const account = createData({
  fields: {
    balance: 0,
    status: "active" as "active" | "suspended",
  },

  getters: {
    load: async () => getAccount(),
  },

  mutators: {
    suspend: async () => suspendAccount(),
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

That's the same declaration the [Dependency & Ownership report](#see-it-run) above is generated from — not a separate governance system, the same `documentData` call your fields already need to correlate with the capability. The same build pass cross-references every declared field against actual reads and writes in your source, so `owner`/`sensitivity`/`retention` stay attached to what the code actually does, not a document someone forgot to update. The [Guide](GUIDE.md#documented-example) has the full field-governance vocabulary.

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

The core runtime, build tooling, CLI, ESLint integration, manifest generation, documentation generation, and ownership analysis are implemented and tested. `createData` is currently Experimental; lower-level runtime primitives are Stable.

## Learn more

- [Guide](GUIDE.md) - Concepts, usage, and integration patterns
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

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## License

See [LICENSE](LICENSE).
