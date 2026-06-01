#!/usr/bin/env bash
# CodeGov OSS benchmark — reproducible AI-authorship scan of public repos.
#
# Method (identical for every repo, so the table is comparable):
#   1. Blobless, single-branch clone of the last 6 months of the DEFAULT branch
#      (`--filter=blob:none --shallow-since="6 months ago"`). No file contents are
#      downloaded — detection only needs commit metadata.
#   2. `codegov scan --since 6m --no-stat` (metadata-only; counts are identical to
#      a full scan, just without line-diff numbers).
#
# Usage:
#   CODEGOV="node /abs/path/to/codegov/dist/cli.js" bash benchmark.sh   # local build
#   bash benchmark.sh                                                   # published npm
#
# Override the window with SINCE, e.g. SINCE="3 months ago".

set -u
CODEGOV="${CODEGOV:-npx -y @james-wall/codegov}"
SINCE="${SINCE:-6 months ago}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

REPOS=(
  "aider-chat/aider"
  "tailwindlabs/tailwindcss"
  "microsoft/vscode"
  "supabase/supabase"
  "vercel/next.js"
  "anthropics/anthropic-sdk-python"
  "openai/openai-python"
  "langchain-ai/langchain"
  "facebook/react"
  "nodejs/node"
)

printf "%-34s %9s %7s %8s  %s\n" "repo" "commits" "ai" "pct" "agents"
echo "------------------------------------------------------------------------------------------"

for repo in "${REPOS[@]}"; do
  name="${repo##*/}"
  dir="$WORK/$name"

  if ! git clone --quiet --filter=blob:none --shallow-since="$SINCE" \
        --single-branch "https://github.com/$repo.git" "$dir" 2>/dev/null; then
    printf "%-34s %9s\n" "$repo" "CLONE-FAIL"
    continue
  fi

  out="$(cd "$dir" && $CODEGOV scan --since 6m --no-stat 2>/dev/null)"
  headline="$(echo "$out" | grep -E "% of commits are AI-authored" | head -1)"
  agents="$(echo "$out" | grep -E "^Agents:" | head -1 | sed 's/^Agents: //')"
  pct="$(echo "$headline" | grep -oE '^[0-9.]+%')"
  frac="$(echo "$headline" | grep -oE '\([0-9]+/[0-9]+\)' | tr -d '()')"
  ai="${frac%/*}"; commits="${frac#*/}"

  printf "%-34s %9s %7s %8s  %s\n" \
    "$repo" "${commits:-?}" "${ai:-?}" "${pct:-?}" "${agents:-—}"
  rm -rf "$dir"
done
