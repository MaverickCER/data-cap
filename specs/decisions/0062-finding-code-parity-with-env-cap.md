# 0062: Three finding codes renamed for word-order/vocabulary parity with `@maverickcer/env-cap`

## Status

Accepted. Implemented across `src/build/findings.ts`,
`src/build/citation-verification.ts`, `src/build/exclusive-group.ts`, every
test asserting the old strings, `examples/enterprise-platform/reports/
litigation-evidence.ts`, and the generated `schemas/*.schema.json`/
`docs/api-report/`. Historical references to the old names in already-
Accepted ADRs (0050, 0052, 0053) and already-released `CHANGELOG.md`
entries are deliberately left as-is — they describe what shipped at the
time, not the current name.

## Context

A cross-package parity audit ahead of both packages' `1.0` release compared
data-cap's finding codes against env-cap's for the two concepts each
package ported near-verbatim from the other's design:

- **Developer-declared dynamic-access citations** (env-cap's ADR 0037,
  data-cap's ADR 0053 — the exact same "a citation whose source no longer
  resolves" vs. "resolves but its content changed" pair): env-cap names
  them `MISSING_DYNAMIC_ACCESS_CITATION`/`STALE_DYNAMIC_ACCESS_CITATION`;
  data-cap named them `DYNAMIC_ACCESS_CITATION_MISSING`/
  `DYNAMIC_ACCESS_CITATION_STALE` — identical concept, identical words,
  word order systematically reversed for no documented reason.
- **Mutually-exclusive group membership** (env-cap's ADR 0009, data-cap's
  own exclusive-group check): env-cap names the finding
  `EXCLUSIVE_GROUP_VIOLATION`; data-cap named it `EXCLUSIVE_GROUP_CONFLICT`
  — same mechanism (a declared exclusivity rule broken by simultaneous
  membership), gratuitously different noun.

Neither package's own finding-code vocabulary is internally 100%
consistent (both mix status-word-first — `UNCONSUMED_FIELD`,
`ABANDONED_CAPABILITY` — and status-word-last — `FIELD_ACCESS_INDETERMINATE`,
`CAPABILITY_MISSING_OWNER` — forms), so there was no principled reason to
prefer data-cap's existing spelling over env-cap's on internal-consistency
grounds either way. env-cap's status-first form is the clear dominant
pattern (12 of its 17 ownership/docs-family codes) for the citation pair
specifically; "violation" is also the more precise word for a broken
declared rule than the vaguer "conflict."

## Decision

Rename, in data-cap only:

- `DYNAMIC_ACCESS_CITATION_MISSING` → `MISSING_DYNAMIC_ACCESS_CITATION`
- `DYNAMIC_ACCESS_CITATION_STALE` → `STALE_DYNAMIC_ACCESS_CITATION`
- `EXCLUSIVE_GROUP_CONFLICT` → `EXCLUSIVE_GROUP_VIOLATION`

env-cap's spellings are unchanged — they were the more consistent /
precise of each pair, and changing the already-larger, already-consistent
side to match the smaller inconsistency would be the wrong direction.

## Consequences

- A reader or CI script matching on one of these exact strings across both
  packages (a realistic case: a shared SARIF/JSON post-processing script,
  or someone who's used one tool and reasonably expects the other's finding
  vocabulary to read the same way) now gets the same word order/vocabulary
  from either package for the identical underlying concept.
- **Breaking change** for any existing data-cap consumer matching on the
  old three strings (in `--json` output, a `--check` script parsing stdout,
  a SARIF converter, or a stored evidence snapshot). Finding codes live
  under `./build`, an Experimental-tier surface (see `VERSIONING.md`), so
  per `CONTRIBUTING.md` this ships as a `minor` changeset even though it's
  breaking -- pre-1.0, and Experimental besides, this doesn't need to wait
  for a major (consistent with ADR 0060's escape-site widening, bundled
  into the same release, which already changes some fields' reported
  status for the identical reason).
- Old ADRs (0050, 0052, 0053) and already-released `CHANGELOG.md` entries
  keep the old names in their prose — they are historical records of what
  shipped at the time, not living documentation of the current vocabulary.

## Alternatives considered

- **Change env-cap instead.** Rejected — env-cap's form is the more
  internally-consistent and more precise of the two; moving env-cap to
  match data-cap's spelling would trade a two-code inconsistency in the
  smaller package for reduced consistency in the larger, more-established
  one.
- **Leave both as-is.** Rejected — the whole point of positioning env-cap
  and data-cap as a matched pair of sibling audit tools is a consistent
  experience switching between them; a purely cosmetic, easily-fixed
  mismatch left in place ahead of both packages' first stable release is
  not a good look for tools whose entire pitch is precision and
  correctness.
- **A shared enum/constants package both import from.** Rejected for the
  same reason ADR 0043 rejected a shared resolver package: the surface is
  small enough (a handful of string literals) that the duplication cost is
  lower than a third shared-package dependency's versioning/release
  overhead.
