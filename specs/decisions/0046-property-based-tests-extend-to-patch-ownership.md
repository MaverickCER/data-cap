# 0046: Property-based testing extends to `core/patch.ts` and `core/ownership.ts`, not just canonicalization

## Status

Accepted. Implemented in `test/core/patch.test.ts`,
`test/core/ownership.test.ts`.

## Context

`core/canonicalize.ts` always needed property-based tests (equal inputs →
equal keys; distinct supported values → distinct keys) since its
correctness is fundamentally about behavior across a huge space of
possible inputs, not any specific example. `core/patch.ts`
(`patchInto`/`commitState`/`project`) and `core/ownership.ts`
(`resolveOperationPatch`) are exactly as algorithmically dense and
correctness-critical — structural sharing, no-op suppression, and
ownership-boundary enforcement all have the same "must hold across
arbitrary shapes, not just the examples we happened to write" character.

## Decision

`patch.ts` gets property-based coverage for: every field/branch _not_
touched by a patch stays reference-equal to `prev`'s counterpart, across
randomized nested shapes; `patchInto(s, {})` returns `s` unchanged (same
reference); applying the same patch twice is idempotent, with the second
call returning the _same reference_ as the first (the no-op-suppression
invariant, ADR 0042); neither function ever mutates its input, checked
both by reference and by deep-equal snapshot after the call; `project()`
folding an empty transitions list returns `authoritativeState` unchanged,
and folding a given list is deterministic across repeated calls despite
never being cached. `ownership.ts` gets property-based coverage for:
across randomly generated processor output — including extra/malicious/
`__proto__`-style keys and functions — the accepted patch never contains a
key absent from the declared ownership/schema boundary; a fully valid,
fully owned processor output round-trips unchanged; a single malformed
leaf embedded in an otherwise-valid randomly generated tree never causes a
sibling leaf to be dropped or reset (generalizing ADR 0012's own example).

## Consequences

- These properties are proven across a generated space of inputs, not just
  the specific shapes a hand-written example happened to cover — a
  structural-sharing or ownership-boundary bug that only manifests for an
  unusual (but valid) input shape is far more likely to be caught before
  release.
- Because the properties are stated explicitly (not just "the tests
  pass"), they double as precise, checkable documentation of exactly what
  `patchInto`/`commitState`/`project`/`resolveOperationPatch` guarantee.
- This matches env-cap's own existing property-based rigor for its
  analogous dense, correctness-critical modules, rather than treating
  data-cap's equivalents as a lesser standard.

## Alternatives considered

- **Example-based tests only, for every module including these.**
  Rejected — the failure modes these properties guard against (a
  structural-sharing bug that only shows up for a specific nesting depth
  or key-overlap pattern, an ownership-boundary leak for an unusual
  malicious-key shape) are exactly the kind hand-picked examples are
  statistically unlikely to happen to cover.
- **Property-based testing everywhere, uniformly, regardless of a
  module's actual algorithmic density.** Rejected as unnecessary scope —
  simpler, more mechanical modules (e.g. `errors.ts`'s error-class
  construction) don't have the "must hold across a huge input space"
  character that makes property-based testing worth its own added
  complexity.
