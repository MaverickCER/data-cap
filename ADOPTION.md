# Adoption guide

You have to decide whether your team adopts `data-cap`. This page covers what it solves, what it costs, what it needs, and what it refuses to do. Each row names the check or the decision that holds it, and where that stops.

## What it solves

Several consumers of the same data each invent their own status bookkeeping: a `userLoading` boolean here, a `userError` string there. `data-cap` gives every consumer of a capability one typed `fields` and `info` shape. That holds whatever fetches the data underneath: a REST call, a database query, a socket event, or a mix.

Fetching libraries (TanStack Query, SWR, RTK Query, Apollo) solve request dedup, caching and refetch policy. Stores (Redux, Zustand, Jotai) move values to where they are read. `data-cap` solves neither. It solves agreement on shape and status, and it records who owns each field. That is why it composes with those tools instead of replacing them; see [How it differs](README.md#how-it-differs).

## What it costs

- **A declaration per capability.** Each piece of data is declared once, with its fields, operations and, optionally, governance metadata. You adopt one capability at a time.
- **A build step in CI.** The reports and the evidence file come from a static pass. `--check` fails the job when they are stale.
- **Bundle size.** Every entry point has a gzip budget in `ci/size-budgets.mjs`, and the `verify` and `contract` jobs fail over it. Core is budgeted at 2 KB and `./runtime` at 8 KB. [PERFORMANCE.md](PERFORMANCE.md#bundle-size-budgets) has every budget. The budgets measure the ESM files only.
- **Install size.** The package's one dependency is a TypeScript 6 compiler, bundled in the tarball. Only `./build` and the CLI load it. The `compiler-isolation` step of the `verify` job fails if a runtime entry can reach it.
- **Optional pieces cost nothing until imported.** Cache and retry are separate entries. `test/runtime/tree-shaking.test.ts` checks that neither carries the other's code, and that the built `./runtime` contains neither.

### Migration cost from what you have today

Every [migration guide](specs/migrations/) is incremental and says when to keep what you have.

| Coming from                                 | Guide                                                                      | In one line                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Manual `useState` and `useEffect` fetching  | [From manual fetch-and-state](specs/migrations/from-manual-fetch-state.md) | Replace scattered loading, error and data booleans with one typed `DataState`.              |
| A Redux or Zustand global store             | [From a global store](specs/migrations/from-a-global-store.md)             | Keep the store for UI state; move server-derived data into capabilities.                    |
| TanStack Query used directly                | [From TanStack Query alone](specs/migrations/from-tanstack-query-alone.md) | Keep TanStack Query for fetching and caching; let its results flow into a `data-cap` store. |
| Apollo Client or a normalized GraphQL cache | [From Apollo Client](specs/migrations/from-apollo-client.md)               | Keep Apollo for the transport; capability fields become the shape components read.          |

## What it needs

- **Node.js 22 or later.** CI runs the tests on Node 22 and 24.
- **TypeScript is optional.** The runtime works in plain JavaScript. The generator uses your TypeScript 5 or 6, or else the bundled TypeScript 6.
- **`moduleResolution`** of `node16`, `nodenext` or `bundler` in a TypeScript project.
- **npm** for full support. pnpm, Yarn 1 and Yarn Berry (node-modules linker) are tested for install and import only, in a job that does not block a merge. Plug'n'Play is unsupported.
- **ESLint 8.57, 9 or 10 and `@typescript-eslint/utils` 8**, only for `data-cap/eslint-plugin`. ESLint 10 runs the unit tests and ESLint 9 a fixture; 8.57 is untested.

### What installing it adds

The runtime entry points import nothing. Generated from `package.json`:

<!-- ipc:begin dependencies -->

Installing `data-cap` installs 1 package directly, and whatever it depends on. It names 3 optional peers, which you install yourself when you use the part that needs them.

| Package                    | Kind          | Range                              | Why                                                                                                                                                                                                              |
| -------------------------- | ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@typescript/typescript6`  | dependency    | `^6.0.2`                           | The TypeScript 6 compiler the build entry parses with when the project's own TypeScript is 7 or missing. It is bundled inside the tarball. The `compiler-isolation` check fails if a runtime entry can reach it. |
| `@typescript-eslint/utils` | optional peer | `^8.0.0`                           | Only for `data-cap/eslint-plugin`; projects linting TypeScript already have it through `typescript-eslint`.                                                                                                      |
| `eslint`                   | optional peer | `^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` | Only for `data-cap/eslint-plugin`, which runs inside the project's own ESLint.                                                                                                                                   |
| `typescript`               | optional peer | `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0`   | The project's own compiler, used by the build entry instead of `@typescript/typescript6` when it is version 5 or 6.                                                                                              |

<!-- ipc:end dependencies -->

## What it refuses to do

| It does not                                      | Why, and what to do instead                                                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fetch data or hold UI state                      | Your functions do the I/O; keep your fetching and state libraries.                                                                                                                                                   |
| Authorize, encrypt or redact                     | A field in `fields` is not an access decision. `fields` and `info` print as plain objects ([SECURITY.md](SECURITY.md#application-responsibilities)).                                                                 |
| Roll back a failed mutation or resolve conflicts | A failed optimistic update reverts because its pending transition is removed. Write any merge policy in your own processor ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md)).       |
| Run your code at build time                      | The build tool reads files through the TypeScript Compiler API and never imports or evaluates them ([SECURITY.md](SECURITY.md#build-time-security-model)).                                                           |
| Follow data into packages                        | The flow scan reads your project only. A package call is recorded as an unknown unless you declare what it does.                                                                                                     |
| Ship adapters for other libraries                | No TanStack Query, Socket.IO or React package ships ([ADR 0037](specs/decisions/0037-no-first-party-integration-packages.md)). Tested patterns live under `test/integration/`, in a job that does not block a merge. |
| Validate field values                            | `shape` has structural guards only; a processor is where your validation goes ([ADR 0039](specs/decisions/0039-helpers-subpath-scope.md)).                                                                           |
| Decide your regulatory classification            | `metadata` is an open bag you fill; `data-cap` never validates it. Its outputs can support a review; they do not establish compliance.                                                                               |

## What it holds to

| What it holds to                                                                                                 | Held by                                                                                      | Limit                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Fields are readable synchronously, with their defaults, from the moment `buildData()` or `createData()` returns. | `test/core/build.test.ts`, `test/runtime/capability.test.ts`                                 | Bun and Deno are smoke-tested in a job that does not block a merge.   |
| Every `DataState` has `fields` and `info`, committed together as one snapshot.                                   | `test/core/patch.test.ts`, `test/runtime/store.test.ts`                                      | Tested through the store API; there is no concurrency stress test.    |
| A write to a field the operation does not own is dropped, and the warning never includes the value.              | `test/core/ownership.test.ts`, `test/runtime/capability.test.ts`                             | The value check covers a string value on the `createData` path.       |
| Every published snapshot is deep-frozen.                                                                         | `test/core/build.test.ts`, `test/core/patch.test.ts`                                         | `Map`, `Set` and `Date` can still be mutated through their methods.   |
| Under mixed ESM and CommonJS loading, each of the two coordinators stays correct on its own.                     | `test/runtime/dual-package-hazard.test.ts`                                                   | Dedup does not cross between them. Tested on Node's two loaders only. |
| `createData` is optional: `buildData` with `createDataStore` gives full manual control over the same primitives. | [ADR 0048](specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md) | Pick per capability.                                                  |

## Versioning, stability, and long-term support

`data-cap` is below 1.0. [VERSIONING.md](VERSIONING.md) lists, per entry point, what is Stable, Experimental and Private. Before 1.0 a minor release may change a Stable API. There is no long-term-support branch: security fixes go to the latest published `0.x` only ([SECURITY.md](SECURITY.md#supported-versions)).

From 1.0, security fixes will be backported to the previous major's latest minor for at least six months ([ADR 0061](specs/decisions/0061-security-backport-window.md)). That is a commitment about a future release line; it has not been exercised. If you need it today, wait for 1.0.

## Open questions

- **Production performance numbers:** none. The benchmarks measure the package's own primitives with simulated I/O ([PERFORMANCE.md](PERFORMANCE.md)). There is no deployed-at-scale record to cite.
- **An adapter for another library:** none is planned. The TanStack Query and Socket.IO fixtures are the patterns to adapt.
