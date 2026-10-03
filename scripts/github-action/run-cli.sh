#!/usr/bin/env bash
# Runs `data-cap --json <args>` for the composite action. Every action input arrives as an
# environment variable (never interpolated into this script's text, which is GitHub's documented
# injection anti-pattern), and the package is never "whatever npm latest is at run time": it is the
# project's own local install, or an explicit version.
#
#   INPUT_ARGS      arguments for `data-cap --json`, split on whitespace into an array
#   INPUT_VERSION   version to fetch via npx when data-cap is not installed locally
#   RESULT_PATH     where the JSON result goes
#   GITHUB_OUTPUT   receives `exit-code=<n>`
set -uo pipefail

: "${RESULT_PATH:?RESULT_PATH is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

read -r -a ARGS <<<"${INPUT_ARGS:-}"

if [ -x node_modules/.bin/data-cap ]; then
  RUNNER=(npx --no-install data-cap)
elif [ -n "${INPUT_VERSION:-}" ]; then
  if ! [[ "$INPUT_VERSION" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]*$ ]]; then
    echo "::error::The 'version' input must be a plain npm version or dist-tag; got '$INPUT_VERSION'."
    echo "exit-code=2" >>"$GITHUB_OUTPUT"
    exit 0
  fi
  RUNNER=(npx --yes "data-cap@${INPUT_VERSION}")
else
  echo "::error::data-cap is not installed in this project and no 'version' input was given. Install it as a devDependency (recommended) or set 'version:', so the action never runs an unpinned 'latest'."
  echo "exit-code=2" >>"$GITHUB_OUTPUT"
  exit 0
fi

"${RUNNER[@]}" --json "${ARGS[@]}" >"$RESULT_PATH"
echo "exit-code=$?" >>"$GITHUB_OUTPUT"
