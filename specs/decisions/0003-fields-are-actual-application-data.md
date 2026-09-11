# 0003: `fields` are the actual application data shape — no wrapper, proxy, symbol, or dot-notation access

## Status

Accepted. Implemented in `src/core/types.ts` (`InferFields`), `src/core/create.ts`.

## Context

env-cap's `EnvContract` is a proxy-backed object with per-key getters that
throw until validation completes — appropriate for environment variables,
which are inherently untyped strings until processed. data-cap's `fields`
represent ordinary application data (a user object, a list of comments) —
data a consumer already expects to read and write like any other object,
often passed straight into existing rendering/serialization code that has
no knowledge of data-cap at all.

## Decision

`capability.fields` is a plain object (or array, at the leaf) with the
exact declared shape — `capability.fields.user.name`, not
`capability.fields.get("user.name")` or a proxy trap. `InferFields`
recursively maps a declared schema to its resolved runtime type with no
wrapper types at any level. The only place a symbol or marker appears is
`fields.nullable`/`fields.optional`, and only during schema authoring —
markers never survive into the resolved `fields` value (see ADR 0018 for
the parallel decision on array identity, which is metadata-only for the
same reason).

## Consequences

- Any code that already knows how to work with plain JS objects (React
  props, `JSON.stringify`, a template engine) works with `fields` with zero
  data-cap-specific adaptation.
- No `data.fields` access can throw — reading an unset field just returns
  its resolved default (see ADR 0004), never a proxy trap error.
- Deep-freezing (ADR 0044) is what actually protects `fields` from
  accidental mutation, since there's no proxy layer to intercept writes.

## Alternatives considered

- **A proxy-backed `fields` object**, mirroring env-cap's `EnvContract`.
  Rejected — env-cap's proxy exists specifically to gate reads until
  validation and to support self-redaction (ADR 0006 rejects that for
  data-cap too); neither reason applies here, and a proxy would break
  identity checks (`===`) and structural-sharing reference equality
  (ADR 0010) that both directly manipulate plain fields objects.
- **Dot-notation string paths** (`data.get("user.name")`). Rejected — loses
  TypeScript's own structural type-checking on the path string, and adds
  API surface with no corresponding benefit over plain property access.
