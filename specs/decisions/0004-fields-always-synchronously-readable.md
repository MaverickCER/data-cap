# 0004: `fields` are always synchronously readable — no throw-until-ready gate

## Status

Accepted. Implemented in `src/core/create.ts`.

## Context

env-cap's `createEnv()` returns a contract whose values throw
`EnvNotReadyError` until `validateEnv()` has run — appropriate because an
unvalidated environment variable genuinely has no safe default (a missing
`DATABASE_URL` is an error state, not a value). data-cap's `fields` are
declared with real defaults at schema-authoring time (`createData({
fields: { user: { name: "" } } })`), so there is always a well-defined
value to return, even before any getter/mutator/subscription has ever run.

## Decision

`createData()` resolves every declared field to its default synchronously,
at call time, and returns a `DataState` whose `fields` are immediately
readable — `capability.fields.user.name` is `""` (or whatever was
declared) the instant `createData()` returns, with no "not ready yet"
state. `capability.info` is present from the same moment too (mandatory,
per ADR 0007), but starts fully sparse — there is metadata to report only
once something has actually executed.

## Consequences

- A component or module that imports a capability and reads a field before
  any getter has run sees a real, typed value (the declared default), not
  an error or `undefined` — exactly what "declare a default" is for.
- There is no async "wait for the capability to be ready" step in this
  package's own API — readiness, if an application wants to model it, is
  built from `info.<field>.status` (ADR 0016), not from a gate on `fields`
  itself.
- A schema-authoring mistake (a function-valued or cyclic default) still
  throws synchronously at `createData()` call time — this decision is
  about the _value_, not about validation, which remains a hard,
  synchronous, structural check (see `InvalidFieldDefaultError`).

## Alternatives considered

- **Mirroring env-cap's throw-until-ready gate.** Rejected — data-cap's
  fields always have a real, declared default, so there is no analogous
  "not yet known" state to gate against; the gate would only add
  friction (every read wrapped in a check) without a corresponding safety
  benefit.
- **Fields start as `undefined` until the first operation runs.** Rejected
  — this reintroduces exactly the "was this never fetched, or is the real
  value undefined" ambiguity `fields.optional()`'s explicit `undefined`
  marker exists to make deliberate, and it loses the declared-default's
  whole purpose (a safe, typed starting value).
