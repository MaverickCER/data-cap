# Releasing data-cap

Maintainer-facing. Contributors don't run any of this — a normal change is
just a PR with a changeset (see [`CONTRIBUTING.md`](CONTRIBUTING.md#making-a-change)).
For what semver actually covers, see [`VERSIONING.md`](VERSIONING.md).

## How releases work

Releases are fully automated by [Changesets](https://github.com/changesets/changesets)
and npm's [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers)
via [`.github/workflows/release.yml`](.github/workflows/release.yml). **No
`NPM_TOKEN` secret exists in this repository** and none is needed — npm
verifies the workflow's OIDC identity against a one-time trusted-publisher
registration on npmjs.com (see [First-time setup](#first-time-setup)).

The loop:

1. Every PR that changes user-facing behavior lands with a changeset file in
   `.changeset/` (Markdown, `patch`/`minor`/`major` + a consumer-facing
   description).
2. On each push to `main`, `release.yml` runs `changesets/action`. If any
   unreleased changesets are pending, it opens or updates a pull request
   titled **"Version Packages"** from the branch
   **`changeset-release/main`** (`changesets/action`'s default; this repo's
   `.changeset/config.json` sets `commit: false` and `baseBranch: main` and
   does not override the branch name). That PR consumes the changeset files,
   bumps `package.json`'s `version`, and rewrites `CHANGELOG.md`.
3. Merging the "Version Packages" PR triggers `release.yml` again. This time
   there are no pending changesets, so `changesets/action` runs its
   `publish` step: `npm run release` (`changeset publish`), which runs
   `prepublishOnly` (`npm run verify`) and then publishes to npm over OIDC.
4. On a successful publish, the workflow force-updates the floating `v1` git
   tag to the release commit, so the `uses: maverickcer/data-cap@v1` GitHub
   Action reference in the README and [`action.yml`](action.yml) keeps
   pointing at the latest compatible build. `v1` tracks the _composite
   Action's_ interface (`action.yml` inputs/outputs), which is versioned
   independently of the npm package's pre-1.0 semver — every successful
   publish rolls it forward until `action.yml` itself has a breaking change.

`CHANGELOG.md` is generated — never hand-edit it. Fix a wrong entry by
correcting the offending changeset before the "Version Packages" PR is
merged, or with a follow-up changeset after.

## First-time setup

One-time, before the very first automated release. Requires npm account
access, so it can't be done from a PR.

1. On [npmjs.com](https://www.npmjs.com), open `data-cap`'s
   package settings → **Publishing access** → add a **trusted publisher** for
   GitHub Actions:
   - Organization or user: `maverickcer`
   - Repository: `data-cap`
   - Workflow filename: `release.yml` (exactly — just the filename, not a
     path; a mismatch here is the most common cause of the OIDC flow failing
     with a misleading `E404`)
   - Environment: leave blank unless `release.yml` is later scoped to a
     GitHub Environment
2. That's the whole trust relationship — `release.yml`'s `id-token: write`
   permission plus this registration. There is no token to copy anywhere.

Until the package exists on npm, its settings page doesn't either. For the
**first ever publish**, register the trusted publisher immediately after the
first `npm publish` (a one-time manual `npm publish --access public` from a
maintainer machine, from a clean `npm run verify` tree), then let every
subsequent release go through `release.yml`. Alternatively, publish an empty
`0.0.0` placeholder manually first, register the trusted publisher, then let
the first real "Version Packages" PR publish `0.1.0` over OIDC.

## Recovering from a failed release

Identify which state you're in first — the recovery differs and the wrong
one can double-publish or lose a version.

### A. "Version Packages" PR is open, nothing published yet

Safe state. The bump only exists on the `changeset-release/main` branch.
Fix forward: push more changesets to `main` (the PR auto-updates), or edit
the PR branch directly if the generated `CHANGELOG.md`/version is wrong.
Nothing is on npm; nothing to undo.

### B. "Version Packages" PR merged, but the publish step failed

`main` now has the version bump and changelog commit, but npm does not have
the version. This is the common failure (OIDC misconfig, a flaky
`npm run verify`, a registry blip).

1. Confirm npm really doesn't have it: `npm view data-cap
versions --json` — check the bumped version is absent.
2. Fix the root cause (see [Common failures](#common-failure-causes)).
3. Re-run the failed `release.yml` run from the Actions tab
   ("Re-run failed jobs"). `changesets/action` re-detects that there are no
   pending changesets and the current `package.json` version isn't on npm,
   and retries only the `publish` step. No new commit, no version change.
4. If re-running isn't possible, publish that exact version once by hand
   from a clean tree (`git checkout main && npm ci && npm run verify && npm
publish --access public`), then confirm the next push to `main` produces
   no spurious "Version Packages" PR.

### C. Published to npm, but a later workflow step failed

e.g. the publish succeeded but the `v1` tag roll failed. The release itself
is done and correct. Just fix the trailing step manually:

```bash
git checkout main && git pull
git tag -f v1 && git push origin v1 --force
```

Do **not** re-run the whole workflow — `changeset publish` is idempotent and
will no-op on the already-published version, but re-running risks masking
whatever the real trailing failure was.

### D. Wrong version published

npm publishes are effectively permanent (`npm unpublish` is allowed only
within 72 hours and only if nothing depends on it, and the version number
can never be reused). Don't try to unpublish a normal mistake. Instead:

- Wrong contents, right version number: publish a patch (`x.y.z+1`) with a
  changeset that fixes it, and `npm deprecate data-cap@x.y.z
"Broken publish — use x.y.z+1"`.
- Accidental major/minor bump: it stays. Continue from the new baseline; a
  version number is cheap, a rewritten history is not.

### E. First release, package not yet on npm

See [First-time setup](#first-time-setup) — the trusted-publisher
registration cannot exist before the package does, so the first publish is
the one manual step. Every release after that is automated.

## Common failure causes

- **`E404` on publish with OIDC**: the trusted-publisher registration's
  workflow filename doesn't exactly match `release.yml`, or the
  org/user/repo fields are wrong.
- **`npm run verify` fails in `prepublishOnly`**: the "Version Packages" PR
  merged with a red `main`. Fix `main` first, then recover per case B.
- **`changesets/action` opens a "Version Packages" PR when you didn't expect
  one**: there's a stray changeset file in `.changeset/` on `main`. If it's
  spurious, delete it in a normal PR.
- **Two "Version Packages" PRs**: an older one wasn't closed when `main`
  moved. Close the stale one; `changesets/action` only maintains the newest.

## Related

- [`VERSIONING.md`](VERSIONING.md) — what each bump type means, and which
  surface semver actually covers.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the contributor-side workflow
  (branch, changeset, PR).
- [`SECURITY.md`](SECURITY.md#supported-versions) — which versions get
  security fixes.
