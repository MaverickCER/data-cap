# AGENTS.md

Rules for coding agents changing `data-cap`'s own source or moving an application onto it. For
application code that only uses `data-cap`, load [`skills/data-cap/SKILL.md`](skills/data-cap/SKILL.md)
instead: the consumer manual, generated from the package.

## What this package is

`data-cap` declares who owns each piece of application data and how it may be handled. The
declaration is a _capability_: a schema passed to `createData()` or `buildData()`, with the fields it
owns and the getters, mutators and subscriptions that load, change or watch them. `documentData()`
adds the owner and each field's handling (`sensitivity`, `purpose`, `legalBasis`, `retention`) to the
same schema. Every component reads the capability's one snapshot. The ESLint plugin and the build
entry check source against the declarations, and the build entry regenerates the data docs from it.

## Invariants

Where a test or ADR holds a rule, the rule names it; rules 5 and 18 rest on review. Read the ADR
when a change has to bend the rule.

1. **Fields are the plain application data.** `data.fields.user.email` is a plain string, read by
   property access. Functions are never field values. Wrappers (`.value`), proxies, symbols and
   string paths stay out of the field system
   ([ADR 0003](specs/decisions/0003-fields-are-actual-application-data.md)).
2. **Fields are readable from the start.** `buildData()` and `createData()` return state holding the
   declared defaults, synchronously ([ADR 0004](specs/decisions/0004-fields-always-synchronously-readable.md)).
3. **`fields` and `info` commit together.** Every `DataState` has both, published as one atomic
   snapshot through `commitState` (`core/patch.ts`). `info` stays mandatory and small through
   structural sparsity: no metadata for untouched fields (ADR 0007, ADR 0008,
   `test/core/patch.test.ts`).
4. **Presence is `Object.hasOwn`.** `0`, `false`, `""`, `null`, explicit `undefined` and `[]` are
   real values in every ownership and presence check (ADR 0047, `test/core/ownership.test.ts`).
5. **Three operation kinds, three meanings.** Getters acquire, mutators perform side effects,
   subscriptions observe.
6. **`src/core/` is synchronous and stateless.** Execution loops, including `createData`'s, live in
   `src/runtime/` (ADR 0048).
7. **The build tooling reads source; it never runs it.** `src/build/` parses files through the
   TypeScript Compiler API. Operation bodies stay opaque: only operation names and literal `writes`
   shapes are extracted. A capability is discovered from a top-level `buildData(...)` or
   `createData(...)` call in source; there is no runtime capability registry
   ([ADR 0055](specs/decisions/0055-remove-unused-capability-registry.md)).
8. **Messages carry paths, never values.** Errors and warnings name field paths. Capabilities print
   normally: `data.fields` and `data.info` are application data, not secrets (ADR 0005, ADR 0006,
   `test/runtime/capability.test.ts`).
9. **Sharing follows function identity.** Pass module-level functions as `execute` and `subscribe`.
   The `stable-operation-reference` lint rule flags inline functions, including in `createData`'s
   `execute`, `processor`, `subscribe` and `optimistic` keys.
10. **A failed optimistic mutation reverts by removing its pending transition.**
    `removePendingTransition` runs in a `finally`. Only the operation's own processor interprets a
    result against the latest authoritative state; rollback code and write-wins or merge policies
    stay out ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md)).
11. **`FIELD_MARKER` uses `Symbol.for`.** `core` and `runtime` are separate bundles, and the global
    symbol registry keeps the marker one identity across both (ADR 0048,
    `test/runtime/cross-bundle-field-marker.test.ts`).
12. **Reports record what the AST proves, and label the rest.** An ambiguous case becomes an `info`
    or indeterminate finding (ADR 0049). Every rendered fact is labelled "declared" or "proven".
    Authored metadata is declared: `source`, `credentials`, `protections`, `retention`,
    `endpoints`, `expiresAt`, `deprecated`, `removeBy` and `renamedFrom`. `writes` and dependency
    edges are proven. Nothing expires or is removed at runtime.
13. **Flow evidence is graded, and incompleteness is data.** Each flow fact has one status:
    `declared`, `static`, `observed`, `inferred` or `unknown`.
    - What the flow pass cannot follow becomes an `unknown`, and the trace is "not complete"
      (ADR 0071, `test/flow/never-silently-safe.test.ts`).
    - Observation records names and paths, never values, and a clock only when the caller passes
      one (ADR 0072).
    - A CI rule over analysis that did not run fails.
    - It is a data-flow analysis, not an information-flow one (ADR 0074).
    - A package call is followed only through a caller-declared `flowSummaries` entry, whose facts
      are `declared`.
    - A redundant transformation is an `info` finding (ADR 0075).
14. **Published paths are root-relative.** Absolute paths exist only in `discover.ts`. They become
    root-relative at `buildInventory` and `scanDependencies` through `displayPath`
    (`display-path.ts`); `absolutePathFrom(root, file)` turns one back (`test/build/inventory.test.ts`).
15. **A field's runtime type is its shape.** A processor is the one place for custom logic, and
    `helpers/shape.ts` guards check structure only (ADR 0039).
16. **`helpers/identity.ts` and `helpers/canonicalize.ts` re-export `core`.** They stay literal
    re-exports (ADR 0039, `test/helpers/identity.test.ts`, `test/helpers/canonicalize.test.ts`).
17. **Framework patterns live in `examples/`.** TanStack Query, Socket.IO and React integrations are
    examples, not packages (ADR 0037). `getSnapshot` and `subscribe` stay
    `useSyncExternalStore`-compatible.
18. **Type one declared property at a time in `runtime/capability.ts`.** Its mapped types extract
    each property (`DeclaredParams`, `DeclaredWrites`). Matching an operation definition against a
    whole `GetterDefinition`, `MutatorDefinition` or `SubscriptionDefinition` widens `createData`'s
    inference.

`createData` is Stable and composes the Stable primitives `buildData`, `createDataStore` and the
coordinator; its behaviour contract is ADR 0048. Choosing per capability between `createData` and
the hand-wired primitives: GUIDE.md, "The low-level path: full manual control".

## Generated files

A generated file carries `GENERATED FILE -- do not edit by hand`, sits in an `<!-- ipc:begin -->` region, or comes from a command below. Change its source, then rerun the
generator. The `version` script in
`package.json` runs the whole chain; run the step that matches what changed:

| Changed                                           | Run                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| TSDoc, exports or `--help` text                   | `npm run build`, then `npx internal-package-contract update-baseline` |
| TSDoc on exported types                           | `npm run docs:api:report` and `npm run schema`                        |
| `docs/skill.json`, `docs/surface.json`, exports   | `npx internal-package-contract skill`                                 |
| `docs/site.json`                                  | `npx internal-package-contract site`                                  |
| `package.json` facts behind an `ipc:begin` region | `npx internal-package-contract generate`                              |
| Code whose output an example records              | `npm run examples:update-golden`                                      |

## Moving an application onto data-cap

Migrate one capability per pull request and keep its consumers' observable behaviour unchanged. The
five steps and a guide per starting point (manual fetch-and-state, a global store, TanStack Query
alone, Apollo) are in [`specs/migrations/README.md`](specs/migrations/README.md). Read it before the
first capability.

## Public API map

<!-- ipc:begin entry-points -->

| Export                   | Source                 | Environment           | Tier         | Purpose                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------- | --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-cap`               | `src/core/`            | isomorphic, zero deps | Stable       | `buildData`, `documentData`, `fields.nullable` and `fields.optional`, the `DataState`, `DataInfo` and `FieldInfo` types, and the error classes.                                                                                                         |
| `data-cap/runtime`       | `src/runtime/`         | isomorphic, zero deps | Stable       | `createData`, `createDataStore`, `defaultCoordinator` and `createCoordinator`, `composeSignals` and `rejectOnAbort`.                                                                                                                                    |
| `data-cap/runtime/cache` | `src/runtime/cache.ts` | isomorphic            | Stable       | `createDataCache`. Optional, and a separate entry, and `test/runtime/tree-shaking.test.ts` checks that the built `./runtime` does not include it.                                                                                                       |
| `data-cap/runtime/retry` | `src/runtime/retry.ts` | isomorphic            | Stable       | `withRetry` and `isStillDefault`. Optional, and a separate entry, and `test/runtime/tree-shaking.test.ts` checks that the built `./runtime` does not include it.                                                                                        |
| `data-cap/helpers`       | `src/helpers/`         | isomorphic            | Stable       | The `processors`, `identity`, `canonicalize` and `shape` namespaces.                                                                                                                                                                                    |
| `data-cap/build`         | `src/build/`           | Node-only             | Stable       | Discovery and linking, the inventory and the other fact models, the report generators, and `generateDataArtifacts` and `checkArtifacts`. The flow pass (`flowEvidence`, `flowSinks`, `flowSummaries`, `scanFlow`) and its projections are Experimental. |
| `data-cap/node`          | `src/node/`            | Node-only, dev/CI     | Stable       | `nodeBuildFileSystem`: the `BuildFileSystem` a Node build script hands to `./build`.                                                                                                                                                                    |
| `data-cap/evidence`      | `src/evidence/`        | isomorphic, zero deps | Stable       | `defineEvidenceProjection` (Stable), imported as a type-only reader of the Evidence Model. The flow queries, views, standards adapters and `evaluateEvidenceRules` are Experimental.                                                                    |
| `data-cap/observe`       | `src/observe/`         | isomorphic, zero deps | Experimental | `observeBoundary`, `observeValue`, `observeSink`, `instrumentBoundary`, `observeResponse` and `createMemorySink`. They record field names, never values, into a sink you supply.                                                                        |
| `data-cap/eslint-plugin` | `src/eslint-plugin/`   | Node-only (ESLint)    | Stable       | The `stable-operation-reference`, `no-raw-external-io`, `no-fields-escape` and `no-node-fs` rules.                                                                                                                                                      |
| `data-cap/schema`        | `schemas/`             | static JSON           | Stable       | The JSON Schema for `data-cap --json` output, and the model schemas under `./schema/*`.                                                                                                                                                                 |

<!-- ipc:end entry-points -->

## Before finishing a change

Each item is done when its command exits 0 or its condition holds.

1. `npm run typecheck`, `npm run lint` and `npm run test:coverage` pass. (`npm run verify` is the full
   gate.)
2. A changed public type has a positive `expectTypeOf` test, plus a `// @ts-expect-error` test where
   an invalid construct exists (ADR 0045).
3. A change to `core/patch.ts` or `core/ownership.ts` is covered by the property-based tests in
   `test/core/` (ADR 0046).
4. A change to `runtime/capability.ts` keeps `test/runtime/capability.test.ts` covering ADR 0048:
   the getter-versus-mutator stale-discard asymmetry, dedup and subscription identity scoping, and
   `optimistic()` receiving authoritative state.
5. A change near `FIELD_MARKER` passes `test/runtime/cross-bundle-field-marker.test.ts` after a fresh
   `npm run build`.
6. No thrown error or warning contains a field value.
7. A changed example passes `npm start` and `npm run typecheck` in its own folder, a separate npm project. Its golden is regenerated.
8. A public export changed only on purpose; otherwise it is restored.
9. Every generated file was regenerated from its source, as in [Generated files](#generated-files).

## Where to look

- Every CLI flag: `npx data-cap --help`. Every script: `package.json`.
- Every option of the generators, the CLI and flow policies: [GUIDE.md](GUIDE.md).
- Why the architecture is shaped this way: [`specs/architecture.md`](specs/architecture.md).
- Why a specific rule exists: [`specs/decisions/`](specs/decisions/).
