# 0065: Promote `./build`, `createData`, and the `--package`/`--tsconfig` CLI flags to Stable

## Status

Accepted. Moves the entire Experimental-tier bullet list in `VERSIONING.md`
into Stable, leaving the Experimental section empty. Removes every
`@remarks Experimental -- see VERSIONING.md.` doc-comment tag from
`src/build/parse.ts`, `discover.ts`, `link.ts`, `literal-eval.ts`,
`resolution/resolve-import.ts`, `resolution/resolve-within-root.ts`,
`resolution/resolve-package-schema.ts`, `resolution/resolve-tsconfig-paths.ts`,
and `src/runtime/capability.ts` (`createData`); removes the
`[Experimental, see VERSIONING.md]` prefix from `--package`/`--tsconfig` in
`src/cli/index.ts`'s help text; updates the corresponding prose in
`README.md`, `GUIDE.md`, and `ADOPTION.md`.

## Context

`VERSIONING.md`'s own Experimental-tier definition states the graduation
criterion directly: "Once a feature has been through at least one real
feedback cycle without a need to break it... it becomes Stable." Every
surface that shipped Experimental has now had exactly that:

- `./build`'s discovery/parse/link/resolution primitives have been in real
  use since [ADR 0032](0032-tsconfig-path-alias-resolution-ported.md)/
  [ADR 0043](0043-env-cap-resolver-relocated-and-duplicated.md), ported from
  `env-cap`'s own already-Stable equivalent, and this same release's audit
  (ADR 0060) found and fixed a real gap in it without needing to change its
  public shape — the function signatures, not the internal escape-detection
  logic, are what Stable actually covers.
- `createData` ([ADR 0048](0048-builddata-createdata-split-and-optional-operations-layer.md))
  has shipped since its introduction with no reported need to change its
  bound-operation contract, `runGetters` semantics, or `getSnapshot()`
  shape.
- `--package`/`--tsconfig` are thin CLI surfaces over the now-Stable
  `./build` primitives above; there is no remaining reason for them to lag
  the primitives they configure.

Separately: this package is laser-focused on one core benefit --
synchronously-readable, always-valid application data state -- and every
mechanism that ships as part of it is meant to be depended on with
confidence, not held at arm's length behind a tier that exists for genuine
uncertainty that no longer applies here.

## Decision

Promote all of it to Stable in one pass, in this same release as the ADR
0060/0062/0063/0064 audit. The Experimental tier itself stays defined in
`VERSIONING.md` — it's the right mechanism for a genuinely new, unproven
future surface — it's just empty right now, honestly, rather than holding
onto a designation that no longer describes anything true about these APIs.

## Consequences

- A breaking change to `./build`'s public functions, `createData`'s
  contract, or `--package`/`--tsconfig` now requires a major version bump
  (once `data-cap` reaches 1.0 -- see `VERSIONING.md`'s Pre-1.0 status
  section; before that, the existing minor-may-break-Stable allowance still
  applies, same as every other Stable surface).
- No runtime behavior changes anywhere in this ADR -- this is a
  documentation and compatibility-promise change only, verified by the full
  test suite passing unchanged.
- Anyone who read the old Experimental labeling as a reason to hold off
  adopting `createData` or the cross-package/tsconfig discovery flags now
  has an explicit, documented Stable commitment instead.

## Alternatives considered

- **Promote piecemeal, one ADR-reviewed feedback cycle at a time.**
  Rejected for this pass: every currently-Experimental surface already
  independently satisfies the stated graduation criterion, so gating them
  on separate future ADRs would just delay an already-justified decision
  without adding information.
- **Leave `./build` Experimental a while longer given ADR 0060 just changed
  its reported findings.** Rejected -- ADR 0060 changed what the scanner
  _reports_ (a bug fix to its accuracy), not its public function
  signatures or options shape, which is what the Stable tier actually
  covers per `VERSIONING.md`'s own scope.
