# 0006: Capabilities do not self-redact `fields`/`info` in `console.log`/`util.inspect`

## Status

Accepted. Implemented implicitly — `DataState` is a plain object with no
custom `toString`/`toJSON`/`util.inspect.custom` override.

## Context

env-cap's own ADR 0006 gives `EnvContract` a self-redacting `String()`/
`util.inspect()` form, because environment variables routinely hold
secrets (API keys, database credentials) that must never be accidentally
logged. data-cap's `fields` hold ordinary application data — a user's
name, a list of comments, a product's price — data an application already
expects to see in its own logs, error reports, and debugging tools without
a data-cap-specific redaction layer getting in the way.

## Decision

`DataState` (and every value reachable from `capability.fields`/
`capability.info`) prints exactly as a plain JS object would under
`console.log`/`util.inspect`/`JSON.stringify` — no custom formatting, no
redaction, no special-casing.

## Consequences

- Debugging a capability's live state is exactly as straightforward as
  debugging any other plain object — `console.log(capability.fields)`
  shows the real values.
- An application that _does_ hold genuinely sensitive data in a field
  (uncommon, but not prevented — data-cap has no opinion on what a field
  represents) is responsible for its own redaction at the point it logs,
  exactly as it would be for any other plain object in its codebase; this
  is a documented, explicit non-goal, not an oversight (see SECURITY.md).
- No divergence exists between what a consumer sees via `console.log` and
  what's actually stored — useful for the freeze-verification tests
  (ADR 0044) that assert on `Object.isFrozen`/structural equality directly
  against printed/inspected values during debugging.

## Alternatives considered

- **Mirroring env-cap's self-redaction.** Rejected — data-cap's fields are
  not secrets by default (env-cap's ARE, definitionally, since it exists
  specifically for environment variables); redacting ordinary application
  data by default would make debugging harder for the overwhelmingly
  common case, in exchange for a protection against a case (secrets stored
  in `fields`) this package doesn't specifically target or claim to solve.
- **An opt-in redaction flag.** Rejected as unnecessary scope for the
  initial release — an application with a genuine need to keep some field
  out of logs can already do so at its own logging boundary, without
  data-cap needing to model "which fields are sensitive."
