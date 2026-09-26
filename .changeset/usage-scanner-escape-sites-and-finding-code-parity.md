---
"data-cap": minor
---

Fixes a real false-negative in the usage scanner (ADR 0060): a capability's
`.fields` object (or the capability itself) handed whole to a function
argument, a spread, a `return`, or a React component's props — a JSX-prop-
drilled or context-provided value, not a direct `x.fields.<name>` read — now
correctly widens every not-otherwise-proven field on that capability to
`indeterminate`, with a real cited source position, instead of silently
reporting `UNCONSUMED_FIELD` ("no consumer found") when a real, unattributable
consumer was sitting right there. Mirrors a fix `@maverickcer/env-cap` already
shipped for its own equivalent scanner (its ADR 0039).

**Breaking, pre-1.0 (any Stable API may change in a minor per VERSIONING.md):**
three finding codes are renamed for parity with env-cap's equivalent codes
(ADR 0062) — `DYNAMIC_ACCESS_CITATION_MISSING` → `MISSING_DYNAMIC_ACCESS_CITATION`,
`DYNAMIC_ACCESS_CITATION_STALE` → `STALE_DYNAMIC_ACCESS_CITATION`,
`EXCLUSIVE_GROUP_CONFLICT` → `EXCLUSIVE_GROUP_VIOLATION`. Anything matching
on the old exact strings (a `--json`/SARIF consumer, a stored evidence
snapshot) needs updating.
