# Contributing to data-cap

You want a change merged and released without surprises. This covers setup, the checks your change must pass, and how it reaches npm.

## Development setup

```bash
git clone https://github.com/maverickcer/data-cap.git
cd data-cap
npm run setup   # install, build, regenerate the schemas, and install the git hooks
```

`npm run setup` installs the shared git hooks (`internal-package-contract install-hooks`). When installed, they run most of CI's checks earlier:

| Hook       | Runs                                              |
| ---------- | ------------------------------------------------- |
| pre-commit | The contract, for the checks the change can reach |
| pre-push   | The contract without the slow analyses            |
| commit-msg | The Conventional Commits format check             |

The hooks are optional; CI is the gate. The branch ruleset requires the `contract` and `lint` checks.

`npm run verify` runs locally what CI spreads over `lint` and `verify`, plus the README example check (skipped unless `examples/application` is installed):

```bash
npm run verify   # typecheck, lint, format, build, schemas, coverage, size, ambient and isolation checks, README example, API report
```

Run it before you open a pull request. Single steps are `npm run typecheck`, `npm run build`, `npm test`, `npm run test:watch`, `npm run test:coverage`, `npm run lint` and `npm run size`. `npm run contract` runs the full `internal-package-contract` gate, mutation testing included.

Each directory under `examples/` is its own npm project, installed from `file:../..`. The root `npm run verify` does not install or run them. To work on one:

```bash
npm run build      # from the repository root, first
cd examples/<name>
npm install
npm start          # runs the example's assertions
npm run typecheck
```

If you changed observed behaviour on purpose, regenerate the examples' committed output from the root with `npm run examples:update-golden`. Review that diff before you commit it ([`examples/README.md`](examples/README.md)).

## Making a change

1. Branch from `main`.
2. Make the change. If it touches a Stable surface in [`VERSIONING.md`](VERSIONING.md), decide whether it is breaking, additive or a fix.
3. Add or update tests. `npm run test:coverage` fails below the floors in `vitest.config.ts`. Floors are raised in review when coverage improves and never lowered to fit a drop. A new dense pure function (canonicalization, patching, ownership) also gets property-based tests.
4. Add a changeset with `npx changeset`, written for someone who installs the package. Pick the bump from VERSIONING.md's tiers; a change to an Experimental surface is never `major`. Before 1.0, write `minor` for a breaking change; a `major` changeset publishes 1.0.0. Without one, a changeset is generated on `main` from your commit messages.
5. Open a pull request. The `lint`, `verify` and `contract` jobs run the same steps as `npm run verify`, plus the contract and mutation testing. The other jobs (examples, integration fixtures, Bun and Deno, TypeScript and package-manager compatibility, benchmarks) also run but do not block a merge. A failed `benchmark-pr` skips `lint`, `verify` and `contract`, and GitHub counts a skipped required check as passing, so check it by hand. The release still needs a successful `contract` run.

Commit messages follow Conventional Commits; the `Commits` check in `contract` fails otherwise.

## Adding an Architecture Decision Record (ADR)

`specs/decisions/` records why the project is shaped the way it is. `specs/architecture.md` is the current-state summary; the ADRs are the reasoning. Add one when a change:

- adds a constraint an application could rely on, such as "`DataInfo` is mandatory";
- rules out an approach a later contributor might reintroduce, such as automatic rollback; or
- moves the boundary of what an entry point is responsible for.

A bug fix or a refactor with no observable change does not need one.

**Numbering:** take the next unused number in `specs/decisions/`. Never reuse a number, even one with no file.

Use this structure:

```markdown
# NNNN: <short, decision-stated-as-a-sentence title>

## Status

Proposed.
<!-- A new decision starts Proposed. Change it to "Accepted. Implemented in
     `path/to/file.ts`." once the code that implements it is merged. -->

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

Each rejected alternative, and the specific reason it was rejected: not just
"more complex," but what concrete problem the complexity would or wouldn't
have solved.
```

If the ADR records a structural boundary, link it from `specs/architecture.md`'s decision table.

## Release process (maintainers)

Releases use Changesets and npm trusted publishing. After a change merges, a version pull request opens; a person reviews and merges it, and only then does the release publish. [`RELEASING.md`](RELEASING.md) covers the flow, the one-time setup and recovery. Contributors run none of it.

## Versioning and stability

[`VERSIONING.md`](VERSIONING.md) says what semver covers, what is Experimental, and what is private. If you are unsure whether a change is breaking, ask in the pull request.
