# 0041: Dual-package-hazard (duplicate module instantiation across import paths) is a checked, documented risk class

## Status

Accepted. Checked by `test/runtime/dual-package-hazard.test.ts`; documented
in SECURITY.md/ADOPTION.md (Phase 9).

## Context

`defaultCoordinator` (ADR 0027) is a module-level singleton — correct and
useful _within_ one loaded module instance, but a real hazard the moment a
consumer's dependency tree resolves `@maverickcer/data-cap/runtime`
through two different specifiers (an ESM importer and a CJS requirer of
the same logical package, or a re-exporting intermediate package). Node
loads two entirely separate module instances in that case, each with its
own `defaultCoordinator` — no npm package that ships both ESM and CJS
builds can prevent this; it's a property of how Node's two module systems
resolve independently.

## Decision

Since the hazard can't be prevented, it's made a checked, documented risk
class instead of a silent unknown. `test/runtime/dual-package-hazard.test.ts`
loads the built `dist/runtime/index.js` (ESM) and `dist/runtime/index.cjs`
(CJS) as two genuinely separate module instances and pins the _exact_,
understood consequence: the same resolution path always yields the same
singleton (no hazard within one module graph); different resolution paths
load different instances (the hazard itself, confirmed to exist rather
than assumed); and — the important part — each instance still dedupes
correctly _on its own_, they simply never share work with each other.
Graceful degradation, not corruption or a crash. SECURITY.md/ADOPTION.md
state this plainly as a known limitation for evaluators to plan around.

## Consequences

- If a future change somehow "fixed" this hazard for the wrong reason
  (e.g. a build change that accidentally makes CJS re-export the ESM
  singleton in a broken way), the test would need updating — it pins
  today's real, correct behavior, not a hoped-for one.
- An application or organization evaluating this package for a
  mixed-module-system environment has an honest, tested answer instead of
  an unverified claim either way.
- The test doubles as proof that the _consequence_ of the hazard is
  survivable — two independent, internally-correct coordinators, not
  silent data corruption — which is the property that actually matters
  for a consumer deciding whether this is acceptable for their use case.

## Alternatives considered

- **Attempting to prevent the hazard via a global registry keyed by some
  cross-realm-stable token (e.g. on `globalThis`).** Rejected — adds real
  complexity and its own new hazard class (global namespace collisions,
  version-mismatch handling) to solve a problem that, once understood,
  degrades gracefully anyway; not worth the tradeoff for this package's
  actual risk profile.
- **Ignoring the hazard, undocumented.** Rejected — an unverified, unstated
  risk is strictly worse for an evaluator than a stated, tested one, even
  though the underlying limitation is identical either way.
