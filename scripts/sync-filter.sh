#!/bin/sh
# Copies the shared filter into the Chrome extension folder. The iOS target
# reads shared/ directly, so this is only needed for chrome/.
# Usage: scripts/sync-filter.sh [--check]   (--check fails if chrome/ is stale)
set -eu
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--check" ]; then
  for f in filter.js filter.css; do
    cmp -s "shared/$f" "chrome/$f" || { echo "chrome/$f is out of date; run scripts/sync-filter.sh" >&2; exit 1; }
  done
  echo "chrome/ is in sync"
  exit 0
fi

cp shared/filter.js shared/filter.css chrome/
echo "copied shared/filter.{js,css} -> chrome/"
