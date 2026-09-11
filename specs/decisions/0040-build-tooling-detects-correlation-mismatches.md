# 0040: Build tooling detects `createData`/`documentData` correlation mismatches, not just matching pairs

## Status

Accepted. Implemented in `src/build/link.ts` (`correlate`,
`checkDocFieldsAgainstShape`). Demonstrated directly in
`test/integration/build-tooling/tsconfig-aliases/` and `test/integration/build-tooling/tsconfig-aliases-consumer/`
(clean correlation) — the mismatch categories themselves are covered by
`test/build/link.test.ts`.

## Context

With `createData` and `documentData` deliberately split (ADR 0001), a real
risk opens up: documentation can silently drift from the capability it's
meant to describe — a capability with no documentation at all, leftover
documentation for a capability that was since removed, two documentation
calls both claiming the same capability, or documentation describing a
field name that doesn't actually exist on the capability's schema. A build
tool that only reports _successful_ correlations would miss every one of
these as silently as if it had never looked.

## Decision

`link.ts`'s `correlate()` explicitly surfaces every mismatch category as
its own named `ParseWarning`: an undocumented capability, orphaned
documentation (no matching `createData` in the file), duplicate
documentation (two `documentData` calls both matching one capability), and
— via `checkDocFieldsAgainstShape` — documentation naming a field absent
from the capability's own resolved `fields` shape. Correlation itself is
same-file only, matching env-cap's own `link.ts` convention: unambiguous
whenever both calls reference the same local `fields` identifier, or
(fallback) whenever a file contains exactly one still-uncorrelated
`createData` and one still-unused `documentData` — anything else is
reported, never guessed at.

## Consequences

- A capability drifting out of sync with its own documentation becomes a
  discoverable, reportable condition instead of a silent, growing gap
  between what's documented and what's real.
- Because every mismatch category is named specifically (not just a
  generic "something's wrong" warning), a developer reading the report
  knows exactly what to fix — add documentation, remove orphaned
  documentation, resolve a duplicate, or correct a field name.
- This is the direct mechanism that makes `documentData`'s structural
  mirroring of `createData`'s shape (ADR 0001) actually pay off: without
  correlation checking, the shared shape would be a nice-to-have
  convention rather than something build tooling can verify held.

## Alternatives considered

- **Only reporting successful correlations, silent on everything else.**
  Rejected — exactly the "silent drift" hazard this decision exists to
  catch; a tool that never mentions a problem provides no more signal than
  no tool at all for that problem.
- **Cross-file correlation** (a `documentData` call in one file matching a
  `createData` in another). Rejected, matching env-cap's own precedent —
  same-file correlation keeps the relationship visible to a reader without
  needing to trace an identifier across files, and the ambiguity of
  matching across files (which of several same-named exports, in which
  file) isn't worth the flexibility gained.
