#!/usr/bin/env bash
# Run only the checks affected by what changed.
#   scripts/ci-changed.sh          changes vs origin/main (or HEAD) + uncommitted + untracked
#   scripts/ci-changed.sh --all    everything
# With no commits yet, everything counts as changed.
set -euo pipefail
cd "$(dirname "$0")/.."

changed() {
  if [[ "${1:-}" == "--all" ]] || ! git rev-parse --verify -q HEAD >/dev/null; then
    git ls-files --cached --others --exclude-standard 2>/dev/null || find . -type f -not -path './.git/*'
    echo "__ALL__"
    return
  fi
  local base=HEAD
  git rev-parse --verify -q origin/main >/dev/null && base=$(git merge-base origin/main HEAD)
  { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u
}

FILES=$(changed "${1:-}")
has() { grep -qE "$1" <<<"$FILES"; }
ALL=false; has '^__ALL__$' && ALL=true

run() { echo; echo "▶ $*"; "$@"; }
ran=0

if $ALL || has '^(crates/|data/|Cargo\.(toml|lock)$)'; then
  run cargo fmt --all --check
  run cargo clippy -p analog-core -p analog-wasm --all-targets -- -D warnings
  run cargo test -p analog-core
  ran=1
fi

if $ALL || has '^(crates/|data/|web/|Cargo\.(toml|lock)$)'; then
  run mise run wasm
  run pnpm --dir web typecheck
  run pnpm --dir web test
  run pnpm --dir web build
  if node -e "require('playwright')" 2>/dev/null || NODE_PATH="$(npm root -g)" node -e "require('playwright')" 2>/dev/null; then
    run scripts/e2e.sh
  else
    echo "⚠ Playwright not found: skipping e2e (pnpm add -g playwright && npx playwright install chromium)"
  fi
  ran=1
fi

if $ALL || has '^(src-tauri/|crates/analog-core/)'; then
  if [[ "$(uname)" == "Linux" ]] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    echo "⚠ WebKitGTK not installed: skipping src-tauri check"
  else
    run cargo clippy -p analog-finder --all-targets -- -D warnings
  fi
  ran=1
fi

if $ALL || has '^app/.*\.js$'; then
  for f in $(find app/js -name '*.js'); do node --check "$f"; done
  echo "✓ legacy app/ syntax"
  ran=1
fi

[[ $ran == 1 ]] && echo && echo "✅ ci-changed passed" || echo "Nothing to check."
