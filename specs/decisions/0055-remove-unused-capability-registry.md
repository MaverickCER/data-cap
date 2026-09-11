# 0055: Remove the unused capability registry — it never fed build-tooling discovery

## Status

Accepted. Removed `src/core/registry.ts` and its one call site in
`src/core/build.ts`; removed `BuildDataOptions`/`CreateDataOptions.name`
(their only purpose was seeding the registry's `Symbol` identity).

## Context

`buildData()` unconditionally called `registerCapability(state, { id:
Symbol(name), fieldsShape: config.fields })` on every invocation, writing
into a private, module-level `WeakMap<object, CapabilityInternals>`
(`src/core/registry.ts`). Its only reader, `getCapabilityInternals()`, had
**zero call sites** anywhere in the shipped codebase — not in `createData`
(`runtime/capability.ts`), not in the coordinator (`runtime/coordinator.ts`),
not in `ownership.ts`'s `resolveOperationPatch` despite a doc comment there
implying its `fieldsSchema` option came "from the capability's registry
entry" (in the real code, it's passed directly by the caller). The module's
own header comment and `specs/architecture.md` framed it as reserved for
"the (future) standalone runtime" — but that runtime (`runtime/`'s
`createData`, `createDataStore`, `coordinator`) has since fully shipped
without ever needing it. It was write-only dead code.

Worse, its presence produced a real, reasonable misreading: that
`@maverickcer/data-cap/build`'s AST scanner depends on this registry to
discover capabilities, and that skipping `buildData()` (e.g. hand-
constructing a `DataState` and passing it straight to `createDataStore()`)
would "opt out" of discovery via some missing runtime registration step.
That is not how discovery works and never was — `src/build/`'s scanner
(`parse.ts`, `link.ts`, `literal-eval.ts`) is pure `ts.createSourceFile()`
AST analysis over source text (ADR 0002); it never `import()`s, `require()`s,
or `eval()`s a discovered file, and structurally never holds a live
capability object at all — only AST nodes and file paths — so it could not
read a runtime `WeakMap` keyed by object identity even if one existed for
that purpose. `grep -rn "registry" src/build/` returns zero matches.
Discoverability has only ever depended on whether a
`buildData(...)`/`createData(...)` call expression is written at
module-top-level in a file's source (`parse.ts`'s `isCallToName`) — a purely
syntactic fact, independent of whether that code ever executes.

## Decision

Delete `src/core/registry.ts` (`registerCapability`, `getCapabilityInternals`,
`CapabilityInternals`) and its call site in `buildData()`
(`src/core/build.ts`). Since `BuildDataOptions.name`/`CreateDataOptions.name`
existed solely to seed the registry entry's `Symbol(name)`, remove them too
rather than leave a public option that silently does nothing —
`buildData<TFields>(config: BuildDataConfig<TFields>): BuiltData<TFields>`
is now single-argument.

## Consequences

- No discovery or runtime-behavior change for any capability: the registry
  never fed anything observable to begin with.
- `buildData()`'s signature drops its second `options` parameter; any caller
  passing `{ name: ... }` needs to drop it (pre-1.0, no deprecation window —
  see `VERSIONING.md`).
- Restates, explicitly, the actual discovery contract for future readers:
  `@maverickcer/data-cap/build` finds a capability purely by matching a
  `buildData(...)`/`createData(...)` call expression in your source's AST —
  never by anything that happens at runtime, and never via any runtime
  registration mechanism. `data-cap` has no runtime capability registry at
  all, by design.
- `core/ownership.ts`'s `fieldsSchema` doc comment and
  `specs/architecture.md`'s `core/` module inventory are updated to stop
  referencing the now-deleted registry.

## Alternatives considered

- **Keep the registry for a hypothetical future consumer.** Rejected — the
  runtime it was explicitly reserved for ("the (future) standalone runtime")
  already shipped without needing it, and inert runtime plumbing with a
  forward-looking doc comment is exactly what produced this misunderstanding
  in the first place. If a real future need for a runtime capability→schema
  lookup arises, it should be reintroduced deliberately, scoped to that
  actual consumer, not kept speculatively.
- **Keep `registerCapability` but delete only the misleading doc comments.**
  Rejected — the code itself, not just its documentation, is what's
  confusing: a runtime side effect on every `buildData()` call that does
  nothing observable is a worse design than not having the side effect,
  independent of how it's documented.
