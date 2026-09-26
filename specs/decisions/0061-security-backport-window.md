# 0061: Post-1.0 security fixes are backported one major version back, for a minimum of six months

## Status

Accepted. Implemented in `SECURITY.md`'s "Supported versions" section.
Mirrors `@maverickcer/env-cap`'s identical
[ADR 0015](https://github.com/MaverickCER/env-cap/blob/main/specs/decisions/0015-security-backport-window.md)
— both packages ship their first `1.0` together and should give an
evaluator the same forward answer, not a gap in one and a commitment in
the other.

## Context

`SECURITY.md`'s "Supported versions" section said only that security fixes
target the latest published `0.x` version and that "there is currently no
separate long-term-support branch or extended security-support policy" —
true today, but silent on what happens once the project reaches `1.0`, when
a major-version bump starts meaning something different (a real breaking-
change boundary, not `0.x`'s "any minor may change a Stable API" per
`VERSIONING.md`). `ADOPTION.md`'s "Versioning, stability, and long-term
support" section already named this as "the honest gap" for an organization
evaluating adoption at scale, with no forward answer — only a description
of what's missing today. `env-cap` — the sibling package this one was
seeded from ([ADR 0043](0043-env-cap-resolver-relocated-and-duplicated.md))
— had exactly this same gap once and closed it via its own ADR 0015; this
package never received the equivalent fix, surfaced during a cross-package
parity audit ahead of both packages' `1.0` release.

## Decision

Starting at the first `1.0` release, security fixes will be backported to
the latest minor release of the previous major version for a minimum of six
months after a new major version ships. That minimum window may be extended
at the maintainer's discretion, but once a minimum end date has been stated
for a given major version's backport window, it will never be shortened
retroactively. Before `1.0`, the existing "latest `0.x` only" policy
continues unchanged — this decision does not attempt to backdate a
commitment onto pre-1.0 releases.

## Consequences

- An organization evaluating `data-cap` for a hard LTS/backport requirement
  now has a concrete, dated answer for the _post-1.0_ state, distinct from
  today's real, current gap — `ADOPTION.md` is updated to state both
  halves rather than only the gap.
- This is a forward commitment, not a proven track record. `ADOPTION.md`
  must continue to say so explicitly.
- A future major-version release's changelog/release notes must state the
  backport window's end date explicitly, since the "never shortened once
  stated" guarantee only has teeth if the stated date is written down
  somewhere a consumer can point back to.

## Alternatives considered

Identical reasoning to env-cap's ADR 0015 — see that ADR for the full
"no commitment at all" / "shorter or open-ended window" / "revocable
commitment" alternatives and why each was rejected. No package-specific
reasoning changes any of those conclusions here.
