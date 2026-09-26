---
"data-cap": minor
---

Adds a new ESLint rule, `data-cap/no-fields-escape` (ADR 0063/0064): the
lint-time mirror of the usage-scanner widening in this same release (ADR
0060). Flags a capability's `.fields`/`getSnapshot()` escaping whole via a
spread/rest, a bare function-call argument, a named JSX prop, or an export
-- the same shapes the scanner now reports as `indeterminate` instead of a
false `UNCONSUMED_FIELD`, caught earlier at lint time instead of at report
time. Ships with an `allow` glob option for legitimate whole-object
forwarding (e.g. an internal debug panel), matching `no-raw-external-io`'s
existing escape hatch.
