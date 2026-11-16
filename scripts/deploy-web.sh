#!/usr/bin/env bash
# Update the public web app: merge main into the `deploy` branch, refresh the prebuilt WASM
# (web/src/wasm is ignored on main but committed on deploy), and push. tachyon builds `deploy`
# automatically (see tachyon.yml on that branch).
#   mise run deploy-web                     merge origin/main, rebuild wasm, push deploy
#   scripts/deploy-web.sh --dry             same, but stop before pushing
#   scripts/deploy-web.sh --target preview  same into the `preview` branch (tachyon app
#                                           walkback-preview, scripts/tachyon.preview.yml); the
#                                           public deploy branch is not touched
#   scripts/deploy-web.sh --target both     preview first, then the public deploy branch
#                                           (roll back with: tachyon compute deployments rollback
#                                           app_01m7ccwrtfwnvwv8ecg7558mad --to-previous)
# Works in a temporary worktree, so the current checkout and branch are left alone.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DRY=false; BRANCH=deploy
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY=true ;;
    --target) BRANCH="${2:?--target needs deploy or preview}"; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done
if [[ "$BRANCH" == both ]]; then
  extra=""; $DRY && extra="--dry"
  # shellcheck disable=SC2086  # $extra is empty or one word
  "$0" --target preview $extra && "$0" --target deploy $extra
  exit $?
fi
[[ "$BRANCH" == deploy || "$BRANCH" == preview ]] || { echo "--target must be deploy, preview or both"; exit 2; }

git fetch -q origin main
# The preview branch starts from main the first time.
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null; then git fetch -q origin "$BRANCH"; BASE="origin/$BRANCH"
elif [[ "$BRANCH" == preview ]]; then BASE=origin/main
else echo "origin/deploy not found"; exit 1; fi
if [[ "$(git rev-parse --abbrev-ref HEAD)" == "main" && "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "⚠ local main differs from origin/main: deploying origin/main (push main first to include local commits)"
fi

# Temporary worktree of the target branch with origin/main merged in; cargo shares ./target.
WT=$(mktemp -d "${TMPDIR:-/tmp}/deploy-web.XXXXXX")
cleanup() { git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"; }
trap cleanup EXIT

git worktree add -q --detach "$WT" "$BASE"
cd "$WT"
git merge -q --no-edit origin/main -m "$BRANCH: merge main ($(git rev-parse --short origin/main))"
if [[ "$BRANCH" == preview ]]; then
  # Only the preview app's manifest on this branch.
  cp scripts/tachyon.preview.yml tachyon.yml
  git add tachyon.yml
  git diff --cached --quiet || git commit -q -m "preview: tachyon.yml for walkback-preview"
fi

echo "▶ building wasm"
export CARGO_TARGET_DIR="$ROOT/target"
cargo build -q -p analog-wasm --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir web/src/wasm "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/analog_wasm.wasm"
git add -f web/src/wasm
git diff --cached --quiet || git commit -q -m "$BRANCH: rebuild wasm for $(git rev-parse --short origin/main)"

echo "▶ checking the web build"
pnpm --dir web install --frozen-lockfile >/dev/null
pnpm --dir web build >/dev/null

if git diff --quiet "$BASE" HEAD && [[ "$BASE" == "origin/$BRANCH" ]]; then
  echo "✓ $BRANCH is already up to date with main"; exit 0
fi
git log --oneline "$BASE"..HEAD
if $DRY; then echo "(dry run: not pushed)"; exit 0; fi
git push -q origin "HEAD:refs/heads/$BRANCH"
echo "✓ pushed $BRANCH ($(git rev-parse --short HEAD))"

# tachyon starts a "Tachyon Build" check run within seconds of a push, but has once missed one.
# If none shows up, push an empty commit to retrigger it.
command -v gh >/dev/null || { echo "(gh not found: check the build on platform.txcloud.app)"; exit 0; }
checks() { gh api "repos/course-inc/nasa-hackason/commits/$(git rev-parse HEAD)/check-runs" --jq '.total_count' 2>/dev/null || echo 0; }
for attempt in 1 2; do
  for _ in 1 2 3 4 5 6; do [[ "$(checks)" != "0" ]] && break 2; sleep 10; done
  echo "⚠ no tachyon build started: pushing an empty commit to retrigger"
  git commit -q --allow-empty -m "$BRANCH: retrigger tachyon build"
  git push -q origin "HEAD:refs/heads/$BRANCH"
done
[[ "$(checks)" != "0" ]] && echo "✓ tachyon build started: https://github.com/course-inc/nasa-hackason/commits/$BRANCH" \
  || echo "⚠ tachyon still hasn't started a build: check platform.txcloud.app"
