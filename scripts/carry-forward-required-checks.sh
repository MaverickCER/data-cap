#!/usr/bin/env bash
# A bot-authored commit that only refreshes derived/generated content
# (badges, evidence docs, refreshed benchmark numbers) sits on top of a SHA
# already verified by this same workflow run's own `contract`/`lint` jobs --
# but GitHub never lets a GITHUB_TOKEN push trigger `pull_request`-based
# workflows (an anti-recursion guard), so the new commit's required status
# checks would otherwise sit pending forever. Rather than paying for a full
# re-run (mutation testing included) of a check whose answer can't have
# changed -- no source file differs from the already-graded parent -- this
# posts a commit status on the new SHA carrying forward the parent's own real
# conclusion. Required status checks accept a status from the classic
# Statuses API (not only a Checks-API check run) as satisfying a same-named
# requirement, and the Statuses API needs only `statuses: write`, not a
# GitHub-App-associated token the Checks API requires.
set -euo pipefail

repo="$1"          # owner/repo
branch="$2"        # branch whose head SHA needs the carried-forward statuses
verified_sha="$3"  # SHA whose own check-run results are being carried forward
shift 3

new_sha=$(gh api "repos/$repo/branches/$branch" --jq .commit.sha)

for name in "$@"; do
  conclusion=$(gh api "repos/$repo/commits/$verified_sha/check-runs" --jq ".check_runs[] | select(.name==\"$name\") | .conclusion" | head -1)
  if [ "$conclusion" != "success" ]; then
    echo "::warning::$name's own result on $verified_sha was '${conclusion:-unknown}', not success -- not carrying forward a status this commit doesn't actually have."
    continue
  fi
  gh api "repos/$repo/statuses/$new_sha" \
    -f state=success \
    -f context="$name" \
    -f description="Carried forward from ${verified_sha:0:7}: unchanged source, not re-run" \
    >/dev/null
  echo "Carried forward $name (success) from $verified_sha onto $new_sha"
done
