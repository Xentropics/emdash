#!/usr/bin/env bash
# Put the fork's feature branches (fork/features.txt) and local-updates.patch on
# top of an upstream release tag, and stamp the Xentropics version. Used by the
# release-fork workflow and by emdash-local/rebuild.command.
#
# Usage: assemble.sh <repo> <tag> <version>
#   repo     clone of Xentropics/emdash with remotes origin (the fork) and upstream
#   tag      upstream release tag, for example v1.2.14
#   version  version to stamp, for example 1.2.14+xentropics.1
set -euo pipefail

TOOLS="$(cd "$(dirname "$0")" && pwd)"
REPO="$1"
TAG="$2"
VERSION="$3"
BUILD_BRANCH="${BUILD_BRANCH:-local/build}"

cd "$REPO"
# Branches that touch the same files (groups and pins) conflict when combined.
# rerere replays the resolutions kept in fork/rr-cache.
git config rerere.enabled true
git config rerere.autoupdate true
mkdir -p "$(git rev-parse --git-path rr-cache)"
cp -R "$TOOLS/rr-cache/." "$(git rev-parse --git-path rr-cache)/"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "The build checkout has uncommitted changes:"; git status --short; exit 1
fi
git checkout --quiet -B "$BUILD_BRANCH" "$TAG"

while IFS='|' read -r branch marker_file marker_text base; do
  case "$branch" in '' | '#'*) continue ;; esac
  if git cat-file -e "$TAG:$marker_file" 2>/dev/null &&
    { [ -z "$marker_text" ] || git show "$TAG:$marker_file" | grep -qF -- "$marker_text"; }; then
    echo "→ $TAG already contains $branch; skipping it"
    continue
  fi
  COMMITS="$(git rev-list --reverse --no-merges "${base:-upstream/main}..origin/$branch")"
  echo "→ Adding $branch ($(echo "$COMMITS" | wc -l | tr -d ' ') commits)"
  for c in $COMMITS; do
    if ! git cherry-pick "$c" >/dev/null; then
      if [ -z "$(git diff --name-only --diff-filter=U)" ]; then
        echo "  resolved with a recorded resolution: $(git log --oneline -1 "$c")"
        git -c core.editor=true cherry-pick --continue >/dev/null
        continue
      fi
      git cherry-pick --abort || true
      echo "Commit $(git log --oneline -1 "$c") does not apply on $TAG."
      echo "Rebase $branch onto upstream/main, or resolve the conflict once locally"
      echo "and copy .git/rr-cache into fork/rr-cache, then run this again."
      exit 1
    fi
  done
done <"$TOOLS/features.txt"

echo "→ Applying local-updates.patch (rebuild or fork release instead of auto-update)"
git apply --3way "$TOOLS/local-updates.patch"

echo "→ Stamping version $VERSION"
node -e '
  const fs = require("fs");
  const file = "apps/emdash-desktop/package.json";
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = process.argv[1];
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
' "$VERSION"
cp "$TOOLS/electron-builder.fork.config.ts" apps/emdash-desktop/
git add -A apps
git -c user.name="Xentropics build" -c user.email="build@invalid" \
  commit --quiet -m "local: Xentropics build $VERSION" --no-verify
echo "✓ Assembled $VERSION on $BUILD_BRANCH"
