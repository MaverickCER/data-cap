# 0001: `documentData` mirrors `createData`'s own config shape, and stays inert

## Status

Accepted. Implemented in `src/core/document.ts`.

## Context

`env-cap` already separates runtime validation (`createEnv`) from
documentation metadata (`documentEnv`), for reasons recorded in its own ADR
0001: runtime consumers and build tooling have different information
requirements, and rich metadata risks leaking into a runtime bundle.
`data-cap` needs the same split — a capability's field/getter/mutator/
subscription documentation (descriptions, ownership, operational notes)
has no role in resolving a field's actual runtime value — but data-cap's
own capability graph (fields plus getters/mutators/subscriptions) is a
different shape than env-cap's flat variable map, so the documentation
call's own shape needed a matching decision, not just a ported one.

## Decision

`documentData(config, docs)` takes the _same_ `config` shape `createData`
does (`{ fields, getters, mutators, subscriptions }`) as its first
argument, and a `docs` object structurally mirroring that same graph
(`CapabilityDocs<TFields>` mirrors `CreateDataConfig<TFields>`) as its
second. It is inert: `void config; void docs` is the entire runtime body.
Nothing it returns is ever consumed by `createData`, and no build step
requires `documentData` to exist for `createData` to work standalone.

## Consequences

- `documentData` can never be documentation for a capability whose shape
  doesn't exist — the same `fields`/`getters`/`mutators`/`subscriptions`
  object literal (or a shared identifier) is what build tooling later
  correlates the two calls through (see ADR 0040).
- A documentation-only refactor never touches runtime code, and a
  runtime-only refactor never requires re-authoring documentation types.
- Because it's inert, `documentData` never appears in a production bundle's
  actual behavior — only static analysis ever "runs" it, by reading its AST.

## Alternatives considered

- **A single call combining runtime config and documentation fields**
  (env-cap's own original, since-reverted design). Rejected for the same
  reasons env-cap's ADR 0001 rejected it: it couples the runtime API and
  type surface to documentation complexity, and risks documentation data
  leaking into runtime errors/logs/bundles.
- **A loosely-typed `{ fields, [key: string]: unknown }` docs bag.**
  Rejected — an unstructured bag can't be checked against the real
  capability shape (a doc'd field that doesn't exist would go unnoticed
  until a human read it), defeating the correlation-mismatch detection
  ADR 0040 depends on.
