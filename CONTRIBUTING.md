# Contributing to data-cap

## Development setup

```bash
git clone https://github.com/maverickcer/data-cap.git
cd data-cap
npm install
```

There is one local pre-flight gate that mirrors CI exactly:

```bash
npm run verify   # typecheck && lint && format:check && build && test:coverage && size
```

Run it before opening a pull request. Individual steps are also available on
their own: `npm run typecheck`, `npm run build`, `npm test` / `npm run
test:watch`, `npm run test:coverage`, `npm run lint`, `npm run size`.

Each directory under `examples/` is its own, separately-installed npm
project (`file:../..` against this repo's own build) — the root `npm run
verify` does not install or run them. To work on one:

```bash
npm run build   # from the repo root, first
cd examples/<name>
npm install
npm start        # runs its real assertions + writes output.json
npm run typecheck
```

If you intentionally changed observed behavior, regenerate every installed
example's golden from the repo root with `npm run examples:update-golden`
and review the diff before committing it — see
[`examples/README.md`](examples/README.md).

## Making a change

1. Branch from `main`.
2. Make your change. If it touches a documented, user-facing behavior
   (anything covered by [`VERSIONING.md`](VERSIONING.md)'s "stable" tier),
   check whether it's breaking, additive, or a fix — this determines the
   changeset bump type in step 4.
3. Add or update tests. `npm run test:coverage` must not drop coverage below
   the thresholds in `vitest.config.ts` — the policy is ratchet-up-only:
   thresholds are raised when coverage improves, never lowered to
   accommodate a drop. New algorithmically dense pure functions (canonicalization,
   structural patching/merging, field-ownership resolution) should ship with
   property-based tests in addition to example-based ones — see
   `specs/architecture.md`'s "Property-based test obligations" and "Negative
   guarantees" sections for what's expected.
4. Run `npx changeset` and describe your change from the consumer's
   perspective (not "what I changed in the code", but "what changes for
   someone who installs this package"). Pick `patch`/`minor`/`major`
   according to [`VERSIONING.md`](VERSIONING.md)'s stable/experimental/private
   split — a change to something documented as Experimental is never
   `major`, even if it's breaking.
5. Open a pull request. CI runs `npm run verify` plus coverage thresholds.

## Adding an Architecture Decision Record (ADR)

`specs/decisions/` records _why_ the project is shaped the way it is, not
just what it does today — `specs/architecture.md` is the current-state
summary; ADRs are the reasoning trail. Add one when a change:

- introduces a new constraint or guarantee an application could come to rely
  on (e.g. "`DataInfo` is mandatory, never optional or tree-shakeable"),
- closes off an alternative approach a future contributor might otherwise
  reintroduce without knowing it was already considered and rejected (e.g.
  "automatic rollback of failed optimistic mutations" or "array `DataInfo`
  fully rebuilds on every replacement" — both deliberately rejected), or
- changes the boundary of what the core/runtime/build/helpers packages are
  responsible for.

A one-line bug fix or an internal refactor with no observable behavior change
does not need one.

**Numbering**: take the next unused integer (check `specs/decisions/` for the
current highest number — gaps are possible if a numbered decision was
retroactively backfilled out of order; don't reuse a number even if a file
for it doesn't exist yet).

**Structure**:

```markdown
# NNNN: <short, decision-stated-as-a-sentence title>

## Status

Accepted. Implemented in `path/to/file.ts`.
<!-- or: Proposed / Experimental, if the decision ships behind an explicit
     Experimental label per VERSIONING.md -->

## Context

What problem existed, what constraints applied, and what would happen absent
this decision. Reference specific files/functions, not just the abstract
problem.

## Decision

What was actually decided, stated concretely enough that a future reader
could verify the codebase still matches it.

## Consequences

What this makes possible, what it forecloses, and any non-obvious tradeoff a
future contributor should know about before "fixing" what looks like a
limitation.

## Alternatives considered

Each rejected alternative, and the specific reason it was rejected — not just
"more complex," but what concrete problem the complexity would or wouldn't
have solved.
```

Cross-reference the new ADR from `specs/architecture.md`'s decision table if
it documents a structural boundary, not just a narrower implementation
choice.

## Release process (maintainers)

Releases are fully automated (Changesets + npm OIDC trusted publishing). The
whole process — the normal flow, first-time trusted-publisher setup, and
how to recover a failed or wrong publish — lives in
[`RELEASING.md`](RELEASING.md). Contributors don't run any of it; a change
ships by merging a PR that carries a changeset.

## Versioning and stability

See [`VERSIONING.md`](VERSIONING.md) for what's covered by semantic
versioning, what's Experimental, and what's a private implementation detail
that can change without notice. When in doubt about whether your change is
breaking, ask in the pull request rather than guessing at the changeset bump
type.
