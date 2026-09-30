#!/bin/sh
# Fails if any private term appears in the staged changes, or in the commit
# message when one is passed. The terms live in .private-terms, which is
# gitignored: publishing the list would publish the very things it protects.
set -eu
root=$(git rev-parse --show-toplevel)
terms="$root/.private-terms"
if [ ! -s "$terms" ]; then
  echo "privacy-check: $terms is missing or empty. Create it (one term per line) before committing." >&2
  exit 1
fi
pattern=$(grep -v '^[[:space:]]*\(#\|$\)' "$terms" | sed 's/[.[\*^$/]/\\&/g' | paste -sd'|' -)
status=0
if git diff --cached --name-only | grep -qx '.private-terms'; then
  echo "privacy-check: .private-terms is staged. Unstage it." >&2
  status=1
fi
hits=$(git diff --cached -U0 --no-color -- . ':(exclude).private-terms' | grep '^+' | grep -v '^+++' | grep -inwE "$pattern" || true)
if [ -n "$hits" ]; then
  echo "privacy-check: private terms in staged changes:" >&2
  echo "$hits" >&2
  status=1
fi
if [ $# -gt 0 ] && grep -v '^#' "$1" | grep -inwE "$pattern" >&2; then
  echo "privacy-check: private terms in the commit message." >&2
  status=1
fi
exit $status
